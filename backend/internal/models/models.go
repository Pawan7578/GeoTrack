package models

import "time"

// User represents a system user with authentication
type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`    // Never expose password
	Role      string    `json:"role"` // admin, user
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CreateUserRequest is the request body for creating a user
type CreateUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"` // admin, user
}

// LoginRequest is the request body for login
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse is returned after successful authentication
type AuthResponse struct {
	User         User   `json:"user"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

// Geofence represents a geofenced area
type Geofence struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Category    string      `json:"category"`
	Coordinates [][]float64 `json:"coordinates"`
	Status      string      `json:"status"`
	CreatedBy   string      `json:"created_by"`
	UpdatedBy   string      `json:"updated_by"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

// CreateGeofenceRequest is the request body for creating a geofence
type CreateGeofenceRequest struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Coordinates [][]float64 `json:"coordinates"`
	Category    string      `json:"category"`
}

// Vehicle represents a registered vehicle
type Vehicle struct {
	ID            string    `json:"id"`
	VehicleNumber string    `json:"vehicle_number"`
	DriverName    string    `json:"driver_name"`
	VehicleType   string    `json:"vehicle_type"`
	Phone         string    `json:"phone"`
	Status        string    `json:"status"`
	CreatedBy     string    `json:"created_by"`
	UpdatedBy     string    `json:"updated_by"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// CreateVehicleRequest is the request body for creating a vehicle
type CreateVehicleRequest struct {
	VehicleNumber string `json:"vehicle_number"`
	DriverName    string `json:"driver_name"`
	VehicleType   string `json:"vehicle_type"`
	Phone         string `json:"phone"`
}

// LocationUpdateRequest is the request body for updating vehicle location
type LocationUpdateRequest struct {
	VehicleID string    `json:"vehicle_id"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Timestamp time.Time `json:"timestamp"`
}

// GeofenceRef is a lightweight geofence reference
type GeofenceRef struct {
	GeofenceID   string `json:"geofence_id"`
	GeofenceName string `json:"geofence_name"`
	Category     string `json:"category"`
}

// LocationUpdateResponse is the response for location update
type LocationUpdateResponse struct {
	VehicleID        string        `json:"vehicle_id"`
	LocationUpdated  bool          `json:"location_updated"`
	CurrentGeofences []GeofenceRef `json:"current_geofences"`
	TimeNs           int64         `json:"time_ns"`
}

// VehicleLocation represents a vehicle's current location with geofence status
type VehicleLocation struct {
	VehicleID        string        `json:"vehicle_id"`
	VehicleNumber    string        `json:"vehicle_number"`
	CurrentLocation  *Location     `json:"current_location"`
	CurrentGeofences []GeofenceRef `json:"current_geofences"`
	TimeNs           int64         `json:"time_ns"`
}

// Location represents a geographic point
type Location struct {
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Timestamp time.Time `json:"timestamp"`
}

// AlertConfig represents an alert rule configuration
type AlertConfig struct {
	ID         string    `json:"alert_id"`
	GeofenceID string    `json:"geofence_id"`
	VehicleID  *string   `json:"vehicle_id"`
	EventType  string    `json:"event_type"`
	Status     string    `json:"status"`
	CreatedBy  string    `json:"created_by"`
	UpdatedBy  string    `json:"updated_by"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// CreateAlertConfigRequest is the request body for creating an alert config
type CreateAlertConfigRequest struct {
	GeofenceID string  `json:"geofence_id"`
	VehicleID  *string `json:"vehicle_id"`
	EventType  string  `json:"event_type"`
}

// GeofenceEvent represents a historical geofence entry/exit event
type GeofenceEvent struct {
	ID            string    `json:"id"`
	VehicleID     string    `json:"vehicle_id"`
	VehicleNumber string    `json:"vehicle_number"`
	GeofenceID    string    `json:"geofence_id"`
	GeofenceName  string    `json:"geofence_name"`
	EventType     string    `json:"event_type"`
	Latitude      float64   `json:"latitude"`
	Longitude     float64   `json:"longitude"`
	Timestamp     time.Time `json:"timestamp"`
}

// ViolationHistoryResponse is the paginated response for violations
type ViolationHistoryResponse struct {
	Violations []GeofenceEvent `json:"violations"`
	TotalCount int             `json:"total_count"`
	TimeNs     int64           `json:"time_ns"`
}

// WebSocketAlert is the real-time alert message sent over WebSocket
type WebSocketAlert struct {
	EventID   string         `json:"event_id"`
	EventType string         `json:"event_type"`
	Timestamp time.Time      `json:"timestamp"`
	Vehicle   WSVehicleInfo  `json:"vehicle"`
	Geofence  WSGeofenceInfo `json:"geofence"`
	Location  WSLocationInfo `json:"location"`
}

type WSVehicleInfo struct {
	VehicleID     string `json:"vehicle_id"`
	VehicleNumber string `json:"vehicle_number"`
	DriverName    string `json:"driver_name"`
}

type WSGeofenceInfo struct {
	GeofenceID   string `json:"geofence_id"`
	GeofenceName string `json:"geofence_name"`
	Category     string `json:"category"`
}

type WSLocationInfo struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// StandardResponse wraps any response with time_ns
type StandardResponse struct {
	Data   interface{} `json:",inline"`
	TimeNs int64       `json:"time_ns"`
}
