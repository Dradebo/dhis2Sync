package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
	"gorm.io/gorm"

	"dhis2sync-desktop/internal/api"
	"dhis2sync-desktop/internal/crypto"
	"dhis2sync-desktop/internal/models"
	"dhis2sync-desktop/internal/services/completeness"
)

// CompletenessServiceInterface defines the interface for completeness service integration
type CompletenessServiceInterface interface {
	StartAssessment(req completeness.AssessmentRequest) (string, error)
	GetAssessmentProgress(taskID string) (*completeness.AssessmentProgress, error)
}

// Service handles scheduled job management and execution
type Service struct {
	db                  *gorm.DB
	ctx                 context.Context
	cron                *cron.Cron
	jobs                map[string]cron.EntryID // jobID -> cron entry ID
	jobsMu              sync.RWMutex
	completenessService CompletenessServiceInterface
}

// NewService creates a new scheduler service
func NewService(db *gorm.DB, ctx context.Context, completenessService CompletenessServiceInterface) *Service {
	// Create cron scheduler with seconds support
	c := cron.New(cron.WithSeconds())

	return &Service{
		db:                  db,
		ctx:                 ctx,
		cron:                c,
		jobs:                make(map[string]cron.EntryID),
		completenessService: completenessService,
	}
}

// Start initializes the scheduler and loads enabled jobs from database
func (s *Service) Start() error {
	log.Println("Starting scheduler...")

	// Auto-migrate ScheduledJob table
	if err := s.db.AutoMigrate(&ScheduledJob{}); err != nil {
		return fmt.Errorf("failed to migrate scheduled_jobs table: %w", err)
	}

	// Start the cron scheduler
	s.cron.Start()
	log.Println("Cron scheduler started")

	// Load all enabled jobs from database
	var jobs []ScheduledJob
	if err := s.db.Where("enabled = ?", true).Find(&jobs).Error; err != nil {
		return fmt.Errorf("failed to load scheduled jobs: %w", err)
	}

	for _, job := range jobs {
		if err := s.scheduleJob(&job); err != nil {
			log.Printf("WARNING: Failed to schedule job %s (%s): %v", job.Name, job.ID, err)
		} else {
			log.Printf("Scheduled job: %s (%s) with cron: %s", job.Name, job.ID, job.Cron)
		}
	}

	log.Printf("Scheduler started with %d enabled jobs", len(jobs))
	return nil
}

// Stop gracefully stops the scheduler
func (s *Service) Stop() {
	if s.cron != nil {
		ctx := s.cron.Stop()
		<-ctx.Done()
		log.Println("Scheduler stopped")
	}
}

// ListJobs retrieves all scheduled jobs
func (s *Service) ListJobs() ([]JobListResponse, error) {
	var jobs []ScheduledJob
	if err := s.db.Order("created_at DESC").Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("failed to list jobs: %w", err)
	}

	responses := make([]JobListResponse, len(jobs))
	for i, job := range jobs {
		responses[i] = s.toJobListResponse(&job)
	}

	return responses, nil
}

// UpsertJob creates or updates a scheduled job
func (s *Service) UpsertJob(req UpsertJobRequest) (string, error) {
	// Validate required fields
	if req.Name == "" || req.JobType == "" || req.Cron == "" {
		return "", fmt.Errorf("name, job_type, and cron are required")
	}

	// Normalize and validate cron expression (convert 5-field to 6-field)
	normalizedCron, err := normalizeCron(req.Cron)
	if err != nil {
		return "", err
	}
	req.Cron = normalizedCron

	// Find or create job
	var job ScheduledJob
	result := s.db.Where("name = ?", req.Name).First(&job)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			// Create new job
			job = ScheduledJob{
				ID:   uuid.New().String(),
				Name: req.Name,
			}
		} else {
			return "", fmt.Errorf("failed to query job: %w", result.Error)
		}
	}

	// Update job fields
	job.JobType = req.JobType
	job.Cron = req.Cron
	job.Timezone = req.Timezone
	if job.Timezone == "" {
		job.Timezone = "UTC"
	}
	job.Enabled = req.Enabled

	// Handle payload
	payloadStr := ""
	if req.Payload != nil {
		switch p := req.Payload.(type) {
		case string:
			payloadStr = p
		case map[string]interface{}, []interface{}:
			data, err := json.Marshal(p)
			if err != nil {
				return "", fmt.Errorf("failed to marshal payload: %w", err)
			}
			payloadStr = string(data)
		default:
			data, err := json.Marshal(p)
			if err != nil {
				return "", fmt.Errorf("failed to marshal payload: %w", err)
			}
			payloadStr = string(data)
		}
	}
	job.Payload = payloadStr

	// Calculate next run time (cron parser uses the 6-field format stored in DB)
	parser := cron.NewParser(cron.SecondOptional | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)
	schedule, err := parser.Parse(job.Cron)
	if err != nil {
		return "", fmt.Errorf("failed to parse cron for next run: %w", err)
	}
	nextRun := schedule.Next(time.Now())
	job.NextRunAt = &nextRun

	// Save to database
	if result.Error == gorm.ErrRecordNotFound {
		if err := s.db.Create(&job).Error; err != nil {
			return "", fmt.Errorf("failed to create job: %w", err)
		}
	} else {
		if err := s.db.Save(&job).Error; err != nil {
			return "", fmt.Errorf("failed to update job: %w", err)
		}
	}

	// Reschedule in cron
	if err := s.rescheduleJob(job.ID); err != nil {
		return "", fmt.Errorf("failed to reschedule job: %w", err)
	}

	return job.ID, nil
}

