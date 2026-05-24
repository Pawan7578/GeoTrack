package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/geofence-system/backend/internal/db"
	apperrors "github.com/geofence-system/backend/internal/errors"
	"github.com/geofence-system/backend/internal/logger"
	"github.com/geofence-system/backend/internal/middleware"
	"github.com/geofence-system/backend/internal/models"
	"github.com/geofence-system/backend/internal/validation"
	"github.com/gorilla/mux"
)

// ConfigureAlert handles POST /alerts/configure
func ConfigureAlert(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	var req models.CreateAlertConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apperrors.WriteError(w, apperrors.BadRequestError("Invalid request body"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	fieldErrors := make(map[string]string)

	if req.GeofenceID == "" {
		fieldErrors["geofence_id"] = "Geofence ID is required"
	}
	if err := validation.ValidateEventType(req.EventType); err != nil {
		fieldErrors["event_type"] = err.Error()
	}

	if len(fieldErrors) > 0 {
		apperrors.WriteError(w, apperrors.ValidationErrorWithDetails(
			"Validation failed for alert configuration",
			fieldErrors,
		), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Verify geofence exists
	var geofenceExists bool
	if err := db.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM geofences WHERE id = $1 AND status = 'active')`, req.GeofenceID).
		Scan(&geofenceExists); err != nil || !geofenceExists {
		apperrors.WriteError(w, apperrors.NotFoundError("Geofence not found or is not active"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Verify vehicle exists if provided
	if req.VehicleID != nil && *req.VehicleID != "" {
		var vehicleExists bool
		if err := db.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM vehicles WHERE id = $1 AND status = 'active')`, *req.VehicleID).
			Scan(&vehicleExists); err != nil || !vehicleExists {
			apperrors.WriteError(w, apperrors.NotFoundError("Vehicle not found or is not active"), time.Since(start).Nanoseconds())
			logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
				time.Since(start).Seconds()*1000, userID, nil)
			return
		}
	} else {
		req.VehicleID = nil
	}

	var alertID, geofenceID, eventType, status string
	var vehicleID sql.NullString

	err := db.DB.QueryRow(`
		INSERT INTO alert_configs (geofence_id, vehicle_id, event_type, created_by, updated_by, status)
		VALUES ($1, $2, $3, $4, $4, 'active')
		RETURNING id, geofence_id, vehicle_id, event_type, status
	`, req.GeofenceID, nullableString(req.VehicleID), req.EventType, userID).
		Scan(&alertID, &geofenceID, &vehicleID, &eventType, &status)

	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to configure alert", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	var vid interface{} = nil
	if vehicleID.Valid {
		vid = vehicleID.String
	}

	response := map[string]interface{}{
		"alert_id":    alertID,
		"geofence_id": geofenceID,
		"vehicle_id":  vid,
		"event_type":  eventType,
		"status":      status,
	}

	logger.GeofenceEvent(requestID, userID, "alert_configured", alertID, "", map[string]interface{}{
		"geofence_id": geofenceID,
		"event_type":  eventType,
	})

	apperrors.WriteSuccess(w, response, http.StatusCreated, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusCreated,
		time.Since(start).Seconds()*1000, userID, nil)
}

