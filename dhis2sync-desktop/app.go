package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"

	"dhis2sync-desktop/internal/api"
	"dhis2sync-desktop/internal/crypto"
	"dhis2sync-desktop/internal/database"
	"dhis2sync-desktop/internal/models"
	"dhis2sync-desktop/internal/services/completeness"
	"dhis2sync-desktop/internal/services/metadata"
	"dhis2sync-desktop/internal/services/scheduler"
	"dhis2sync-desktop/internal/services/tracker"
	"dhis2sync-desktop/internal/services/transfer"
	"gorm.io/gorm"
)

// App struct - main application state
type App struct {
	ctx                 context.Context
	db                  *gorm.DB
	selectedProfile     *models.ConnectionProfile
	taskStore           map[string]*models.TaskProgress // In-memory task progress cache
	transferService     *transfer.Service
	metadataService     *metadata.Service
	completenessService *completeness.Service
	trackerService      *tracker.Service
	schedulerService    *scheduler.Service
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		taskStore: make(map[string]*models.TaskProgress),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	log.Println("Application starting up...")

	// Initialize encryption (FATAL if this fails - we cannot save profiles without it)
	if err := crypto.InitEncryption(); err != nil {
		log.Fatalf("FATAL: Encryption initialization failed: %v\nProfiles cannot be saved without encryption.", err)
	}
	log.Println("Encryption initialized successfully")

	// Initialize database
	db, err := database.Init()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	a.db = db
	log.Println("Database initialized successfully")

	// Initialize services
	a.transferService = transfer.NewService(ctx)
	log.Println("Transfer service initialized")

	a.metadataService = metadata.NewService(db, ctx)
	log.Println("Metadata service initialized")

	a.completenessService = completeness.NewService(db, ctx)
	log.Println("Completeness service initialized")

	a.trackerService = tracker.NewService(db, ctx)
	log.Println("Tracker service initialized")

	a.schedulerService = scheduler.NewService(db, ctx)
	if err := a.schedulerService.Start(); err != nil {
		log.Printf("WARNING: Failed to start scheduler: %v", err)
	} else {
		log.Println("Scheduler service initialized and started")
	}

	log.Println("Startup complete")
}

// shutdown is called when the app is closing
func (a *App) shutdown(ctx context.Context) {
	log.Println("Application shutting down...")

	// Stop scheduler
	if a.schedulerService != nil {
		a.schedulerService.Stop()
	}

	// Close database
	if err := database.Close(); err != nil {
		log.Printf("Error closing database: %v", err)
	}

	log.Println("Shutdown complete")
}

// ====================================================================================
// WAILS-BOUND METHODS - Exposed to Frontend
// ====================================================================================

// Profile Management Methods

// ListProfiles returns all connection profiles
func (a *App) ListProfiles() ([]models.ConnectionProfile, error) {
	var profiles []models.ConnectionProfile
	if err := a.db.Find(&profiles).Error; err != nil {
		return nil, err
	}
	return profiles, nil
}

// GetProfile retrieves a specific connection profile by ID
func (a *App) GetProfile(profileID string) (*models.ConnectionProfile, error) {
	var profile models.ConnectionProfile
	if err := a.db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

// CreateProfile creates a new connection profile
// NOTE: Frontend should call TestConnection() for both source and destination before calling this method
// to validate credentials and URLs before saving to database
func (a *App) CreateProfile(req CreateProfileRequest) error {
	// Validate encryption is initialized
	if !crypto.IsInitialized() {
		return errors.New("encryption system not initialized - cannot save profiles")
	}

	// Encrypt passwords
	sourcePasswordEnc, err := crypto.EncryptPassword(req.SourcePassword)
	if err != nil {
		return err
	}

	destPasswordEnc, err := crypto.EncryptPassword(req.DestPassword)
	if err != nil {
		return err
	}

	profile := &models.ConnectionProfile{
		Name:              req.Name,
		Owner:             req.Owner,
		SourceURL:         req.SourceURL,
		SourceUsername:    req.SourceUsername,
		SourcePasswordEnc: sourcePasswordEnc,
		DestURL:           req.DestURL,
		DestUsername:      req.DestUsername,
		DestPasswordEnc:   destPasswordEnc,
	}

	return a.db.Create(profile).Error
}

// UpdateProfile updates an existing connection profile
func (a *App) UpdateProfile(profileID string, req CreateProfileRequest) error {
	var profile models.ConnectionProfile
	if err := a.db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return err
	}

	// Update fields
	profile.Name = req.Name
	profile.Owner = req.Owner
	profile.SourceURL = req.SourceURL
	profile.SourceUsername = req.SourceUsername
	profile.DestURL = req.DestURL
	profile.DestUsername = req.DestUsername

	// Encrypt passwords if provided
	if req.SourcePassword != "" {
		sourcePasswordEnc, err := crypto.EncryptPassword(req.SourcePassword)
		if err != nil {
			return err
		}
		profile.SourcePasswordEnc = sourcePasswordEnc
	}

	if req.DestPassword != "" {
		destPasswordEnc, err := crypto.EncryptPassword(req.DestPassword)
		if err != nil {
			return err
		}
		profile.DestPasswordEnc = destPasswordEnc
	}

	return a.db.Save(&profile).Error
}

