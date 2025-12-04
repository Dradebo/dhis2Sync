package transfer

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	// DHIS2 UID pattern: 11 alphanumeric characters
	uidPattern = regexp.MustCompile(`^[a-zA-Z0-9]{11}$`)

	// ISO period patterns
	periodPatterns = map[string]*regexp.Regexp{
		"monthly":   regexp.MustCompile(`^\d{6}$`),       // 202401
		"quarterly": regexp.MustCompile(`^\d{4}Q[1-4]$`), // 2024Q1
		"yearly":    regexp.MustCompile(`^\d{4}$`),       // 2024
	}
)

// ValidationError represents a validation error with field context
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ValidateTransferRequest validates a transfer request
func ValidateTransferRequest(req *TransferRequest) error {
	// Validate ProfileID
	if req.ProfileID == "" {
		return &ValidationError{"ProfileID", "required"}
	}
	if !uidPattern.MatchString(req.ProfileID) {
		return &ValidationError{"ProfileID", "invalid DHIS2 UID format"}
	}

	// Validate DatasetIDs
	if req.SourceDatasetID == "" {
		return &ValidationError{"SourceDatasetID", "required"}
	}
	if !uidPattern.MatchString(req.SourceDatasetID) {
		return &ValidationError{"SourceDatasetID", "invalid DHIS2 UID format"}
	}

	if req.DestDatasetID == "" {
		req.DestDatasetID = req.SourceDatasetID // Default to same
	}
	if !uidPattern.MatchString(req.DestDatasetID) {
		return &ValidationError{"DestDatasetID", "invalid DHIS2 UID format"}
	}

	// Validate Periods
	if len(req.Periods) == 0 {
		return &ValidationError{"Periods", "at least one period required"}
	}
	if len(req.Periods) > 100 {
		return &ValidationError{"Periods", "maximum 100 periods allowed"}
	}

	for _, period := range req.Periods {
		if !isValidPeriod(period) {
			return &ValidationError{"Periods", fmt.Sprintf("invalid period format: %s", period)}
		}
	}

	// Validate OrgUnitSelectionMode
	if req.OrgUnitSelectionMode == "" {
		req.OrgUnitSelectionMode = "discovered" // Default
	}

	validModes := map[string]bool{"all": true, "selected": true, "discovered": true}
	if !validModes[req.OrgUnitSelectionMode] {
		return &ValidationError{"OrgUnitSelectionMode", "must be 'all', 'selected', or 'discovered'"}
	}

	// Validate OrgUnitIDs if selection mode is "selected"
	if req.OrgUnitSelectionMode == "selected" {
		if len(req.OrgUnitIDs) == 0 {
			return &ValidationError{"OrgUnitIDs", "required when selection mode is 'selected'"}
		}
		if len(req.OrgUnitIDs) > 1000 {
			return &ValidationError{"OrgUnitIDs", "maximum 1000 org units allowed"}
		}

		for _, ouID := range req.OrgUnitIDs {
			if !uidPattern.MatchString(ouID) {
				return &ValidationError{"OrgUnitIDs", fmt.Sprintf("invalid UID: %s", ouID)}
			}
		}
	}

	// Validate ElementMapping
	if len(req.ElementMapping) > 10000 {
		return &ValidationError{"ElementMapping", "maximum 10000 mappings allowed"}
	}

	return nil
}

// isValidPeriod checks if a period string matches DHIS2 period formats
func isValidPeriod(period string) bool {
	period = strings.TrimSpace(period)

	for _, pattern := range periodPatterns {
		if pattern.MatchString(period) {
			return true
		}
	}

	return false
}
