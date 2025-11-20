package scheduler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"dhis2sync-desktop/internal/models"
	"dhis2sync-desktop/internal/services/completeness"
)

// mockCompletenessService for testing scheduled completeness jobs
type mockCompletenessService struct {
	startAssessmentCalled bool
	startAssessmentReq    completeness.AssessmentRequest
	startAssessmentTaskID string
	startAssessmentErr    error
	getProgressCalled     bool
	getProgressResult     *completeness.AssessmentProgress
}

func (m *mockCompletenessService) StartAssessment(req completeness.AssessmentRequest) (string, error) {
	m.startAssessmentCalled = true
	m.startAssessmentReq = req
	if m.startAssessmentErr != nil {
		return "", m.startAssessmentErr
	}
	return m.startAssessmentTaskID, nil
}

func (m *mockCompletenessService) GetAssessmentProgress(taskID string) (*completeness.AssessmentProgress, error) {
	m.getProgressCalled = true
	return m.getProgressResult, nil
}

// TestCompletenessJobExecution tests that scheduled completeness jobs actually execute assessments
func TestCompletenessJobExecution(t *testing.T) {
	t.Run("Should call completeness service with correct parameters", func(t *testing.T) {
		// Setup in-memory database
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		require.NoError(t, err)

		// Create test profile
		err = db.AutoMigrate(&models.ConnectionProfile{})
		require.NoError(t, err)

		profile := models.ConnectionProfile{
			Name:            "Test Profile",
			SourceURL:       "https://source.dhis2.org",
			SourceUsername:  "admin",
			SourcePasswordEnc: "encrypted",
			DestURL:         "https://dest.dhis2.org",
			DestUsername:    "admin",
			DestPasswordEnc: "encrypted",
		}
		err = db.Create(&profile).Error
		require.NoError(t, err)

		// Create mock completeness service
		mockService := &mockCompletenessService{
			startAssessmentTaskID: "test-task-123",
			getProgressResult: &completeness.AssessmentProgress{
				TaskID:   "test-task-123",
				Status:   "completed",
				Progress: 100,
				Results: &completeness.AssessmentResult{
					TotalCompliant:    5,
					TotalNonCompliant: 2,
					TotalErrors:       0,
				},
			},
		}

		// Create scheduler service with mock
		ctx := context.Background()
		service := &Service{
			db:                  db,
			ctx:                 ctx,
			completenessService: mockService,
		}

		// Create job payload
		payload := map[string]interface{}{
			"profile_id": profile.ID,
			"instance":   "source",
			"dataset_id": "ds123",
			"periods":    []interface{}{"202501", "202502"},
			"parent_org_units": []interface{}{"ou001", "ou002"},
			"compliance_threshold": 80.0,
			"include_parents": true,
		}

		// Execute job
		service.runCompletenessJob(payload)

		// Wait a bit for goroutine to start
		time.Sleep(100 * time.Millisecond)

		// Verify StartAssessment was called
		assert.True(t, mockService.startAssessmentCalled, "StartAssessment should be called")

		// Verify request parameters
		req := mockService.startAssessmentReq
		assert.Equal(t, profile.ID, req.ProfileID)
		assert.Equal(t, "source", req.Instance)
		assert.Equal(t, "ds123", req.DatasetID)
		assert.Equal(t, []string{"202501", "202502"}, req.Periods)
		assert.Equal(t, []string{"ou001", "ou002"}, req.ParentOrgUnits)
		assert.Equal(t, 80, req.ComplianceThreshold)
		assert.True(t, req.IncludeParents)
	})

	t.Run("Should use default compliance threshold when not provided", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		require.NoError(t, err)

		err = db.AutoMigrate(&models.ConnectionProfile{})
		require.NoError(t, err)

		profile := models.ConnectionProfile{
			Name:            "Test Profile",
			SourceURL:       "https://source.dhis2.org",
			SourceUsername:  "admin",
			SourcePasswordEnc: "encrypted",
			DestURL:         "https://dest.dhis2.org",
			DestUsername:    "admin",
			DestPasswordEnc: "encrypted",
		}
		err = db.Create(&profile).Error
		require.NoError(t, err)

		mockService := &mockCompletenessService{
			startAssessmentTaskID: "test-task-456",
		}

		service := &Service{
			db:                  db,
			ctx:                 context.Background(),
			completenessService: mockService,
		}

		payload := map[string]interface{}{
			"profile_id":       profile.ID,
			"dataset_id":       "ds456",
			"periods":          []interface{}{"202503"},
			"parent_org_units": []interface{}{"ou003"},
		}

		service.runCompletenessJob(payload)
		time.Sleep(100 * time.Millisecond)

		assert.True(t, mockService.startAssessmentCalled)
		assert.Equal(t, 70, mockService.startAssessmentReq.ComplianceThreshold, "Should use default threshold of 70")
		assert.False(t, mockService.startAssessmentReq.IncludeParents, "Should default to false")
	})

	t.Run("Should handle required elements parameter", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		require.NoError(t, err)

		err = db.AutoMigrate(&models.ConnectionProfile{})
		require.NoError(t, err)

		profile := models.ConnectionProfile{
			Name:            "Test Profile",
			SourceURL:       "https://source.dhis2.org",
			SourceUsername:  "admin",
			SourcePasswordEnc: "encrypted",
			DestURL:         "https://dest.dhis2.org",
			DestUsername:    "admin",
			DestPasswordEnc: "encrypted",
		}
		err = db.Create(&profile).Error
		require.NoError(t, err)

		mockService := &mockCompletenessService{
			startAssessmentTaskID: "test-task-789",
		}

		service := &Service{
			db:                  db,
			ctx:                 context.Background(),
			completenessService: mockService,
		}

		payload := map[string]interface{}{
			"profile_id":        profile.ID,
			"dataset_id":        "ds789",
			"periods":           []interface{}{"202504"},
			"parent_org_units":  []interface{}{"ou004"},
			"required_elements": []interface{}{"de001", "de002", "de003"},
		}

		service.runCompletenessJob(payload)
		time.Sleep(100 * time.Millisecond)

		assert.True(t, mockService.startAssessmentCalled)
		assert.Equal(t, []string{"de001", "de002", "de003"}, mockService.startAssessmentReq.RequiredElements)
	})

	t.Run("Should skip job with incomplete payload", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		require.NoError(t, err)

		mockService := &mockCompletenessService{}

		service := &Service{
			db:                  db,
			ctx:                 context.Background(),
			completenessService: mockService,
		}

		// Missing required fields
		payload := map[string]interface{}{
			"profile_id": "profile123",
			// Missing dataset_id, periods, parent_org_units
		}

		service.runCompletenessJob(payload)
		time.Sleep(100 * time.Millisecond)

		assert.False(t, mockService.startAssessmentCalled, "Should not call StartAssessment with incomplete payload")
	})
}

