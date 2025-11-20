package metadata

import (
	"context"
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

// Service handles metadata comparison and synchronization
type Service struct {
	db            *gorm.DB
	ctx           context.Context
	progressStore map[string]*DiffProgress
	progressMu    sync.RWMutex
	mappingsStore map[string]map[MetadataType]map[string]string // profileID -> type -> srcID:dstID
	mappingsMu    sync.RWMutex
}

// NewService creates a new metadata service
func NewService(db *gorm.DB, ctx context.Context) *Service {
	return &Service{
		db:            db,
		ctx:           ctx,
		progressStore: make(map[string]*DiffProgress),
		mappingsStore: make(map[string]map[MetadataType]map[string]string),
	}
}

// GetSummary fetches metadata summaries for selected types from both instances
func (s *Service) GetSummary(profileID string, types []MetadataType) (map[MetadataType]TypeSummary, error) {
	profile, err := s.getProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	sourceClient, err := s.getAPIClient(profile, "source")
	if err != nil {
		return nil, fmt.Errorf("failed to create source client: %w", err)
	}

	destClient, err := s.getAPIClient(profile, "dest")
	if err != nil {
		return nil, fmt.Errorf("failed to create dest client: %w", err)
	}

	result := make(map[MetadataType]TypeSummary)
	for _, t := range types {
		source := s.fetchType(sourceClient, t)
		dest := s.fetchType(destClient, t)
		result[t] = TypeSummary{
			Source: source,
			Dest:   dest,
		}
	}

	return result, nil
}

// StartDiff initiates a background metadata comparison task
func (s *Service) StartDiff(profileID string, types []MetadataType) (string, error) {
	profile, err := s.getProfile(profileID)
	if err != nil {
		return "", fmt.Errorf("failed to get profile: %w", err)
	}

	taskID := uuid.New().String()
	progress := &DiffProgress{
		TaskID:   taskID,
		Status:   "starting",
		Progress: 0,
		Messages: []string{},
	}

	s.progressMu.Lock()
	s.progressStore[taskID] = progress
	s.progressMu.Unlock()

	// Emit initial state so frontend can render immediately
	s.emitProgressEvent(taskID)

	// Run in background goroutine
	go s.performDiff(taskID, profile, types)

	return taskID, nil
}

// GetDiffProgress retrieves the current progress of a diff task
func (s *Service) GetDiffProgress(taskID string) (*DiffProgress, error) {
	s.progressMu.RLock()
	defer s.progressMu.RUnlock()

	progress, exists := s.progressStore[taskID]
	if !exists {
		return nil, fmt.Errorf("task not found: %s", taskID)
	}

	return progress, nil
}

// SaveMappings persists mapping pairs for a profile
func (s *Service) SaveMappings(profileID string, pairs []MappingPair) (*SaveMappingsResponse, error) {
	s.mappingsMu.Lock()
	defer s.mappingsMu.Unlock()

	if s.mappingsStore[profileID] == nil {
		s.mappingsStore[profileID] = make(map[MetadataType]map[string]string)
	}

	saved := 0
	typesSet := make(map[MetadataType]bool)

	for _, pair := range pairs {
		if pair.Type == "" || pair.SourceID == "" || pair.DestID == "" {
			continue
		}

		if s.mappingsStore[profileID][pair.Type] == nil {
			s.mappingsStore[profileID][pair.Type] = make(map[string]string)
		}

		// Only count as saved if it's new or different
		existing := s.mappingsStore[profileID][pair.Type][pair.SourceID]
		if existing != pair.DestID {
			s.mappingsStore[profileID][pair.Type][pair.SourceID] = pair.DestID
			saved++
		}
		typesSet[pair.Type] = true
	}

	types := make([]MetadataType, 0, len(typesSet))
	for t := range typesSet {
		types = append(types, t)
	}

	return &SaveMappingsResponse{
		Saved: saved,
		Types: types,
	}, nil
}

// GetMappings retrieves saved mappings for a profile
func (s *Service) GetMappings(profileID string) map[MetadataType]map[string]string {
	s.mappingsMu.RLock()
	defer s.mappingsMu.RUnlock()

	if s.mappingsStore[profileID] == nil {
		return make(map[MetadataType]map[string]string)
	}

	// Return a copy to avoid concurrent modifications
	result := make(map[MetadataType]map[string]string)
	for t, mappings := range s.mappingsStore[profileID] {
		result[t] = make(map[string]string)
		for src, dst := range mappings {
			result[t][src] = dst
		}
	}

	return result
}

// BuildPayloadPreview generates a metadata import payload for missing items
func (s *Service) BuildPayloadPreview(profileID string, types []MetadataType, mappings map[MetadataType]map[string]string) (*PayloadPreviewResponse, error) {
	profile, err := s.getProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	sourceClient, err := s.getAPIClient(profile, "source")
	if err != nil {
		return nil, fmt.Errorf("failed to create source client: %w", err)
	}

	destClient, err := s.getAPIClient(profile, "dest")
	if err != nil {
		return nil, fmt.Errorf("failed to create dest client: %w", err)
	}

	// Build payload
	payload := s.buildPayloadForTypes(types, sourceClient, destClient, mappings)

	// Calculate counts
	counts := make(map[MetadataType]int)
	for t, items := range payload {
		counts[t] = len(items)
	}

	// Fetch required fields info
	required := s.fetchRequiredFields(destClient, types)

	return &PayloadPreviewResponse{
		Payload:  payload,
		Counts:   counts,
		Required: required,
	}, nil
}

// DryRun performs a dry-run metadata import
func (s *Service) DryRun(profileID string, payload map[MetadataType][]map[string]interface{}, importStrategy, atomicMode string) (*ImportReport, error) {
	profile, err := s.getProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	if importStrategy == "" {
		importStrategy = "CREATE_AND_UPDATE"
	}
	if atomicMode == "" {
		atomicMode = "ALL"
	}

	destClient, err := s.getAPIClient(profile, "dest")
	if err != nil {
		return &ImportReport{
			Status: "error",
			Error:  fmt.Sprintf("failed to create dest client: %v", err),
		}, nil
	}

	endpoint := fmt.Sprintf("/api/metadata?importStrategy=%s&atomicMode=%s&dryRun=true", importStrategy, atomicMode)

	resp, err := destClient.Post(endpoint, payload)
	if err != nil {
		return &ImportReport{
			Status: "error",
			Error:  err.Error(),
		}, nil
	}

	var result ImportReport
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		// If JSON parsing fails, return raw response
		respBody := resp.Body()
		bodyText := string(respBody[:min(1000, len(respBody))])
		return &ImportReport{
			Status:  "error",
			Message: "Failed to parse response",
			Body:    map[string]interface{}{"text": bodyText},
		}, nil
	}

	return &result, nil
}

