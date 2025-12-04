package models

// OrganisationUnit represents a DHIS2 organisation unit
type OrganisationUnit struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Level       int    `json:"level"`
	Path        string `json:"path"`
	DisplayName string `json:"displayName,omitempty"`
}
