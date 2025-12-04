package audit

import (
	"context"
	"dhis2sync-desktop/internal/api"
	"dhis2sync-desktop/internal/crypto"
	"dhis2sync-desktop/internal/database"
	"dhis2sync-desktop/internal/models"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
)

// Service handles metadata audit operations
type Service struct {
	ctx       context.Context
	taskStore map[string]*AuditProgress
	taskMu    sync.RWMutex
}

// NewService creates a new Audit service
func NewService(ctx context.Context) *Service {
	return &Service{
		ctx:       ctx,
		taskStore: make(map[string]*AuditProgress),
	}
}

// AuditProgress tracks the progress of an audit task
type AuditProgress struct {
	TaskID   string       `json:"task_id"`
	Status   string       `json:"status"` // "running", "completed", "failed"
	Progress int          `json:"progress"`
	Messages []string     `json:"messages"`
	Results  *AuditResult `json:"results,omitempty"`
}

// AuditResult contains the findings of the audit
type AuditResult struct {
	MissingOrgUnits []MissingItem `json:"missing_org_units"`
	MissingCOCs     []MissingItem `json:"missing_cocs"`
	DataIssues      []DataIssue   `json:"data_issues"`
}

type MissingItem struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	Type       string           `json:"type"` // "orgUnit", "categoryOptionCombo"
	Suggestion *MatchSuggestion `json:"suggestion,omitempty"`
}

type MatchSuggestion struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Score int    `json:"score"` // Confidence score (0-100)
}

type DataIssue struct {
	DataElementID string `json:"data_element_id"`
	Value         string `json:"value"`
	IssueType     string `json:"issue_type"` // "invalid_email", "invalid_phone"
	Count         int    `json:"count"`
}

// StartAudit initiates a background audit
func (s *Service) StartAudit(profileID string, datasetID string, periods []string) (string, error) {
	taskID := "audit-" + uuid.New().String()

	progress := &AuditProgress{
		TaskID:   taskID,
		Status:   "starting",
		Progress: 0,
		Messages: []string{"Initializing audit..."},
	}

	s.taskMu.Lock()
	s.taskStore[taskID] = progress
	s.taskMu.Unlock()

	go s.performAudit(taskID, profileID, datasetID, periods)

	return taskID, nil
}

// GetAuditProgress retrieves progress
func (s *Service) GetAuditProgress(taskID string) (*AuditProgress, error) {
	s.taskMu.RLock()
	defer s.taskMu.RUnlock()

	if progress, ok := s.taskStore[taskID]; ok {
		return progress, nil
	}
	return nil, fmt.Errorf("task not found")
}

