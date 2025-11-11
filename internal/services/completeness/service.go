package completeness

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gorm.io/gorm"

	"dhis2sync-desktop/internal/api"
	"dhis2sync-desktop/internal/crypto"
	"dhis2sync-desktop/internal/models"
)

// Service handles completeness assessment operations
type Service struct {
	db                *gorm.DB
	ctx               context.Context
	assessmentStore   map[string]*AssessmentProgress
	assessmentMu      sync.RWMutex
	bulkActionStore   map[string]*BulkActionProgress
	bulkActionMu      sync.RWMutex
}

// NewService creates a new completeness service
func NewService(db *gorm.DB, ctx context.Context) *Service {
	return &Service{
		db:              db,
		ctx:             ctx,
		assessmentStore: make(map[string]*AssessmentProgress),
		bulkActionStore: make(map[string]*BulkActionProgress),
	}
}

// StartAssessment initiates a background completeness assessment
func (s *Service) StartAssessment(req AssessmentRequest) (string, error) {
	profile, err := s.getProfile(req.ProfileID)
	if err != nil {
		return "", fmt.Errorf("failed to get profile: %w", err)
	}

	taskID := uuid.New().String()
	progress := &AssessmentProgress{
		TaskID:   taskID,
		Status:   "starting",
		Progress: 0,
		Messages: []string{"Starting completeness assessment..."},
	}

	s.assessmentMu.Lock()
	s.assessmentStore[taskID] = progress
	s.assessmentMu.Unlock()

	// Run in background goroutine
	go s.performAssessment(taskID, profile, req)

	return taskID, nil
}

// GetAssessmentProgress retrieves assessment progress
func (s *Service) GetAssessmentProgress(taskID string) (*AssessmentProgress, error) {
	s.assessmentMu.RLock()
	defer s.assessmentMu.RUnlock()

	progress, exists := s.assessmentStore[taskID]
	if !exists {
		return nil, fmt.Errorf("task not found: %s", taskID)
	}

	return progress, nil
}

// ExportResults exports assessment results in JSON or CSV format
func (s *Service) ExportResults(taskID, format string, limit int) (string, error) {
	s.assessmentMu.RLock()
	progress, exists := s.assessmentStore[taskID]
	s.assessmentMu.RUnlock()

	if !exists {
		return "", fmt.Errorf("task not found: %s", taskID)
	}

	if progress.Status != "completed" || progress.Results == nil {
		return "", fmt.Errorf("assessment not completed or no results available")
	}

	results := progress.Results

	if format == "json" {
		// Optionally limit compliance details for preview
		if limit > 0 && len(results.ComplianceDetails) > limit {
			limitedDetails := make(map[string]*OrgUnitComplianceInfo)
			count := 0
			for k, v := range results.ComplianceDetails {
				if count >= limit {
					break
				}
				limitedDetails[k] = v
				count++
			}
			results = &AssessmentResult{
				TotalCompliant:    results.TotalCompliant,
				TotalNonCompliant: results.TotalNonCompliant,
				TotalErrors:       results.TotalErrors,
				Hierarchy:         results.Hierarchy,
				ComplianceDetails: limitedDetails,
			}
		}

		data, err := json.MarshalIndent(results, "", "  ")
		if err != nil {
			return "", fmt.Errorf("failed to marshal JSON: %w", err)
		}
		return string(data), nil
	}

	if format == "csv" {
		var buf strings.Builder
		writer := csv.NewWriter(&buf)

		// Write header
		writer.Write([]string{"orgUnitId", "name", "compliance_percentage", "elements_present", "elements_required"})

		// Write rows
		count := 0
		for ouID, info := range results.ComplianceDetails {
			if limit > 0 && count >= limit {
				break
			}
			writer.Write([]string{
				ouID,
				info.Name,
				fmt.Sprintf("%.1f", info.CompliancePercentage),
				fmt.Sprintf("%d", info.ElementsPresent),
				fmt.Sprintf("%d", info.ElementsRequired),
			})
			count++
		}

		writer.Flush()
		if err := writer.Error(); err != nil {
			return "", fmt.Errorf("failed to write CSV: %w", err)
		}

		return buf.String(), nil
	}

	return "", fmt.Errorf("unsupported format: %s (use 'json' or 'csv')", format)
}

