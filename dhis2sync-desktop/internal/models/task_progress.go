package models

import (
	"time"
)

// TaskProgress tracks the progress of long-running operations
type TaskProgress struct {
	ID        string    `gorm:"primaryKey" json:"id"` // UUID task ID
	TaskType  string    `gorm:"not null;column:task_type" json:"task_type"` // transfer, completeness, bulk_completeness, metadata
	Status    string    `gorm:"not null;default:starting" json:"status"`     // starting, running, completed, error
	Progress  int       `gorm:"not null;default:0" json:"progress"`          // 0-100
	Messages  string    `gorm:"type:text" json:"messages"`                   // JSON array of strings
	Results   string    `gorm:"type:text" json:"results"`                    // JSON blob
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName specifies the table name for GORM
func (TaskProgress) TableName() string {
	return "task_progress"
}