// Apply performs an actual metadata import
func (s *Service) Apply(profileID string, payload map[MetadataType][]map[string]interface{}, importStrategy, atomicMode string) (*ImportReport, error) {
	profile, err := s.getProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	if importStrategy == "" {
		importStrategy = "CREATE_AND_UPDATE"
	}
	if atomicMode == "" {
		atomicMode = "ALL"
	}

	destClient, err := s.getAPIClient(profile, "dest")
	if err != nil {
		return &ImportReport{
			Status: "error",
			Error:  fmt.Sprintf("failed to create dest client: %v", err),
		}, nil
	}

	endpoint := fmt.Sprintf("/api/metadata?importStrategy=%s&atomicMode=%s", importStrategy, atomicMode)

	resp, err := destClient.Post(endpoint, payload)
	if err != nil {
		return &ImportReport{
			Status: "error",
			Error:  err.Error(),
		}, nil
	}

	var result ImportReport
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		respBody := resp.Body()
		bodyText := string(respBody[:min(1000, len(respBody))])
		return &ImportReport{
			Status:  "error",
			Message: "Failed to parse response",
			Body:    map[string]interface{}{"text": bodyText},
		}, nil
	}

	return &result, nil
}

// Helper functions

func (s *Service) getProfile(profileID string) (*models.ConnectionProfile, error) {
	var profile models.ConnectionProfile
	if err := s.db.First(&profile, "id = ?", profileID).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

// getAPIClient creates an API client for the specified instance (source or dest)
func (s *Service) getAPIClient(profile *models.ConnectionProfile, sourceOrDest string) (*api.Client, error) {
	var url, username, encPassword string

	if sourceOrDest == "source" {
		url = profile.SourceURL
		username = profile.SourceUsername
		encPassword = profile.SourcePasswordEnc
	} else {
		url = profile.DestURL
		username = profile.DestUsername
		encPassword = profile.DestPasswordEnc
	}

	// Decrypt password
	password, err := crypto.DecryptPassword(encPassword)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt password: %w", err)
	}

	return api.NewClient(url, username, password), nil
}

