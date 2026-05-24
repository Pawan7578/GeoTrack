package errors

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// ErrorCode represents error types
type ErrorCode string

const (
	// 4xx
	BadRequest      ErrorCode = "BAD_REQUEST"
	Unauthorized    ErrorCode = "UNAUTHORIZED"
	Forbidden       ErrorCode = "FORBIDDEN"
	NotFound        ErrorCode = "NOT_FOUND"
	Conflict        ErrorCode = "CONFLICT"
	ValidationError ErrorCode = "VALIDATION_ERROR"
	TooManyRequests ErrorCode = "TOO_MANY_REQUESTS"

	// 5xx
	InternalError ErrorCode = "INTERNAL_ERROR"
	DatabaseError ErrorCode = "DATABASE_ERROR"
)

// AppError represents an application error with structured response
type AppError struct {
	Code       ErrorCode              `json:"code"`
	Message    string                 `json:"message"`
	StatusCode int                    `json:"-"`
	Details    map[string]interface{} `json:"details,omitempty"`
	Internal   error                  `json:"-"`
}

// Error implements the error interface
func (e *AppError) Error() string {
	return e.Message
}

// New creates a new AppError
func New(code ErrorCode, message string, statusCode int) *AppError {
	return &AppError{
		Code:       code,
		Message:    message,
		StatusCode: statusCode,
		Details:    make(map[string]interface{}),
	}
}

// WithDetails adds detail information to error
func (e *AppError) WithDetails(key string, value interface{}) *AppError {
	e.Details[key] = value
	return e
}

// WithInternal wraps an internal error
func (e *AppError) WithInternal(err error) *AppError {
	e.Internal = err
	return e
}

// Helper functions for common errors

func BadRequestError(message string) *AppError {
	return New(BadRequest, message, http.StatusBadRequest)
}

func UnauthorizedError(message string) *AppError {
	return New(Unauthorized, message, http.StatusUnauthorized)
}

func ForbiddenError(message string) *AppError {
	return New(Forbidden, message, http.StatusForbidden)
}

func NotFoundError(message string) *AppError {
	return New(NotFound, message, http.StatusNotFound)
}

func ConflictError(message string) *AppError {
	return New(Conflict, message, http.StatusConflict)
}

func RateLimitError(message string) *AppError {
	return New(TooManyRequests, message, http.StatusTooManyRequests)
}

func ValidationErrorWithDetails(message string, fields map[string]string) *AppError {
	err := New(ValidationError, message, http.StatusBadRequest)
	for field, detail := range fields {
		err.WithDetails(field, detail)
	}
	return err
}

func InternalServerError(message string, internalErr error) *AppError {
	return New(InternalError, message, http.StatusInternalServerError).WithInternal(internalErr)
}

func DatabaseErrorValue(operation string, internalErr error) *AppError {
	return New(DatabaseError,
		fmt.Sprintf("Database operation '%s' failed", operation),
		http.StatusInternalServerError,
	).WithInternal(internalErr)
}

// HTTPResponse represents standardized API response — always includes time_ns
type HTTPResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *ErrorInfo  `json:"error,omitempty"`
	TimeNs  int64       `json:"time_ns"`
}

// ErrorInfo represents error details in response
type ErrorInfo struct {
	Code    ErrorCode              `json:"code"`
	Message string                 `json:"message"`
	Details map[string]interface{} `json:"details,omitempty"`
}

// WriteError writes an error response — timeNs is nanoseconds since request start
func WriteError(w http.ResponseWriter, appErr *AppError, timeNs int64) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(appErr.StatusCode)

	response := HTTPResponse{
		Success: false,
		Error: &ErrorInfo{
			Code:    appErr.Code,
			Message: appErr.Message,
			Details: appErr.Details,
		},
		TimeNs: timeNs,
	}

	json.NewEncoder(w).Encode(response)
}

// WriteSuccess writes a success response — timeNs is nanoseconds since request start
func WriteSuccess(w http.ResponseWriter, data interface{}, statusCode int, timeNs int64) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	response := HTTPResponse{
		Success: true,
		Data:    data,
		TimeNs:  timeNs,
	}

	json.NewEncoder(w).Encode(response)
}
