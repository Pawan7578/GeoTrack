package db

import (
	"database/sql"
	"fmt"

	"github.com/geofence-system/backend/internal/models"
)

// CreateUser inserts a new user into the database
func CreateUser(email, passwordHash, role string) (*models.User, error) {
	user := &models.User{}

	err := DB.QueryRow(`
		INSERT INTO users (email, password_hash, role, status)
		VALUES ($1, $2, $3, 'active')
		RETURNING id, email, role, status, created_at, updated_at
	`, email, passwordHash, role).Scan(
		&user.ID, &user.Email, &user.Role, &user.Status,
		&user.CreatedAt, &user.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	return user, nil
}

// GetUserByEmail retrieves a user by email
func GetUserByEmail(email string) (*models.User, error) {
	user := &models.User{}

	err := DB.QueryRow(`
		SELECT id, email, password_hash, role, status, created_at, updated_at
		FROM users WHERE email = $1
	`, email).Scan(
		&user.ID, &user.Email, &user.Password, &user.Role, &user.Status,
		&user.CreatedAt, &user.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return user, nil
}

// GetUserByID retrieves a user by ID
func GetUserByID(userID string) (*models.User, error) {
	user := &models.User{}

	err := DB.QueryRow(`
		SELECT id, email, role, status, created_at, updated_at
		FROM users WHERE id = $1 AND status != 'suspended'
	`, userID).Scan(
		&user.ID, &user.Email, &user.Role, &user.Status,
		&user.CreatedAt, &user.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return user, nil
}

// UpdateUser updates user information
func UpdateUser(userID, role, status string) (*models.User, error) {
	user := &models.User{}

	err := DB.QueryRow(`
		UPDATE users
		SET role = COALESCE(NULLIF($2, ''), role),
			status = COALESCE(NULLIF($3, ''), status),
			updated_at = NOW()
		WHERE id = $1
		RETURNING id, email, role, status, created_at, updated_at
	`, userID, role, status).Scan(
		&user.ID, &user.Email, &user.Role, &user.Status,
		&user.CreatedAt, &user.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	return user, nil
}

// UserExists checks if a user exists by email
func UserExists(email string) (bool, error) {
	var exists bool
	err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)`, email).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check user existence: %w", err)
	}
	return exists, nil
}

// GetAllUsers retrieves all users with pagination
func GetAllUsers(limit, offset int) ([]models.User, int, error) {
	rows, err := DB.Query(`
		SELECT id, email, role, status, created_at, updated_at
		FROM users
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)

	if err != nil {
		return nil, 0, fmt.Errorf("failed to query users: %w", err)
	}
	defer rows.Close()

	users := []models.User{}
	for rows.Next() {
		user := models.User{}
		if err := rows.Scan(&user.ID, &user.Email, &user.Role, &user.Status,
			&user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, 0, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, user)
	}

	// Get total count
	var count int
	err = DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count users: %w", err)
	}

	return users, count, nil
}
