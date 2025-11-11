package scheduler

import "time"

// ScheduledJob represents a CRON-based scheduled job
type ScheduledJob struct {
	ID         string    `json:"id" gorm:"primaryKey"`
	Name       string    `json:"name" gorm:"unique;not null"`
	JobType    string    `json:"job_type" gorm:"not null"` // "completeness", "transfer", "metadata"
	Cron       string    `json:"cron" gorm:"not null"`     // CRON expression
	Timezone   string    `json:"timezone" gorm:"default:UTC"`
	Payload    string    `json:"payload" gorm:"type:text"`    // JSON payload string
	Enabled    bool      `json:"enabled" gorm:"default:true"`
	LastRunAt  *time.Time `json:"last_run_at"`
	NextRunAt  *time.Time `json:"next_run_at"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// TableName specifies the table name for GORM
func (ScheduledJob) TableName() string {
	return "scheduled_jobs"
}

// JobListResponse represents a scheduled job in list responses
type JobListResponse struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	JobType   string  `json:"job_type"`
	Cron      string  `json:"cron"`
	Timezone  string  `json:"timezone"`
	Enabled   bool    `json:"enabled"`
	LastRunAt *string `json:"last_run_at"` // ISO 8601 format
	NextRun   *string `json:"next_run"`    // ISO 8601 format
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

// UpsertJobRequest represents a request to create or update a scheduled job
type UpsertJobRequest struct {
	Name     string      `json:"name"`
	JobType  string      `json:"job_type"` // "completeness" or "transfer"
	Cron     string      `json:"cron"`
	Timezone string      `json:"timezone"`
	Enabled  bool        `json:"enabled"`
	Payload  interface{} `json:"payload"` // Can be map or string
}

// CompletenessJobPayload represents the payload for a completeness job
type CompletenessJobPayload struct {
	ProfileID         string   `json:"profile_id"`
	Instance          string   `json:"instance"`
	DatasetID         string   `json:"dataset_id"`
	Periods           []string `json:"periods"`
	ParentOrgUnits    []string `json:"parent_org_units"`
	RequiredElements  []string `json:"required_elements"`
	Threshold         int      `json:"threshold"`
	IncludeParents    bool     `json:"include_parents"`
}

// TransferJobPayload represents the payload for a transfer job
type TransferJobPayload struct {
	ProfileID      string   `json:"profile_id"`
	DatasetID      string   `json:"dataset_id"`
	DestDatasetID  string   `json:"dest_dataset_id"`
	Periods        []string `json:"periods"`
	ParentOrgUnits []string `json:"parent_org_units"`
	MarkComplete   bool     `json:"mark_complete"`
}
