package completeness

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
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
	db              *gorm.DB
	ctx             context.Context
	assessmentStore map[string]*AssessmentProgress
	assessmentMu    sync.RWMutex
	bulkActionStore map[string]*BulkActionProgress
	bulkActionMu    sync.RWMutex
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
		TaskID:    taskID,
		ProfileID: req.ProfileID,
		Status:    "starting",
		Progress:  0,
		Messages:  []string{"Starting completeness assessment..."},
	}

	s.assessmentMu.Lock()
	s.assessmentStore[taskID] = progress
	s.assessmentMu.Unlock()

	// Emit initial state for frontend progress tracker
	s.emitAssessmentEvent(taskID)

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
		data, err := json.MarshalIndent(results, "", "  ")
		if err != nil {
			return "", fmt.Errorf("failed to marshal JSON: %w", err)
		}
		return string(data), nil
	}

	if format == "csv" {
		var buf strings.Builder
		writer := csv.NewWriter(&buf)

		writer.Write([]string{"orgUnitId", "name", "compliance_percentage", "elements_present", "elements_required"})

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
		return buf.String(), writer.Error()
	}

	return "", fmt.Errorf("unsupported format: %s", format)
}

// StartBulkAction initiates a background bulk complete/incomplete action
func (s *Service) StartBulkAction(req BulkActionRequest) (string, error) {
	if req.Action != "complete" && req.Action != "incomplete" {
		return "", fmt.Errorf("action must be 'complete' or 'incomplete'")
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
		Messages: []string{fmt.Sprintf("Starting bulk %s...", req.Action)},
		Results: &BulkActionResult{
			Action:     req.Action,
			Successful: []string{},
			Failed:     []string{},
		},
	}

	s.bulkActionMu.Lock()
	s.bulkActionStore[taskID] = progress
	s.bulkActionMu.Unlock()

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
			s.updateProgress(taskID, "error", 0, fmt.Sprintf("Panic: %v", r))
		}
	}()

	s.updateProgress(taskID, "running", 5, "Creating API client...")

	client, err := s.getAPIClient(profile, req.Instance)
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to create client: %v", err))
		return
	}

	requiredElements := req.RequiredElements
	if len(requiredElements) == 0 {
		s.updateProgress(taskID, "running", 10, "Fetching dataset elements...")
		elements, err := s.fetchDatasetElements(client, req.DatasetID)
		if err != nil {
			s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to fetch elements: %v", err))
			return
		}
		requiredElements = elements
	}

	results := &AssessmentResult{
		Hierarchy:         make(map[string]*HierarchyResult),
		ComplianceDetails: make(map[string]*OrgUnitComplianceInfo),
	}

	total := len(req.Periods)
	for i, period := range req.Periods {
		s.appendMessage(taskID, fmt.Sprintf("Assessing %s (%d/%d)...", period, i+1, total))

		periodResults := s.assessPeriod(client, req.ParentOrgUnits, period, req.DatasetID,
			requiredElements, req.ComplianceThreshold, req.IncludeParents)

		results.TotalCompliant += periodResults.TotalCompliant
		results.TotalNonCompliant += periodResults.TotalNonCompliant
		results.TotalErrors += periodResults.TotalErrors

		for k, v := range periodResults.Hierarchy {
			results.Hierarchy[k] = v
		}
		for k, v := range periodResults.ComplianceDetails {
			results.ComplianceDetails[k] = v
		}

		progress := 10 + int(85*float64(i+1)/float64(total))
		s.updateProgress(taskID, "running", progress, "")
		time.Sleep(10 * time.Millisecond)
	}

	s.assessmentMu.Lock()
	if p, exists := s.assessmentStore[taskID]; exists {
		p.Results = results
		p.CompletedAt = time.Now().Unix()
	}
	s.assessmentMu.Unlock()

	// This will emit with results included via emitAssessmentEvent
	s.updateProgress(taskID, "completed", 100, "Assessment complete")
}