// DeleteJob removes a scheduled job
func (s *Service) DeleteJob(jobID string) error {
	// Remove from cron if exists
	s.jobsMu.Lock()
	if entryID, exists := s.jobs[jobID]; exists {
		s.cron.Remove(entryID)
		delete(s.jobs, jobID)
	}
	s.jobsMu.Unlock()

	// Delete from database
	if err := s.db.Delete(&ScheduledJob{}, "id = ?", jobID).Error; err != nil {
		return fmt.Errorf("failed to delete job: %w", err)
	}

	return nil
}

// scheduleJob adds a job to the cron scheduler
func (s *Service) scheduleJob(job *ScheduledJob) error {
	if !job.Enabled {
		return nil
	}

	// Remove existing entry if present
	s.jobsMu.Lock()
	if entryID, exists := s.jobs[job.ID]; exists {
		s.cron.Remove(entryID)
	}
	s.jobsMu.Unlock()

	// Add job to cron
	entryID, err := s.cron.AddFunc(job.Cron, func() {
		s.executeJob(job.ID)
	})

	if err != nil {
		return fmt.Errorf("failed to add cron job: %w", err)
	}

	s.jobsMu.Lock()
	s.jobs[job.ID] = entryID
	s.jobsMu.Unlock()

	return nil
}

// rescheduleJob reloads a job from database and reschedules it
func (s *Service) rescheduleJob(jobID string) error {
	var job ScheduledJob
	if err := s.db.First(&job, "id = ?", jobID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Job was deleted, remove from cron
			s.jobsMu.Lock()
			if entryID, exists := s.jobs[jobID]; exists {
				s.cron.Remove(entryID)
				delete(s.jobs, jobID)
			}
			s.jobsMu.Unlock()
			return nil
		}
		return fmt.Errorf("failed to load job: %w", err)
	}

	return s.scheduleJob(&job)
}

// executeJob runs a scheduled job
func (s *Service) executeJob(jobID string) {
	log.Printf("Executing scheduled job: %s", jobID)

	// Load job from database
	var job ScheduledJob
	if err := s.db.First(&job, "id = ?", jobID).Error; err != nil {
		log.Printf("ERROR: Failed to load job %s: %v", jobID, err)
		return
	}

	// Update last run time
	now := time.Now()
	job.LastRunAt = &now

	// Calculate next run time (cron parser uses the 6-field format stored in DB)
	parser := cron.NewParser(cron.SecondOptional | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)
	schedule, err := parser.Parse(job.Cron)
	if err != nil {
		log.Printf("WARNING: Failed to parse cron for next run: %v", err)
	} else {
		nextRun := schedule.Next(now)
		job.NextRunAt = &nextRun
	}

	if err := s.db.Save(&job).Error; err != nil {
		log.Printf("WARNING: Failed to update job run times: %v", err)
	}

	// Parse payload
	var payload map[string]interface{}
	if job.Payload != "" {
		if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
			log.Printf("ERROR: Failed to parse job payload: %v", err)
			return
		}
	}

	// Execute based on job type
	switch job.JobType {
	case "completeness":
		s.runCompletenessJob(payload)
	case "transfer":
		s.runTransferJob(payload)
	default:
		log.Printf("WARNING: Unknown job type: %s", job.JobType)
	}

	log.Printf("Completed scheduled job: %s", jobID)
}

