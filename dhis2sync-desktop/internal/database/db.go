package database

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"dhis2sync-desktop/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// Init initializes the database connection and runs auto-migration
func Init() (*gorm.DB, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		// Default to SQLite for development
		databaseURL = "sqlite://./dhis2sync.db"
	}

	var dialector gorm.Dialector
	var err error

	if strings.HasPrefix(databaseURL, "sqlite://") {
		// SQLite
		dbPath := strings.TrimPrefix(databaseURL, "sqlite://")

		// If using default path, store in user config directory
		if dbPath == "./dhis2sync.db" {
			configDir, err := os.UserConfigDir()
			if err != nil {
				return nil, fmt.Errorf("failed to get user config directory: %w", err)
			}

			appDir := filepath.Join(configDir, "dhis2sync")
			if err := os.MkdirAll(appDir, 0755); err != nil {
				return nil, fmt.Errorf("failed to create app directory: %w", err)
			}

			dbPath = filepath.Join(appDir, "dhis2sync.db")
			log.Printf("Using database at: %s", dbPath)
		}

		dialector = sqlite.Open(dbPath)
	} else if strings.HasPrefix(databaseURL, "postgresql://") || strings.HasPrefix(databaseURL, "postgres://") {
		// PostgreSQL
		dialector = postgres.Open(databaseURL)
	} else {
		return nil, fmt.Errorf("unsupported database URL format: %s", databaseURL)
	}

	// Configure GORM logger
	gormLogger := logger.Default
	if os.Getenv("LOG_LEVEL") == "DEBUG" {
		gormLogger = logger.Default.LogMode(logger.Info)
	} else {
		gormLogger = logger.Default.LogMode(logger.Warn)
	}

	// Open connection
	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: gormLogger,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Configure connection pool
	sqlDB, err := DB.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	// Set connection pool parameters (configurable via environment variables)
	maxOpenConns := getEnvInt("DB_MAX_OPEN_CONNS", 25)
	maxIdleConns := getEnvInt("DB_MAX_IDLE_CONNS", 5)
	connMaxLifetime := getEnvDuration("DB_CONN_MAX_LIFETIME", 5*time.Minute)

	sqlDB.SetMaxOpenConns(maxOpenConns)
	sqlDB.SetMaxIdleConns(maxIdleConns)
	sqlDB.SetConnMaxLifetime(connMaxLifetime)

	log.Printf("Database connection pool configured: max_open=%d, max_idle=%d, max_lifetime=%v",
		maxOpenConns, maxIdleConns, connMaxLifetime)

	// Health check
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("database ping failed: %w", err)
	}

	// Auto-migrate models
	if err := AutoMigrate(DB); err != nil {
		return nil, fmt.Errorf("failed to auto-migrate: %w", err)
	}

	log.Println("Database initialized successfully")
	return DB, nil
}

// getEnvInt retrieves an integer from environment variable with default fallback
func getEnvInt(key string, defaultValue int) int {
	if val := os.Getenv(key); val != "" {
		if intVal, err := strconv.Atoi(val); err == nil {
			return intVal
		}
	}
	return defaultValue
}

// getEnvDuration retrieves a duration from environment variable with default fallback
func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if duration, err := time.ParseDuration(val); err == nil {
			return duration
		}
	}
	return defaultValue
}

// AutoMigrate runs GORM auto-migration for all models
func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.ConnectionProfile{},
		&models.ScheduledJob{},
		&models.TaskProgress{},
	)
}

// Close closes the database connection
func Close() error {
	if DB != nil {
		sqlDB, err := DB.DB()
		if err != nil {
			return err
		}
		return sqlDB.Close()
	}
	return nil
}

// GetDB returns the database instance (helper for services)
func GetDB() *gorm.DB {
	return DB
}