func (s *Service) performDiff(taskID string, profile *models.ConnectionProfile, types []MetadataType) {
	defer func() {
		if r := recover(); r != nil {
			s.updateProgress(taskID, "error", 0, fmt.Sprintf("Panic: %v", r))
		}
	}()

	s.updateProgress(taskID, "running", 5, "Starting metadata assessment...")

	sourceClient, err := s.getAPIClient(profile, "source")
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to create source client: %v", err))
		return
	}

	destClient, err := s.getAPIClient(profile, "dest")
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to create dest client: %v", err))
		return
	}

	results := make(map[MetadataType]ComparisonResult)
	total := len(types)

	for i, t := range types {
		s.appendMessage(taskID, fmt.Sprintf("Fetching %s from source and destination...", t))

		src := s.fetchType(sourceClient, t)
		dst := s.fetchType(destClient, t)

		s.appendMessage(taskID, fmt.Sprintf("Comparing %s (%d vs %d)...", t, len(src), len(dst)))

		results[t] = s.compareLists(src, dst, t)

		progress := 5 + int(90*float64(i+1)/float64(total))
		s.updateProgress(taskID, "running", progress, "")
	}

	s.progressMu.Lock()
	s.progressStore[taskID].Results = results
	s.progressStore[taskID].CompletedAt = time.Now().Unix()
	s.progressMu.Unlock()

	s.emitProgressEvent(taskID)

	s.updateProgress(taskID, "completed", 100, "Assessment complete.")
}

func (s *Service) updateProgress(taskID, status string, progress int, message string) {
	s.progressMu.Lock()
	defer s.progressMu.Unlock()

	updated := false
	if p, exists := s.progressStore[taskID]; exists {
		p.Status = status
		p.Progress = progress
		if message != "" {
			p.Messages = append(p.Messages, message)
		}
		updated = true
	}

	if updated {
		go s.emitProgressEvent(taskID)
	}
}

func (s *Service) appendMessage(taskID, message string) {
	s.progressMu.Lock()
	defer s.progressMu.Unlock()

	appended := false
	if p, exists := s.progressStore[taskID]; exists {
		p.Messages = append(p.Messages, message)
		appended = true
	}

	if appended {
		go s.emitProgressEvent(taskID)
	}
}

func (s *Service) emitProgressEvent(taskID string) {
	s.progressMu.RLock()
	progress, exists := s.progressStore[taskID]
	s.progressMu.RUnlock()
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

	runtime.EventsEmit(s.ctx, fmt.Sprintf("metadata:%s", taskID), payload)
}

