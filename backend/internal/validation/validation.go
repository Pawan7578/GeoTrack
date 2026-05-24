package validation

import (
	"fmt"
	"regexp"
)

// ValidateEmail checks if email is valid
func ValidateEmail(email string) error {
	if email == "" {
		return fmt.Errorf("email is required")
	}
	regex := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	if !regex.MatchString(email) {
		return fmt.Errorf("email format is invalid")
	}
	return nil
}

// ValidateLat validates latitude
func ValidateLat(lat float64) error {
	if lat < -90 || lat > 90 {
		return fmt.Errorf("latitude must be between -90 and 90, got %f", lat)
	}
	return nil
}

// ValidateLon validates longitude
func ValidateLon(lon float64) error {
	if lon < -180 || lon > 180 {
		return fmt.Errorf("longitude must be between -180 and 180, got %f", lon)
	}
	return nil
}

// ValidateCoordinates validates a list of lat/lon coordinates
func ValidateCoordinates(coordinates [][]float64) error {
	if len(coordinates) < 3 {
		return fmt.Errorf("polygon must have at least 3 points")
	}

	for i, coord := range coordinates {
		if len(coord) != 2 {
			return fmt.Errorf("coordinate %d must have exactly 2 values [lat, lon]", i)
		}
		if err := ValidateLat(coord[0]); err != nil {
			return fmt.Errorf("coordinate %d: %w", i, err)
		}
		if err := ValidateLon(coord[1]); err != nil {
			return fmt.Errorf("coordinate %d: %w", i, err)
		}
	}

	return nil
}

// ValidatePolygonClosure ensures polygon is closed (first point == last point)
func ValidatePolygonClosure(coordinates [][]float64) bool {
	if len(coordinates) < 3 {
		return false
	}
	first := coordinates[0]
	last := coordinates[len(coordinates)-1]
	return first[0] == last[0] && first[1] == last[1]
}

// ValidateGeofenceCategory validates category field
func ValidateGeofenceCategory(category string) error {
	valid := map[string]bool{
		"delivery_zone":   true,
		"restricted_zone": true,
		"toll_zone":       true,
		"customer_area":   true,
	}
	if !valid[category] {
		return fmt.Errorf("category must be one of: delivery_zone, restricted_zone, toll_zone, customer_area")
	}
	return nil
}

// ValidateEventType validates event type
func ValidateEventType(eventType string) error {
	valid := map[string]bool{
		"entry": true,
		"exit":  true,
		"both":  true,
	}
	if !valid[eventType] {
		return fmt.Errorf("event_type must be one of: entry, exit, both")
	}
	return nil
}

// ValidateVehicleNumber validates vehicle number
func ValidateVehicleNumber(number string) error {
	if number == "" {
		return fmt.Errorf("vehicle_number is required")
	}
	if len(number) > 100 {
		return fmt.Errorf("vehicle_number must be max 100 characters")
	}
	return nil
}

// ValidatePhone validates phone number (basic)
func ValidatePhone(phone string) error {
	if phone == "" {
		return fmt.Errorf("phone is required")
	}
	if len(phone) < 5 || len(phone) > 20 {
		return fmt.Errorf("phone must be between 5 and 20 characters")
	}
	return nil
}

// ValidateGeofenceName validates geofence name
func ValidateGeofenceName(name string) error {
	if name == "" {
		return fmt.Errorf("name is required")
	}
	if len(name) > 255 {
		return fmt.Errorf("name must be max 255 characters")
	}
	return nil
}