// DeleteProfile deletes a connection profile
func (a *App) DeleteProfile(profileID string) error {
	return a.db.Where("id = ?", profileID).Delete(&models.ConnectionProfile{}).Error
}

// SelectProfile sets the currently selected profile
func (a *App) SelectProfile(profileID string) error {
	var profile models.ConnectionProfile
	if err := a.db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return err
	}
	a.selectedProfile = &profile
	log.Printf("Selected profile: %s", profile.Name)
	return nil
}

// GetSelectedProfile returns the currently selected profile
func (a *App) GetSelectedProfile() (*models.ConnectionProfile, error) {
	if a.selectedProfile == nil {
		return nil, nil
	}
	return a.selectedProfile, nil
}

// ListJobs retrieves recent job execution history
func (a *App) ListJobs(limit int) ([]JobHistoryResponse, error) {
	if limit <= 0 {
		limit = 10 // Default to 10 most recent jobs
	}

	var tasks []models.TaskProgress

	// Query last N tasks, ordered by created_at desc
	if err := a.db.Order("created_at DESC").Limit(limit).Find(&tasks).Error; err != nil {
		return nil, err
	}

	// Map to response format
	jobs := make([]JobHistoryResponse, 0, len(tasks))
	for _, task := range tasks {
		job := JobHistoryResponse{
			TaskID:    task.ID,
			JobType:   task.TaskType,
			Status:    task.Status,
			StartedAt: task.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			Progress:  task.Progress,
		}

		// Set completed_at if task is finished
		if task.UpdatedAt.After(task.CreatedAt) {
			completedAt := task.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
			job.CompletedAt = &completedAt
		}

		// Generate summary from task results or status
		job.Summary = generateJobSummary(&task)

		jobs = append(jobs, job)
	}

	return jobs, nil
}

// generateJobSummary creates a brief summary of the job result
func generateJobSummary(task *models.TaskProgress) string {
	switch task.Status {
	case "completed":
		// Try to extract stats from results JSON
		if task.Results != "" {
			return "Completed successfully"
		}
		return "Completed"
	case "failed":
		return "Failed"
	case "running":
		return fmt.Sprintf("In progress (%d%%)", task.Progress)
	default:
		return task.Status
	}
}

// Transfer Service Methods

// ListDatasets lists datasets from source or destination
func (a *App) ListDatasets(profileID string, sourceOrDest string) ([]transfer.Dataset, error) {
	return a.transferService.ListDatasets(profileID, sourceOrDest)
}

// GetDatasetInfo retrieves detailed dataset information
func (a *App) GetDatasetInfo(profileID string, datasetID string, sourceOrDest string) (*transfer.DatasetInfo, error) {
	return a.transferService.GetDatasetInfo(profileID, datasetID, sourceOrDest)
}

// StartTransfer initiates a data transfer operation
func (a *App) StartTransfer(req transfer.TransferRequest) (string, error) {
	return a.transferService.StartTransfer(req)
}

// GetTransferProgress retrieves transfer progress
func (a *App) GetTransferProgress(taskID string) (*transfer.TransferProgress, error) {
	return a.transferService.GetTransferProgress(taskID)
}

// ResolveUnmappedValues handles user's decision on unmapped data values
// action: "create_mappings", "skip_unmapped", or "cancel"
// newMappings: map of source element ID → destination element ID (only used for "create_mappings" action)
func (a *App) ResolveUnmappedValues(taskID string, action string, newMappings map[string]string) error {
	switch action {
	case "create_mappings":
		// Apply new mappings and retry import for unmapped values
		return a.transferService.RetryWithNewMappings(taskID, newMappings)

	case "skip_unmapped":
		// Continue without unmapped values (mark transfer as complete)
		return a.transferService.SkipUnmappedAndComplete(taskID)

	case "cancel":
		// Cancel entire transfer
		return a.transferService.CancelTransfer(taskID)

	default:
		return errors.New("invalid action: must be 'create_mappings', 'skip_unmapped', or 'cancel'")
	}
}