// fetchType retrieves metadata objects for a specific type
func (s *Service) fetchType(client *api.Client, objType MetadataType) []map[string]interface{} {
	var endpoint string
	var params map[string]string

	switch objType {
	case TypeOrganisationUnits:
		endpoint = "/api/organisationUnits.json"
		params = map[string]string{"fields": "id,code,displayName,level,parent[id]", "paging": "false"}
	case TypeCategoryOptions:
		endpoint = "/api/categoryOptions.json"
		params = map[string]string{"fields": "id,code,displayName", "paging": "false"}
	case TypeCategories:
		endpoint = "/api/categories.json"
		params = map[string]string{"fields": "id,code,displayName,categoryOptions[id]", "paging": "false"}
	case TypeCategoryCombos:
		endpoint = "/api/categoryCombos.json"
		params = map[string]string{"fields": "id,code,displayName,categories[id]", "paging": "false"}
	case TypeCategoryOptionCombos:
		endpoint = "/api/categoryOptionCombos.json"
		params = map[string]string{"fields": "id,code,displayName,categoryCombo[id]", "paging": "false"}
	case TypeOptionSets:
		endpoint = "/api/optionSets.json"
		params = map[string]string{"fields": "id,code,displayName,options[id,code,displayName]", "paging": "false"}
	case TypeDataElements:
		endpoint = "/api/dataElements.json"
		params = map[string]string{"fields": "id,code,displayName,valueType,categoryCombo[id],optionSet[id]", "paging": "false"}
	case TypeDataSets:
		endpoint = "/api/dataSets.json"
		params = map[string]string{"fields": "id,code,displayName,periodType,categoryCombo[id],dataSetElements[dataElement[id,code]]", "paging": "false"}
	default:
		return []map[string]interface{}{}
	}

	resp, err := client.Get(endpoint, params)
	if err != nil {
		return []map[string]interface{}{}
	}

	var data map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &data); err != nil {
		return []map[string]interface{}{}
	}

	items, ok := data[string(objType)].([]interface{})
	if !ok {
		return []map[string]interface{}{}
	}

	converted := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]interface{}); ok {
			converted = append(converted, m)
		}
	}

	return converted
}

// compareLists compares source and destination lists to find missing, conflicts, and suggestions
func (s *Service) compareLists(src, dst []map[string]interface{}, objType MetadataType) ComparisonResult {
	srcByID := indexBy(src, "id")
	dstByID := indexBy(dst, "id")
	dstByCode := indexBy(dst, "code")

	missing := []MissingItem{}
	conflicts := []ConflictItem{}
	suggestions := []SuggestionItem{}

	criticalFields := getCriticalFields(objType)

	// Find missing and conflicts
	for sid, sitem := range srcByID {
		ditem, existsByID := dstByID[sid]

		// Try code match if not found by ID
		if !existsByID {
			if scode, ok := getString(sitem, "code"); ok && scode != "" {
				if ditemByCode, ok := dstByCode[scode]; ok {
					ditem = ditemByCode
					existsByID = true
				}
			}
		}

		if !existsByID {
			missing = append(missing, MissingItem{
				ID:   sid,
				Code: getStringOr(sitem, "code", ""),
				Name: getDisplayName(sitem),
			})
			continue
		}

		// Check for conflicts
		diffs := make(map[string]map[string]interface{})
		for _, field := range criticalFields {
			sval := sitem[field]
			dval := ditem[field]
			if !equalValues(sval, dval) {
				diffs[field] = map[string]interface{}{
					"source": sval,
					"dest":   dval,
				}
			}
		}

		if len(diffs) > 0 {
			conflicts = append(conflicts, ConflictItem{
				ID:    sid,
				Code:  getStringOr(sitem, "code", ""),
				Name:  getDisplayName(sitem),
				Diffs: diffs,
			})
		}
	}

	// Generate suggestions
	dstNames := make([]struct{ id, code, name string }, 0, len(dst))
	for _, d := range dst {
		dstNames = append(dstNames, struct{ id, code, name string }{
			id:   getStringOr(d, "id", ""),
			code: getStringOr(d, "code", ""),
			name: getDisplayName(d),
		})
	}

	for _, s := range src {
		sid := getStringOr(s, "id", "")
		if sid == "" {
			continue
		}

		// Skip if already exists by ID
		if _, exists := dstByID[sid]; exists {
			continue
		}

		scode := getStringOr(s, "code", "")
		sname := getDisplayName(s)

		// Suggest by code match
		if scode != "" {
			if ditem, ok := dstByCode[scode]; ok {
				suggestions = append(suggestions, SuggestionItem{
					Source: SuggestionDetail{
						ID:   sid,
						Code: scode,
						Name: sname,
					},
					Dest: SuggestionDetail{
						ID:   getStringOr(ditem, "id", ""),
						Code: scode,
						Name: getDisplayName(ditem),
					},
					Confidence: 1.0,
					By:         "code",
				})
				continue
			}
		}

		// Suggest by name similarity
		bestScore := 0.0
		var bestMatch struct{ id, code, name string }
		for _, d := range dstNames {
			score := nameSimilarity(sname, d.name)
			if score > bestScore {
				bestScore = score
				bestMatch = d
			}
		}

		if bestScore >= 0.7 {
			suggestions = append(suggestions, SuggestionItem{
				Source: SuggestionDetail{
					ID:   sid,
					Code: scode,
					Name: sname,
				},
				Dest: SuggestionDetail{
					ID:   bestMatch.id,
					Code: bestMatch.code,
					Name: bestMatch.name,
				},
				Confidence: round(bestScore, 3),
				By:         "name",
			})
		}
	}

	return ComparisonResult{
		Missing:     missing,
		Conflicts:   conflicts,
		Suggestions: suggestions,
	}
}