// StartBulkAction initiates a background bulk complete/incomplete action
func (s *Service) StartBulkAction(req BulkActionRequest) (string, error) {
	if req.Action != "complete" && req.Action != "incomplete" {
		return "", fmt.Errorf("action must be 'complete' or 'incomplete', got: %s", req.Action)
	}

	profile, err := s.getProfile(req.ProfileID)
	if err != nil {
		return "", fmt.Errorf("failed to get profile: %w", err)
	}

	taskID := uuid.New().String()
	progress := &BulkActionProgress{
		TaskID:   taskID,
		Status:   "starting",
		Progress: 0,
		Messages: []string{fmt.Sprintf("Starting bulk %s for %d org units across %d period(s)...", req.Action, len(req.OrgUnits), len(req.Periods))},
		Results: &BulkActionResult{
			Action:     req.Action,
			Successful: []string{},
			Failed:     []string{},
		},
	}

	s.bulkActionMu.Lock()
	s.bulkActionStore[taskID] = progress
	s.bulkActionMu.Unlock()

	// Run in background goroutine
	go s.performBulkAction(taskID, profile, req)

	return taskID, nil
}

// GetBulkActionProgress retrieves bulk action progress
func (s *Service) GetBulkActionProgress(taskID string) (*BulkActionProgress, error) {
	s.bulkActionMu.RLock()
	defer s.bulkActionMu.RUnlock()

	progress, exists := s.bulkActionStore[taskID]
	if !exists {
		return nil, fmt.Errorf("task not found: %s", taskID)
	}

	return progress, nil
}

// Helper functions

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

func (s *Service) performAssessment(taskID string, profile *models.ConnectionProfile, req AssessmentRequest) {
	defer func() {
		if r := recover(); r != nil {
			s.updateAssessmentProgress(taskID, "error", 0, fmt.Sprintf("Panic: %v", r))
		}
	}()

	s.updateAssessmentProgress(taskID, "running", 5, "Creating API client...")

	client, err := s.getAPIClient(profile, req.Instance)
	if err != nil {
		s.updateAssessmentProgress(taskID, "error", 0, fmt.Sprintf("Failed to create API client: %v", err))
		return
	}

	// If no required elements specified, fetch from dataset
	requiredElements := req.RequiredElements
	if len(requiredElements) == 0 {
		s.updateAssessmentProgress(taskID, "running", 10, "Fetching dataset elements...")
		elements, err := s.fetchDatasetElements(client, req.DatasetID)
		if err != nil {
			s.updateAssessmentProgress(taskID, "error", 0, fmt.Sprintf("Failed to fetch dataset elements: %v", err))
			return
		}
		requiredElements = elements
		if len(requiredElements) == 0 {
			s.updateAssessmentProgress(taskID, "error", 0, "Dataset has no data elements to assess")
			return
		}
	}

	results := &AssessmentResult{
		Hierarchy:         make(map[string]*HierarchyResult),
		ComplianceDetails: make(map[string]*OrgUnitComplianceInfo),
	}

	total := len(req.Periods)
	for i, period := range req.Periods {
		s.appendMessage(taskID, fmt.Sprintf("Assessing %s (%d/%d)...", period, i+1, total))

		periodResults := s.assessPeriod(
			client,
			req.ParentOrgUnits,
			period,
			req.DatasetID,
			requiredElements,
			req.ComplianceThreshold,
			req.IncludeParents,
		)

		// Aggregate results
		results.TotalCompliant += periodResults.TotalCompliant
		results.TotalNonCompliant += periodResults.TotalNonCompliant
		results.TotalErrors += periodResults.TotalErrors

		// Merge hierarchy
		for parentID, parentData := range periodResults.Hierarchy {
			if _, exists := results.Hierarchy[parentID]; !exists {
				results.Hierarchy[parentID] = &HierarchyResult{
					Name:         parentData.Name,
					Compliant:    []*OrgUnitComplianceInfo{},
					NonCompliant: []*OrgUnitComplianceInfo{},
					Children:     []*OrgUnitComplianceInfo{},
					Unmarked:     []*OrgUnitComplianceInfo{},
				}
			}
			existing := results.Hierarchy[parentID]
			existing.Compliant = append(existing.Compliant, parentData.Compliant...)
			existing.NonCompliant = append(existing.NonCompliant, parentData.NonCompliant...)
			existing.Children = append(existing.Children, parentData.Children...)
			existing.Unmarked = append(existing.Unmarked, parentData.Unmarked...)
			if parentData.Error != "" {
				existing.Error = parentData.Error
			}
		}

		// Merge compliance details
		for ouID, info := range periodResults.ComplianceDetails {
			results.ComplianceDetails[ouID] = info
		}

		// Update progress
		progress := 10 + int(85*float64(i+1)/float64(total))
		s.updateAssessmentProgress(taskID, "running", progress, "")

		// Brief sleep for responsiveness
		time.Sleep(10 * time.Millisecond)
	}

	// Finalize
	s.assessmentMu.Lock()
	if p, exists := s.assessmentStore[taskID]; exists {
		p.Results = results
		p.CompletedAt = time.Now().Unix()
	}
	s.assessmentMu.Unlock()

	s.updateAssessmentProgress(taskID, "completed", 100, "Assessment complete")

	// Emit event
	runtime.EventsEmit(s.ctx, fmt.Sprintf("assessment:%s", taskID), map[string]interface{}{
		"task_id": taskID,
		"status":  "completed",
		"results": results,
	})
}

