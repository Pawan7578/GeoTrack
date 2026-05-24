package validation_test

import (
	"testing"

	"github.com/geofence-system/backend/internal/validation"
)

// ── Coordinate validation ─────────────────────────────────────────────────

func TestValidateLat(t *testing.T) {
	cases := []struct {
		name    string
		lat     float64
		wantErr bool
	}{
		{"valid equator",    0,      false},
		{"valid north pole", 90,     false},
		{"valid south pole", -90,    false},
		{"valid mid-range",  28.61,  false},
		{"too high",         90.001, true},
		{"too low",          -90.001,true},
		{"way over",         180,    true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validation.ValidateLat(tc.lat)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateLat(%v) error=%v, wantErr=%v", tc.lat, err, tc.wantErr)
			}
		})
	}
}

func TestValidateLon(t *testing.T) {
	cases := []struct {
		name    string
		lon     float64
		wantErr bool
	}{
		{"valid prime meridian", 0,       false},
		{"valid east 180",       180,     false},
		{"valid west 180",       -180,    false},
		{"valid longitude",      77.209,  false},
		{"too high",             180.001, true},
		{"too low",              -180.001,true},
		{"way over",             360,     true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validation.ValidateLon(tc.lon)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateLon(%v) error=%v, wantErr=%v", tc.lon, err, tc.wantErr)
			}
		})
	}
}

// ── Polygon coordinate validation ─────────────────────────────────────────

func TestValidateCoordinates(t *testing.T) {
	cases := []struct {
		name        string
		coordinates [][]float64
		wantErr     bool
	}{
		{
			name:        "valid triangle",
			coordinates: [][]float64{{28.0, 77.0}, {29.0, 78.0}, {28.5, 79.0}},
			wantErr:     false,
		},
		{
			name:        "too few points",
			coordinates: [][]float64{{28.0, 77.0}, {29.0, 78.0}},
			wantErr:     true,
		},
		{
			name:        "empty",
			coordinates: [][]float64{},
			wantErr:     true,
		},
		{
			name:        "invalid latitude in set",
			coordinates: [][]float64{{28.0, 77.0}, {200.0, 78.0}, {28.5, 79.0}},
			wantErr:     true,
		},
		{
			name:        "invalid longitude in set",
			coordinates: [][]float64{{28.0, 77.0}, {29.0, 200.0}, {28.5, 79.0}},
			wantErr:     true,
		},
		{
			name:        "wrong coord pair size",
			coordinates: [][]float64{{28.0, 77.0, 0.0}, {29.0, 78.0}, {28.5, 79.0}},
			wantErr:     true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validation.ValidateCoordinates(tc.coordinates)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateCoordinates error=%v, wantErr=%v", err, tc.wantErr)
			}
		})
	}
}

// ── Polygon closure ───────────────────────────────────────────────────────

func TestValidatePolygonClosure(t *testing.T) {
	closed := [][]float64{
		{28.0, 77.0}, {29.0, 78.0}, {28.5, 79.0}, {28.0, 77.0},
	}
	open := [][]float64{
		{28.0, 77.0}, {29.0, 78.0}, {28.5, 79.0},
	}
	tooShort := [][]float64{
		{28.0, 77.0}, {29.0, 78.0},
	}

	if !validation.ValidatePolygonClosure(closed) {
		t.Error("closed polygon should return true")
	}
	if validation.ValidatePolygonClosure(open) {
		t.Error("open polygon should return false")
	}
	if validation.ValidatePolygonClosure(tooShort) {
		t.Error("too-short polygon should return false")
	}
}

// ── Category validation ───────────────────────────────────────────────────

func TestValidateGeofenceCategory(t *testing.T) {
	valid := []string{"delivery_zone", "restricted_zone", "toll_zone", "customer_area"}
	for _, cat := range valid {
		if err := validation.ValidateGeofenceCategory(cat); err != nil {
			t.Errorf("expected valid category %q to pass, got: %v", cat, err)
		}
	}

	invalid := []string{"", "unknown", "DELIVERY_ZONE", "free-zone", "null"}
	for _, cat := range invalid {
		if err := validation.ValidateGeofenceCategory(cat); err == nil {
			t.Errorf("expected invalid category %q to fail", cat)
		}
	}
}

// ── Event type validation ─────────────────────────────────────────────────

func TestValidateEventType(t *testing.T) {
	for _, et := range []string{"entry", "exit", "both"} {
		if err := validation.ValidateEventType(et); err != nil {
			t.Errorf("expected valid event type %q to pass, got: %v", et, err)
		}
	}
	for _, et := range []string{"", "ENTRY", "all", "none"} {
		if err := validation.ValidateEventType(et); err == nil {
			t.Errorf("expected invalid event type %q to fail", et)
		}
	}
}

// ── Vehicle number validation ─────────────────────────────────────────────

func TestValidateVehicleNumber(t *testing.T) {
	if err := validation.ValidateVehicleNumber("MH01AB1234"); err != nil {
		t.Errorf("expected valid vehicle number to pass: %v", err)
	}
	if err := validation.ValidateVehicleNumber(""); err == nil {
		t.Error("expected empty vehicle number to fail")
	}
	// 101-char string — over the limit
	long := make([]byte, 101)
	for i := range long { long[i] = 'A' }
	if err := validation.ValidateVehicleNumber(string(long)); err == nil {
		t.Error("expected 101-char vehicle number to fail")
	}
}

// ── Phone validation ──────────────────────────────────────────────────────

func TestValidatePhone(t *testing.T) {
	cases := []struct {
		phone   string
		wantErr bool
	}{
		{"+91 98765 43210", false},
		{"12345",           false}, // exactly 5 chars — boundary
		{"",                true},
		{"1234",            true}, // too short
		{"123456789012345678901", true}, // 21 chars — too long
	}
	for _, tc := range cases {
		err := validation.ValidatePhone(tc.phone)
		if (err != nil) != tc.wantErr {
			t.Errorf("ValidatePhone(%q) err=%v, wantErr=%v", tc.phone, err, tc.wantErr)
		}
	}
}

// ── Email validation ──────────────────────────────────────────────────────

func TestValidateEmail(t *testing.T) {
	valid := []string{
		"admin@geofence.local",
		"user+tag@example.com",
		"a@b.co",
	}
	for _, e := range valid {
		if err := validation.ValidateEmail(e); err != nil {
			t.Errorf("expected valid email %q to pass: %v", e, err)
		}
	}
	invalid := []string{"", "notanemail", "@nodomain", "no@", "a@b"}
	for _, e := range invalid {
		if err := validation.ValidateEmail(e); err == nil {
			t.Errorf("expected invalid email %q to fail", e)
		}
	}
}

// ── Geofence name validation ──────────────────────────────────────────────

func TestValidateGeofenceName(t *testing.T) {
	if err := validation.ValidateGeofenceName("My Zone"); err != nil {
		t.Errorf("valid name should pass: %v", err)
	}
	if err := validation.ValidateGeofenceName(""); err == nil {
		t.Error("empty name should fail")
	}
	// 256 chars
	long := make([]byte, 256)
	for i := range long { long[i] = 'X' }
	if err := validation.ValidateGeofenceName(string(long)); err == nil {
		t.Error("256-char name should fail (max 255)")
	}
}
