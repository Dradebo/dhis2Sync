package tracker

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gorm.io/gorm"

	"dhis2sync-desktop/internal/api"
	"dhis2sync-desktop/internal/crypto"
	"dhis2sync-desktop/internal/models"
)

// Service handles tracker event operations
type Service struct {
	db            *gorm.DB
	ctx           context.Context
	transferStore map[string]*TransferProgress
	transferMu    sync.RWMutex
}

// NewService creates a new tracker service
func NewService(db *gorm.DB, ctx context.Context) *Service {
	return &Service{
		db:            db,
		ctx:           ctx,
		transferStore: make(map[string]*TransferProgress),
	}
}

// ListPrograms retrieves programs from the specified instance
func (s *Service) ListPrograms(profileID, instance string, includeAll bool, searchQuery string) ([]Program, error) {
	profile, err := s.getProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	client, err := s.getAPIClient(profile, instance)
	if err != nil {
		return nil, fmt.Errorf("failed to create API client: %w", err)
	}

	params := map[string]string{
		"fields": "id,displayName,programType,version,programStages[id,displayName]",
		"paging": "false",
	}

	if searchQuery != "" {
		params["filter"] = fmt.Sprintf("displayName:ilike:%s", searchQuery)
	}

	resp, err := client.Get("/api/programs.json", params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch programs: %w", err)
	}

	var result struct {
		Programs []Program `json:"programs"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse programs response: %w", err)
	}

	programs := result.Programs

	// Filter to event-only programs if requested
	if !includeAll {
		filtered := []Program{}
		for _, p := range programs {
			if p.ProgramType == "WITHOUT_REGISTRATION" {
				filtered = append(filtered, p)
			}
		}
		programs = filtered
	}

	return programs, nil
}

// GetProgramDetail retrieves detailed program information
func (s *Service) GetProgramDetail(profileID, programID, instance string) (*Program, error) {
	profile, err := s.getProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	client, err := s.getAPIClient(profile, instance)
	if err != nil {
		return nil, fmt.Errorf("failed to create API client: %w", err)
	}

	params := map[string]string{
		"fields": "id,displayName,programType,version,programStages[id,displayName,programStageDataElements[dataElement[id,displayName,code,valueType,optionSet[id,displayName,options[code,name]]]]]",
	}

	resp, err := client.Get(fmt.Sprintf("/api/programs/%s", programID), params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch program detail: %w", err)
	}

	var program Program
	if err := json.Unmarshal(resp.Body(), &program); err != nil {
		return nil, fmt.Errorf("failed to parse program detail: %w", err)
	}

	return &program, nil
}

// PreviewEvents fetches a preview of events for the given parameters
func (s *Service) PreviewEvents(req PreviewRequest) (*PreviewResponse, error) {
	profile, err := s.getProfile(req.ProfileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	client, err := s.getAPIClient(profile, req.Instance)
	if err != nil {
		return nil, fmt.Errorf("failed to create API client: %w", err)
	}

	previewCap := req.PreviewCap
	if previewCap <= 0 {
		previewCap = 1000
	}

	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 200
	}
	if pageSize > 500 {
		pageSize = 500
	}

	totalCollected := 0
	sample := []map[string]interface{}{}

	for _, orgUnit := range req.OrgUnits {
		page := 1
		for totalCollected < previewCap {
			params := map[string]string{
				"program":    req.ProgramID,
				"orgUnit":    orgUnit,
				"ouMode":     "DESCENDANTS",
				"startDate":  req.StartDate,
				"endDate":    req.EndDate,
				"page":       fmt.Sprintf("%d", page),
				"pageSize":   fmt.Sprintf("%d", pageSize),
				"totalPages": "true",
			}

			if req.ProgramStage != "" {
				params["programStage"] = req.ProgramStage
			}
			if req.Status != "" {
				params["status"] = req.Status
			}

			resp, err := client.Get("/api/events", params)
			if err != nil {
				break
			}

			var data map[string]interface{}
			if err := json.Unmarshal(resp.Body(), &data); err != nil {
				break
			}

			events, _ := data["events"].([]interface{})
			if len(events) == 0 {
				break
			}

			totalCollected += len(events)

			// Collect up to 5 sample events
			if len(sample) < 5 {
				for _, evt := range events {
					if len(sample) >= 5 {
						break
					}
					if evtMap, ok := evt.(map[string]interface{}); ok {
						sample = append(sample, evtMap)
					}
				}
			}

			// Check pagination
			pager, _ := data["pager"].(map[string]interface{})
			pageCount := 1
			if pc, ok := pager["pageCount"].(float64); ok {
				pageCount = int(pc)
			}

			if page >= pageCount {
				break
			}
			page++
		}
	}

	return &PreviewResponse{
		ProgramID:     req.ProgramID,
		OrgUnits:      req.OrgUnits,
		StartDate:     req.StartDate,
		EndDate:       req.EndDate,
		EstimateTotal: totalCollected,
		Sample:        sample,
	}, nil
}

// StartTransfer initiates a background event transfer
func (s *Service) StartTransfer(req TransferRequest) (string, error) {
	profile, err := s.getProfile(req.ProfileID)
	if err != nil {
		return "", fmt.Errorf("failed to get profile: %w", err)
	}

	// Set defaults
	if req.BatchSize <= 0 {
		req.BatchSize = 200
	}
	if req.MaxPages <= 0 {
		req.MaxPages = 500
	}
	if req.MaxRuntimeSeconds <= 0 {
		req.MaxRuntimeSeconds = 1500 // 25 minutes
	}

	taskID := uuid.New().String()
	progress := &TransferProgress{
		TaskID:   taskID,
		Status:   "starting",
		Progress: 0,
		Messages: []string{"Starting tracker event transfer..."},
	}

	s.transferMu.Lock()
	s.transferStore[taskID] = progress
	s.transferMu.Unlock()

	// Emit initial state for frontend
	s.emitTransferEvent(taskID)

	// Run in background goroutine
	go s.performTransfer(taskID, profile, req)

	return taskID, nil
}

// GetTransferProgress retrieves transfer progress
func (s *Service) GetTransferProgress(taskID string) (*TransferProgress, error) {
	s.transferMu.RLock()
	defer s.transferMu.RUnlock()

	progress, exists := s.transferStore[taskID]
	if !exists {
		return nil, fmt.Errorf("task not found: %s", taskID)
	}

	return progress, nil
}

func (s *Service) getProfile(profileID string) (*models.ConnectionProfile, error) {
	var profile models.ConnectionProfile
	if err := s.db.First(&profile, "id = ?", profileID).Error; err != nil {
		return nil, err
	}
	return &profile, nil
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

func (s *Service) performTransfer(taskID string, profile *models.ConnectionProfile, req TransferRequest) {
	defer func() {
		if r := recover(); r != nil {
			s.updateProgress(taskID, "error", 0, fmt.Sprintf("Panic: %v", r))
		}
	}()

	s.updateProgress(taskID, "running", 5, "Creating API clients...")

	srcClient, err := s.getAPIClient(profile, "source")
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to create source client: %v", err))
		return
	}

	destClient, err := s.getAPIClient(profile, "dest")
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to create destination client: %v", err))
		return
	}

	pageSize := req.BatchSize
	if pageSize < 50 {
		pageSize = 50
	}
	if pageSize > 500 {
		pageSize = 500
	}

	totalFetched := 0
	totalSent := 0
	batchesSent := 0
	startTime := time.Now()

	for idx, orgUnit := range req.OrgUnits {
		s.appendMessage(taskID, fmt.Sprintf("Processing OU %d/%d: %s", idx+1, len(req.OrgUnits), orgUnit))

		page := 1
		for page <= req.MaxPages {
			// Check max runtime
			if time.Since(startTime).Seconds() > float64(req.MaxRuntimeSeconds) {
				s.appendMessage(taskID, "Max runtime reached; finishing early with partial results")
				s.finalizeTransfer(taskID, totalFetched, totalSent, batchesSent, req.DryRun, true)
				return
			}

			params := map[string]string{
				"program":    req.ProgramID,
				"orgUnit":    orgUnit,
				"ouMode":     "DESCENDANTS",
				"startDate":  req.StartDate,
				"endDate":    req.EndDate,
				"page":       fmt.Sprintf("%d", page),
				"pageSize":   fmt.Sprintf("%d", pageSize),
				"totalPages": "true",
			}

			if req.ProgramStage != "" {
				params["programStage"] = req.ProgramStage
			}
			if req.Status != "" {
				params["status"] = req.Status
			}

			resp, err := srcClient.Get("/api/events", params)
			if err != nil {
				s.appendMessage(taskID, fmt.Sprintf("Fetch failed for %s page %d: %v", orgUnit, page, err))
				break
			}

			var data map[string]interface{}
			if err := json.Unmarshal(resp.Body(), &data); err != nil {
				s.appendMessage(taskID, fmt.Sprintf("Failed to parse events: %v", err))
				break
			}

			events, _ := data["events"].([]interface{})
			if len(events) == 0 {
				break
			}

			totalFetched += len(events)

			// Transform events to minimal payload
			transformed := []map[string]interface{}{}
			for _, evt := range events {
				if evtMap, ok := evt.(map[string]interface{}); ok {
					minimal := minimalEvent(evtMap)
					transformed = append(transformed, minimal)
				}
			}

			if req.DryRun {
				s.appendMessage(taskID, fmt.Sprintf("Dry-run: would send %d events (OU %s, page %d)", len(transformed), orgUnit, page))
			} else {
				// Send in batches
				chunkSize := req.BatchSize
				for i := 0; i < len(transformed); i += chunkSize {
					end := i + chunkSize
					if end > len(transformed) {
						end = len(transformed)
					}
					batch := transformed[i:end]

					payload := map[string]interface{}{
						"events": batch,
					}

					_, err := destClient.Post("/api/events", payload)
					if err != nil {
						s.appendMessage(taskID, fmt.Sprintf("✗ Failed to send batch (OU %s, page %d): %v", orgUnit, page, err))
					} else {
						totalSent += len(batch)
						batchesSent++
						s.appendMessage(taskID, fmt.Sprintf("✓ Sent %d events (OU %s, batch %d, page %d)", len(batch), orgUnit, batchesSent, page))
					}
				}
			}

			// Update progress
			s.transferMu.Lock()
			if p, exists := s.transferStore[taskID]; exists {
				p.Progress = min(95, p.Progress+2)
				// Trim messages to prevent memory growth
				if len(p.Messages) > 500 {
					p.Messages = p.Messages[len(p.Messages)-500:]
				}
			}
			s.transferMu.Unlock()

			// Small sleep to avoid blocking
			time.Sleep(10 * time.Millisecond)

			// Check pagination
			pager, _ := data["pager"].(map[string]interface{})
			pageCount := 1
			if pc, ok := pager["pageCount"].(float64); ok {
				pageCount = int(pc)
			}

			if page >= pageCount {
				break
			}
			page++
		}
	}

	s.finalizeTransfer(taskID, totalFetched, totalSent, batchesSent, req.DryRun, false)
}

func (s *Service) finalizeTransfer(taskID string, fetched, sent, batches int, dryRun, partial bool) {
	s.transferMu.Lock()
	if p, exists := s.transferStore[taskID]; exists {
		p.Status = "completed"
		p.Progress = 100
		p.Results = &TransferResult{
			TotalFetched: fetched,
			TotalSent:    sent,
			BatchesSent:  batches,
			DryRun:       dryRun,
			Partial:      partial,
		}
		p.CompletedAt = time.Now().Unix()

		msg := fmt.Sprintf("Done. Fetched %d events, sent %d across %d batches", fetched, sent, batches)
		if partial {
			msg += " (partial - stopped due to runtime limit)"
		}
		p.Messages = append(p.Messages, msg)
	}
	s.transferMu.Unlock()

	s.emitTransferEvent(taskID)
}

func (s *Service) updateProgress(taskID, status string, progress int, message string) {
	s.transferMu.Lock()
	defer s.transferMu.Unlock()

	updated := false
	if p, exists := s.transferStore[taskID]; exists {
		p.Status = status
		p.Progress = progress
		if message != "" {
			p.Messages = append(p.Messages, message)
		}
		updated = true
	}

	if updated {
		go s.emitTransferEvent(taskID)
	}
}

func (s *Service) appendMessage(taskID, message string) {
	s.transferMu.Lock()
	defer s.transferMu.Unlock()

	appended := false
	if p, exists := s.transferStore[taskID]; exists {
		p.Messages = append(p.Messages, message)
		// Trim messages to prevent memory growth
		if len(p.Messages) > 500 {
			p.Messages = p.Messages[len(p.Messages)-500:]
		}
		appended = true
	}

	if appended {
		go s.emitTransferEvent(taskID)
	}
}

func (s *Service) emitTransferEvent(taskID string) {
	s.transferMu.RLock()
	progress, exists := s.transferStore[taskID]
	s.transferMu.RUnlock()
	if !exists {
		return
	}

	payload := map[string]interface{}{
		"task_id":  taskID,
		"status":   progress.Status,
		"progress": progress.Progress,
		"messages": append([]string(nil), progress.Messages...),
	}

	if len(progress.Messages) > 0 {
		payload["message"] = progress.Messages[len(progress.Messages)-1]
	}

	if progress.Results != nil {
		payload["result"] = progress.Results
	}

	if progress.CompletedAt != 0 {
		payload["completed_at"] = progress.CompletedAt
	}

	runtime.EventsEmit(s.ctx, fmt.Sprintf("tracker:%s", taskID), payload)
}

// minimalEvent transforms a source event to a minimal payload
func minimalEvent(event map[string]interface{}) map[string]interface{} {
	allowedKeys := map[string]bool{
		"program":              true,
		"orgUnit":              true,
		"programStage":         true,
		"eventDate":            true,
		"dueDate":              true,
		"status":               true,
		"dataValues":           true,
		"coordinate":           true,
		"geometry":             true,
		"completedDate":        true,
		"attributeOptionCombo": true,
		"notes":                true,
	}

	out := make(map[string]interface{})
	for k, v := range event {
		if allowedKeys[k] {
			out[k] = v
		}
	}

	// Ensure programStage is present
	if _, ok := out["programStage"]; !ok {
		if ps, exists := event["programStage"]; exists {
			out["programStage"] = ps
		}
	}

	// Filter dataValues to core keys
	if dataValues, ok := out["dataValues"].([]interface{}); ok {
		cleaned := []map[string]interface{}{}
		for _, dv := range dataValues {
			if dvMap, ok := dv.(map[string]interface{}); ok {
				cleanedDV := make(map[string]interface{})
				if de, exists := dvMap["dataElement"]; exists {
					cleanedDV["dataElement"] = de
				}
				if val, exists := dvMap["value"]; exists {
					cleanedDV["value"] = val
				}
				if pe, exists := dvMap["providedElsewhere"]; exists {
					cleanedDV["providedElsewhere"] = pe
				}
				if len(cleanedDV) > 0 {
					cleaned = append(cleaned, cleanedDV)
				}
			}
		}
		out["dataValues"] = cleaned
	}

	return out
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