// buildPayloadForTypes generates metadata import payload
func (s *Service) buildPayloadForTypes(types []MetadataType, sourceClient, destClient *api.Client, mappings map[MetadataType]map[string]string) map[MetadataType][]map[string]interface{} {
	payload := make(map[MetadataType][]map[string]interface{})

	// Fetch summaries for all types
	summaries := make(map[MetadataType]struct{ src, dst []map[string]interface{} })
	for _, t := range types {
		summaries[t] = struct{ src, dst []map[string]interface{} }{
			src: s.fetchType(sourceClient, t),
			dst: s.fetchType(destClient, t),
		}
	}

	// Helper: check if missing in destination
	isMissing := func(t MetadataType, uid string) bool {
		dstByID := indexBy(summaries[t].dst, "id")
		if _, exists := dstByID[uid]; exists {
			return false
		}
		// Check if mapped to existing destination UID
		if mappings != nil && mappings[t] != nil {
			if mapped, ok := mappings[t][uid]; ok {
				if _, exists := dstByID[mapped]; exists {
					return false
				}
			}
		}
		return true
	}

	// Process each type (simplified - production code would handle dependencies)
	for _, t := range types {
		for _, sitem := range summaries[t].src {
			uid := getStringOr(sitem, "id", "")
			if uid == "" || !isMissing(t, uid) {
				continue
			}

			// Fetch full item from source
			fullItem := s.fetchFullItem(sourceClient, t, uid)
			if fullItem == nil {
				continue
			}

			// Build minimal payload item
			minimal := s.buildMinimalItem(t, fullItem, mappings)
			if minimal != nil {
				payload[t] = append(payload[t], minimal)
			}
		}
	}

	return payload
}