// runCompletenessJob executes a completeness assessment job
func (s *Service) runCompletenessJob(payload map[string]interface{}) {
	// Extract parameters
	profileID, _ := payload["profile_id"].(string)
	instance, _ := payload["instance"].(string)
	if instance == "" {
		instance = "source"
	}
	datasetID, _ := payload["dataset_id"].(string)

	periods := []string{}
	if p, ok := payload["periods"].([]interface{}); ok {
		for _, period := range p {
			if ps, ok := period.(string); ok {
				periods = append(periods, ps)
			}
		}
	}

	parentOrgUnits := []string{}
	if p, ok := payload["parent_org_units"].([]interface{}); ok {
		for _, ou := range p {
			if ous, ok := ou.(string); ok {
				parentOrgUnits = append(parentOrgUnits, ous)
			}
		}
	}

	if profileID == "" || datasetID == "" || len(periods) == 0 || len(parentOrgUnits) == 0 {
		log.Printf("WARNING: Incomplete completeness job payload")
		return
	}

	// Build assessment request
	req := completeness.AssessmentRequest{
		ProfileID:           profileID,
		Instance:            instance,
		DatasetID:           datasetID,
		Periods:             periods,
		ParentOrgUnits:      parentOrgUnits,
		ComplianceThreshold: 70, // Default threshold
		IncludeParents:      false,
	}

	// Extract optional parameters
	if threshold, ok := payload["compliance_threshold"].(float64); ok {
		req.ComplianceThreshold = int(threshold)
	}
	if includeParents, ok := payload["include_parents"].(bool); ok {
		req.IncludeParents = includeParents
	}
	if requiredElements, ok := payload["required_elements"].([]interface{}); ok {
		req.RequiredElements = make([]string, len(requiredElements))
		for i, elem := range requiredElements {
			if elemStr, ok := elem.(string); ok {
				req.RequiredElements[i] = elemStr
			}
		}
	}

	log.Printf("Starting scheduled completeness assessment for dataset %s (profile: %s, instance: %s)", datasetID, profileID, instance)

	// Execute assessment via completeness service
	taskID, err := s.completenessService.StartAssessment(req)
	if err != nil {
		log.Printf("ERROR: Failed to start completeness assessment: %v", err)
		return
	}

	log.Printf("Completeness assessment started with task ID: %s", taskID)

	// Wait for completion (with timeout) - run in background to not block scheduler
	go func() {
		timeout := time.After(30 * time.Minute) // 30-minute timeout
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-timeout:
				log.Printf("WARNING: Completeness assessment %s timed out after 30 minutes", taskID)
				return
			case <-ticker.C:
				progress, err := s.completenessService.GetAssessmentProgress(taskID)
				if err != nil {
					log.Printf("ERROR: Failed to get progress for assessment %s: %v", taskID, err)
					return
				}

				if progress == nil {
					log.Printf("WARNING: Progress for assessment %s is nil, stopping monitoring", taskID)
					return
				}

				if progress.Status == "completed" {
					log.Printf("Scheduled completeness assessment completed successfully (task: %s)", taskID)
					if progress.Results != nil {
						log.Printf("Results: %d compliant, %d non-compliant, %d errors",
							progress.Results.TotalCompliant,
							progress.Results.TotalNonCompliant,
							progress.Results.TotalErrors)
					}
					return
				} else if progress.Status == "error" {
					log.Printf("ERROR: Completeness assessment failed (task: %s)", taskID)
					if len(progress.Messages) > 0 {
						log.Printf("Last message: %s", progress.Messages[len(progress.Messages)-1])
					}
					return
				}
			}
		}
	}()

	log.Printf("Completeness job initiated for dataset %s", datasetID)
}