func (s *Service) assessPeriod(client *api.Client, parentOrgUnits []string, period,
	datasetID string, requiredElements []string, threshold int, includeParents bool) *AssessmentResult {

	results := &AssessmentResult{
		Hierarchy:         make(map[string]*HierarchyResult),
		ComplianceDetails: make(map[string]*OrgUnitComplianceInfo),
	}

	for _, parentOU := range parentOrgUnits {
		parentName := client.GetOrgUnitName(parentOU)

		// Step 1: Fetch the full organisation unit hierarchy (universe of units)
		// We use the 'path:like' filter to get the parent and all its descendants
		log.Printf("Fetching hierarchy for parent: %s (%s)", parentName, parentOU)
		orgUnits, err := s.fetchOrgUnitHierarchy(client, parentOU)
		if err != nil {
			log.Printf("Error fetching hierarchy: %v", err)
			results.TotalErrors++
			results.Hierarchy[parentOU] = &HierarchyResult{Name: parentName, Error: fmt.Sprintf("Failed to fetch hierarchy: %v", err)}
			continue
		}
		log.Printf("Fetched %d org units in hierarchy for %s", len(orgUnits), parentName)

		// Step 2: Fetch data values for the entire subtree
		log.Printf("Fetching data values for parent: %s", parentName)
		resp, err := client.Get("/api/dataValueSets", map[string]string{
			"dataSet":  datasetID,
			"orgUnit":  parentOU,
			"period":   period,
			"children": "true",
		})

		if err != nil {
			log.Printf("Error fetching data values: %v", err)
			results.TotalErrors++
			results.Hierarchy[parentOU] = &HierarchyResult{Name: parentName, Error: err.Error()}
			continue
		}

		var data map[string]interface{}
		json.Unmarshal(resp.Body(), &data)

		dataValues, _ := data["dataValues"].([]interface{})
		log.Printf("Fetched %d data values for %s", len(dataValues), parentName)

		// Map: OrgUnitID -> DataElementID -> Exists
		orgUnitData := make(map[string]map[string]bool)

		for _, dv := range dataValues {
			dvMap, _ := dv.(map[string]interface{})
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

		compliantUnits := []*OrgUnitComplianceInfo{}
		nonCompliantUnits := []*OrgUnitComplianceInfo{}

		// Step 3: Iterate over ALL organisation units in the hierarchy
		for _, ou := range orgUnits {
			// Skip parent if requested
			if ou.ID == parentOU && !includeParents {
				continue
			}

			// Check if this unit has data
			elementsWithData := orgUnitData[ou.ID]

			presentCount := 0
			if elementsWithData != nil {
				for _, de := range requiredElements {
					if elementsWithData[de] {
						presentCount++
					}
				}
			}

			compliancePercentage := 0.0
			if len(requiredElements) > 0 {
				compliancePercentage = float64(presentCount) / float64(len(requiredElements)) * 100
			}

			info := &OrgUnitComplianceInfo{
				ID:                   ou.ID,
				Name:                 ou.Name,
				CompliancePercentage: compliancePercentage,
				ElementsPresent:      presentCount,
				ElementsRequired:     len(requiredElements),
				HasData:              elementsWithData != nil && len(elementsWithData) > 0,
				TotalEntries:         len(elementsWithData),
			}

			results.ComplianceDetails[ou.ID] = info

			if compliancePercentage >= float64(threshold) {
				compliantUnits = append(compliantUnits, info)
				results.TotalCompliant++
			} else {
				nonCompliantUnits = append(nonCompliantUnits, info)
				results.TotalNonCompliant++
			}
		}

		log.Printf("Assessment result for %s: %d compliant, %d non-compliant", parentName, len(compliantUnits), len(nonCompliantUnits))

		results.Hierarchy[parentOU] = &HierarchyResult{
			Name:         parentName,
			Compliant:    compliantUnits,
			NonCompliant: nonCompliantUnits,
			Children:     compliantUnits,
			Unmarked:     nonCompliantUnits,
		}
	}

	return results
}

// fetchOrgUnitHierarchy fetches the parent org unit and all its descendants
func (s *Service) fetchOrgUnitHierarchy(client *api.Client, parentID string) ([]models.OrganisationUnit, error) {
	// Fetch ID, Name, and Level for the subtree
	resp, err := client.Get("/api/organisationUnits", map[string]string{
		"filter": fmt.Sprintf("path:like:%s", parentID),
		"fields": "id,name,level,path",
		"paging": "false",
	})

	if err != nil {
		return nil, err
	}

	var result struct {
		OrganisationUnits []models.OrganisationUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse org units: %w", err)
	}

	return result.OrganisationUnits, nil
}

func (s *Service) performBulkAction(taskID string, profile *models.ConnectionProfile, req BulkActionRequest) {
	defer func() {
		if r := recover(); r != nil {
			s.updateBulkProgress(taskID, "error", 0, fmt.Sprintf("Panic: %v", r))
		}
	}()

	client, err := s.getAPIClient(profile, req.Instance)
	if err != nil {
		s.updateBulkProgress(taskID, "error", 0, fmt.Sprintf("Failed to create client: %v", err))
		return
	}

	totalSteps := len(req.OrgUnits) * len(req.Periods)
	processed := 0

	for _, ouID := range req.OrgUnits {
		for _, period := range req.Periods {
			key := fmt.Sprintf("%s:%s", ouID, period)

			payload := map[string]interface{}{
				"completeDataSetRegistrations": []map[string]interface{}{
					{
						"dataSet":          req.DatasetID,
						"period":           period,
						"organisationUnit": ouID,
						"completed":        req.Action == "complete",
					},
				},
			}

			_, err := client.Post("/api/completeDataSetRegistrations", payload)

			s.bulkActionMu.Lock()
			if p, exists := s.bulkActionStore[taskID]; exists && p.Results != nil {
				if err == nil {
					p.Results.Successful = append(p.Results.Successful, key)
				} else {
					p.Results.Failed = append(p.Results.Failed, fmt.Sprintf("%s - %s", key, err.Error()))
				}
				p.Results.TotalProcessed++
			}
			s.bulkActionMu.Unlock()

			processed++
			progress := int(float64(processed) / float64(totalSteps) * 100)
			s.updateBulkProgress(taskID, "running", progress, "")
			time.Sleep(10 * time.Millisecond)
		}
	}

	s.bulkActionMu.Lock()
	if p, exists := s.bulkActionStore[taskID]; exists {
		p.CompletedAt = time.Now().Unix()
	}
	s.bulkActionMu.Unlock()

	s.updateBulkProgress(taskID, "completed", 100, "Bulk action complete")

	runtime.EventsEmit(s.ctx, fmt.Sprintf("bulk-action:%s", taskID), map[string]interface{}{
		"task_id": taskID,
		"status":  "completed",
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
	json.Unmarshal(resp.Body(), &data)

	elements := []string{}
	dataSetElements, _ := data["dataSetElements"].([]interface{})

	for _, dse := range dataSetElements {
		dseMap, _ := dse.(map[string]interface{})
		de, _ := dseMap["dataElement"].(map[string]interface{})
		if id, ok := de["id"].(string); ok && id != "" {
			elements = append(elements, id)
		}
	}

	return elements, nil
}

func (s *Service) updateProgress(taskID, status string, progress int, message string) {
	s.assessmentMu.Lock()
	defer s.assessmentMu.Unlock()

	updated := false
	if p, exists := s.assessmentStore[taskID]; exists {
		p.Status = status
		p.Progress = progress
		if message != "" {
			p.Messages = append(p.Messages, message)
		}
		updated = true
	}

	if updated {
		go s.emitAssessmentEvent(taskID)
	}
}

func (s *Service) appendMessage(taskID, message string) {
	s.assessmentMu.Lock()
	defer s.assessmentMu.Unlock()

	appended := false
	if p, exists := s.assessmentStore[taskID]; exists {
		p.Messages = append(p.Messages, message)
		appended = true
	}

	if appended {
		go s.emitAssessmentEvent(taskID)
	}
}

func (s *Service) emitAssessmentEvent(taskID string) {
	s.assessmentMu.RLock()
	progress, exists := s.assessmentStore[taskID]
	s.assessmentMu.RUnlock()
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
		payload["results"] = progress.Results
	}

	if progress.CompletedAt != 0 {
		payload["completed_at"] = progress.CompletedAt
	}

	runtime.EventsEmit(s.ctx, fmt.Sprintf("assessment:%s", taskID), payload)
}

func (s *Service) updateBulkProgress(taskID, status string, progress int, message string) {
	s.bulkActionMu.Lock()
	defer s.bulkActionMu.Unlock()

	if p, exists := s.bulkActionStore[taskID]; exists {
		p.Status = status
		p.Progress = progress
		if message != "" {
			p.Messages = append(p.Messages, message)
		}
	}
}