func (s *Service) performAudit(taskID, profileID, datasetID string, periods []string) {
	defer func() {
		if r := recover(); r != nil {
			s.updateProgress(taskID, "failed", 0, fmt.Sprintf("Panic during audit: %v", r))
		}
	}()

	s.updateProgress(taskID, "running", 5, "Loading connection profile...")

	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		s.updateProgress(taskID, "failed", 0, fmt.Sprintf("Failed to load profile: %v", err))
		return
	}

	// Decrypt passwords and create clients
	sourcePwd, err := crypto.DecryptPassword(profile.SourcePasswordEnc)
	if err != nil {
		s.updateProgress(taskID, "failed", 0, fmt.Sprintf("Failed to decrypt source password: %v", err))
		return
	}
	sourceClient := api.NewClient(profile.SourceURL, profile.SourceUsername, sourcePwd)

	destPwd, err := crypto.DecryptPassword(profile.DestPasswordEnc)
	if err != nil {
		s.updateProgress(taskID, "failed", 0, fmt.Sprintf("Failed to decrypt destination password: %v", err))
		return
	}
	destClient := api.NewClient(profile.DestURL, profile.DestUsername, destPwd)

	// 1. Scan Source for unique OUs and COCs
	s.updateProgress(taskID, "running", 15, "Scanning source data...")

	uniqueOUs := make(map[string]bool)
	uniqueCOCs := make(map[string]bool)

	// We also need to find the root org unit to limit the scan if needed,
	// but for now let's assume we scan the dataset for the given periods.
	// Note: In the desktop app, we usually discover OUs first.
	// Here we might need to do a similar discovery or just fetch data if the dataset is small enough.
	// Given the "War Room" context (large data), we should probably use the same discovery logic
	// or just fetch by root OU if known.
	// For simplicity in this first pass, let's try to fetch dataValueSets for the root OU (user's root).

	// Get user's root org unit from source
	resp, err := sourceClient.Get("api/me.json?fields=organisationUnits[id]", nil)
	if err != nil || !resp.IsSuccess() {
		s.updateProgress(taskID, "failed", 0, "Failed to get user root org unit")
		return
	}

	var meResp struct {
		OrganisationUnits []struct {
			ID string `json:"id"`
		} `json:"organisationUnits"`
	}
	_ = json.Unmarshal(resp.Body(), &meResp)
	if len(meResp.OrganisationUnits) == 0 {
		s.updateProgress(taskID, "failed", 0, "No root org unit found for user")
		return
	}
	rootOU := meResp.OrganisationUnits[0].ID

	totalPeriods := len(periods)
	for i, period := range periods {
		progress := 15 + (20 * i / totalPeriods)
		s.updateProgress(taskID, "running", progress, fmt.Sprintf("Scanning period %s...", period))

		// Fetch data values (metadata only to save bandwidth? No, we need values to check for invalid emails)
		// We'll fetch everything but maybe we can optimize?
		// Actually, we need to know WHICH OUs are present.
		params := map[string]string{
			"dataSet":        datasetID,
			"orgUnit":        rootOU,
			"period":         period,
			"children":       "true",
			"paging":         "false",
			"includeDeleted": "false",
		}

		resp, err := sourceClient.Get("api/dataValueSets", params)
		if err != nil {
			s.updateProgress(taskID, "failed", 0, fmt.Sprintf("Failed to fetch data for period %s: %v", period, err))
			return
		}

		var dataValueSet struct {
			DataValues []struct {
				OrgUnit             string `json:"orgUnit"`
				CategoryOptionCombo string `json:"categoryOptionCombo"`
				DataElement         string `json:"dataElement"`
				Value               string `json:"value"`
			} `json:"dataValues"`
		}

		if err := json.Unmarshal(resp.Body(), &dataValueSet); err == nil {
			for _, dv := range dataValueSet.DataValues {
				uniqueOUs[dv.OrgUnit] = true
				uniqueCOCs[dv.CategoryOptionCombo] = true
				// TODO: Check for data quality issues here
			}
		}
	}

	s.updateProgress(taskID, "running", 35, fmt.Sprintf("Found %d unique OrgUnits and %d COCs", len(uniqueOUs), len(uniqueCOCs)))

	// 2. Check Destination for existence
	s.updateProgress(taskID, "running", 40, "Checking destination for missing metadata...")

	// Convert maps to slices
	ouIDs := make([]string, 0, len(uniqueOUs))
	for id := range uniqueOUs {
		ouIDs = append(ouIDs, id)
	}
	cocIDs := make([]string, 0, len(uniqueCOCs))
	for id := range uniqueCOCs {
		cocIDs = append(cocIDs, id)
	}

	// Check OUs
	foundOUs, err := s.checkExistence(destClient, "organisationUnits", ouIDs)
	if err != nil {
		s.updateProgress(taskID, "failed", 0, fmt.Sprintf("Failed to check OUs: %v", err))
		return
	}

	// Check COCs
	foundCOCs, err := s.checkExistence(destClient, "categoryOptionCombos", cocIDs)
	if err != nil {
		s.updateProgress(taskID, "failed", 0, fmt.Sprintf("Failed to check COCs: %v", err))
		return
	}

	// Identify missing items
	missingOUs := []MissingItem{}
	for _, id := range ouIDs {
		if !foundOUs[id] {
			missingOUs = append(missingOUs, MissingItem{ID: id, Type: "orgUnit"})
		}
	}

	missingCOCs := []MissingItem{}
	for _, id := range cocIDs {
		if !foundCOCs[id] {
			missingCOCs = append(missingCOCs, MissingItem{ID: id, Type: "categoryOptionCombo"})
		}
	}

	s.updateProgress(taskID, "running", 60, fmt.Sprintf("Found %d missing OUs and %d missing COCs", len(missingOUs), len(missingCOCs)))

	// 3. Perform Fuzzy/Structural matching for missing items
	s.updateProgress(taskID, "running", 70, "Attempting to resolve missing items...")

	// Resolve OUs
	for i, item := range missingOUs {
		// Fetch Source Name
		// We need to fetch it from Source API because we only have ID
		var srcName string
		resp, err := sourceClient.Get(fmt.Sprintf("api/organisationUnits/%s?fields=name", item.ID), nil)
		if err == nil && resp.IsSuccess() {
			var nameResp struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(resp.Body(), &nameResp); err == nil {
				srcName = nameResp.Name
				missingOUs[i].Name = srcName
			}
		}

		if srcName != "" {
			suggestion, _ := s.findBestMatch(destClient, "organisationUnits", srcName)
			if suggestion != nil {
				missingOUs[i].Suggestion = suggestion
			}
		}
	}

	// Resolve COCs
	for i, item := range missingCOCs {
		// Fetch Source Name
		var srcName string
		resp, err := sourceClient.Get(fmt.Sprintf("api/categoryOptionCombos/%s?fields=name", item.ID), nil)
		if err == nil && resp.IsSuccess() {
			var nameResp struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(resp.Body(), &nameResp); err == nil {
				srcName = nameResp.Name
				missingCOCs[i].Name = srcName
			}
		}

		if srcName != "" {
			suggestion, _ := s.resolveCOCByStructure(sourceClient, destClient, item.ID, srcName)
			if suggestion != nil {
				missingCOCs[i].Suggestion = suggestion
			}
		}
	}

	// Save results
	result := &AuditResult{
		MissingOrgUnits: missingOUs,
		MissingCOCs:     missingCOCs,
		// DataIssues: ...
	}

	s.taskMu.Lock()
	if p, ok := s.taskStore[taskID]; ok {
		p.Results = result
		p.Status = "completed"
		p.Progress = 100
		p.Messages = append(p.Messages, "Audit complete")
	}
	s.taskMu.Unlock()
}