func (s *Service) assessPeriod(
	client *api.Client,
	parentOrgUnits []string,
	period string,
	datasetID string,
	requiredElements []string,
	threshold int,
	includeParents bool,
) *AssessmentResult {
	results := &AssessmentResult{
		Hierarchy:         make(map[string]*HierarchyResult),
		ComplianceDetails: make(map[string]*OrgUnitComplianceInfo),
	}

	for _, parentOU := range parentOrgUnits {
		parentName := client.GetOrgUnitName(parentOU)

		// Fetch data values for parent and children
		resp, err := client.Get("/api/dataValueSets", map[string]string{
			"dataSet":  datasetID,
			"orgUnit":  parentOU,
			"period":   period,
			"children": "true",
		})

		if err != nil {
			results.TotalErrors++
			results.Hierarchy[parentOU] = &HierarchyResult{
				Name:         parentName,
				Compliant:    []*OrgUnitComplianceInfo{},
				NonCompliant: []*OrgUnitComplianceInfo{},
				Children:     []*OrgUnitComplianceInfo{},
				Unmarked:     []*OrgUnitComplianceInfo{},
				Error:        err.Error(),
			}
			continue
		}

		var data map[string]interface{}
		if err := json.Unmarshal(resp.Body(), &data); err != nil {
			results.TotalErrors++
			results.Hierarchy[parentOU] = &HierarchyResult{
				Name:         parentName,
				Compliant:    []*OrgUnitComplianceInfo{},
				NonCompliant: []*OrgUnitComplianceInfo{},
				Children:     []*OrgUnitComplianceInfo{},
				Unmarked:     []*OrgUnitComplianceInfo{},
				Error:        fmt.Sprintf("Failed to parse response: %v", err),
			}
			continue
		}

		dataValues, ok := data["dataValues"].([]interface{})
		if !ok {
			dataValues = []interface{}{}
		}

		// Group data values by org unit and data element
		orgUnitData := make(map[string]map[string]bool) // ouID -> {deID: true}

		for _, dv := range dataValues {
			dvMap, ok := dv.(map[string]interface{})
			if !ok {
				continue
			}

			ouID, _ := dvMap["orgUnit"].(string)
			deID, _ := dvMap["dataElement"].(string)
			value, _ := dvMap["value"].(string)

			if ouID != "" && deID != "" && value != "" {
				if orgUnitData[ouID] == nil {
					orgUnitData[ouID] = make(map[string]bool)
				}
				orgUnitData[ouID][deID] = true
			}
		}

		// Assess compliance for each org unit
		compliantUnits := []*OrgUnitComplianceInfo{}
		nonCompliantUnits := []*OrgUnitComplianceInfo{}

		for ouID, elementsWithData := range orgUnitData {
			// Skip parent if not included
			if ouID == parentOU && !includeParents {
				continue
			}

			ouName := client.GetOrgUnitName(ouID)

			// Calculate compliance
			requiredSet := make(map[string]bool)
			for _, de := range requiredElements {
				requiredSet[de] = true
			}

			presentElements := []string{}
			for de := range requiredSet {
				if elementsWithData[de] {
					presentElements = append(presentElements, de)
				}
			}

			missingElements := []string{}
			for de := range requiredSet {
				if !elementsWithData[de] {
					missingElements = append(missingElements, de)
				}
			}

			compliancePercentage := 0.0
			if len(requiredElements) > 0 {
				compliancePercentage = float64(len(presentElements)) / float64(len(requiredElements)) * 100
			}

			info := &OrgUnitComplianceInfo{
				ID:                   ouID,
				Name:                 ouName,
				CompliancePercentage: roundFloat(compliancePercentage, 1),
				ElementsPresent:      len(presentElements),
				ElementsRequired:     len(requiredElements),
				MissingElements:      missingElements,
				HasData:              true,
				TotalEntries:         len(elementsWithData),
			}

			results.ComplianceDetails[ouID] = info

			if compliancePercentage >= float64(threshold) {
				compliantUnits = append(compliantUnits, info)
				results.TotalCompliant++
			} else {
				nonCompliantUnits = append(nonCompliantUnits, info)
				results.TotalNonCompliant++
			}
		}

		results.Hierarchy[parentOU] = &HierarchyResult{
			Name:         parentName,
			Compliant:    compliantUnits,
			NonCompliant: nonCompliantUnits,
			Children:     compliantUnits, // Backward compatibility
			Unmarked:     nonCompliantUnits,
		}
	}

	return results
}