// fetchFullItem retrieves complete metadata object
func (s *Service) fetchFullItem(client *api.Client, objType MetadataType, uid string) map[string]interface{} {
	var endpoint string
	var params map[string]string

	switch objType {
	case TypeCategoryOptions:
		endpoint = fmt.Sprintf("/api/categoryOptions/%s.json", uid)
		params = map[string]string{"fields": "id,code,displayName,name,shortName"}
	case TypeCategories:
		endpoint = fmt.Sprintf("/api/categories/%s.json", uid)
		params = map[string]string{"fields": "id,code,displayName,name,shortName,dataDimensionType,categoryOptions[id]"}
	case TypeCategoryCombos:
		endpoint = fmt.Sprintf("/api/categoryCombos/%s.json", uid)
		params = map[string]string{"fields": "id,code,displayName,name,categories[id]"}
	case TypeDataElements:
		endpoint = fmt.Sprintf("/api/dataElements/%s.json", uid)
		params = map[string]string{"fields": "id,code,displayName,name,shortName,valueType,aggregationType,domainType,categoryCombo[id],optionSet[id]"}
	case TypeDataSets:
		endpoint = fmt.Sprintf("/api/dataSets/%s.json", uid)
		params = map[string]string{"fields": "id,code,displayName,name,shortName,periodType,categoryCombo[id],dataSetElements[dataElement[id]]"}
	case TypeOrganisationUnits:
		endpoint = fmt.Sprintf("/api/organisationUnits/%s.json", uid)
		params = map[string]string{"fields": "id,code,displayName,name,parent[id]"}
	case TypeOptionSets:
		endpoint = fmt.Sprintf("/api/optionSets/%s.json", uid)
		params = map[string]string{"fields": "id,code,displayName,name,valueType,options[id,code,displayName,name]"}
	default:
		return nil
	}

	resp, err := client.Get(endpoint, params)
	if err != nil {
		return nil
	}

	var item map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &item); err != nil {
		return nil
	}

	return item
}

// buildMinimalItem creates a minimal metadata payload item
func (s *Service) buildMinimalItem(objType MetadataType, full map[string]interface{}, mappings map[MetadataType]map[string]string) map[string]interface{} {
	minimal := make(map[string]interface{})

	// Copy basic fields
	for _, field := range []string{"id", "code", "name", "displayName", "shortName"} {
		if val, ok := full[field]; ok && val != nil && val != "" {
			minimal[field] = val
		}
	}

	// Type-specific handling
	switch objType {
	case TypeCategories:
		if val, ok := full["dataDimensionType"]; ok {
			minimal["dataDimensionType"] = val
		} else {
			minimal["dataDimensionType"] = "DISAGGREGATION"
		}
		// Remap category options
		if opts, ok := full["categoryOptions"].([]interface{}); ok {
			remapped := []map[string]interface{}{}
			for _, opt := range opts {
				if optMap, ok := opt.(map[string]interface{}); ok {
					if id := getStringOr(optMap, "id", ""); id != "" {
						remapped = append(remapped, map[string]interface{}{
							"id": s.remapUID(TypeCategoryOptions, id, mappings),
						})
					}
				}
			}
			minimal["categoryOptions"] = remapped
		}

	case TypeDataElements:
		if val, ok := full["valueType"]; ok {
			minimal["valueType"] = val
		}
		if val, ok := full["aggregationType"]; ok {
			minimal["aggregationType"] = val
		} else {
			minimal["aggregationType"] = "SUM"
		}
		if val, ok := full["domainType"]; ok {
			minimal["domainType"] = val
		} else {
			minimal["domainType"] = "AGGREGATE"
		}
		// Remap category combo
		if cc, ok := full["categoryCombo"].(map[string]interface{}); ok {
			if id := getStringOr(cc, "id", ""); id != "" {
				minimal["categoryCombo"] = map[string]interface{}{
					"id": s.remapUID(TypeCategoryCombos, id, mappings),
				}
			}
		}
	}

	return minimal
}

// remapUID applies mapping if exists, otherwise returns original
func (s *Service) remapUID(objType MetadataType, uid string, mappings map[MetadataType]map[string]string) string {
	if mappings == nil || mappings[objType] == nil {
		return uid
	}
	if mapped, ok := mappings[objType][uid]; ok {
		return mapped
	}
	return uid
}

