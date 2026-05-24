package middleware

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/geofence-system/backend/internal/db"
	apperrors "github.com/geofence-system/backend/internal/errors"
	"github.com/geofence-system/backend/internal/logger"
	"github.com/google/uuid"
)

// contextKey is a typed key for context values
type contextKey string

const (
	RequestIDKey contextKey = "request_id"
	UserIDKey    contextKey = "user_id"
	RoleKey      contextKey = "role"
	StartTimeKey contextKey = "start_time"
)

// RequestLogger middleware adds request ID and logs HTTP requests
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := uuid.New().String()
		start := time.Now()

		ctx := r.Context()
		ctx = context.WithValue(ctx, RequestIDKey, requestID)
		ctx = context.WithValue(ctx, StartTimeKey, start)
		r = r.WithContext(ctx)

		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)

		duration := time.Since(start).Seconds() * 1000
		userID := ""
		if uid := r.Context().Value(UserIDKey); uid != nil {
			userID = uid.(string)
		}
		logger.HTTPRequest(requestID, r.Method, r.URL.Path, wrapped.statusCode, duration, userID, nil)
	})
}

// InjectSystemUserMiddleware injects the system user ID into the context for non-authenticated requests
func InjectSystemUserMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		// Only inject if no user ID is already present
		if _, ok := ctx.Value(UserIDKey).(string); !ok {
			ctx = context.WithValue(ctx, UserIDKey, db.SystemUserID)
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
// Note: CORS is handled globally by gorilla/handlers in main.go

// rateLimiter holds per-key token bucket state
type rateLimiter struct {
	mu         sync.Mutex
	buckets    map[string]*bucket
	rate       int           // max requests
	window     time.Duration // per window
	cleanEvery time.Duration
	lastClean  time.Time
}

type bucket struct {
	count       int
	windowStart time.Time
}

var locationRateLimiter = &rateLimiter{
	buckets:    make(map[string]*bucket),
	rate:       30, // 30 requests per minute per user
	window:     time.Minute,
	cleanEvery: 5 * time.Minute,
	lastClean:  time.Now(),
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	// Periodic cleanup of old buckets
	if now.Sub(rl.lastClean) > rl.cleanEvery {
		for k, b := range rl.buckets {
			if now.Sub(b.windowStart) > rl.window {
				delete(rl.buckets, k)
			}
		}
		rl.lastClean = now
	}

	b, exists := rl.buckets[key]
	if !exists || now.Sub(b.windowStart) > rl.window {
		rl.buckets[key] = &bucket{count: 1, windowStart: now}
		return true
	}

	if b.count >= rl.rate {
		return false
	}

	b.count++
	return true
}

// LocationRateLimitMiddleware limits POST /vehicles/location to 30 req/min per user
func LocationRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := getStartTime(r)
		userID, _ := r.Context().Value(UserIDKey).(string)

		// Use user ID as rate limit key; fall back to IP
		key := userID
		if key == "" {
			key = r.RemoteAddr
		}

		if !locationRateLimiter.allow(key) {
			w.Header().Set("Retry-After", "60")
			apperrors.WriteError(w,
				apperrors.RateLimitError("Rate limit exceeded: max 30 location updates per minute"),
				time.Since(start).Nanoseconds(),
			)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getStartTime retrieves the request start time from context, defaulting to now
func getStartTime(r *http.Request) time.Time {
	if t, ok := r.Context().Value(StartTimeKey).(time.Time); ok {
		return t
	}
	return time.Now()
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.written {
		rw.statusCode = code
		rw.written = true
		rw.ResponseWriter.WriteHeader(code)
	}
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.written {
		rw.WriteHeader(http.StatusOK)
	}
	return rw.ResponseWriter.Write(b)
}

// Hijack implements http.Hijacker to support WebSocket upgrades
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hijacker, ok := rw.ResponseWriter.(http.Hijacker); ok {
		return hijacker.Hijack()
	}
	return nil, nil, fmt.Errorf("http.Hijacker not supported")
}