// runTransferJob executes a data transfer job
func (s *Service) runTransferJob(payload map[string]interface{}) {
	// Extract parameters
	profileID, _ := payload["profile_id"].(string)
	datasetID, _ := payload["dataset_id"].(string)
	destDatasetID, _ := payload["dest_dataset_id"].(string)
	if destDatasetID == "" {
		destDatasetID = datasetID
	}

	periods := []string{}
	if p, ok := payload["periods"].([]interface{}); ok {
		for _, period := range p {
			if ps, ok := period.(string); ok {
				periods = append(periods, ps)
			}
		}
	}

	parentOrgUnits := []string{}
	if p, ok := payload["parent_org_units"].([]interface{}); ok {
		for _, ou := range p {
			if ous, ok := ou.(string); ok {
				parentOrgUnits = append(parentOrgUnits, ous)
			}
		}
	}

	markComplete := false
	if mc, ok := payload["mark_complete"].(bool); ok {
		markComplete = mc
	}

	if profileID == "" || datasetID == "" || len(periods) == 0 {
		log.Printf("WARNING: Incomplete transfer job payload")
		return
	}

	// Get profile
	var profile models.ConnectionProfile
	if err := s.db.First(&profile, "id = ?", profileID).Error; err != nil {
		log.Printf("ERROR: Failed to get profile: %v", err)
		return
	}

	srcClient, err := s.getAPIClient(&profile, "source")
	if err != nil {
		log.Printf("ERROR: Failed to create source client: %v", err)
		return
	}

	destClient, err := s.getAPIClient(&profile, "dest")
	if err != nil {
		log.Printf("ERROR: Failed to create dest client: %v", err)
		return
	}

	// Execute transfer for each period and org unit
	for _, period := range periods {
		orgUnits := parentOrgUnits
		if len(orgUnits) == 0 {
			orgUnits = []string{""}
		}

		for _, parentOU := range orgUnits {
			params := map[string]string{
				"dataSet":  datasetID,
				"period":   period,
				"children": "true",
			}
			if parentOU != "" {
				params["orgUnit"] = parentOU
			}

			resp, err := srcClient.Get("/api/dataValueSets", params)
			if err != nil {
				log.Printf("WARNING: Failed to fetch data: %v", err)
				continue
			}

			var data map[string]interface{}
			if err := json.Unmarshal(resp.Body(), &data); err != nil {
				log.Printf("WARNING: Failed to parse response: %v", err)
				continue
			}

			dataValues, _ := data["dataValues"].([]interface{})
			if len(dataValues) == 0 {
				continue
			}

			// Ensure period is set on each data value
			for _, dv := range dataValues {
				if dvMap, ok := dv.(map[string]interface{}); ok {
					if _, hasPeriod := dvMap["period"]; !hasPeriod {
						dvMap["period"] = period
					}
				}
			}

			// Post to destination
			postPayload := map[string]interface{}{
				"dataValues": dataValues,
			}

			if _, err := destClient.Post("/api/dataValueSets", postPayload); err != nil {
				log.Printf("WARNING: Failed to post data values: %v", err)
				continue
			}

			// Mark complete if requested
			if markComplete {
				ouIDs := make(map[string]bool)
				for _, dv := range dataValues {
					if dvMap, ok := dv.(map[string]interface{}); ok {
						if ouID, ok := dvMap["orgUnit"].(string); ok && ouID != "" {
							ouIDs[ouID] = true
						}
					}
				}

				if len(ouIDs) > 0 {
					registrations := []map[string]interface{}{}
					for ouID := range ouIDs {
						registrations = append(registrations, map[string]interface{}{
							"dataSet":          destDatasetID,
							"period":           period,
							"organisationUnit": ouID,
							"completed":        true,
						})
					}

					completePayload := map[string]interface{}{
						"completeDataSetRegistrations": registrations,
					}

					if _, err := destClient.Post("/api/completeDataSetRegistrations", completePayload); err != nil {
						log.Printf("WARNING: Failed to mark complete: %v", err)
					}
				}
			}
		}
	}
}

func (s *Service) getAPIClient(profile *models.ConnectionProfile, instance string) (*api.Client, error) {
	var url, username, encPassword string

	if instance == "source" {
		url = profile.SourceURL
		username = profile.SourceUsername
		encPassword = profile.SourcePasswordEnc
	} else {
		url = profile.DestURL
		username = profile.DestUsername
		encPassword = profile.DestPasswordEnc
	}

	password, err := crypto.DecryptPassword(encPassword)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt password: %w", err)
	}

	return api.NewClient(url, username, password), nil
}

// normalizeCron converts 5-field cron to 6-field format by prepending seconds
// 5-field: "minute hour day month dow" (APScheduler/standard cron)
// 6-field: "second minute hour day month dow" (robfig/cron with WithSeconds)
func normalizeCron(cronExpr string) (string, error) {
	// Import strings package is already available at top of file

	// Trim whitespace
	cronExpr = strings.TrimSpace(cronExpr)

	// Check if it's already 6-field
	fields := strings.Fields(cronExpr)
	if len(fields) == 6 {
		// Already 6-field, try to validate it
		parser := cron.NewParser(cron.SecondOptional | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)
		if _, err := parser.Parse(cronExpr); err == nil {
			return cronExpr, nil // Valid 6-field expression
		}
	}

	// Assume 5-field, validate and convert
	if len(fields) == 5 {
		// Validate as standard 5-field cron
		if _, err := cron.ParseStandard(cronExpr); err != nil {
			return "", fmt.Errorf("invalid 5-field cron expression: %w", err)
		}
		// Prepend seconds (0 = run at 0 seconds of the minute)
		return "0 " + cronExpr, nil
	}

	return "", fmt.Errorf("invalid cron expression: expected 5 or 6 fields, got %d", len(fields))
}

func (s *Service) toJobListResponse(job *ScheduledJob) JobListResponse {
	resp := JobListResponse{
		ID:        job.ID,
		Name:      job.Name,
		JobType:   job.JobType,
		Cron:      job.Cron,
		Timezone:  job.Timezone,
		Enabled:   job.Enabled,
		CreatedAt: job.CreatedAt.Format(time.RFC3339),
		UpdatedAt: job.UpdatedAt.Format(time.RFC3339),
	}

	if job.LastRunAt != nil {
		lastRun := job.LastRunAt.Format(time.RFC3339)
		resp.LastRunAt = &lastRun
	}

	if job.NextRunAt != nil {
		nextRun := job.NextRunAt.Format(time.RFC3339)
		resp.NextRun = &nextRun
	}

	return resp
}
