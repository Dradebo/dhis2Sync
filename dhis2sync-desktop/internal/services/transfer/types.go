package transfer

import "time"

// TransferRequest represents a request to transfer data between DHIS2 instances
type TransferRequest struct {
	ProfileID        string            `json:"profile_id"`
	SourceDatasetID  string            `json:"source_dataset"`
	DestDatasetID    string            `json:"dest_dataset"`    // Can be different if mapping is needed
	Periods          []string          `json:"periods"`         // e.g., ["202401", "202402"]
	// OrgUnits are auto-discovered from user's assigned org units - no manual selection needed
	ElementMapping   map[string]string `json:"element_mapping"` // source element ID -> dest element ID
	MarkComplete     bool              `json:"mark_complete"`   // Mark dataset as complete after transfer
}

// Dataset represents a DHIS2 dataset
type Dataset struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Code        string `json:"code"`
	PeriodType  string `json:"periodType"` // MONTHLY, WEEKLY, etc.
}

// DatasetInfo contains detailed information about a dataset
type DatasetInfo struct {
	ID               string                `json:"id"`
	Name             string                `json:"name"`
	DisplayName      string                `json:"displayName"`
	Code             string                `json:"code"`
	PeriodType       string                `json:"periodType"`
	DataElements     []DataElement         `json:"dataElements"`
	CategoryCombos   []CategoryCombo       `json:"categoryCombos"`
	OrganisationUnits []OrganisationUnit   `json:"organisationUnits"`
}

// DataElement represents a DHIS2 data element
type DataElement struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Code        string `json:"code"`
	ValueType   string `json:"valueType"`
}

// CategoryCombo represents a DHIS2 category combination
type CategoryCombo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}

// OrganisationUnit represents a DHIS2 organization unit
type OrganisationUnit struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Code        string `json:"code"`
	Level       int    `json:"level"`
	Path        string `json:"path"`
}

// DataValue represents a single data value in DHIS2
type DataValue struct {
	DataElement             string `json:"dataElement"`
	Period                  string `json:"period"`
	OrgUnit                 string `json:"orgUnit"`
	CategoryOptionCombo     string `json:"categoryOptionCombo"`
	AttributeOptionCombo    string `json:"attributeOptionCombo"`
	Value                   string `json:"value"`
	StoredBy                string `json:"storedBy,omitempty"`
	Created                 string `json:"created,omitempty"`
	LastUpdated             string `json:"lastUpdated,omitempty"`
	Comment                 string `json:"comment,omitempty"`
	FollowUp                bool   `json:"followUp,omitempty"`
}

// DataValueSet represents a collection of data values
// DEPRECATED: Use DataValueSetPayload for imports instead
type DataValueSet struct {
	DataValues []DataValue `json:"dataValues"`
}

// DataValueSetPayload represents the complete payload structure required by DHIS2 for dataValueSets imports
// Format 1: Single period/orgUnit per request (legacy - slow for bulk operations)
type DataValueSetPayload struct {
	DataSet      string      `json:"dataSet"`      // Required: Dataset ID
	Period       string      `json:"period"`       // Required: Period identifier (e.g., "202401")
	OrgUnit      string      `json:"orgUnit"`      // Required: Organization unit ID
	CompleteDate string      `json:"completeDate"` // Required: Format "YYYY-MM-DD"
	DataValues   []DataValue `json:"dataValues"`   // Array of data values to import
}

// BulkDataValueSetPayload represents the minimal bulk payload for DHIS2 dataValueSets imports
// Format 2: Multiple periods/orgUnits per request (recommended for bulk operations)
// Based on DHIS2 official docs: "Sending bulks of data values"
// See: https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-241/data.html
type BulkDataValueSetPayload struct {
	DataValues []DataValue `json:"dataValues"` // Each value contains period/orgUnit fields
}

// AsyncJobResponse represents DHIS2 async job initiation response
// Returned when POST /api/dataValueSets?async=true is called
type AsyncJobResponse struct {
	HTTPStatus     string `json:"httpStatus"`
	HTTPStatusCode int    `json:"httpStatusCode"`
	Status         string `json:"status"`
	Message        string `json:"message"`
	Response       struct {
		Name                     string `json:"name"`
		ID                       string `json:"id"`
		Created                  string `json:"created"`
		JobType                  string `json:"jobType"`
		RelativeNotifierEndpoint string `json:"relativeNotifierEndpoint"`
	} `json:"response"`
}

// JobStatus represents DHIS2 async job status
// Retrieved from GET /api/system/tasks/DATAVALUE_IMPORT/{jobId}
type JobStatus struct {
	Completed bool   `json:"completed"`
	Level     string `json:"level"` // SUCCESS, ERROR, WARNING
	Message   string `json:"message,omitempty"`
	Summary   *struct {
		Status      string          `json:"status"`
		ImportCount ImportCount     `json:"importCount"`
		Conflicts   []ImportConflict `json:"conflicts,omitempty"`
	} `json:"summary,omitempty"`
}

// TransferProgress represents the progress of a transfer operation
type TransferProgress struct {
	TaskID          string                     `json:"task_id"`
	Status          string                     `json:"status"` // starting, running, completed, error, awaiting_user_decision
	Progress        int                        `json:"progress"` // 0-100
	Messages        []string                   `json:"messages"`
	TotalFetched    int                        `json:"total_fetched"`
	TotalMapped     int                        `json:"total_mapped"`
	TotalImported   int                        `json:"total_imported"`
	ImportSummary   *ImportSummary             `json:"import_summary,omitempty"`
	Error           string                     `json:"error,omitempty"`
	UnmappedValues  map[string][]DataValue     `json:"unmapped_values,omitempty"`  // Key: "ouName:period", Value: unmapped data values
	StartedAt       time.Time                  `json:"started_at"`
	CompletedAt     *time.Time                 `json:"completed_at,omitempty"`
}

// ImportSummary represents the result of a DHIS2 import operation
type ImportSummary struct {
	Status       string              `json:"status"` // SUCCESS, WARNING, ERROR
	Description  string              `json:"description"`
	ImportCount  ImportCount         `json:"importCount"`
	Conflicts    []ImportConflict    `json:"conflicts,omitempty"`
	DataSetComplete string           `json:"dataSetComplete,omitempty"`
}

// ImportCount tracks imported/updated/ignored counts
type ImportCount struct {
	Imported int `json:"imported"`
	Updated  int `json:"updated"`
	Ignored  int `json:"ignored"`
	Deleted  int `json:"deleted"`
}

// ImportConflict represents a conflict during import
type ImportConflict struct {
	Object string `json:"object"`
	Value  string `json:"value"`
	ErrorCode string `json:"errorCode"`
}

// CompletionRequest represents a request to mark a dataset as complete
type CompletionRequest struct {
	DataSet string   `json:"dataSet"`
	Period  string   `json:"period"`
	OrgUnits []string `json:"orgUnits"` // Can mark multiple OUs as complete
}

// CompletionResponse represents the response from marking dataset complete
type CompletionResponse struct {
	Status      string `json:"status"`
	Imported    int    `json:"imported"`
	Updated     int    `json:"updated"`
	Ignored     int    `json:"ignored"`
	Deleted     int    `json:"deleted"`
}