func (s *Service) performBulkAction(taskID string, profile *models.ConnectionProfile, req BulkActionRequest) {
	defer func() {
		if r := recover(); r != nil {
			s.updateBulkActionProgress(taskID, "error", 0, fmt.Sprintf("Panic: %v", r))
		}
	}()

	s.updateBulkActionProgress(taskID, "running", 5, "Creating API client...")

	client, err := s.getAPIClient(profile, req.Instance)
	if err != nil {
		s.updateBulkActionProgress(taskID, "error", 0, fmt.Sprintf("Failed to create API client: %v", err))
		return
	}

	totalSteps := len(req.OrgUnits) * len(req.Periods)
	processed := 0

	for _, ouID := range req.OrgUnits {
		for _, period := range req.Periods {
			key := fmt.Sprintf("%s:%s", ouID, period)

			var resp interface{}
			var err error

			if req.Action == "complete" {
				payload := map[string]interface{}{
					"completeDataSetRegistrations": []map[string]interface{}{
						{
							"dataSet":          req.DatasetID,
							"period":           period,
							"organisationUnit": ouID,
							"completed":        true,
						},
					},
				}
				resp, err = client.Post("/api/completeDataSetRegistrations", payload)
			} else {
				// Incomplete action
				payload := map[string]interface{}{
					"completeDataSetRegistrations": []map[string]interface{}{
						{
							"dataSet":          req.DatasetID,
							"period":           period,
							"organisationUnit": ouID,
							"completed":        false,
						},
					},
				}
				resp, err = client.Post("/api/completeDataSetRegistrations", payload)
			}

			s.bulkActionMu.Lock()
			if p, exists := s.bulkActionStore[taskID]; exists && p.Results != nil {
				if err == nil && resp != nil {
					p.Results.Successful = append(p.Results.Successful, key)
					s.appendBulkActionMessage(taskID, fmt.Sprintf("✓ %s %s", req.Action, key))
				} else {
					errMsg := "unknown error"
					if err != nil {
						errMsg = err.Error()
					}
					p.Results.Failed = append(p.Results.Failed, fmt.Sprintf("%s - %s", key, errMsg))
					s.appendBulkActionMessage(taskID, fmt.Sprintf("✗ %s %s - %s", req.Action, key, errMsg))
				}
				p.Results.TotalProcessed++
			}
			s.bulkActionMu.Unlock()

			processed++
			progress := int(float64(processed) / float64(totalSteps) * 100)
			s.updateBulkActionProgress(taskID, "running", progress, "")

			time.Sleep(10 * time.Millisecond)
		}
	}

	// Finalize
	s.bulkActionMu.Lock()
	if p, exists := s.bulkActionStore[taskID]; exists {
		p.CompletedAt = time.Now().Unix()
		successCount := len(p.Results.Successful)
		failCount := len(p.Results.Failed)
		finalMsg := fmt.Sprintf("Completed bulk %s. Success: %d, Failed: %d", req.Action, successCount, failCount)
		p.Messages = append(p.Messages, finalMsg)
	}
	s.bulkActionMu.Unlock()

	s.updateBulkActionProgress(taskID, "completed", 100, "")

	// Emit event
	s.bulkActionMu.RLock()
	results := s.bulkActionStore[taskID].Results
	s.bulkActionMu.RUnlock()

	runtime.EventsEmit(s.ctx, fmt.Sprintf("bulk-action:%s", taskID), map[string]interface{}{
		"task_id": taskID,
		"status":  "completed",
		"results": results,
	})
}

