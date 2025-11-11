package tracker

// Program represents a DHIS2 program (tracker or event)
type Program struct {
	ID           string         `json:"id"`
	DisplayName  string         `json:"displayName"`
	ProgramType  string         `json:"programType"` // WITH_REGISTRATION or WITHOUT_REGISTRATION
	Version      int            `json:"version"`
	ProgramStages []ProgramStage `json:"programStages,omitempty"`
}

// ProgramStage represents a stage within a program
type ProgramStage struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

// PreviewRequest represents a request to preview events before transfer
type PreviewRequest struct {
	ProfileID    string   `json:"profile_id"`
	Instance     string   `json:"instance"` // "source" or "dest"
	ProgramID    string   `json:"program_id"`
	OrgUnits     []string `json:"org_units"`
	StartDate    string   `json:"start_date"` // YYYY-MM-DD
	EndDate      string   `json:"end_date"`   // YYYY-MM-DD
	ProgramStage string   `json:"program_stage,omitempty"`
	Status       string   `json:"status,omitempty"` // ACTIVE, COMPLETED, SCHEDULE, etc.
	PreviewCap   int      `json:"preview_cap"`      // Maximum events to preview
	PageSize     int      `json:"page_size"`        // Events per API call
}

// PreviewResponse contains event preview results
type PreviewResponse struct {
	ProgramID     string           `json:"program_id"`
	OrgUnits      []string         `json:"org_units"`
	StartDate     string           `json:"start_date"`
	EndDate       string           `json:"end_date"`
	EstimateTotal int              `json:"estimate_total"`
	Sample        []map[string]interface{} `json:"sample"` // Sample events
}

// TransferRequest represents a request to transfer events between instances
type TransferRequest struct {
	ProfileID         string   `json:"profile_id"`
	ProgramID         string   `json:"program_id"`
	OrgUnits          []string `json:"org_units"`
	StartDate         string   `json:"start_date"` // YYYY-MM-DD
	EndDate           string   `json:"end_date"`   // YYYY-MM-DD
	ProgramStage      string   `json:"program_stage,omitempty"`
	Status            string   `json:"status,omitempty"`
	DryRun            bool     `json:"dry_run"`
	BatchSize         int      `json:"batch_size"`          // Events per batch (default: 200)
	MaxPages          int      `json:"max_pages"`           // Max pages to fetch per OU (default: 500)
	MaxRuntimeSeconds int      `json:"max_runtime_seconds"` // Max runtime in seconds (default: 1500)
}

// TransferProgress tracks the progress of an event transfer task
type TransferProgress struct {
	TaskID      string          `json:"task_id"`
	Status      string          `json:"status"`   // starting, running, completed, error
	Progress    int             `json:"progress"` // 0-100
	Messages    []string        `json:"messages"`
	Results     *TransferResult `json:"results,omitempty"`
	CompletedAt int64           `json:"completed_at,omitempty"` // Unix timestamp
}

// TransferResult contains the results of an event transfer
type TransferResult struct {
	TotalFetched int  `json:"total_fetched"`
	TotalSent    int  `json:"total_sent"`
	BatchesSent  int  `json:"batches_sent"`
	DryRun       bool `json:"dry_run"`
	Partial      bool `json:"partial,omitempty"` // True if stopped due to runtime limit
}

// Event represents a minimal DHIS2 event for transfer
type Event struct {
	Program              string                   `json:"program,omitempty"`
	OrgUnit              string                   `json:"orgUnit,omitempty"`
	ProgramStage         string                   `json:"programStage,omitempty"`
	EventDate            string                   `json:"eventDate,omitempty"`
	DueDate              string                   `json:"dueDate,omitempty"`
	Status               string                   `json:"status,omitempty"`
	DataValues           []DataValue              `json:"dataValues,omitempty"`
	Coordinate           *Coordinate              `json:"coordinate,omitempty"`
	Geometry             map[string]interface{}   `json:"geometry,omitempty"`
	CompletedDate        string                   `json:"completedDate,omitempty"`
	AttributeOptionCombo string                   `json:"attributeOptionCombo,omitempty"`
	Notes                []map[string]interface{} `json:"notes,omitempty"`
}

// DataValue represents a data element value within an event
type DataValue struct {
	DataElement        string `json:"dataElement"`
	Value              string `json:"value"`
	ProvidedElsewhere  bool   `json:"providedElsewhere,omitempty"`
}

// Coordinate represents geographic coordinates
type Coordinate struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}
