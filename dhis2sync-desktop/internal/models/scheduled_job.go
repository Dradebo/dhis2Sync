package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ScheduledJob represents a recurring task (transfer, completeness, etc.)
type ScheduledJob struct {
	ID          string     `gorm:"primaryKey" json:"id"`
	Name        string     `gorm:"unique;not null" json:"name"`
	JobType     string     `gorm:"not null;column:job_type" json:"job_type"` // completeness, transfer, metadata
	Cron        string     `gorm:"not null" json:"cron"`                     // cron expression
	Timezone    string     `gorm:"default:UTC" json:"timezone"`
	Payload     string     `gorm:"type:text" json:"payload"`      // JSON payload string
	Enabled     bool       `gorm:"default:true" json:"enabled"`
	LastRunAt   *time.Time `gorm:"column:last_run_at" json:"last_run_at"`
	NextRunAt   *time.Time `gorm:"column:next_run_at" json:"next_run_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// BeforeCreate hook to generate UUID before creating record
func (sj *ScheduledJob) BeforeCreate(tx *gorm.DB) error {
	if sj.ID == "" {
		sj.ID = uuid.New().String()
	}
	return nil
}

// TableName specifies the table name for GORM
func (ScheduledJob) TableName() string {
	return "scheduled_jobs"
}
