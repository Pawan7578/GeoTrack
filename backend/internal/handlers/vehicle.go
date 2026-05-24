package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/geofence-system/backend/internal/db"
	apperrors "github.com/geofence-system/backend/internal/errors"
	"github.com/geofence-system/backend/internal/logger"
	"github.com/geofence-system/backend/internal/middleware"
	"github.com/geofence-system/backend/internal/models"
	"github.com/geofence-system/backend/internal/validation"
	ws "github.com/geofence-system/backend/internal/websocket"
	"github.com/gorilla/mux"
)

// Hub is the shared WebSocket hub, injected at startup
var Hub *ws.Hub

// CreateVehicle handles POST /vehicles
func CreateVehicle(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	var req models.CreateVehicleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apperrors.WriteError(w, apperrors.BadRequestError("Invalid request body"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	fieldErrors := make(map[string]string)

	if err := validation.ValidateVehicleNumber(req.VehicleNumber); err != nil {
		fieldErrors["vehicle_number"] = err.Error()
	}
	if req.DriverName == "" {
		fieldErrors["driver_name"] = "Driver name is required"
	}
	if req.VehicleType == "" {
		fieldErrors["vehicle_type"] = "Vehicle type is required"
	}
	if err := validation.ValidatePhone(req.Phone); err != nil {
		fieldErrors["phone"] = err.Error()
	}

	if len(fieldErrors) > 0 {
		apperrors.WriteError(w, apperrors.ValidationErrorWithDetails(
			"Validation failed for vehicle creation",
			fieldErrors,
		), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	var vehicle models.Vehicle
	err := db.DB.QueryRow(`
		INSERT INTO vehicles (vehicle_number, driver_name, vehicle_type, phone, created_by, updated_by, status)
		VALUES ($1, $2, $3, $4, $5, $5, 'active')
		RETURNING id, vehicle_number, driver_name, vehicle_type, phone, status, created_by, updated_by, created_at, updated_at
	`, req.VehicleNumber, req.DriverName, req.VehicleType, req.Phone, userID).Scan(
		&vehicle.ID, &vehicle.VehicleNumber, &vehicle.DriverName,
		&vehicle.VehicleType, &vehicle.Phone, &vehicle.Status,
		&vehicle.CreatedBy, &vehicle.UpdatedBy, &vehicle.CreatedAt, &vehicle.UpdatedAt,
	)

	if err != nil {
		// FIX: use strings.Contains instead of custom contains functions
		if isUniqueViolation(err) {
			apperrors.WriteError(w, apperrors.ConflictError("Vehicle number already exists"), time.Since(start).Nanoseconds())
		} else {
			apperrors.WriteError(w, apperrors.InternalServerError("Failed to create vehicle", err), time.Since(start).Nanoseconds())
		}
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	logger.GeofenceEvent(requestID, userID, "vehicle_created", vehicle.ID, "", map[string]interface{}{
		"vehicle_number": vehicle.VehicleNumber,
		"driver_name":    vehicle.DriverName,
		"vehicle_type":   vehicle.VehicleType,
	})

	apperrors.WriteSuccess(w, vehicle, http.StatusCreated, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusCreated,
		time.Since(start).Seconds()*1000, userID, nil)
}

// GetVehicles handles GET /vehicles with pagination
func GetVehicles(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	q := r.URL.Query()
	limit := 50
	offset := 0
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 {
		if l > 200 {
			l = 200
		}
		limit = l
	}
	if o, err := strconv.Atoi(q.Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	var totalCount int
	if err := db.DB.QueryRow(`SELECT COUNT(*) FROM vehicles WHERE status = 'active'`).Scan(&totalCount); err != nil {
		logger.Error("Failed to count vehicles", err)
	}

	rows, err := db.DB.Query(`
		SELECT id, vehicle_number, driver_name, vehicle_type, phone, status, created_by, updated_by, created_at, updated_at
		FROM vehicles
		WHERE status = 'active'
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to fetch vehicles", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}
	defer rows.Close()

	vehicles := []models.Vehicle{}
	for rows.Next() {
		var v models.Vehicle
		if err := rows.Scan(&v.ID, &v.VehicleNumber, &v.DriverName, &v.VehicleType, &v.Phone, &v.Status,
			&v.CreatedBy, &v.UpdatedBy, &v.CreatedAt, &v.UpdatedAt); err != nil {
			continue
		}
		vehicles = append(vehicles, v)
	}

	response := map[string]interface{}{
		"vehicles":    vehicles,
		"count":       len(vehicles),
		"total_count": totalCount,
		"limit":       limit,
		"offset":      offset,
	}

	apperrors.WriteSuccess(w, response, http.StatusOK, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
}

// UpdateVehicleLocation handles POST /vehicles/location
func UpdateVehicleLocation(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	var req models.LocationUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apperrors.WriteError(w, apperrors.BadRequestError("Invalid request body"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	fieldErrors := make(map[string]string)
	if req.VehicleID == "" {
		fieldErrors["vehicle_id"] = "Vehicle ID is required"
	}
	if err := validation.ValidateLat(req.Latitude); err != nil {
		fieldErrors["latitude"] = err.Error()
	}
	if err := validation.ValidateLon(req.Longitude); err != nil {
		fieldErrors["longitude"] = err.Error()
	}

	if len(fieldErrors) > 0 {
		apperrors.WriteError(w, apperrors.ValidationErrorWithDetails("Validation failed", fieldErrors), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Default timestamp to now if not provided
	if req.Timestamp.IsZero() {
		req.Timestamp = time.Now().UTC()
	}

	// Verify vehicle exists
	var vehicleID, vehicleNumber, driverName string
	err := db.DB.QueryRow(`SELECT id, vehicle_number, driver_name FROM vehicles WHERE id = $1 AND status = 'active'`, req.VehicleID).
		Scan(&vehicleID, &vehicleNumber, &driverName)
	if err == sql.ErrNoRows {
		apperrors.WriteError(w, apperrors.NotFoundError("Vehicle not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to verify vehicle", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	// Store location history
	_, err = db.DB.Exec(`
		INSERT INTO vehicle_locations (vehicle_id, latitude, longitude, location, timestamp)
		VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4)
	`, vehicleID, req.Latitude, req.Longitude, req.Timestamp)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to store location", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	// Upsert current position
	_, err = db.DB.Exec(`
		INSERT INTO vehicle_current_positions (vehicle_id, latitude, longitude, location, timestamp, updated_at)
		VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, NOW())
		ON CONFLICT (vehicle_id) DO UPDATE SET
			latitude = EXCLUDED.latitude,
			longitude = EXCLUDED.longitude,
			location = EXCLUDED.location,
			timestamp = EXCLUDED.timestamp,
			updated_at = NOW()
	`, vehicleID, req.Latitude, req.Longitude, req.Timestamp)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to update current position", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	// Fetch current geofences for this position
	currentGeofences, err := getContainingGeofences(req.Latitude, req.Longitude)
	if err != nil {
		currentGeofences = []models.GeofenceRef{}
	}

	log.Printf("[LOCATION] Vehicle %s at (%.4f, %.4f) - inside %d geofences", vehicleNumber, req.Latitude, req.Longitude, len(currentGeofences))

	// Fetch previous geofence state
	prevRows, err := db.DB.Query(`SELECT geofence_id FROM vehicle_geofence_state WHERE vehicle_id = $1`, vehicleID)
	prevGeofenceIDs := map[string]bool{}
	if err == nil {
		defer prevRows.Close()
		for prevRows.Next() {
			var gid string
			if scanErr := prevRows.Scan(&gid); scanErr == nil {
				prevGeofenceIDs[gid] = true
			}
		}
	}

	log.Printf("[LOCATION] Previous geofences: %d", len(prevGeofenceIDs))

	// Detect entry/exit events asynchronously — does not block the HTTP response
	go detectAndBroadcastEvents(vehicleID, vehicleNumber, driverName, req.Latitude, req.Longitude, req.Timestamp, currentGeofences, prevGeofenceIDs)

	response := map[string]interface{}{
		"vehicle_id":        vehicleID,
		"location_updated":  true,
		"current_geofences": currentGeofences,
	}

	apperrors.WriteSuccess(w, response, http.StatusOK, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
}

// GetVehicleLocation handles GET /vehicles/location/{vehicle_id}
func GetVehicleLocation(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	vehicleID := mux.Vars(r)["vehicle_id"]
	if vehicleID == "" {
		apperrors.WriteError(w, apperrors.BadRequestError("Vehicle ID is required"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	var vehicle models.Vehicle
	err := db.DB.QueryRow(`
		SELECT id, vehicle_number, driver_name, vehicle_type, phone, status, created_by, updated_by, created_at, updated_at
		FROM vehicles WHERE id = $1
	`, vehicleID).Scan(&vehicle.ID, &vehicle.VehicleNumber, &vehicle.DriverName,
		&vehicle.VehicleType, &vehicle.Phone, &vehicle.Status, &vehicle.CreatedBy, &vehicle.UpdatedBy,
		&vehicle.CreatedAt, &vehicle.UpdatedAt)
	if err == sql.ErrNoRows {
		apperrors.WriteError(w, apperrors.NotFoundError("Vehicle not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to fetch vehicle", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	var loc *models.Location
	var lat, lon float64
	var ts time.Time
	if err := db.DB.QueryRow(`
		SELECT latitude, longitude, timestamp FROM vehicle_current_positions WHERE vehicle_id = $1
	`, vehicleID).Scan(&lat, &lon, &ts); err == nil {
		loc = &models.Location{Latitude: lat, Longitude: lon, Timestamp: ts}
	}

	currentGeofences := []models.GeofenceRef{}
	if loc != nil {
		currentGeofences, _ = getContainingGeofences(loc.Latitude, loc.Longitude)
	}

	response := map[string]interface{}{
		"vehicle_id":        vehicleID,
		"vehicle_number":    vehicle.VehicleNumber,
		"current_location":  loc,
		"current_geofences": currentGeofences,
	}

	apperrors.WriteSuccess(w, response, http.StatusOK, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
}

// detectAndBroadcastEvents detects geofence entry/exit events and broadcasts alerts via WebSocket
func detectAndBroadcastEvents(
	vehicleID, vehicleNumber, driverName string,
	lat, lon float64,
	ts time.Time,
	currentGeofences []models.GeofenceRef,
	prevGeofenceIDs map[string]bool,
) {
	currentGeofenceIDs := map[string]bool{}
	currentGeofenceMap := map[string]models.GeofenceRef{}
	for _, gf := range currentGeofences {
		currentGeofenceIDs[gf.GeofenceID] = true
		currentGeofenceMap[gf.GeofenceID] = gf
	}

	log.Printf("[DETECT] Vehicle=%s, Current=%v, Previous=%v", vehicleNumber, len(currentGeofenceIDs), len(prevGeofenceIDs))

	// Detect entries (in current but not previous)
	for gid := range currentGeofenceIDs {
		if !prevGeofenceIDs[gid] {
			log.Printf("[DETECT] Entry detected: vehicle=%s, geofence=%s", vehicleNumber, gid)
			storeAndBroadcastEvent(vehicleID, vehicleNumber, driverName, lat, lon, ts, currentGeofenceMap[gid], "entry")
		}
	}

	// Detect exits (in previous but not current)
	for gid := range prevGeofenceIDs {
		if !currentGeofenceIDs[gid] {
			log.Printf("[DETECT] Exit detected: vehicle=%s, geofence=%s", vehicleNumber, gid)
			var gf models.GeofenceRef
			if err := db.DB.QueryRow(`SELECT id, name, category FROM geofences WHERE id = $1`, gid).
				Scan(&gf.GeofenceID, &gf.GeofenceName, &gf.Category); err == nil {
				storeAndBroadcastEvent(vehicleID, vehicleNumber, driverName, lat, lon, ts, gf, "exit")
			}
		}
	}

	// Update vehicle geofence state atomically
	tx, err := db.DB.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()

	tx.Exec(`DELETE FROM vehicle_geofence_state WHERE vehicle_id = $1`, vehicleID)
	for gid := range currentGeofenceIDs {
		tx.Exec(`
			INSERT INTO vehicle_geofence_state (vehicle_id, geofence_id, entered_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (vehicle_id, geofence_id) DO NOTHING
		`, vehicleID, gid, ts)
	}
	tx.Commit()
}

// storeAndBroadcastEvent stores a geofence event and broadcasts a WebSocket alert if configured
func storeAndBroadcastEvent(
	vehicleID, vehicleNumber, driverName string,
	lat, lon float64,
	ts time.Time,
	gf models.GeofenceRef,
	eventType string,
) {
	var eventID string
	err := db.DB.QueryRow(`
		INSERT INTO geofence_events (vehicle_id, geofence_id, event_type, latitude, longitude, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, vehicleID, gf.GeofenceID, eventType, lat, lon, ts).Scan(&eventID)
	if err != nil {
		logger.Error("Failed to store geofence event", err)
		return
	}

	// Only broadcast if an alert config matches this event
	// For systems without explicit alert configs, broadcast all events
	var hasAlert bool
	err = db.DB.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM alert_configs
			WHERE geofence_id = $1
			AND (vehicle_id IS NULL OR vehicle_id = $2)
			AND (event_type = $3 OR event_type = 'both')
			AND status = 'active'
		)
	`, gf.GeofenceID, vehicleID, eventType).Scan(&hasAlert)

	if err != nil {
		logger.Error("Failed to check alert config", err)
		return
	}

	// If no specific alert config, still broadcast the event (development mode)
	if !hasAlert {
		log.Printf("[ALERT] No explicit alert config, broadcasting event anyway - vehicle=%s, geofence=%s, event=%s", vehicleNumber, gf.GeofenceID, eventType)
	}

	if Hub == nil {
		log.Printf("[ALERT] Hub is nil, cannot broadcast alert")
		return
	}

	alert := models.WebSocketAlert{
		EventID:   fmt.Sprintf("evt_%s", eventID[:8]),
		EventType: eventType,
		Timestamp: ts,
		Vehicle: models.WSVehicleInfo{
			VehicleID:     vehicleID,
			VehicleNumber: vehicleNumber,
			DriverName:    driverName,
		},
		Geofence: models.WSGeofenceInfo{
			GeofenceID:   gf.GeofenceID,
			GeofenceName: gf.GeofenceName,
			Category:     gf.Category,
		},
		Location: models.WSLocationInfo{
			Latitude:  lat,
			Longitude: lon,
		},
	}

	log.Printf("[ALERT] Broadcasting: vehicle=%s, geofence=%s, event=%s", vehicleNumber, gf.GeofenceName, eventType)
	Hub.BroadcastAlert(alert)
}

// DeleteVehicle handles DELETE /vehicles/{id}
func DeleteVehicle(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	vehicleID := mux.Vars(r)["id"]
	if vehicleID == "" {
		apperrors.WriteError(w, apperrors.BadRequestError("Vehicle ID is required"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Start transaction
	tx, err := db.DB.Begin()
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to start transaction", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}
	defer tx.Rollback()

	// Check if vehicle exists
	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM vehicles WHERE id = $1)`, vehicleID).Scan(&exists); err != nil || !exists {
		apperrors.WriteError(w, apperrors.NotFoundError("Vehicle not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Delete vehicle locations
	tx.Exec(`DELETE FROM vehicle_locations WHERE vehicle_id = $1`, vehicleID)
	tx.Exec(`DELETE FROM vehicle_current_positions WHERE vehicle_id = $1`, vehicleID)
	tx.Exec(`DELETE FROM vehicle_geofence_state WHERE vehicle_id = $1`, vehicleID)

	// Delete vehicle
	result, err := tx.Exec(`DELETE FROM vehicles WHERE id = $1`, vehicleID)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to delete vehicle", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil || rowsAffected == 0 {
		apperrors.WriteError(w, apperrors.NotFoundError("Vehicle not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	if err := tx.Commit(); err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to commit transaction", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Vehicle deleted successfully"}`))
}

// isUniqueViolation checks if an error is a PostgreSQL unique constraint violation
// FIX: uses strings.Contains instead of a hand-rolled loop
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique constraint")
}
