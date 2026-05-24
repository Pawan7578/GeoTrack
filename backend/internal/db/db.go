package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

var DB *sql.DB

var SystemUserID string

// Connect opens a connection to Supabase via the Transaction Pooler (port 6543).
//
// IMPORTANT: prefer_simple_protocol MUST be set via pgx.ParseConfig in code.
// Passing it as a URL parameter (?prefer_simple_protocol=true) is silently
// ignored by pgx/v5/stdlib — prepared statements still get used, causing
// "prepared statement already exists / does not exist" errors against PgBouncer.
func Connect() error {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		return errors.New("DATABASE_URL environment variable is required")
	}

	// Enforce SSL — required by Supabase
	if !strings.Contains(dsn, "sslmode=") {
		if strings.Contains(dsn, "?") {
			dsn += "&sslmode=require"
		} else {
			dsn += "?sslmode=require"
		}
	}

	// Parse the DSN into a pgx config struct
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("failed to parse DATABASE_URL: %w", err)
	}

	// THIS is the critical line — must be set in code, not in the URL.
	// Disables prepared statements so PgBouncer (Supabase Transaction Pooler)
	// can route queries across connections without statement cache conflicts.
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	// Open database/sql wrapper using the configured pgx connection
	DB = stdlib.OpenDB(*config)

	// Supabase free plan: 60 pooler connections max — keep pool conservative
	DB.SetMaxOpenConns(10)
	DB.SetMaxIdleConns(5)
	DB.SetConnMaxLifetime(5 * time.Minute)
	DB.SetConnMaxIdleTime(2 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err = DB.PingContext(ctx); err != nil {
		_ = DB.Close()
		return fmt.Errorf("failed to reach Supabase database: %w", err)
	}

	log.Println("Supabase database connected successfully")
	return nil
}

// InitializeSystemUser creates or retrieves the system user.
func InitializeSystemUser() error {
	var existingID string
	err := DB.QueryRow(`
		SELECT id FROM users WHERE email = 'system@geofence' LIMIT 1
	`).Scan(&existingID)

	if err == nil {
		SystemUserID = existingID
		log.Printf("Using existing system user: %s", SystemUserID)
		return nil
	}

	if err != sql.ErrNoRows {
		return fmt.Errorf("failed to check for system user: %w", err)
	}

	err = DB.QueryRow(`
		INSERT INTO users (email, password_hash, role, status)
		VALUES ('system@geofence', '', 'admin', 'active')
		RETURNING id
	`).Scan(&SystemUserID)

	if err != nil {
		return fmt.Errorf("failed to create system user: %w", err)
	}

	log.Printf("Created system user: %s", SystemUserID)
	return nil
}