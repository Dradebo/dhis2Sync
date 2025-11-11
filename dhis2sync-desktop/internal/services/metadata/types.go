package metadata

// MetadataType represents the type of metadata object
type MetadataType string

const (
	TypeOrganisationUnits    MetadataType = "organisationUnits"
	TypeCategoryOptions      MetadataType = "categoryOptions"
	TypeCategories           MetadataType = "categories"
	TypeCategoryCombos       MetadataType = "categoryCombos"
	TypeCategoryOptionCombos MetadataType = "categoryOptionCombos"
	TypeOptionSets           MetadataType = "optionSets"
	TypeOptions              MetadataType = "options"
	TypeDataElements         MetadataType = "dataElements"
	TypeDataSets             MetadataType = "dataSets"
)

// MetadataObject represents a generic DHIS2 metadata object
type MetadataObject struct {
	ID          string                 `json:"id,omitempty"`
	Code        string                 `json:"code,omitempty"`
	Name        string                 `json:"name,omitempty"`
	DisplayName string                 `json:"displayName,omitempty"`
	ShortName   string                 `json:"shortName,omitempty"`
	Extra       map[string]interface{} `json:"-"` // For type-specific fields
}

// SummaryRequest requests metadata summary from both instances
type SummaryRequest struct {
	ProfileID string         `json:"profile_id"`
	Types     []MetadataType `json:"types"`
}

// TypeSummary contains source and destination lists for a metadata type
type TypeSummary struct {
	Source []map[string]interface{} `json:"source"`
	Dest   []map[string]interface{} `json:"dest"`
}

// ComparisonResult contains missing, conflicts, and suggestions for a type
type ComparisonResult struct {
	Missing     []MissingItem     `json:"missing"`
	Conflicts   []ConflictItem    `json:"conflicts"`
	Suggestions []SuggestionItem  `json:"suggestions"`
}

// MissingItem represents a metadata object missing in destination
type MissingItem struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// ConflictItem represents metadata objects with same ID but different properties
type ConflictItem struct {
	ID    string                        `json:"id"`
	Code  string                        `json:"code"`
	Name  string                        `json:"name"`
	Diffs map[string]map[string]interface{} `json:"diffs"` // field -> {source: val, dest: val}
}

// SuggestionItem represents a suggested mapping based on code or name similarity
type SuggestionItem struct {
	Source     SuggestionDetail `json:"source"`
	Dest       SuggestionDetail `json:"dest"`
	Confidence float64          `json:"confidence"` // 0.0 to 1.0
	By         string           `json:"by"`         // "code" or "name"
}

// SuggestionDetail contains ID, code, and name for a suggestion
type SuggestionDetail struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// DiffRequest starts a background metadata comparison
type DiffRequest struct {
	ProfileID string         `json:"profile_id"`
	Types     []MetadataType `json:"types"`
}

// DiffProgress tracks the progress of a metadata comparison task
type DiffProgress struct {
	TaskID      string                      `json:"task_id"`
	Status      string                      `json:"status"`   // starting, running, completed, error
	Progress    int                         `json:"progress"` // 0-100
	Messages    []string                    `json:"messages"`
	Results     map[MetadataType]ComparisonResult `json:"results,omitempty"`
	CompletedAt int64                       `json:"completed_at,omitempty"` // Unix timestamp
}

// MappingPair represents a source -> destination ID mapping for a type
type MappingPair struct {
	Type     MetadataType `json:"type"`
	SourceID string       `json:"sourceId"`
	DestID   string       `json:"destId"`
}

// SaveMappingsRequest contains mapping pairs to persist
type SaveMappingsRequest struct {
	Pairs []MappingPair `json:"pairs"`
}

// SaveMappingsResponse indicates how many mappings were saved
type SaveMappingsResponse struct {
	Saved int              `json:"saved"`
	Types []MetadataType   `json:"types"`
}

// PayloadPreviewRequest requests a metadata import payload preview
type PayloadPreviewRequest struct {
	ProfileID string                       `json:"profile_id"`
	Types     []MetadataType               `json:"types"`
	Mappings  map[MetadataType]map[string]string `json:"mappings,omitempty"` // type -> {srcID: dstID}
}

// PayloadPreviewResponse contains the generated payload and metadata
type PayloadPreviewResponse struct {
	Payload  map[MetadataType][]map[string]interface{} `json:"payload"`
	Counts   map[MetadataType]int                      `json:"counts"`
	Required map[MetadataType][]string                 `json:"required"` // Required fields per type
}

// DryRunRequest performs a metadata import dry-run
type DryRunRequest struct {
	ProfileID      string                                    `json:"profile_id"`
	Payload        map[MetadataType][]map[string]interface{} `json:"payload"`
	ImportStrategy string                                    `json:"importStrategy,omitempty"` // Default: CREATE_AND_UPDATE
	AtomicMode     string                                    `json:"atomicMode,omitempty"`     // Default: ALL
}

// ApplyRequest performs an actual metadata import
type ApplyRequest struct {
	ProfileID      string                                    `json:"profile_id"`
	Payload        map[MetadataType][]map[string]interface{} `json:"payload"`
	ImportStrategy string                                    `json:"importStrategy,omitempty"` // Default: CREATE_AND_UPDATE
	AtomicMode     string                                    `json:"atomicMode,omitempty"`     // Default: ALL
}

// ImportReport represents the response from a metadata import
type ImportReport struct {
	Status      string                 `json:"status"`
	TypeReports []TypeReport           `json:"typeReports,omitempty"`
	Stats       map[string]interface{} `json:"stats,omitempty"`
	Message     string                 `json:"message,omitempty"`
	Error       string                 `json:"error,omitempty"`
	Body        map[string]interface{} `json:"body,omitempty"`
}

// TypeReport contains import statistics for a specific metadata type
type TypeReport struct {
	Type    string                 `json:"klass"`
	Stats   map[string]interface{} `json:"stats"`
	Objects []ObjectReport         `json:"objectReports,omitempty"`
}

// ObjectReport contains import details for a single object
type ObjectReport struct {
	UID          string   `json:"uid"`
	ErrorReports []string `json:"errorReports,omitempty"`
}

// SchemaInfo contains required fields info for a metadata type
type SchemaInfo struct {
	Klass              string   `json:"klass"`
	RequiredProperties []string `json:"requiredProperties,omitempty"`
	Required           []string `json:"required,omitempty"`
}
