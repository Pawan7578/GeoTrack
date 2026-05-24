package logger

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"
)

// LogLevel represents log severity level
type LogLevel string

const (
	DEBUG LogLevel = "DEBUG"
	INFO  LogLevel = "INFO"
	WARN  LogLevel = "WARN"
	ERROR LogLevel = "ERROR"
)

// LogEntry represents a structured log entry
type LogEntry struct {
	Timestamp  time.Time              `json:"timestamp"`
	Level      LogLevel               `json:"level"`
	Message    string                 `json:"message"`
	RequestID  string                 `json:"request_id,omitempty"`
	UserID     string                 `json:"user_id,omitempty"`
	Method     string                 `json:"method,omitempty"`
	Path       string                 `json:"path,omitempty"`
	StatusCode int                    `json:"status_code,omitempty"`
	Duration   float64                `json:"duration_ms,omitempty"`
	Error      string                 `json:"error,omitempty"`
	Data       map[string]interface{} `json:"data,omitempty"`
}

var (
	writer io.Writer = os.Stdout
	envLog LogLevel  = INFO
)

// SetWriter sets the output writer for logs
func SetWriter(w io.Writer) {
	writer = w
}

// SetLogLevel sets the minimum log level to output
func SetLogLevel(level LogLevel) {
	envLog = level
}

// shouldLog checks if this log level should be output
func shouldLog(level LogLevel) bool {
	levels := map[LogLevel]int{
		DEBUG: 0,
		INFO:  1,
		WARN:  2,
		ERROR: 3,
	}
	return levels[level] >= levels[envLog]
}

// log outputs a structured log entry
func log(level LogLevel, entry *LogEntry) {
	if !shouldLog(level) {
		return
	}

	entry.Level = level
	entry.Timestamp = time.Now().UTC()

	jsonData, err := json.Marshal(entry)
	if err != nil {
		fmt.Fprintf(writer, "Failed to marshal log entry: %v\n", err)
		return
	}

	fmt.Fprintln(writer, string(jsonData))
}

// Info logs an info message
func Info(message string, data ...map[string]interface{}) {
	entry := &LogEntry{Message: message}
	if len(data) > 0 {
		entry.Data = data[0]
	}
	log(INFO, entry)
}

// Error logs an error message
func Error(message string, err error, data ...map[string]interface{}) {
	entry := &LogEntry{
		Message: message,
		Error:   err.Error(),
	}
	if len(data) > 0 {
		entry.Data = data[0]
	}
	log(ERROR, entry)
}

// Warn logs a warning message
func Warn(message string, data ...map[string]interface{}) {
	entry := &LogEntry{Message: message}
	if len(data) > 0 {
		entry.Data = data[0]
	}
	log(WARN, entry)
}

// Debug logs a debug message
func Debug(message string, data ...map[string]interface{}) {
	entry := &LogEntry{Message: message}
	if len(data) > 0 {
		entry.Data = data[0]
	}
	log(DEBUG, entry)
}

// HTTPRequest logs HTTP request/response
func HTTPRequest(requestID, method, path string, statusCode int, duration float64, userID string, err error) {
	entry := &LogEntry{
		RequestID:  requestID,
		Method:     method,
		Path:       path,
		StatusCode: statusCode,
		Duration:   duration,
		UserID:     userID,
	}

	level := INFO
	if statusCode >= 400 {
		level = WARN
	}
	if err != nil {
		entry.Error = err.Error()
		level = ERROR
	}

	log(level, entry)
}

// GeofenceEvent logs geofence-related events
func GeofenceEvent(requestID, userID, eventType, geofenceID, vehicleID string, data map[string]interface{}) {
	entry := &LogEntry{
		RequestID: requestID,
		UserID:    userID,
		Message:   fmt.Sprintf("Geofence event: %s", eventType),
		Data: map[string]interface{}{
			"event_type":  eventType,
			"geofence_id": geofenceID,
			"vehicle_id":  vehicleID,
			"event_data":  data,
		},
	}
	log(INFO, entry)
}
