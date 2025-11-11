package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ConnectionProfile represents a DHIS2 instance connection pair (source + destination)
type ConnectionProfile struct {
	ID                string    `gorm:"primaryKey" json:"id"`
	Name              string    `gorm:"unique;not null" json:"name"`
	Owner             string    `json:"owner"`
	SourceURL         string    `gorm:"not null;column:source_url" json:"source_url"`
	SourceUsername    string    `gorm:"not null;column:source_username" json:"source_username"`
	SourcePasswordEnc string    `gorm:"not null;column:source_password_enc" json:"-"` // Encrypted, never expose in JSON
	DestURL           string    `gorm:"not null;column:dest_url" json:"dest_url"`
	DestUsername      string    `gorm:"not null;column:dest_username" json:"dest_username"`
	DestPasswordEnc   string    `gorm:"not null;column:dest_password_enc" json:"-"` // Encrypted, never expose in JSON
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// BeforeCreate hook to generate UUID before creating record
func (cp *ConnectionProfile) BeforeCreate(tx *gorm.DB) error {
	if cp.ID == "" {
		cp.ID = uuid.New().String()
	}
	return nil
}

// TableName specifies the table name for GORM
func (ConnectionProfile) TableName() string {
	return "connection_profiles"
}