func (s *Service) fetchDatasetElements(client *api.Client, datasetID string) ([]string, error) {
	resp, err := client.Get(fmt.Sprintf("/api/dataSets/%s.json", datasetID), map[string]string{
		"fields": "dataSetElements[dataElement[id]]",
	})
	if err != nil {
		return nil, err
	}

	var data map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &data); err != nil {
		return nil, err
	}

	elements := []string{}
	dataSetElements, ok := data["dataSetElements"].([]interface{})
	if !ok {
		return elements, nil
	}

	for _, dse := range dataSetElements {
		dseMap, ok := dse.(map[string]interface{})
		if !ok {
			continue
		}
		de, ok := dseMap["dataElement"].(map[string]interface{})
		if !ok {
			continue
		}
		if id, ok := de["id"].(string); ok && id != "" {
			elements = append(elements, id)
		}
	}

	return elements, nil
}

func (s *Service) updateAssessmentProgress(taskID, status string, progress int, message string) {
	s.assessmentMu.Lock()
	defer s.assessmentMu.Unlock()

	if p, exists := s.assessmentStore[taskID]; exists {
		p.Status = status
		p.Progress = progress
		if message != "" {
			p.Messages = append(p.Messages, message)
			// Trim messages to avoid uncontrolled growth
			if len(p.Messages) > 500 {
				p.Messages = p.Messages[len(p.Messages)-500:]
			}
		}
	}
}

func (s *Service) appendMessage(taskID, message string) {
	s.assessmentMu.Lock()
	defer s.assessmentMu.Unlock()

	if p, exists := s.assessmentStore[taskID]; exists {
		p.Messages = append(p.Messages, message)
		if len(p.Messages) > 500 {
			p.Messages = p.Messages[len(p.Messages)-500:]
		}
	}
}

func (s *Service) updateBulkActionProgress(taskID, status string, progress int, message string) {
	s.bulkActionMu.Lock()
	defer s.bulkActionMu.Unlock()

	if p, exists := s.bulkActionStore[taskID]; exists {
		p.Status = status
		p.Progress = progress
		if message != "" {
			p.Messages = append(p.Messages, message)
			if len(p.Messages) > 500 {
				p.Messages = p.Messages[len(p.Messages)-500:]
			}
		}
	}
}

func (s *Service) appendBulkActionMessage(taskID, message string) {
	if p, exists := s.bulkActionStore[taskID]; exists {
		p.Messages = append(p.Messages, message)
		if len(p.Messages) > 500 {
			p.Messages = p.Messages[len(p.Messages)-500:]
		}
	}
}

func roundFloat(val float64, precision int) float64 {
	multiplier := 1.0
	for i := 0; i < precision; i++ {
		multiplier *= 10
	}
	return float64(int(val*multiplier+0.5)) / multiplier
}