// TestCompletenessJobProgressTracking tests that progress is tracked correctly
func TestCompletenessJobProgressTracking(t *testing.T) {
	t.Run("Should poll for progress until completion", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		require.NoError(t, err)

		err = db.AutoMigrate(&models.ConnectionProfile{})
		require.NoError(t, err)

		profile := models.ConnectionProfile{
			Name:            "Test Profile",
			SourceURL:       "https://source.dhis2.org",
			SourceUsername:  "admin",
			SourcePasswordEnc: "encrypted",
			DestURL:         "https://dest.dhis2.org",
			DestUsername:    "admin",
			DestPasswordEnc: "encrypted",
		}
		err = db.Create(&profile).Error
		require.NoError(t, err)

		mockService := &mockCompletenessService{
			startAssessmentTaskID: "test-progress-task",
			getProgressResult: &completeness.AssessmentProgress{
				TaskID:   "test-progress-task",
				Status:   "running",
				Progress: 50,
			},
		}

		service := &Service{
			db:                  db,
			ctx:                 context.Background(),
			completenessService: mockService,
		}

		payload := map[string]interface{}{
			"profile_id":       profile.ID,
			"dataset_id":       "ds999",
			"periods":          []interface{}{"202505"},
			"parent_org_units": []interface{}{"ou999"},
		}

		service.runCompletenessJob(payload)

		// Wait for initial progress poll
		time.Sleep(6 * time.Second)

		assert.True(t, mockService.getProgressCalled, "Should poll for progress")

		// Update mock to return completed status
		mockService.getProgressResult = &completeness.AssessmentProgress{
			TaskID:   "test-progress-task",
			Status:   "completed",
			Progress: 100,
			Results: &completeness.AssessmentResult{
				TotalCompliant:    10,
				TotalNonCompliant: 3,
				TotalErrors:       1,
			},
		}

		// Wait for completion detection
		time.Sleep(6 * time.Second)
	})
}