// fetchRequiredFields retrieves required field names from destination schemas
func (s *Service) fetchRequiredFields(client *api.Client, types []MetadataType) map[MetadataType][]string {
	result := make(map[MetadataType][]string)

	resp, err := client.Get("/api/schemas", map[string]string{"paging": "false"})
	if err != nil {
		return result
	}

	var data map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &data); err != nil {
		return result
	}

	schemas, ok := data["schemas"].([]interface{})
	if !ok {
		return result
	}

	// Build schema lookup by class name
	byClass := make(map[string]map[string]interface{})
	for _, s := range schemas {
		if schema, ok := s.(map[string]interface{}); ok {
			if klass, ok := getString(schema, "klass"); ok {
				parts := strings.Split(klass, ".")
				baseName := parts[len(parts)-1]
				byClass[baseName] = schema
			}
		}
	}

	// Map types to class names
	typeMap := map[MetadataType]string{
		TypeOrganisationUnits:    "OrganisationUnit",
		TypeCategoryOptions:      "CategoryOption",
		TypeCategories:           "Category",
		TypeCategoryCombos:       "CategoryCombo",
		TypeCategoryOptionCombos: "CategoryOptionCombo",
		TypeOptionSets:           "OptionSet",
		TypeDataElements:         "DataElement",
		TypeDataSets:             "DataSet",
	}

	for _, t := range types {
		className := typeMap[t]
		if schema, ok := byClass[className]; ok {
			required := []string{}

			// Try "requiredProperties" first
			if req, ok := schema["requiredProperties"].([]interface{}); ok {
				for _, r := range req {
					if s, ok := r.(string); ok {
						required = append(required, s)
					}
				}
			} else if req, ok := schema["required"].([]interface{}); ok {
				// Fall back to "required"
				for _, r := range req {
					if s, ok := r.(string); ok {
						required = append(required, s)
					}
				}
			}

			result[t] = required
		}
	}

	return result
}

// Utility functions

func indexBy(items []map[string]interface{}, key string) map[string]map[string]interface{} {
	result := make(map[string]map[string]interface{})
	for _, item := range items {
		if val, ok := getString(item, key); ok && val != "" {
			result[val] = item
		}
	}
	return result
}

func getString(m map[string]interface{}, key string) (string, bool) {
	val, ok := m[key]
	if !ok {
		return "", false
	}
	str, ok := val.(string)
	return str, ok
}

func getStringOr(m map[string]interface{}, key, defaultVal string) string {
	if val, ok := getString(m, key); ok {
		return val
	}
	return defaultVal
}

func getDisplayName(m map[string]interface{}) string {
	if name := getStringOr(m, "displayName", ""); name != "" {
		return name
	}
	return getStringOr(m, "name", "")
}

func equalValues(a, b interface{}) bool {
	// Simple equality check - could be enhanced for deep comparison
	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

func getCriticalFields(objType MetadataType) []string {
	fields := map[MetadataType][]string{
		TypeOrganisationUnits:    {"displayName", "level", "parent"},
		TypeCategoryOptions:      {"displayName"},
		TypeCategories:           {"displayName", "categoryOptions"},
		TypeCategoryCombos:       {"displayName", "categories"},
		TypeCategoryOptionCombos: {"displayName", "categoryCombo"},
		TypeOptionSets:           {"displayName", "options"},
		TypeDataElements:         {"displayName", "valueType", "categoryCombo", "optionSet"},
		TypeDataSets:             {"displayName", "periodType", "categoryCombo", "dataSetElements"},
	}
	if f, ok := fields[objType]; ok {
		return f
	}
	return []string{"displayName"}
}

func nameSimilarity(a, b string) float64 {
	a = strings.ToLower(a)
	b = strings.ToLower(b)

	if a == b {
		return 1.0
	}

	// Simple Levenshtein-inspired similarity (simplified)
	longer := a
	shorter := b
	if len(b) > len(a) {
		longer = b
		shorter = a
	}

	if len(longer) == 0 {
		return 1.0
	}

	// Count matching characters
	matches := 0
	for i := 0; i < len(shorter); i++ {
		if i < len(longer) && shorter[i] == longer[i] {
			matches++
		}
	}

	return float64(matches) / float64(len(longer))
}

func round(val float64, precision int) float64 {
	multiplier := 1.0
	for i := 0; i < precision; i++ {
		multiplier *= 10
	}
	return float64(int(val*multiplier+0.5)) / multiplier
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