func (s *Service) resolveCOCByStructure(sourceClient, destClient *api.Client, srcID, srcName string) (*MatchSuggestion, error) {
	// 1. Get Source Options
	resp, err := sourceClient.Get(fmt.Sprintf("api/categoryOptionCombos/%s?fields=categoryOptions[name]", srcID), nil)
	if err != nil || !resp.IsSuccess() {
		return nil, err
	}

	var srcResp struct {
		CategoryOptions []struct {
			Name string `json:"name"`
		} `json:"categoryOptions"`
	}
	if err := json.Unmarshal(resp.Body(), &srcResp); err != nil {
		return nil, err
	}

	if len(srcResp.CategoryOptions) == 0 {
		return nil, nil // Default or empty COC
	}

	// 2. Find Target Options
	targetOptIDs := make([]string, 0, len(srcResp.CategoryOptions))
	for _, opt := range srcResp.CategoryOptions {
		// Search by name
		params := map[string]string{
			"filter": fmt.Sprintf("name:eq:%s", opt.Name),
			"fields": "id",
		}
		resp, err := destClient.Get("api/categoryOptions", params)
		if err != nil || !resp.IsSuccess() {
			return nil, nil // Option missing in target
		}

		var targetResp struct {
			CategoryOptions []struct {
				ID string `json:"id"`
			} `json:"categoryOptions"`
		}
		if err := json.Unmarshal(resp.Body(), &targetResp); err != nil {
			return nil, err
		}

		if len(targetResp.CategoryOptions) > 0 {
			targetOptIDs = append(targetOptIDs, targetResp.CategoryOptions[0].ID)
		} else {
			return nil, nil // Option not found
		}
	}

	// 3. Find Target COC with these options
	if len(targetOptIDs) == 0 {
		return nil, nil
	}

	firstOpt := targetOptIDs[0]
	// Filter COCs that contain the first option
	params := map[string]string{
		"filter": fmt.Sprintf("categoryOptions.id:eq:%s", firstOpt),
		"fields": "id,name,categoryOptions[id]",
	}
	resp, err = destClient.Get("api/categoryOptionCombos", params)
	if err != nil || !resp.IsSuccess() {
		return nil, err
	}

	var cocResp struct {
		CategoryOptionCombos []struct {
			ID              string `json:"id"`
			Name            string `json:"name"`
			CategoryOptions []struct {
				ID string `json:"id"`
			} `json:"categoryOptions"`
		} `json:"categoryOptionCombos"`
	}
	if err := json.Unmarshal(resp.Body(), &cocResp); err != nil {
		return nil, err
	}

	// Check for exact match
	targetSet := make(map[string]bool)
	for _, id := range targetOptIDs {
		targetSet[id] = true
	}

	for _, coc := range cocResp.CategoryOptionCombos {
		if len(coc.CategoryOptions) != len(targetSet) {
			continue
		}
		match := true
		for _, opt := range coc.CategoryOptions {
			if !targetSet[opt.ID] {
				match = false
				break
			}
		}
		if match {
			return &MatchSuggestion{
				ID:    coc.ID,
				Name:  coc.Name,
				Score: 100, // Structural match is high confidence
			}, nil
		}
	}

	return nil, nil
}

