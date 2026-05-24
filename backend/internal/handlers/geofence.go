package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
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
	"github.com/gorilla/mux"
)

// CreateGeofence handles POST /geofences
func CreateGeofence(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	var req models.CreateGeofenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apperrors.WriteError(w, apperrors.BadRequestError("Invalid request body"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	fieldErrors := make(map[string]string)

	if err := validation.ValidateGeofenceName(req.Name); err != nil {
		fieldErrors["name"] = err.Error()
	}

	if err := validation.ValidateGeofenceCategory(req.Category); err != nil {
		fieldErrors["category"] = err.Error()
	}

	if err := validation.ValidateCoordinates(req.Coordinates); err != nil {
		fieldErrors["coordinates"] = err.Error()
	}

	if len(fieldErrors) > 0 {
		apperrors.WriteError(w, apperrors.ValidationErrorWithDetails(
			"Validation failed for geofence creation",
			fieldErrors,
		), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Auto-close polygon if open
	coordinates := req.Coordinates
	if !validation.ValidatePolygonClosure(coordinates) {
		coordinates = append(coordinates, coordinates[0])
	}

	// Build PostGIS WKT — coordinates are [lat, lon]; WKT expects (lon lat)
	wkt := buildPolygonWKT(coordinates)

	coordsJSON, err := json.Marshal(coordinates)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to serialize coordinates", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	var geofence models.Geofence
	err = db.DB.QueryRow(`
		INSERT INTO geofences (name, description, category, coordinates, boundary, created_by, updated_by, status)
		VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6, $6, 'active')
		RETURNING id, name, description, category, status, created_by, updated_by, created_at, updated_at
	`, req.Name, req.Description, req.Category, string(coordsJSON), wkt, userID).Scan(
		&geofence.ID, &geofence.Name, &geofence.Description, &geofence.Category,
		&geofence.Status, &geofence.CreatedBy, &geofence.UpdatedBy, &geofence.CreatedAt, &geofence.UpdatedAt,
	)

	if err != nil {
		apperrors.WriteError(w, apperrors.DatabaseErrorValue("create geofence", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	geofence.Coordinates = coordinates

	logger.GeofenceEvent(requestID, userID, "geofence_created", geofence.ID, "", map[string]interface{}{
		"name":     geofence.Name,
		"category": geofence.Category,
	})

	apperrors.WriteSuccess(w, geofence, http.StatusCreated, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusCreated,
		time.Since(start).Seconds()*1000, userID, nil)
}

// GetGeofences handles GET /geofences with filtering and pagination
func GetGeofences(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	q := r.URL.Query()
	category := q.Get("category")

	// Pagination — default 50, max 200
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

	query := `
		SELECT id, name, description, category, coordinates, status, created_by, updated_by, created_at, updated_at
		FROM geofences
		WHERE 1=1
	`
	countQuery := `SELECT COUNT(*) FROM geofences WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if category != "" {
		if err := validation.ValidateGeofenceCategory(category); err == nil {
			clause := fmt.Sprintf(" AND category = $%d", argIdx)
			query += clause
			countQuery += clause
			args = append(args, category)
			argIdx++
		}
	}

	var totalCount int
	if err := db.DB.QueryRow(countQuery, args...).Scan(&totalCount); err != nil {
		logger.Error("Failed to count geofences", err)
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		apperrors.WriteError(w, apperrors.DatabaseErrorValue("query geofences", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}
	defer rows.Close()

	geofences := []models.Geofence{}
	for rows.Next() {
		var g models.Geofence
		var coordsJSON string
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.Category, &coordsJSON,
			&g.Status, &g.CreatedBy, &g.UpdatedBy, &g.CreatedAt, &g.UpdatedAt); err != nil {
			logger.Error("Failed to scan geofence", err)
			continue
		}
		if err := json.Unmarshal([]byte(coordsJSON), &g.Coordinates); err != nil {
			g.Coordinates = [][]float64{}
		}
		geofences = append(geofences, g)
	}

	response := map[string]interface{}{
		"geofences":   geofences,
		"count":       len(geofences),
		"total_count": totalCount,
		"limit":       limit,
		"offset":      offset,
	}

	apperrors.WriteSuccess(w, response, http.StatusOK, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
}

// UpdateGeofence handles PUT /geofences/{id}
func UpdateGeofence(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	geofenceID := mux.Vars(r)["id"]
	if geofenceID == "" {
		apperrors.WriteError(w, apperrors.BadRequestError("Geofence ID is required"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	var req models.CreateGeofenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apperrors.WriteError(w, apperrors.BadRequestError("Invalid request body"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	fieldErrors := make(map[string]string)

	if err := validation.ValidateGeofenceName(req.Name); err != nil {
		fieldErrors["name"] = err.Error()
	}

	if err := validation.ValidateGeofenceCategory(req.Category); err != nil {
		fieldErrors["category"] = err.Error()
	}

	if err := validation.ValidateCoordinates(req.Coordinates); err != nil {
		fieldErrors["coordinates"] = err.Error()
	}

	if len(fieldErrors) > 0 {
		apperrors.WriteError(w, apperrors.ValidationErrorWithDetails(
			"Validation failed for geofence update",
			fieldErrors,
		), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Auto-close polygon if open
	coordinates := req.Coordinates
	if !validation.ValidatePolygonClosure(coordinates) {
		coordinates = append(coordinates, coordinates[0])
	}

	// Build PostGIS WKT — coordinates are [lat, lon]; WKT expects (lon lat)
	wkt := buildPolygonWKT(coordinates)

	coordsJSON, err := json.Marshal(coordinates)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to serialize coordinates", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	var geofence models.Geofence
	err = db.DB.QueryRow(`
		UPDATE geofences 
		SET name = $1, description = $2, category = $3, coordinates = $4, boundary = ST_GeomFromText($5, 4326), updated_by = $6, updated_at = NOW()
		WHERE id = $7
		RETURNING id, name, description, category, status, created_by, updated_by, created_at, updated_at
	`, req.Name, req.Description, req.Category, string(coordsJSON), wkt, userID, geofenceID).Scan(
		&geofence.ID, &geofence.Name, &geofence.Description, &geofence.Category,
		&geofence.Status, &geofence.CreatedBy, &geofence.UpdatedBy, &geofence.CreatedAt, &geofence.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		apperrors.WriteError(w, apperrors.NotFoundError("Geofence not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	if err != nil {
		apperrors.WriteError(w, apperrors.DatabaseErrorValue("update geofence", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	geofence.Coordinates = coordinates

	logger.GeofenceEvent(requestID, userID, "geofence_updated", geofence.ID, "", map[string]interface{}{
		"name":     geofence.Name,
		"category": geofence.Category,
	})

	apperrors.WriteSuccess(w, geofence, http.StatusOK, time.Since(start).Nanoseconds())
	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
}

// buildPolygonWKT converts [lat,lon] coordinate pairs to PostGIS WKT POLYGON (lon lat)
func buildPolygonWKT(coords [][]float64) string {
	points := make([]string, len(coords))
	for i, c := range coords {
		// coords[i] = [lat, lon] — PostGIS WKT requires (lon lat) order
		points[i] = fmt.Sprintf("%f %f", c[1], c[0])
	}
	return fmt.Sprintf("POLYGON((%s))", strings.Join(points, ", "))
}

// getContainingGeofences returns all active geofences that contain the given point
func getContainingGeofences(lat, lon float64) ([]models.GeofenceRef, error) {
	rows, err := db.DB.Query(`
		SELECT id, name, category
		FROM geofences
		WHERE ST_Contains(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
		AND status = 'active'
	`, lon, lat) // ST_MakePoint expects (lon, lat)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	refs := []models.GeofenceRef{}
	for rows.Next() {
		var ref models.GeofenceRef
		if err := rows.Scan(&ref.GeofenceID, &ref.GeofenceName, &ref.Category); err != nil {
			continue
		}
		refs = append(refs, ref)
	}
	return refs, nil
}

// DeleteGeofence handles DELETE /geofences/{id}
func DeleteGeofence(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	userID, _ := r.Context().Value(middleware.UserIDKey).(string)
	requestID, _ := r.Context().Value(middleware.RequestIDKey).(string)

	geofenceID := mux.Vars(r)["id"]
	if geofenceID == "" {
		apperrors.WriteError(w, apperrors.BadRequestError("Geofence ID is required"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusBadRequest,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Check if geofence exists
	var exists bool
	if err := db.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM geofences WHERE id = $1)`, geofenceID).Scan(&exists); err != nil || !exists {
		apperrors.WriteError(w, apperrors.NotFoundError("Geofence not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	// Delete geofence
	result, err := db.DB.Exec(`DELETE FROM geofences WHERE id = $1`, geofenceID)
	if err != nil {
		apperrors.WriteError(w, apperrors.InternalServerError("Failed to delete geofence", err), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusInternalServerError,
			time.Since(start).Seconds()*1000, userID, err)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil || rowsAffected == 0 {
		apperrors.WriteError(w, apperrors.NotFoundError("Geofence not found"), time.Since(start).Nanoseconds())
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusNotFound,
			time.Since(start).Seconds()*1000, userID, nil)
		return
	}

	logger.GeofenceEvent(requestID, userID, "geofence_deleted", geofenceID, "", nil)

	logger.HTTPRequest(requestID, r.Method, r.URL.Path, http.StatusOK,
		time.Since(start).Seconds()*1000, userID, nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Geofence deleted successfully"}`))
}

func nullableString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{String: *s, Valid: true}
}