// ListOrganisationUnits lists org units at a specific level or roots (level 1)
func (a *App) ListOrganisationUnits(profileID string, sourceOrDest string, level int) ([]transfer.OrgUnit, error) {
	return a.transferService.ListOrganisationUnits(profileID, sourceOrDest, level)
}

// GetOrgUnitChildren retrieves children of a specific org unit
func (a *App) GetOrgUnitChildren(profileID string, sourceOrDest string, parentID string) ([]transfer.OrgUnit, error) {
	return a.transferService.GetOrgUnitChildren(profileID, sourceOrDest, parentID)
}

// Metadata Service Methods

// GetMetadataSummary fetches metadata summaries for selected types
func (a *App) GetMetadataSummary(profileID string, types []metadata.MetadataType) (map[metadata.MetadataType]metadata.TypeSummary, error) {
	return a.metadataService.GetSummary(profileID, types)
}

// StartMetadataDiff initiates a background metadata comparison
func (a *App) StartMetadataDiff(profileID string, types []metadata.MetadataType) (string, error) {
	return a.metadataService.StartDiff(profileID, types)
}

// GetMetadataDiffProgress retrieves metadata diff progress
func (a *App) GetMetadataDiffProgress(taskID string) (*metadata.DiffProgress, error) {
	return a.metadataService.GetDiffProgress(taskID)
}

// SaveMetadataMappings persists metadata mapping pairs
func (a *App) SaveMetadataMappings(profileID string, pairs []metadata.MappingPair) (*metadata.SaveMappingsResponse, error) {
	return a.metadataService.SaveMappings(profileID, pairs)
}

// GetMetadataMappings retrieves saved metadata mappings
func (a *App) GetMetadataMappings(profileID string) map[metadata.MetadataType]map[string]string {
	return a.metadataService.GetMappings(profileID)
}

// BuildMetadataPayloadPreview generates a metadata import payload preview
func (a *App) BuildMetadataPayloadPreview(profileID string, types []metadata.MetadataType, mappings map[metadata.MetadataType]map[string]string) (*metadata.PayloadPreviewResponse, error) {
	return a.metadataService.BuildPayloadPreview(profileID, types, mappings)
}

// MetadataDryRun performs a dry-run metadata import
func (a *App) MetadataDryRun(profileID string, payload map[metadata.MetadataType][]map[string]interface{}, importStrategy, atomicMode string) (*metadata.ImportReport, error) {
	return a.metadataService.DryRun(profileID, payload, importStrategy, atomicMode)
}

// MetadataApply performs an actual metadata import
func (a *App) MetadataApply(profileID string, payload map[metadata.MetadataType][]map[string]interface{}, importStrategy, atomicMode string) (*metadata.ImportReport, error) {
	return a.metadataService.Apply(profileID, payload, importStrategy, atomicMode)
}

// Completeness Service Methods

// StartCompletenessAssessment initiates a background completeness assessment
func (a *App) StartCompletenessAssessment(req completeness.AssessmentRequest) (string, error) {
	return a.completenessService.StartAssessment(req)
}

// GetCompletenessAssessmentProgress retrieves assessment progress
func (a *App) GetCompletenessAssessmentProgress(taskID string) (*completeness.AssessmentProgress, error) {
	return a.completenessService.GetAssessmentProgress(taskID)
}

// ExportCompletenessResults exports assessment results in JSON or CSV format
func (a *App) ExportCompletenessResults(taskID, format string, limit int) (string, error) {
	return a.completenessService.ExportResults(taskID, format, limit)
}

// StartCompletenessBulkAction initiates a bulk complete/incomplete action
func (a *App) StartCompletenessBulkAction(req completeness.BulkActionRequest) (string, error) {
	return a.completenessService.StartBulkAction(req)
}

// GetCompletenessBulkActionProgress retrieves bulk action progress
func (a *App) GetCompletenessBulkActionProgress(taskID string) (*completeness.BulkActionProgress, error) {
	return a.completenessService.GetBulkActionProgress(taskID)
}

// ====================================================================================
// TRACKER SERVICE OPERATIONS
// ====================================================================================

// ListTrackerPrograms lists programs from the specified instance
func (a *App) ListTrackerPrograms(profileID, instance string, includeAll bool, searchQuery string) ([]tracker.Program, error) {
	return a.trackerService.ListPrograms(profileID, instance, includeAll, searchQuery)
}

// GetTrackerProgramDetail retrieves detailed program information
func (a *App) GetTrackerProgramDetail(profileID, programID, instance string) (*tracker.Program, error) {
	return a.trackerService.GetProgramDetail(profileID, programID, instance)
}

