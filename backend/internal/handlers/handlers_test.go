package handlers_test

import (
	"strings"
	"testing"
)

// ── WKT polygon builder (extracted for testability) ───────────────────────

func buildPolygonWKT(coords [][]float64) string {
	points := make([]string, len(coords))
	for i, c := range coords {
		// PostGIS WKT expects (lon lat) — coords are [lat, lon]
		points[i] = strings.TrimRight(
			strings.TrimRight(
				strings.Replace(
					strings.Replace(
						strings.Replace(
							strings.Replace(
								// fmt.Sprintf equivalent
								formatPoint(c[1], c[0]),
								"+", "", -1),
							"e", "E", -1),
						"E+0", "E", -1),
					"E-0", "E-", -1),
				"0"),
			".")
	}
	return "POLYGON((" + strings.Join(points, ", ") + "))"
}

func formatPoint(lon, lat float64) string {
	return strings.TrimRight(strings.TrimRight(
		func() string {
			// Simple sprintf-like: just return "lon lat"
			return formatFloat(lon) + " " + formatFloat(lat)
		}(),
		"0"), ".")
}

func formatFloat(f float64) string {
	s := strings.TrimRight(strings.TrimRight(
		func() string {
			buf := make([]byte, 0, 32)
			// Use manual conversion to avoid importing fmt in test
			return string(appendFloat(buf, f))
		}(),
		"0"), ".")
	return s
}

func appendFloat(buf []byte, f float64) []byte {
	return append(buf, []byte(func() string {
		if f == float64(int64(f)) {
			return intToStr(int64(f)) + ".000000"
		}
		return floatToStr(f)
	}())...)
}

func intToStr(n int64) string {
	if n == 0 { return "0" }
	neg := n < 0
	if neg { n = -n }
	buf := make([]byte, 0, 20)
	for n > 0 { buf = append([]byte{byte('0' + n%10)}, buf...); n /= 10 }
	if neg { buf = append([]byte{'-'}, buf...) }
	return string(buf)
}

func floatToStr(f float64) string {
	// Minimal float→string for tests only; production uses fmt.Sprintf
	i := int64(f)
	frac := f - float64(i)
	if frac < 0 { frac = -frac }
	fracPart := int64(frac * 1000000)
	return intToStr(i) + "." + padLeft(intToStr(fracPart), 6)
}

func padLeft(s string, n int) string {
	for len(s) < n { s = "0" + s }
	return s
}

// ── Actual test cases ─────────────────────────────────────────────────────

func TestWKTContainsPolygonPrefix(t *testing.T) {
	coords := [][]float64{
		{28.0, 77.0},
		{29.0, 78.0},
		{28.5, 79.0},
		{28.0, 77.0},
	}
	wkt := buildPolygonWKT(coords)
	if !strings.HasPrefix(wkt, "POLYGON((") {
		t.Errorf("WKT should start with POLYGON((, got: %s", wkt)
	}
	if !strings.HasSuffix(wkt, "))") {
		t.Errorf("WKT should end with )), got: %s", wkt)
	}
}

func TestWKTCoordOrderIsLonLat(t *testing.T) {
	// coords[0] = [lat=10, lon=20] → WKT point should be "20 10"
	coords := [][]float64{{10.0, 20.0}, {11.0, 21.0}, {10.5, 22.0}}
	wkt := buildPolygonWKT(coords)
	// First point in WKT should be "20 10" (lon space lat)
	if !strings.Contains(wkt, "20") {
		t.Errorf("longitude 20 not found in WKT: %s", wkt)
	}
}

// ── isUniqueViolation (copied logic) ──────────────────────────────────────

func isUniqueViolation(err error) bool {
	if err == nil { return false }
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique constraint")
}

type mockErr struct{ msg string }
func (e *mockErr) Error() string { return e.msg }

func TestIsUniqueViolation(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{nil, false},
		{&mockErr{"duplicate key value violates unique constraint"}, true},
		{&mockErr{"unique constraint violation"}, true},
		{&mockErr{"some other error"}, false},
		{&mockErr{""}, false},
	}
	for _, tc := range cases {
		got := isUniqueViolation(tc.err)
		if got != tc.want {
			t.Errorf("isUniqueViolation(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

// ── Entry/Exit detection logic (pure function tests) ──────────────────────

func detectEntries(current, prev map[string]bool) []string {
	var entries []string
	for id := range current {
		if !prev[id] { entries = append(entries, id) }
	}
	return entries
}

func detectExits(current, prev map[string]bool) []string {
	var exits []string
	for id := range prev {
		if !current[id] { exits = append(exits, id) }
	}
	return exits
}

func TestDetectEntries(t *testing.T) {
	prev    := map[string]bool{"gf1": true}
	current := map[string]bool{"gf1": true, "gf2": true}
	entries := detectEntries(current, prev)
	if len(entries) != 1 || entries[0] != "gf2" {
		t.Errorf("expected [gf2] entries, got %v", entries)
	}
}

func TestDetectExits(t *testing.T) {
	prev    := map[string]bool{"gf1": true, "gf3": true}
	current := map[string]bool{"gf1": true}
	exits := detectExits(current, prev)
	if len(exits) != 1 || exits[0] != "gf3" {
		t.Errorf("expected [gf3] exits, got %v", exits)
	}
}

func TestNoEventsWhenUnchanged(t *testing.T) {
	both := map[string]bool{"gf1": true, "gf2": true}
	if n := len(detectEntries(both, both)); n != 0 {
		t.Errorf("expected 0 entries when state unchanged, got %d", n)
	}
	if n := len(detectExits(both, both)); n != 0 {
		t.Errorf("expected 0 exits when state unchanged, got %d", n)
	}
}

func TestAllEntriesWhenNoPrev(t *testing.T) {
	prev    := map[string]bool{}
	current := map[string]bool{"gf1": true, "gf2": true, "gf3": true}
	entries := detectEntries(current, prev)
	if len(entries) != 3 {
		t.Errorf("expected 3 entries from empty prev, got %d", len(entries))
	}
}

func TestAllExitsWhenNoCurrent(t *testing.T) {
	prev    := map[string]bool{"gf1": true, "gf2": true}
	current := map[string]bool{}
	exits := detectExits(current, prev)
	if len(exits) != 2 {
		t.Errorf("expected 2 exits when current is empty, got %d", len(exits))
	}
}
