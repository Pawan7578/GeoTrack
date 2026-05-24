package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/geofence-system/backend/internal/db"
	apphandlers "github.com/geofence-system/backend/internal/handlers"
	"github.com/geofence-system/backend/internal/logger"
	"github.com/geofence-system/backend/internal/middleware"
	ws "github.com/geofence-system/backend/internal/websocket"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
)

// Migrations are NOT run at startup.
// Run migrations/001_init.sql once in the Supabase SQL Editor.

func main() {
	logger.SetLogLevel(logger.INFO)
	logger.Info("Starting GeoTrack server...")

	if err := db.Connect(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.DB.Close()

	if err := db.InitializeSystemUser(); err != nil {
		log.Fatalf("Failed to initialize system user: %v", err)
	}

	hub := ws.NewHub()
	go hub.Run()
	apphandlers.Hub = hub

	r := mux.NewRouter()
	r.Use(middleware.RequestLogger)

	apiRouter := r.PathPrefix("/api").Subrouter()
	apiRouter.Use(middleware.InjectSystemUserMiddleware)

	// Geofence routes
	apiRouter.HandleFunc("/geofences", apphandlers.CreateGeofence).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/geofences", apphandlers.GetGeofences).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/geofences/{id}", apphandlers.UpdateGeofence).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/geofences/{id}", apphandlers.DeleteGeofence).Methods("DELETE", "OPTIONS")

	// Vehicle routes
	apiRouter.HandleFunc("/vehicles", apphandlers.CreateVehicle).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/vehicles", apphandlers.GetVehicles).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/vehicles/{id}", apphandlers.DeleteVehicle).Methods("DELETE", "OPTIONS")
	apiRouter.Handle("/vehicles/location",
		middleware.LocationRateLimitMiddleware(http.HandlerFunc(apphandlers.UpdateVehicleLocation)),
	).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/vehicles/location/{vehicle_id}", apphandlers.GetVehicleLocation).Methods("GET", "OPTIONS")

	// Alert routes
	apiRouter.HandleFunc("/alerts/configure", apphandlers.ConfigureAlert).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/alerts", apphandlers.GetAlerts).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/alerts/{id}", apphandlers.DeleteAlert).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/alerts", apphandlers.ClearAllAlerts).Methods("DELETE", "OPTIONS")

	// Violation history
	apiRouter.HandleFunc("/violations/history", apphandlers.GetViolationHistory).Methods("GET", "OPTIONS")

	// WebSocket
	wsHandler := func(w http.ResponseWriter, r *http.Request) {
		ws.ServeWS(hub, w, r)
	}
	r.HandleFunc("/ws/alerts", wsHandler).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/ws/alerts", wsHandler).Methods("GET", "OPTIONS")

	// Health check
	apiRouter.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"geotrack"}`))
	}).Methods("GET", "OPTIONS")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}

	allowedOrigins := getAllowedOrigins()
	allowedMethods := []string{
		http.MethodGet, http.MethodPost,
		http.MethodPut, http.MethodDelete, http.MethodOptions,
	}
	allowedHeaders := []string{"Content-Type", "Authorization"}

	corsMiddleware := handlers.CORS(
		handlers.AllowedOrigins(allowedOrigins),
		handlers.AllowedMethods(allowedMethods),
		handlers.AllowedHeaders(allowedHeaders),
		handlers.AllowCredentials(),
		handlers.OptionStatusCode(http.StatusOK),
		handlers.MaxAge(3600),
	)

	addr := fmt.Sprintf("%s:%s", host, port)

	server := &http.Server{
		Addr:              addr,
		Handler:           corsMiddleware(r),
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	logger.Info("Server listening", map[string]interface{}{"host": host, "port": port})
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func getAllowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if raw == "" {
		logger.Warn("CORS_ALLOWED_ORIGINS not set — falling back to localhost only")
		return []string{"http://localhost:3000", "http://localhost:5173"}
	}
	var origins []string
	for _, o := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	if len(origins) == 0 {
		return []string{"http://localhost:3000", "http://localhost:5173"}
	}
	logger.Info("CORS allowed origins", map[string]interface{}{"origins": origins})
	return origins
}