// PreviewTrackerEvents previews events for the given parameters
func (a *App) PreviewTrackerEvents(req tracker.PreviewRequest) (*tracker.PreviewResponse, error) {
	return a.trackerService.PreviewEvents(req)
}

// StartTrackerTransfer initiates a background event transfer
func (a *App) StartTrackerTransfer(req tracker.TransferRequest) (string, error) {
	return a.trackerService.StartTransfer(req)
}

// GetTrackerTransferProgress retrieves transfer progress
func (a *App) GetTrackerTransferProgress(taskID string) (*tracker.TransferProgress, error) {
	return a.trackerService.GetTransferProgress(taskID)
}

// ====================================================================================
// SCHEDULER SERVICE OPERATIONS
// ====================================================================================

// ListScheduledJobs retrieves all scheduled jobs
func (a *App) ListScheduledJobs() ([]scheduler.JobListResponse, error) {
	return a.schedulerService.ListJobs()
}

// UpsertScheduledJob creates or updates a scheduled job
func (a *App) UpsertScheduledJob(req scheduler.UpsertJobRequest) (string, error) {
	return a.schedulerService.UpsertJob(req)
}

// DeleteScheduledJob removes a scheduled job
func (a *App) DeleteScheduledJob(jobID string) error {
	return a.schedulerService.DeleteJob(jobID)
}

// ====================================================================================
// REQUEST/RESPONSE TYPES
// ====================================================================================

// JobHistoryResponse represents a completed job in the history
type JobHistoryResponse struct {
	TaskID      string  `json:"task_id"`
	JobType     string  `json:"job_type"`      // "transfer", "completeness", "metadata", "tracker", "bulk_action"
	Status      string  `json:"status"`        // "completed", "failed", "running"
	StartedAt   string  `json:"started_at"`    // ISO 8601 timestamp
	CompletedAt *string `json:"completed_at"`  // ISO 8601 timestamp or null
	Summary     string  `json:"summary"`       // Brief result description
	Progress    int     `json:"progress"`      // 0-100
}

// CreateProfileRequest represents a request to create/update a connection profile
type CreateProfileRequest struct {
	Name           string `json:"name"`
	Owner          string `json:"owner"`
	SourceURL      string `json:"source_url"`
	SourceUsername string `json:"source_username"`
	SourcePassword string `json:"source_password"` // Plain text, will be encrypted
	DestURL        string `json:"dest_url"`
	DestUsername   string `json:"dest_username"`
	DestPassword   string `json:"dest_password"` // Plain text, will be encrypted
}

// TestConnectionRequest represents a connection test request
type TestConnectionRequest struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// TestConnectionResponse represents the test result
type TestConnectionResponse struct {
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
	UserName   string `json:"user_name,omitempty"`
	ServerInfo string `json:"server_info,omitempty"`
}

// TestConnection tests a DHIS2 connection without saving to database
func (a *App) TestConnection(req TestConnectionRequest) TestConnectionResponse {
	// Import the API client
	client := api.NewClient(req.URL, req.Username, req.Password)

	// Test connection by calling /api/me.json
	resp, err := client.Get("api/me.json", nil)
	if err != nil {
		return TestConnectionResponse{
			Success: false,
			Error:   fmt.Sprintf("Connection failed: %v", err),
		}
	}

	// Check HTTP status code
	if !resp.IsSuccess() {
		var errorMsg string
		switch resp.StatusCode() {
		case 401:
			errorMsg = "Invalid credentials (wrong username or password)"
		case 404:
			errorMsg = "Server not found or invalid URL"
		case 403:
			errorMsg = "Access forbidden (check user permissions)"
		default:
			errorMsg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode(), resp.Status())
		}
		return TestConnectionResponse{
			Success: false,
			Error:   errorMsg,
		}
	}

	// Parse user info from response
	var userInfo struct {
		DisplayName string `json:"displayName"`
		Username    string `json:"username"`
		FirstName   string `json:"firstName"`
		Surname     string `json:"surname"`
	}

	if err := json.Unmarshal(resp.Body(), &userInfo); err == nil {
		// Prefer displayName, fall back to firstName + surname, then username
		userName := userInfo.DisplayName
		if userName == "" && userInfo.FirstName != "" {
			userName = userInfo.FirstName
			if userInfo.Surname != "" {
				userName += " " + userInfo.Surname
			}
		}
		if userName == "" {
			userName = userInfo.Username
		}
		if userName == "" {
			userName = "Connected User"
		}

		return TestConnectionResponse{
			Success:  true,
			UserName: userName,
		}
	}

	// Connection succeeded but couldn't parse user info
	return TestConnectionResponse{
		Success:  true,
		UserName: "Connected User",
	}
}