// GetAlerts handles GET /alerts with optional filtering and pagination
func GetAlerts(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	q := r.URL.Query()
	geofenceID := q.Get("geofence_id")
	vehicleID := q.Get("vehicle_id")

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

	baseWhere := `WHERE status = 'active'`
	args := []interface{}{}
	argIdx := 1

	if geofenceID != "" {
		baseWhere += fmt.Sprintf(" AND geofence_id = $%d", argIdx)
		args = append(args, geofenceID)
		argIdx++
	}
	if vehicleID != "" {
		baseWhere += fmt.Sprintf(" AND vehicle_id = $%d", argIdx)
		args = append(args, vehicleID)
		argIdx++
	}

	var totalCount int
	if err := db.DB.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM alert_configs %s`, baseWhere), args...).Scan(&totalCount); err != nil {
		logger.Error("Failed to count alerts", err)
	}

	query := fmt.Sprintf(`
		SELECT id, geofence_id, vehicle_id, event_type, status, created_at, updated_at
		FROM alert_configs %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, baseWhere, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to fetch alerts", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}
	defer rows.Close()

	alerts := []map[string]interface{}{}
	for rows.Next() {
		var id, geofID, eventType, status string
		var vehID sql.NullString
		var createdAt, updatedAt time.Time

		if err := rows.Scan(&id, &geofID, &vehID, &eventType, &status, &createdAt, &updatedAt); err != nil {
			continue
		}

		alert := map[string]interface{}{
			"alert_id":    id,
			"geofence_id": geofID,
			"vehicle_id":  nil,
			"event_type":  eventType,
			"status":      status,
			"created_at":  createdAt,
			"updated_at":  updatedAt,
		}
		if vehID.Valid {
			alert["vehicle_id"] = vehID.String
		}
		alerts = append(alerts, alert)
	}

	response := map[string]interface{}{
		"alerts":      alerts,
		"count":       len(alerts),
		"total_count": totalCount,
		"limit":       limit,
		"offset":      offset,
	}

	apperrors.WriteSuccess(w, response, http.StatusOK, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
}

// GetViolationHistory handles GET /violations/history with filtering and pagination
func GetViolationHistory(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	q := r.URL.Query()
	vehicleID := q.Get("vehicle_id")
	geofenceID := q.Get("geofence_id")
	startDate := q.Get("start_date")
	endDate := q.Get("end_date")

	limit := 50
	offset := 0
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 {
		if l > 500 {
			l = 500
		}
		limit = l
	}
	if o, err := strconv.Atoi(q.Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	baseJoin := `
		FROM geofence_events ge
		JOIN vehicles v ON ge.vehicle_id = v.id
		JOIN geofences g ON ge.geofence_id = g.id
		WHERE 1=1
	`
	args := []interface{}{}
	argIdx := 1

	if vehicleID != "" {
		baseJoin += fmt.Sprintf(" AND ge.vehicle_id = $%d", argIdx)
		args = append(args, vehicleID)
		argIdx++
	}
	if geofenceID != "" {
		baseJoin += fmt.Sprintf(" AND ge.geofence_id = $%d", argIdx)
		args = append(args, geofenceID)
		argIdx++
	}
	if startDate != "" {
		baseJoin += fmt.Sprintf(" AND ge.timestamp >= $%d", argIdx)
		args = append(args, startDate)
		argIdx++
	}
	if endDate != "" {
		baseJoin += fmt.Sprintf(" AND ge.timestamp <= $%d", argIdx)
		args = append(args, endDate)
		argIdx++
	}

	var totalCount int
	if err := db.DB.QueryRow(fmt.Sprintf(`SELECT COUNT(*) %s`, baseJoin), args...).Scan(&totalCount); err != nil {
		logger.Error("Failed to count violations", err)
	}

	query := fmt.Sprintf(`
		SELECT ge.id, ge.vehicle_id, v.vehicle_number, ge.geofence_id, g.name,
			ge.event_type, ge.latitude, ge.longitude, ge.timestamp
		%s
		ORDER BY ge.timestamp DESC
		LIMIT $%d OFFSET $%d
	`, baseJoin, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to fetch violation history", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}
	defer rows.Close()

	violations := []models.GeofenceEvent{}
	for rows.Next() {
		var v models.GeofenceEvent
		if err := rows.Scan(&v.ID, &v.VehicleID, &v.VehicleNumber, &v.GeofenceID, &v.GeofenceName,
			&v.EventType, &v.Latitude, &v.Longitude, &v.Timestamp); err != nil {
			continue
		}
		violations = append(violations, v)
	}

	response := map[string]interface{}{
		"violations":  violations,
		"total_count": totalCount,
		"count":       len(violations),
		"limit":       limit,
		"offset":      offset,
	}

	apperrors.WriteSuccess(w, response, http.StatusOK, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
}

// DeleteAlert handles DELETE /alerts/{id}
func DeleteAlert(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	alertID := mux.Vars(r)["id"]
	if alertID == "" {
		apperrors.WriteError(w, apperrors.BadRequestError("Alert ID is required"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Check if alert exists
	var exists bool
	if err := db.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM alert_configs WHERE id = $1)`, alertID).Scan(&exists); err != nil || !exists {
		apperrors.WriteError(w, apperrors.NotFoundError("Alert not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Delete alert
	result, err := db.DB.Exec(`DELETE FROM alert_configs WHERE id = $1`, alertID)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to delete alert", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil || rowsAffected == 0 {
		apperrors.WriteError(w, apperrors.NotFoundError("Alert not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Alert deleted successfully"}`))
}

// ClearAllAlerts handles DELETE /alerts
func ClearAllAlerts(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	// Delete all alerts
	result, err := db.DB.Exec(`DELETE FROM alert_configs`)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to clear all alerts", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	rowsAffected, _ := result.RowsAffected()

	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(fmt.Sprintf(`{"success":true,"message":"All alerts cleared","deleted":%d}`, rowsAffected)))
}
