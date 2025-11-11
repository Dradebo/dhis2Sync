package completeness

// AssessmentRequest represents a completeness assessment request
type AssessmentRequest struct {
	ProfileID           string   `json:"profile_id"`
	Instance            string   `json:"instance"`             // "source" or "dest"
	DatasetID           string   `json:"dataset_id"`
	Periods             []string `json:"periods"`
	ParentOrgUnits      []string `json:"parent_org_units"`
	RequiredElements    []string `json:"required_elements"`    // If empty, uses all dataset elements
	ComplianceThreshold int      `json:"compliance_threshold"` // 0-100 percentage
	IncludeParents      bool     `json:"include_parents"`      // Include parent OUs in assessment
}

// AssessmentProgress tracks the progress of a completeness assessment task
type AssessmentProgress struct {
	TaskID      string            `json:"task_id"`
	Status      string            `json:"status"`   // starting, running, completed, error
	Progress    int               `json:"progress"` // 0-100
	Messages    []string          `json:"messages"`
	Results     *AssessmentResult `json:"results,omitempty"`
	CompletedAt int64             `json:"completed_at,omitempty"` // Unix timestamp
}

// AssessmentResult contains the overall assessment results
type AssessmentResult struct {
	TotalCompliant    int                                `json:"total_compliant"`
	TotalNonCompliant int                                `json:"total_non_compliant"`
	TotalErrors       int                                `json:"total_errors"`
	Hierarchy         map[string]*HierarchyResult        `json:"hierarchy"`          // parentOrgUnitID -> results
	ComplianceDetails map[string]*OrgUnitComplianceInfo  `json:"compliance_details"` // orgUnitID -> compliance info
}

// HierarchyResult contains compliance results for a parent org unit hierarchy
type HierarchyResult struct {
	Name          string                   `json:"name"`
	Compliant     []*OrgUnitComplianceInfo `json:"compliant"`
	NonCompliant  []*OrgUnitComplianceInfo `json:"non_compliant"`
	Children      []*OrgUnitComplianceInfo `json:"children,omitempty"` // Backward compatibility
	Unmarked      []*OrgUnitComplianceInfo `json:"unmarked,omitempty"` // Backward compatibility
	Error         string                   `json:"error,omitempty"`
}

// OrgUnitComplianceInfo contains detailed compliance information for an org unit
type OrgUnitComplianceInfo struct {
	ID                   string   `json:"id"`
	Name                 string   `json:"name"`
	CompliancePercentage float64  `json:"compliance_percentage"`
	ElementsPresent      int      `json:"elements_present"`
	ElementsRequired     int      `json:"elements_required"`
	MissingElements      []string `json:"missing_elements"`
	HasData              bool     `json:"has_data"`
	TotalEntries         int      `json:"total_entries"` // Total data elements with values
}

// ExportRequest represents a request to export assessment results
type ExportRequest struct {
	TaskID string `json:"task_id"`
	Format string `json:"format"` // "json" or "csv"
	Limit  int    `json:"limit"`  // For CSV, limit number of org units (0 = all)
}

// BulkActionRequest represents a bulk complete/incomplete action
type BulkActionRequest struct {
	ProfileID string   `json:"profile_id"`
	Instance  string   `json:"instance"` // "source" or "dest"
	Action    string   `json:"action"`   // "complete" or "incomplete"
	OrgUnits  []string `json:"org_units"`
	DatasetID string   `json:"dataset_id"`
	Periods   []string `json:"periods"`
}

// BulkActionProgress tracks bulk action progress
type BulkActionProgress struct {
	TaskID      string           `json:"task_id"`
	Status      string           `json:"status"`   // starting, running, completed, error
	Progress    int              `json:"progress"` // 0-100
	Messages    []string         `json:"messages"`
	Results     *BulkActionResult `json:"results,omitempty"`
	CompletedAt int64            `json:"completed_at,omitempty"`
}

// BulkActionResult contains results of bulk complete/incomplete action
type BulkActionResult struct {
	Action         string   `json:"action"` // "complete" or "incomplete"
	TotalProcessed int      `json:"total_processed"`
	Successful     []string `json:"successful"` // "orgUnitID:period" format
	Failed         []string `json:"failed"`     // "orgUnitID:period - error" format
}