func (s *Service) checkExistence(client *api.Client, resource string, ids []string) (map[string]bool, error) {
	found := make(map[string]bool)
	chunkSize := 100

	for i := 0; i < len(ids); i += chunkSize {
		end := i + chunkSize
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[i:end]

		// DHIS2 filter: id:in:[id1,id2,...]
		filter := fmt.Sprintf("id:in:[%s]", strings.Join(chunk, ","))
		params := map[string]string{
			"filter": filter,
			"fields": "id",
			"paging": "false",
		}

		resp, err := client.Get(fmt.Sprintf("api/%s", resource), params)
		if err != nil {
			return nil, err
		}

		// Parse generic response
		// { "organisationUnits": [ {"id": "..."} ] }
		var result map[string][]struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(resp.Body(), &result); err != nil {
			return nil, err
		}

		// The key in JSON matches the resource name usually, but let's be safe
		// Actually, DHIS2 returns the resource name as key.
		// e.g. "organisationUnits", "categoryOptionCombos"
		if items, ok := result[resource]; ok {
			for _, item := range items {
				found[item.ID] = true
			}
		}
	}
	return found, nil
}

func (s *Service) findBestMatch(client *api.Client, resource, name string) (*MatchSuggestion, error) {
	// Simple fuzzy search using 'ilike'
	// Strip common suffixes for better matching
	cleanName := strings.TrimSuffix(name, " P.S")
	cleanName = strings.TrimSuffix(cleanName, " Primary School")

	params := map[string]string{
		"filter": fmt.Sprintf("name:ilike:%s", cleanName),
		"fields": "id,name",
		"paging": "false",
	}

	resp, err := client.Get(fmt.Sprintf("api/%s", resource), params)
	if err != nil {
		return nil, err
	}

	var result map[string][]struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, err
	}

	if items, ok := result[resource]; ok && len(items) > 0 {
		// Return the first match
		return &MatchSuggestion{
			ID:    items[0].ID,
			Name:  items[0].Name,
			Score: 80, // Arbitrary score for now
		}, nil
	}

	return nil, nil
}

func (s *Service) updateProgress(taskID, status string, progress int, msg string) {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	if p, ok := s.taskStore[taskID]; ok {
		p.Status = status
		p.Progress = progress
		if msg != "" {
			p.Messages = append(p.Messages, msg)
		}
	}
}
