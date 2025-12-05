package transfer

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"dhis2sync-desktop/internal/api"
	"dhis2sync-desktop/internal/crypto"
	"dhis2sync-desktop/internal/database"
	"dhis2sync-desktop/internal/models"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Service handles data transfer operations between DHIS2 instances
type Service struct {
	ctx       context.Context
	taskStore map[string]*TransferProgress
	taskMu    sync.RWMutex
}

// NewService creates a new Transfer service
func NewService(ctx context.Context) *Service {
	return &Service{
		ctx:       ctx,
		taskStore: make(map[string]*TransferProgress),
	}
}

// ListDatasets retrieves datasets from source or destination instance
func (s *Service) ListDatasets(profileID string, sourceOrDest string) ([]Dataset, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Decrypt credentials and create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Fetch datasets
	params := map[string]string{
		"fields": "id,name,displayName,code,periodType",
		"paging": "false",
	}

	resp, err := client.Get("api/dataSets.json", params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch datasets: %w", err)
	}

	if !resp.IsSuccess() {
		return nil, fmt.Errorf("API request failed: %s", resp.Status())
	}

	var result struct {
		DataSets []Dataset `json:"dataSets"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.DataSets, nil
}

// GetDatasetInfo retrieves detailed information about a specific dataset
func (s *Service) GetDatasetInfo(profileID string, datasetID string, sourceOrDest string) (*DatasetInfo, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Decrypt credentials and create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Fetch dataset details
	endpoint := fmt.Sprintf("api/dataSets/%s.json", datasetID)
	params := map[string]string{
		"fields": "id,name,displayName,code,periodType,dataSetElements[dataElement[id,name,displayName,code,valueType]],organisationUnits[id,name,displayName,code,level,path],categoryCombo[id,name,code,categoryOptionCombos[id,name,code]]",
	}

	resp, err := client.Get(endpoint, params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch dataset info: %w", err)
	}

	if !resp.IsSuccess() {
		return nil, fmt.Errorf("API request failed: %s", resp.Status())
	}

	// Unmarshal into intermediate struct to handle DHIS2's dataSetElements wrapper
	var apiResponse struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		DisplayName     string `json:"displayName"`
		Code            string `json:"code"`
		PeriodType      string `json:"periodType"`
		DataSetElements []struct {
			DataElement DataElement `json:"dataElement"`
		} `json:"dataSetElements"`
		CategoryCombo     *CategoryCombo     `json:"categoryCombo"`
		OrganisationUnits []OrganisationUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &apiResponse); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Extract data elements from wrapper objects
	dataElements := make([]DataElement, len(apiResponse.DataSetElements))
	for i, wrapper := range apiResponse.DataSetElements {
		dataElements[i] = wrapper.DataElement
	}

	// Build final DatasetInfo struct
	datasetInfo := &DatasetInfo{
		ID:                apiResponse.ID,
		Name:              apiResponse.Name,
		DisplayName:       apiResponse.DisplayName,
		Code:              apiResponse.Code,
		PeriodType:        apiResponse.PeriodType,
		DataElements:      dataElements,
		CategoryCombo:     apiResponse.CategoryCombo,
		OrganisationUnits: apiResponse.OrganisationUnits,
	}

	return datasetInfo, nil
}

// GetOrgUnitTree fetches org unit hierarchy for selection UI
func (s *Service) GetOrgUnitTree(profileID, sourceOrDest, rootID string, maxDepth int) (*OrgUnitTreeResponse, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// If no rootID provided, get user's root org units
	var rootOrgUnits []OrganisationUnit
	if rootID == "" {
		// Fetch user's assigned org units
		resp, err := client.Get("api/me.json", map[string]string{
			"fields": "organisationUnits[id,name,displayName,code,level,path]",
		})
		if err != nil {
			return nil, fmt.Errorf("failed to fetch user org units: %w", err)
		}

		var userInfo struct {
			OrganisationUnits []OrganisationUnit `json:"organisationUnits"`
		}
		if err := json.Unmarshal(resp.Body(), &userInfo); err != nil {
			return nil, fmt.Errorf("failed to parse user info: %w", err)
		}

		rootOrgUnits = userInfo.OrganisationUnits
	} else {
		// Fetch specific org unit
		resp, err := client.Get(fmt.Sprintf("api/organisationUnits/%s.json", rootID), map[string]string{
			"fields": "id,name,displayName,code,level,path",
		})
		if err != nil {
			return nil, fmt.Errorf("failed to fetch org unit: %w", err)
		}

		var ou OrganisationUnit
		if err := json.Unmarshal(resp.Body(), &ou); err != nil {
			return nil, fmt.Errorf("failed to parse org unit: %w", err)
		}

		rootOrgUnits = []OrganisationUnit{ou}
	}

	// Build tree nodes
	treeNodes := make([]OrgUnitTreeNode, 0, len(rootOrgUnits))
	totalCount := 0

	for _, rootOU := range rootOrgUnits {
		node, count := s.buildOrgUnitTreeNode(client, rootOU, 0, maxDepth)
		treeNodes = append(treeNodes, node)
		totalCount += count
	}

	return &OrgUnitTreeResponse{
		RootNodes:  treeNodes,
		TotalCount: totalCount,
	}, nil
}

// buildOrgUnitTreeNode recursively builds org unit tree node
func (s *Service) buildOrgUnitTreeNode(client *api.Client, ou OrganisationUnit, currentDepth, maxDepth int) (OrgUnitTreeNode, int) {
	node := OrgUnitTreeNode{
		ID:          ou.ID,
		Name:        ou.Name,
		DisplayName: ou.DisplayName,
		Code:        ou.Code,
		Level:       ou.Level,
		Path:        ou.Path,
		Children:    []OrgUnitTreeNode{},
	}

	count := 1 // Count this node

	// Stop if max depth reached
	if maxDepth > 0 && currentDepth >= maxDepth {
		node.HasChildren = false
		return node, count
	}

	// Fetch children
	resp, err := client.Get("api/organisationUnits.json", map[string]string{
		"filter": fmt.Sprintf("parent.id:eq:%s", ou.ID),
		"fields": "id,name,displayName,code,level,path",
		"paging": "false",
	})

	if err != nil {
		node.HasChildren = false
		return node, count
	}

	var result struct {
		OrganisationUnits []OrganisationUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		node.HasChildren = false
		return node, count
	}

	node.HasChildren = len(result.OrganisationUnits) > 0

	// Recursively build children if not at max depth
	if maxDepth == 0 || currentDepth < maxDepth-1 {
		for _, childOU := range result.OrganisationUnits {
			childNode, childCount := s.buildOrgUnitTreeNode(client, childOU, currentDepth+1, maxDepth)
			node.Children = append(node.Children, childNode)
			count += childCount
		}
	}

	return node, count
}

// GetOrgUnitsByLevel fetches org units at a specific level
func (s *Service) GetOrgUnitsByLevel(profileID, sourceOrDest string, level int) ([]OrganisationUnit, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Fetch org units at specified level
	resp, err := client.Get("api/organisationUnits.json", map[string]string{
		"filter": fmt.Sprintf("level:eq:%d", level),
		"fields": "id,name,displayName,code,level,path",
		"paging": "false",
	})

	if err != nil {
		return nil, fmt.Errorf("failed to fetch org units: %w", err)
	}

	var result struct {
		OrganisationUnits []OrgUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.OrganisationUnits, nil
}

// SearchOrgUnits searches for org units by name
func (s *Service) SearchOrgUnits(profileID, sourceOrDest, query string, limit int) ([]OrganisationUnit, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50 // Default limit
	}

	// Search org units by name
	params := map[string]string{
		"filter":   fmt.Sprintf("name:ilike:%s", query),
		"fields":   "id,name,displayName,code,level,path",
		"pageSize": fmt.Sprintf("%d", limit),
	}

	resp, err := client.Get("api/organisationUnits.json", params)
	if err != nil {
		return nil, fmt.Errorf("failed to search org units: %w", err)
	}

	var result struct {
		OrganisationUnits []OrgUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.OrganisationUnits, nil
}

// StartTransfer initiates a data transfer operation in the background
func (s *Service) StartTransfer(req TransferRequest) (string, error) {
	// Generate task ID
	taskID := uuid.New().String()

	// Initialize progress tracking
	progress := &TransferProgress{
		TaskID:    taskID,
		Status:    "starting",
		Progress:  0,
		Messages:  []string{"Initializing transfer..."},
		StartedAt: time.Now().Format(time.RFC3339),
	}

	// Store in memory
	s.taskMu.Lock()
	s.taskStore[taskID] = progress
	s.taskMu.Unlock()

	// Persist to database
	taskProgress := &models.TaskProgress{
		ID:       taskID,
		TaskType: "transfer",
		Status:   "starting",
		Progress: 0,
		Messages: s.marshalMessages(progress.Messages),
	}

	db := database.GetDB()
	if err := db.Create(taskProgress).Error; err != nil {
		return "", fmt.Errorf("failed to create task record: %w", err)
	}

	// Start background goroutine
	go s.performTransfer(taskID, req)

	return taskID, nil
}

// GetTransferProgress retrieves the current progress of a transfer operation
func (s *Service) GetTransferProgress(taskID string) (*TransferProgress, error) {
	s.taskMu.RLock()
	progress, exists := s.taskStore[taskID]
	s.taskMu.RUnlock()

	if !exists {
		// Try to load from database
		db := database.GetDB()
		var taskProgress models.TaskProgress
		if err := db.Where("id = ?", taskID).First(&taskProgress).Error; err != nil {
			return nil, fmt.Errorf("task not found: %w", err)
		}

		// Reconstruct progress from DB
		messages := s.unmarshalMessages(taskProgress.Messages)
		progress = &TransferProgress{
			TaskID:   taskProgress.ID,
			Status:   taskProgress.Status,
			Progress: taskProgress.Progress,
			Messages: messages,
		}

		// Parse results if completed
		if taskProgress.Results != "" {
			var summary ImportSummary
			if err := json.Unmarshal([]byte(taskProgress.Results), &summary); err == nil {
				progress.ImportSummary = &summary
			}
		}
	}

	return progress, nil
}

// performTransfer executes the data transfer in a background goroutine
func (s *Service) performTransfer(taskID string, req TransferRequest) {
	defer func() {
		if r := recover(); r != nil {
			s.updateProgress(taskID, "error", 0, fmt.Sprintf("Panic during transfer: %v", r))
			log.Printf("Transfer panic recovered: %v", r)
		}
	}()

	s.updateProgress(taskID, "running", 10, "Loading connection profile...")

	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", req.ProfileID).First(&profile).Error; err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to load profile: %v", err))
		return
	}

	// Create API clients
	sourceClient, err := s.getAPIClient(&profile, "source")
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to create source client: %v", err))
		return
	}

	destClient, err := s.getAPIClient(&profile, "destination")
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to create destination client: %v", err))
		return
	}

	// Get user's root org unit from source instance
	s.updateProgress(taskID, "running", 10, "Getting user's root organization unit...")
	rootOU, err := s.GetUserRootOrgUnit(req.ProfileID, "source")
	if err != nil {
		s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to get root org unit: %v", err))
		return
	}
	s.updateProgress(taskID, "running", 15, fmt.Sprintf("Using root org unit: %s (%s)", rootOU.Name, rootOU.ID))

	// PHASE 1: Smart Batching Transfer Strategy
	// Iterate by Period -> Discover OUs -> Process per OU
	// This ensures we don't OOM on large datasets and provides granular progress

	// Initialize aggregate import stats
	var totalImported, totalUpdated, totalIgnored, totalDeleted int
	processedOUs := 0
	notFoundOUs := []string{}

	// Track successful transfers for batched completeness marking
	// Map key: "destOUID:period", value: sourceOUName
	successfulTransfers := make(map[string]string)

	totalPeriods := len(req.Periods)
	if totalPeriods == 0 {
		s.updateProgress(taskID, "completed", 100, "No periods selected for transfer")
		return
	}

	// Define a chunk size for progress updates within the OU loop
	// We allocate 80% of progress bar to the transfer phase (20% was setup)
	periodProgressChunk := 80 / totalPeriods

	for i, period := range req.Periods {
		// Update progress for the current period
		currentPeriodProgress := 20 + (i * periodProgressChunk)
		s.updateProgress(taskID, "running", currentPeriodProgress, fmt.Sprintf("Processing period %s...", period))

		// 1. Discover Org Units with Data (Smart Batching)
		// This prevents fetching massive payloads by breaking it down by Org Unit
		s.updateProgress(taskID, "running", currentPeriodProgress, fmt.Sprintf("Scanning for data in period %s...", period))

		// Discover OUs with data for the current period, under the root OU
		discoveredOUs, err := s.DiscoverOrgUnitsWithData(req.ProfileID, "source", req.SourceDatasetID, period, rootOU.ID)
		if err != nil {
			s.updateProgress(taskID, "running", currentPeriodProgress, fmt.Sprintf("⚠ Failed to scan period %s: %v", period, err))
			continue
		}

		if len(discoveredOUs) == 0 {
			s.updateProgress(taskID, "running", currentPeriodProgress, fmt.Sprintf("No data found for period %s", period))
			continue
		}

		s.updateProgress(taskID, "running", currentPeriodProgress, fmt.Sprintf("Found %d org units with data for period %s", len(discoveredOUs), period))

		// 2. Process each Org Unit
		ouIdx := 0
		for ouID, ouName := range discoveredOUs {
			ouIdx++
			processedOUs++

			// Check if this OU is skipped by resolution BEFORE fetching
			// (Optimization: don't fetch if we know we'll skip it)
			skipOU := false
			for _, res := range req.Resolutions {
				if res.Type == "orgUnit" && res.ID == ouID && res.Action == "skip" {
					skipOU = true
					break
				}
			}
			if skipOU {
				log.Printf("Skipping org unit %s (%s) based on user resolution", ouName, ouID)
				continue
			}

			// Update progress periodically
			if ouIdx%5 == 0 {
				batchProgress := currentPeriodProgress + int(float64(ouIdx)/float64(len(discoveredOUs))*float64(periodProgressChunk))
				s.updateProgress(taskID, "running", batchProgress, fmt.Sprintf("Processing %s (%d/%d)...", ouName, ouIdx, len(discoveredOUs)))
			}

			// Find matching org unit in destination
			destOUID, err := s.FindMatchingOrgUnit(req.ProfileID, ouID, ouName)
			if err != nil {
				// Log warning but don't fail entire transfer
				log.Printf("No matching org unit found in destination for %s (%s): %v", ouName, ouID, err)
				notFoundOUs = append(notFoundOUs, ouName)
				continue
			}

			// Fetch data for this specific Org Unit (children=false)
			dvParams := map[string]string{
				"dataSet":        req.SourceDatasetID,
				"period":         period,
				"orgUnit":        ouID,
				"children":       "false", // specific OU only
				"includeDeleted": "false",
			}
			if req.AttributeOptionComboID != "" {
				dvParams["attributeOptionCombo"] = req.AttributeOptionComboID
			}

			resp, err := sourceClient.Get("api/dataValueSets", dvParams)
			if err != nil {
				log.Printf("Failed to fetch data for OU %s: %v", ouID, err)
				continue
			}

			if !resp.IsSuccess() {
				log.Printf("Source API returned HTTP %d for %s/%s", resp.StatusCode(), ouName, period)
				continue
			}

			var dvPayload DataValueSet
			if err := json.Unmarshal(resp.Body(), &dvPayload); err != nil {
				log.Printf("Failed to parse source data for %s: %v", ouName, err)
				continue
			}

			if len(dvPayload.DataValues) == 0 {
				continue
			}

			// Update org unit + period in values to match destination
			for i := range dvPayload.DataValues {
				dvPayload.DataValues[i].OrgUnit = destOUID
				dvPayload.DataValues[i].Period = period
			}

			// Apply element mapping if provided
			mappedValues, unmappedValues := s.applyMapping(dvPayload.DataValues, req.ElementMapping)

			// Track unmapped values
			if len(unmappedValues) > 0 {
				s.taskMu.Lock()
				if progress, exists := s.taskStore[taskID]; exists {
					if progress.UnmappedValues == nil {
						progress.UnmappedValues = make(map[string][]DataValue)
					}
					key := fmt.Sprintf("%s:%s", ouName, period)
					progress.UnmappedValues[key] = unmappedValues
					// We don't pause anymore, just log/store
				}
				s.taskMu.Unlock()
			}

			if len(mappedValues) == 0 {
				continue
			}

			// 3. Sanitize / Apply Resolutions
			sanitizedValues, skippedCount := s.applyResolutions(mappedValues, req.Resolutions)

			if skippedCount > 0 {
				log.Printf("Skipped %d values for OU %s based on resolutions", skippedCount, ouName)
			}

			if len(sanitizedValues) == 0 {
				continue
			}

			// 4. Import to Destination
			// Use Bulk Async for performance (chunk size 1000)

			// Calculate progress range for this specific OU
			// We map the import function's 0-100% progress to this OU's slice of the global progress
			ouStartProgress := float64(currentPeriodProgress) + (float64(ouIdx-1)/float64(len(discoveredOUs)))*float64(periodProgressChunk)
			ouEndProgress := float64(currentPeriodProgress) + (float64(ouIdx)/float64(len(discoveredOUs)))*float64(periodProgressChunk)
			progressRange := ouEndProgress - ouStartProgress

			onProgress := func(p float64, msg string) {
				// If p is negative, it means "indeterminate progress" or "just update message"
				// We keep the current progress value (which is roughly the start of this OU's chunk + whatever we last set)
				// But to be safe, we just use the start progress if we don't track state here.
				// Actually, let's just use ouStartProgress for message-only updates if we can't track it.
				// Better: if p < 0, we don't update the percentage, just the message.
				// But s.updateProgress requires a percentage.
				// So we'll calculate the percentage based on p if p >= 0.

				var newProgress int
				if p >= 0 {
					// Map 0.0-1.0 to ouStartProgress-ouEndProgress
					newProgress = int(ouStartProgress + (p * progressRange))
				} else {
					// Keep "current" progress - effectively just update message
					// We use a safe approximation: midway through the chunk or just the start
					newProgress = int(ouStartProgress + (0.5 * progressRange))
				}

				s.updateProgress(taskID, "running", newProgress, msg)
			}

			summaries, err := s.importDataValuesBulkAsync(destClient, sanitizedValues, 1000, onProgress)
			if err != nil {
				s.updateProgress(taskID, "running", int(ouEndProgress), fmt.Sprintf("⚠ Import failed for %s: %v", ouName, err))
				continue
			}

			// Aggregate stats
			for _, summary := range summaries {
				totalImported += summary.ImportCount.Imported
				totalUpdated += summary.ImportCount.Updated
				totalIgnored += summary.ImportCount.Ignored
				totalDeleted += summary.ImportCount.Deleted
			}

			// Track for completeness marking
			if req.MarkComplete {
				transferKey := fmt.Sprintf("%s:%s", destOUID, period)
				successfulTransfers[transferKey] = ouName
			}
		}
	}

	// Persist aggregate import summary so the frontend (and future sessions) can inspect results
	summaryStatus := "SUCCESS"
	if len(notFoundOUs) > 0 {
		summaryStatus = "WARNING"
	}

	// Build description that clarifies ignored values
	var description string
	if totalIgnored > 0 && len(notFoundOUs) > 0 {
		description = fmt.Sprintf("Imported=%d, Updated=%d, Already exist=%d, Org units without matches=%d",
			totalImported, totalUpdated, totalIgnored, len(notFoundOUs))
	} else if totalIgnored > 0 {
		description = fmt.Sprintf("Imported=%d, Updated=%d, Already exist=%d (no changes needed)",
			totalImported, totalUpdated, totalIgnored)
	} else {
		description = fmt.Sprintf("Imported=%d, Updated=%d (org units without matches in dest: %d)",
			totalImported, totalUpdated, len(notFoundOUs))
	}

	summary := ImportSummary{
		Status:      summaryStatus,
		Description: description,
		ImportCount: ImportCount{
			Imported: totalImported,
			Updated:  totalUpdated,
			Ignored:  totalIgnored,
			Deleted:  totalDeleted,
		},
	}

	// Attach to in-memory progress
	s.taskMu.Lock()
	if progress, exists := s.taskStore[taskID]; exists {
		progress.ImportSummary = &summary
	}
	s.taskMu.Unlock()

	// Persist summary JSON into TaskProgress.Results for durability
	if data, err := json.Marshal(summary); err == nil {
		db := database.GetDB()
		var taskProgress models.TaskProgress
		if err := db.Where("id = ?", taskID).First(&taskProgress).Error; err == nil {
			taskProgress.Results = string(data)
			db.Save(&taskProgress)
		}
	}

	// Batch mark datasets as complete (if requested and successful transfers exist)
	if req.MarkComplete && len(successfulTransfers) > 0 {
		s.updateProgress(taskID, "running", 85, "Marking datasets as complete...")

		// Build batched completion payload
		completionRegs := []map[string]interface{}{}
		now := time.Now().Format("2006-01-02") // YYYY-MM-DD format

		for transferKey := range successfulTransfers {
			// Parse key: "destOUID:period"
			parts := strings.Split(transferKey, ":")
			if len(parts) != 2 {
				continue
			}
			destOUID := parts[0]
			period := parts[1]

			completionRegs = append(completionRegs, map[string]interface{}{
				"dataSet":          req.DestDatasetID,
				"period":           period,
				"organisationUnit": destOUID,
				"completed":        true,
				"completeDate":     now,
				"storedBy":         "dhis2sync-desktop",
			})
		}

		if len(completionRegs) > 0 {
			// Single batched POST for all completeness registrations
			completionPayload := map[string]interface{}{
				"completeDataSetRegistrations": completionRegs,
			}

			resp, err := destClient.Post("api/completeDataSetRegistrations", completionPayload)
			if err != nil {
				s.updateProgress(taskID, "running", 90, fmt.Sprintf("⚠ Failed to mark datasets complete: %v", err))
				log.Printf("Completeness marking failed: %v", err)
			} else if !resp.IsSuccess() {
				s.updateProgress(taskID, "running", 90, fmt.Sprintf("⚠ Completion registration failed: HTTP %d", resp.StatusCode()))
				log.Printf("Completeness marking failed: HTTP %d - %s", resp.StatusCode(), resp.String())
			} else {
				s.updateProgress(taskID, "running", 90, fmt.Sprintf("✓ Marked %d dataset registrations as complete", len(completionRegs)))
				log.Printf("Successfully marked %d dataset registrations as complete", len(completionRegs))
			}
		}
	}

	// Check if there are unmapped values requiring user decision
	s.taskMu.Lock()
	var unmappedSummary string
	var totalUnmapped int
	var hasUnmapped bool
	if progress, exists := s.taskStore[taskID]; exists {
		progress.TotalImported = totalImported + totalUpdated

		if len(progress.UnmappedValues) > 0 {
			hasUnmapped = true
			totalUnmapped = 0
			for _, values := range progress.UnmappedValues {
				totalUnmapped += len(values)
			}

			unmappedSummary = fmt.Sprintf("⚠️ %d unmapped values found across %d org unit/period combinations",
				totalUnmapped, len(progress.UnmappedValues))

			// Extract unique unmapped element IDs
			unmappedElements := make(map[string]bool)
			for _, values := range progress.UnmappedValues {
				for _, dv := range values {
					unmappedElements[dv.DataElement] = true
				}
			}

			// Convert to slice for display
			elementIDs := []string{}
			for id := range unmappedElements {
				elementIDs = append(elementIDs, id)
			}

			unmappedSummary += fmt.Sprintf("\n   Unmapped data element IDs: %v", elementIDs)
		}
	}
	s.taskMu.Unlock()

	if hasUnmapped {
		// Pause transfer and wait for user decision
		s.updateProgress(taskID, "awaiting_user_decision", 95, unmappedSummary)
		s.updateProgress(taskID, "awaiting_user_decision", 95,
			"⚠️ User action required: These values were filtered out during mapping")
		s.updateProgress(taskID, "awaiting_user_decision", 95,
			"Options: 1) Create new mappings for unmapped elements, 2) Skip and complete transfer, 3) Cancel entire transfer")

		// Frontend will detect "awaiting_user_decision" status and show modal
		// User selects option, frontend calls: App.ResolveUnmappedValues(taskID, action, newMappings)

		log.Printf("[%s] Transfer paused - awaiting user decision on %d unmapped values", taskID, totalUnmapped)
		return // Stop here, wait for user decision
	}

	// No unmapped values - complete transfer normally
	// Build completion message that clearly shows ignored values
	var msg string
	if totalIgnored > 0 && totalImported == 0 && totalUpdated == 0 {
		msg = fmt.Sprintf("🎉 Transfer complete! All %d values already exist in destination (no changes needed)", totalIgnored)
	} else if totalIgnored > 0 {
		msg = fmt.Sprintf("🎉 Transfer complete! Processed: %d org units, %d new, %d updated, %d already exist, %d not found",
			processedOUs, totalImported, totalUpdated, totalIgnored, len(notFoundOUs))
	} else {
		msg = fmt.Sprintf("🎉 Transfer complete! Processed: %d org units, %d new, %d updated, %d not found",
			processedOUs, totalImported, totalUpdated, len(notFoundOUs))
	}
	s.updateProgress(taskID, "completed", 100, msg)

	if len(notFoundOUs) > 0 {
		s.updateProgress(taskID, "completed", 100, fmt.Sprintf("Note: %d org units not found in destination: %v", len(notFoundOUs), notFoundOUs))
	}

	// Mark completion time
	s.taskMu.Lock()
	if progress, exists := s.taskStore[taskID]; exists {
		now := time.Now().Format(time.RFC3339)
		progress.CompletedAt = now
	}
	s.taskMu.Unlock()
}

// fetchDataValues is no longer used - replaced by discovery pattern in TransferData()

// applyMapping applies element mapping to data values
// Returns two slices: mapped values (with transformed IDs) and unmapped values (filtered out)
// Unmapped values are returned separately for user review/decision
func (s *Service) applyMapping(dataValues []DataValue, mapping map[string]string) ([]DataValue, []DataValue) {
	// No mapping provided → return all as mapped, none as unmapped
	if len(mapping) == 0 {
		return dataValues, []DataValue{}
	}

	mapped := []DataValue{}   // Only values with mapping entries
	unmapped := []DataValue{} // Values with no mapping entry (filtered out)

	for _, dv := range dataValues {
		if destElement, exists := mapping[dv.DataElement]; exists {
			// Mapping found → transform and add to mapped list
			mappedDV := dv
			mappedDV.DataElement = destElement
			mapped = append(mapped, mappedDV)
		} else {
			// No mapping → add to unmapped list for user review
			unmapped = append(unmapped, dv)
		}
	}

	// Log mapping statistics for debugging
	log.Printf("Applied element mapping: %d mapped, %d unmapped (filtered), %d total",
		len(mapped), len(unmapped), len(dataValues))

	if len(unmapped) > 0 {
		log.Printf("WARNING: %d data values have no mapping entry and will be filtered out", len(unmapped))
	}

	return mapped, unmapped // Return both lists separately
}

// applyResolutions applies user-defined resolutions (skip/map) to data values
func (s *Service) applyResolutions(dataValues []DataValue, resolutions []Resolution) ([]DataValue, int) {
	if len(resolutions) == 0 {
		return dataValues, 0
	}

	// Build lookup maps for fast access
	ouActions := make(map[string]string)  // ID -> Action
	cocActions := make(map[string]string) // ID -> Action

	for _, res := range resolutions {
		if res.Type == "orgUnit" {
			ouActions[res.ID] = res.Action
		} else if res.Type == "coc" {
			cocActions[res.ID] = res.Action
		}
	}

	sanitized := []DataValue{}
	skippedCount := 0

	for _, dv := range dataValues {
		// Check OrgUnit Resolution
		if action, ok := ouActions[dv.OrgUnit]; ok {
			if action == "skip" {
				skippedCount++
				continue
			} else if strings.HasPrefix(action, "map:") {
				dv.OrgUnit = strings.TrimPrefix(action, "map:")
			}
		}

		// Check COC Resolution
		if action, ok := cocActions[dv.CategoryOptionCombo]; ok {
			if action == "skip" {
				skippedCount++
				continue
			} else if strings.HasPrefix(action, "map:") {
				dv.CategoryOptionCombo = strings.TrimPrefix(action, "map:")
			}
		}

		// Check AttributeOptionCombo Resolution (if applicable, though usually same as COC logic)
		if action, ok := cocActions[dv.AttributeOptionCombo]; ok {
			if action == "skip" {
				skippedCount++
				continue
			} else if strings.HasPrefix(action, "map:") {
				dv.AttributeOptionCombo = strings.TrimPrefix(action, "map:")
			}
		}

		sanitized = append(sanitized, dv)
	}

	return sanitized, skippedCount
}

// importDataValues sends data values to destination, chunking large payloads to avoid timeouts
func (s *Service) importDataValues(client *api.Client, dataValues []DataValue, datasetID, period, orgUnit string) (*ImportSummary, error) {
	const maxChunkSize = 100 // Max values per API call to avoid server timeouts

	// If small enough, send as single request
	if len(dataValues) <= maxChunkSize {
		return s.importDataValuesChunk(client, dataValues, datasetID, period, orgUnit)
	}

	// Split into chunks for large payloads
	log.Printf("Splitting %d values into chunks of %d", len(dataValues), maxChunkSize)

	aggregatedSummary := &ImportSummary{
		Status:      "SUCCESS",
		ImportCount: ImportCount{},
		Conflicts:   []ImportConflict{},
	}

	totalChunks := (len(dataValues) + maxChunkSize - 1) / maxChunkSize

	for i := 0; i < len(dataValues); i += maxChunkSize {
		end := i + maxChunkSize
		if end > len(dataValues) {
			end = len(dataValues)
		}

		chunk := dataValues[i:end]
		chunkNum := (i / maxChunkSize) + 1
		log.Printf("Importing chunk %d/%d (%d values)", chunkNum, totalChunks, len(chunk))

		summary, err := s.importDataValuesChunk(client, chunk, datasetID, period, orgUnit)
		if err != nil {
			// Log error but continue with remaining chunks
			log.Printf("Chunk %d/%d failed: %v", chunkNum, totalChunks, err)
			aggregatedSummary.Conflicts = append(aggregatedSummary.Conflicts, ImportConflict{
				Object:    fmt.Sprintf("Chunk %d/%d", chunkNum, totalChunks),
				Value:     err.Error(),
				ErrorCode: "CHUNK_FAILED",
			})
			continue
		}

		// Aggregate results from all chunks
		aggregatedSummary.ImportCount.Imported += summary.ImportCount.Imported
		aggregatedSummary.ImportCount.Updated += summary.ImportCount.Updated
		aggregatedSummary.ImportCount.Ignored += summary.ImportCount.Ignored
		aggregatedSummary.ImportCount.Deleted += summary.ImportCount.Deleted
		aggregatedSummary.Conflicts = append(aggregatedSummary.Conflicts, summary.Conflicts...)

		log.Printf("Chunk %d/%d complete: Imported %d, Updated %d, Ignored %d",
			chunkNum, totalChunks, summary.ImportCount.Imported,
			summary.ImportCount.Updated, summary.ImportCount.Ignored)
	}

	// Overall summary
	log.Printf("All chunks complete: Total Imported %d, Updated %d, Ignored %d, Conflicts %d",
		aggregatedSummary.ImportCount.Imported,
		aggregatedSummary.ImportCount.Updated,
		aggregatedSummary.ImportCount.Ignored,
		len(aggregatedSummary.Conflicts))

	return aggregatedSummary, nil
}

// importDataValuesChunk sends a single chunk of data values to DHIS2 using Format 1 (legacy)
// DEPRECATED: Use importDataValuesBulk for better performance
func (s *Service) importDataValuesChunk(client *api.Client, dataValues []DataValue, datasetID, period, orgUnit string) (*ImportSummary, error) {
	// Build complete payload matching DHIS2 API requirements
	now := time.Now().Format("2006-01-02") // YYYY-MM-DD format

	payload := DataValueSetPayload{
		DataSet:      datasetID,
		Period:       period,
		OrgUnit:      orgUnit,
		CompleteDate: now,
		DataValues:   dataValues,
	}

	// POST to dataValueSets endpoint
	resp, err := client.Post("api/dataValueSets", payload)
	if err != nil {
		return nil, fmt.Errorf("failed to post data values: %w", err)
	}

	if !resp.IsSuccess() {
		return nil, fmt.Errorf("import failed with status %d: %s", resp.StatusCode(), resp.String())
	}

	// Parse flat DHIS2 response structure
	var summary ImportSummary
	if err := json.Unmarshal(resp.Body(), &summary); err != nil {
		return nil, fmt.Errorf("failed to parse import response: %w", err)
	}

	return &summary, nil
}

// importDataValuesBulk sends bulk data values to DHIS2 using Format 2 (recommended)
// This method is 300x-900x faster than Format 1 for large datasets (hundreds of org units)
// Implements chunking and concurrent requests for optimal performance
func (s *Service) importDataValuesBulk(client *api.Client, allDataValues []DataValue, chunkSize int, onProgress func(progress float64, message string)) ([]*ImportSummary, error) {
	if len(allDataValues) == 0 {
		return nil, fmt.Errorf("no data values to import")
	}

	if chunkSize <= 0 {
		chunkSize = 50 // Default: 50 values per request (reduced from 100 due to intermittent server timeouts at ~120s)
	}

	// Calculate number of chunks
	totalValues := len(allDataValues)
	numChunks := (totalValues + chunkSize - 1) / chunkSize

	log.Printf("Bulk import: %d total values, %d chunks of ~%d values each", totalValues, numChunks, chunkSize)

	// Process chunks with limited concurrency (1 concurrent request max)
	summaries := make([]*ImportSummary, 0, numChunks)
	summariesMu := sync.Mutex{}

	// Semaphore for concurrency control - SEQUENTIAL PROCESSING to avoid server overload
	maxConcurrent := 1
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	errChan := make(chan error, numChunks)

	for chunkIdx := 0; chunkIdx < numChunks; chunkIdx++ {
		start := chunkIdx * chunkSize
		end := start + chunkSize
		if end > totalValues {
			end = totalValues
		}

		chunk := allDataValues[start:end]

		wg.Add(1)
		go func(chunkNum int, chunkData []DataValue) {
			defer wg.Done()

			// Acquire semaphore
			sem <- struct{}{}
			defer func() { <-sem }()

			// Build bulk payload (Format 2)
			payload := BulkDataValueSetPayload{
				DataValues: chunkData,
			}

			log.Printf("Sending bulk chunk %d/%d (%d values)...", chunkNum+1, numChunks, len(chunkData))

			// POST to dataValueSets endpoint
			resp, err := client.Post("api/dataValueSets", payload)
			if err != nil {
				errChan <- fmt.Errorf("chunk %d failed: %w", chunkNum+1, err)
				return
			}

			if !resp.IsSuccess() {
				errChan <- fmt.Errorf("chunk %d import failed: HTTP %d: %s", chunkNum+1, resp.StatusCode(), resp.String())
				return
			}

			// Parse response
			var summary ImportSummary
			if err := json.Unmarshal(resp.Body(), &summary); err != nil {
				errChan <- fmt.Errorf("chunk %d parse failed: %w", chunkNum+1, err)
				return
			}

			log.Printf("✓ Chunk %d/%d complete: imported=%d, updated=%d, ignored=%d",
				chunkNum+1, numChunks, summary.ImportCount.Imported, summary.ImportCount.Updated, summary.ImportCount.Ignored)

			// Update UI progress via callback
			// Progress is 0.0 to 1.0 relative to this import operation
			progressPct := float64(chunkNum+1) / float64(numChunks)
			if onProgress != nil {
				onProgress(progressPct, fmt.Sprintf("✓ Completed chunk %d/%d (imported=%d, updated=%d)",
					chunkNum+1, numChunks, summary.ImportCount.Imported, summary.ImportCount.Updated))
			}

			// Store summary
			summariesMu.Lock()
			summaries = append(summaries, &summary)
			summariesMu.Unlock()

		}(chunkIdx, chunk)
	}

	// Wait for all chunks to complete
	wg.Wait()
	close(errChan)

	// Check for errors
	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		return summaries, fmt.Errorf("bulk import had %d errors: %v", len(errs), errs[0])
	}

	return summaries, nil
}

// importDataValuesBulkAsync sends bulk data using async mode with job polling
// This is THE RECOMMENDED approach for large imports (>1000 values)
// Uses async=true parameter to avoid connection timeouts during server processing
// Returns after ALL async jobs complete successfully
func (s *Service) importDataValuesBulkAsync(client *api.Client, allDataValues []DataValue, chunkSize int, onProgress func(progress float64, message string)) ([]*ImportSummary, error) {
	if len(allDataValues) == 0 {
		return nil, fmt.Errorf("no data values to import")
	}

	if chunkSize <= 0 {
		chunkSize = 1000 // Default: 1,000 values (optimal for DHIS2 async)
	}

	// Calculate chunks
	totalValues := len(allDataValues)
	numChunks := (totalValues + chunkSize - 1) / chunkSize

	log.Printf("Async bulk import: %d total values, %d chunks of ~%d values each", totalValues, numChunks, chunkSize)
	if onProgress != nil {
		onProgress(0.0, fmt.Sprintf("Submitting %d async import jobs to DHIS2...", numChunks))
	}

	// Submit all chunks as async jobs (returns immediately)
	type asyncJob struct {
		JobID     string
		ChunkNum  int
		NumValues int
	}

	submittedJobs := []asyncJob{}
	submissionErrors := []error{}

	for chunkIdx := 0; chunkIdx < numChunks; chunkIdx++ {
		start := chunkIdx * chunkSize
		end := start + chunkSize
		if end > totalValues {
			end = totalValues
		}

		chunk := allDataValues[start:end]

		// Build bulk payload (Format 2)
		payload := BulkDataValueSetPayload{
			DataValues: chunk,
		}

		log.Printf("Submitting async job %d/%d (%d values)...", chunkIdx+1, numChunks, len(chunk))

		// POST with async=true and preheatCache=true (with retry logic)
		var resp []byte

		retryErr := retryWithBackoff("async_submit", func() error {
			r, e := client.Post("api/dataValueSets?async=true&preheatCache=true", payload)
			if e != nil {
				return e
			}
			if !r.IsSuccess() {
				return fmt.Errorf("HTTP %d: %s", r.StatusCode(), r.String())
			}
			resp = r.Body()
			return nil
		}, 3, func(tid, msg string) {
			if onProgress != nil {
				onProgress(0.1, fmt.Sprintf("Chunk %d/%d: %s", chunkIdx+1, numChunks, msg))
			}
		})

		if retryErr != nil {
			submissionErrors = append(submissionErrors, fmt.Errorf("chunk %d submission failed after retries: %w", chunkIdx+1, retryErr))
			continue
		}

		if resp == nil {
			submissionErrors = append(submissionErrors, fmt.Errorf("chunk %d: nil response after successful retry", chunkIdx+1))
			continue
		}

		// Parse async job response
		var jobResp AsyncJobResponse
		if err := json.Unmarshal(resp, &jobResp); err != nil {
			log.Printf("[ERROR] Chunk %d/%d: Failed to parse job submission response. Body: %s. Error: %v",
				chunkIdx+1, numChunks, string(resp), err)
			submissionErrors = append(submissionErrors, fmt.Errorf("chunk %d parse failed: %w", chunkIdx+1, err))
			continue
		}

		log.Printf("[DEBUG] Chunk %d/%d: Job submission response: %+v", chunkIdx+1, numChunks, jobResp)

		if jobResp.Response.ID == "" {
			log.Printf("[ERROR] Chunk %d/%d: No job ID in response. Full response: %s",
				chunkIdx+1, numChunks, string(resp))
			submissionErrors = append(submissionErrors, fmt.Errorf("chunk %d: no job ID returned", chunkIdx+1))
			continue
		}

		submittedJobs = append(submittedJobs, asyncJob{
			JobID:     jobResp.Response.ID,
			ChunkNum:  chunkIdx + 1,
			NumValues: len(chunk),
		})

		log.Printf("✓ Async job %d/%d submitted: jobID=%s", chunkIdx+1, numChunks, jobResp.Response.ID)
	}

	if len(submissionErrors) > 0 {
		return nil, fmt.Errorf("%d job submissions failed: %v", len(submissionErrors), submissionErrors[0])
	}

	if onProgress != nil {
		onProgress(0.2, fmt.Sprintf("✓ Submitted %d async jobs, polling for completion...", len(submittedJobs)))
	}

	// Poll all jobs for completion (with concurrency limit)
	summaries := make([]*ImportSummary, 0, len(submittedJobs))
	summariesMu := sync.Mutex{}
	completedCount := 0
	completedMu := sync.Mutex{}

	maxConcurrent := 10 // Poll up to 10 jobs concurrently
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	errChan := make(chan error, len(submittedJobs))

	for _, job := range submittedJobs {
		wg.Add(1)
		go func(j asyncJob) {
			defer wg.Done()

			// Acquire semaphore
			sem <- struct{}{}
			defer func() { <-sem }()

			// Log job polling start for user visibility
			if onProgress != nil {
				// Don't update message here to avoid spamming, just log
			}

			// Poll this job until completion (with retry logic)
			summary, err := s.pollAsyncJobWithRetry(client, j.JobID, j.ChunkNum, numChunks, onProgress)
			if err != nil {
				errChan <- fmt.Errorf("job %d (ID=%s) failed: %w", j.ChunkNum, j.JobID, err)
				return
			}

			// Update progress
			completedMu.Lock()
			completedCount++
			// Progress from 0.2 to 1.0
			progressPct := 0.2 + (0.8 * float64(completedCount) / float64(len(submittedJobs)))
			completedMu.Unlock()

			if onProgress != nil {
				onProgress(progressPct, fmt.Sprintf("✓ Completed %d/%d async jobs (imported=%d, updated=%d)",
					completedCount, len(submittedJobs), summary.ImportCount.Imported, summary.ImportCount.Updated))
			}

			// Store summary
			summariesMu.Lock()
			summaries = append(summaries, summary)
			summariesMu.Unlock()

		}(job)
	}

	// Wait for all polling to complete
	wg.Wait()
	close(errChan)

	// Check for errors
	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		return summaries, fmt.Errorf("async import had %d job failures: %v", len(errs), errs[0])
	}

	log.Printf("✓ All %d async jobs completed successfully", len(submittedJobs))
	return summaries, nil
}

// pollAsyncJobWithRetry wraps pollAsyncJob with retry logic for network failures
func (s *Service) pollAsyncJobWithRetry(client *api.Client, jobID string, chunkNum, totalChunks int, onProgress func(progress float64, message string)) (*ImportSummary, error) {
	// "Watch Football" mode: retry for a very long time (approx 8 hours if max backoff is 30s)
	maxRetries := 1000
	backoff := 2 * time.Second
	maxBackoff := 30 * time.Second

	for attempt := 1; attempt <= maxRetries; attempt++ {
		summary, err := s.pollAsyncJob(client, jobID, chunkNum, totalChunks, onProgress)
		if err == nil {
			return summary, nil
		}

		// Log retry attempt
		if attempt < maxRetries {
			log.Printf("Poll attempt %d/%d failed for job %d/%d (ID=%s): %v (retrying in %v...)",
				attempt, maxRetries, chunkNum, totalChunks, jobID, err, backoff)

			// Only update UI every 5th retry to avoid spamming
			if (attempt%5 == 0 || attempt == 1) && onProgress != nil {
				// We don't know the exact progress percentage here, so we just send a message
				// The caller (importDataValuesBulkAsync) manages the percentage
				// We can pass -1.0 to indicate "no change in percentage" if we wanted, but onProgress expects float64
				// Let's just not call onProgress for retries to keep it simple, or call it with a dummy value if needed.
				// Actually, the caller ignores the percentage if we don't have it? No, it expects it.
				// But we are inside a loop in the caller that sets progress based on completed jobs.
				// So we shouldn't mess with the percentage here.
				// We can just log it.
			}

			time.Sleep(backoff)

			// Exponential backoff
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			continue
		}

		// Final attempt failed
		return nil, fmt.Errorf("job polling failed after %d attempts: %w", maxRetries, err)
	}
	return nil, fmt.Errorf("unreachable")
}

// pollAsyncJob polls a single DHIS2 async job until completion or failure
func (s *Service) pollAsyncJob(client *api.Client, jobID string, chunkNum, totalChunks int, onProgress func(progress float64, message string)) (*ImportSummary, error) {
	endpoint := fmt.Sprintf("api/system/tasks/DATAVALUE_IMPORT/%s", jobID)
	maxAttempts := 300 // 300 × 2s = 10 minutes max per job
	pollInterval := 2 * time.Second

	log.Printf("Polling job %d/%d (ID=%s)...", chunkNum, totalChunks, jobID)

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		resp, err := client.Get(endpoint, nil)
		if err != nil {
			log.Printf("[DEBUG] Job %d/%d attempt %d: HTTP error: %v", chunkNum, totalChunks, attempt, err)
			return nil, fmt.Errorf("polling attempt %d failed: %w", attempt, err)
		}

		log.Printf("[DEBUG] Job %d/%d attempt %d: HTTP %d, Body length: %d bytes",
			chunkNum, totalChunks, attempt, resp.StatusCode(), len(resp.Body()))

		if !resp.IsSuccess() {
			log.Printf("[DEBUG] Job %d/%d: Non-success status. Body: %s", chunkNum, totalChunks, string(resp.Body()))
			return nil, fmt.Errorf("polling returned HTTP %d: %s", resp.StatusCode(), resp.String())
		}

		// **LOG THE RAW RESPONSE**
		rawBody := string(resp.Body())
		if attempt == 1 || attempt%30 == 0 || attempt == maxAttempts {
			log.Printf("[DEBUG] Job %d/%d attempt %d raw response: %s", chunkNum, totalChunks, attempt, rawBody)
		}

		// Parse job status (DHIS2 returns array of status objects)
		var statuses []JobStatus
		if err := json.Unmarshal(resp.Body(), &statuses); err != nil {
			log.Printf("[ERROR] Job %d/%d: JSON parse failed. Raw body: %s. Error: %v",
				chunkNum, totalChunks, rawBody, err)
			return nil, fmt.Errorf("failed to parse job status: %w", err)
		}

		log.Printf("[DEBUG] Job %d/%d attempt %d: Parsed %d status objects", chunkNum, totalChunks, attempt, len(statuses))

		if len(statuses) == 0 {
			if attempt%30 == 0 {
				log.Printf("[WARN] Job %d/%d: Empty status array after %d attempts (%d seconds)",
					chunkNum, totalChunks, attempt, attempt*2)
			}
			time.Sleep(pollInterval)
			continue
		}

		jobStatus := statuses[0] // Get first (latest) status
		log.Printf("[DEBUG] Job %d/%d attempt %d: Status - completed=%v, level=%s, message=%s",
			chunkNum, totalChunks, attempt, jobStatus.Completed, jobStatus.Level, jobStatus.Message)

		// Check if completed
		if jobStatus.Completed {
			log.Printf("✓ Job %d/%d complete after %d polls: level=%s", chunkNum, totalChunks, attempt, jobStatus.Level)

			if jobStatus.Level == "ERROR" {
				return nil, fmt.Errorf("job failed: %s", jobStatus.Message)
			}

			// Extract import summary - try structured summary first, fallback to message parsing
			var summary *ImportSummary
			if jobStatus.Summary != nil {
				// Structured summary available (ideal case)
				summary = &ImportSummary{
					Status:      jobStatus.Summary.Status,
					ImportCount: jobStatus.Summary.ImportCount,
					Conflicts:   jobStatus.Summary.Conflicts,
				}
			} else if jobStatus.Message != "" {
				// No structured summary, try parsing the message string
				importCounts, err := parseImportMessageCounts(jobStatus.Message)
				if err != nil {
					return nil, fmt.Errorf("job completed but could not extract summary: %w", err)
				}
				summary = &ImportSummary{
					Status:      "SUCCESS", // Level is INFO/SUCCESS if we got here
					Description: jobStatus.Message,
					ImportCount: *importCounts,
				}
			} else {
				return nil, fmt.Errorf("job completed but no summary or message available")
			}

			return summary, nil
		}

		// Not complete yet, wait and retry
		if attempt%15 == 0 { // Log every 30 seconds (15 attempts × 2s)
			elapsedSeconds := attempt * 2
			log.Printf("Job %d/%d still running after %d seconds...", chunkNum, totalChunks, elapsedSeconds)
			// Update UI to show job is still processing
			// Update UI to show job is still processing
			if onProgress != nil {
				onProgress(-1.0, fmt.Sprintf("⏳ Job %d/%d still processing (%d seconds elapsed)...", chunkNum, totalChunks, elapsedSeconds))
			}
		}

		time.Sleep(pollInterval)
	}

	return nil, fmt.Errorf("job polling timeout after %d attempts (%d minutes)", maxAttempts, maxAttempts*2/60)
}

// markDatasetComplete marks a dataset as complete for a specific org unit and period
func (s *Service) markDatasetComplete(client *api.Client, datasetID string, period string, orgUnitID string) error {
	payload := map[string]interface{}{
		"completeDataSetRegistrations": []map[string]interface{}{
			{
				"dataSet":          datasetID,
				"period":           period,
				"organisationUnit": orgUnitID,
				"completed":        true,
			},
		},
	}

	resp, err := client.Post("api/completeDataSetRegistrations", payload)
	if err != nil {
		return fmt.Errorf("failed to post completion: %w", err)
	}

	if !resp.IsSuccess() {
		return fmt.Errorf("completion registration failed: HTTP %d", resp.StatusCode())
	}

	return nil
}

// getAPIClient creates an API client for the specified instance (source or destination)
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

// parseImportConflicts extracts and formats detailed conflict information from import summary
func parseImportConflicts(summary *ImportSummary) string {
	if summary == nil || len(summary.Conflicts) == 0 {
		return ""
	}

	var details []string
	for i, conflict := range summary.Conflicts {
		if i >= 10 {
			details = append(details, fmt.Sprintf("  ... and %d more conflicts", len(summary.Conflicts)-10))
			break
		}
		details = append(details, fmt.Sprintf("  - %s: %s (code: %s)", conflict.Object, conflict.Value, conflict.ErrorCode))
	}

	return fmt.Sprintf("Import conflicts (%d total):\n%s", len(summary.Conflicts), strings.Join(details, "\n"))
}

// parseImportMessageCounts extracts import counts from DHIS2 message strings
// Example: "Import complete with status SUCCESS, 0 created, 0 updated, 0 deleted, 328 ignored"
func parseImportMessageCounts(message string) (*ImportCount, error) {
	if message == "" {
		return nil, fmt.Errorf("empty message")
	}

	// Regex to match: "(\d+) created, (\d+) updated, (\d+) deleted, (\d+) ignored"
	re := regexp.MustCompile(`(\d+)\s+created,\s+(\d+)\s+updated,\s+(\d+)\s+deleted,\s+(\d+)\s+ignored`)
	matches := re.FindStringSubmatch(message)

	if len(matches) != 5 {
		return nil, fmt.Errorf("could not parse import counts from message: %s", message)
	}

	// Convert string matches to integers
	created, _ := strconv.Atoi(matches[1])
	updated, _ := strconv.Atoi(matches[2])
	deleted, _ := strconv.Atoi(matches[3])
	ignored, _ := strconv.Atoi(matches[4])

	return &ImportCount{
		Imported: created,
		Updated:  updated,
		Deleted:  deleted,
		Ignored:  ignored,
	}, nil
}

// retryWithBackoff retries a function up to maxAttempts times with exponential backoff
// delays: 500ms, 1s, 2s
func retryWithBackoff(taskID string, operation func() error, maxAttempts int, taskLogger func(taskID, msg string)) error {
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		err := operation()
		if err == nil {
			if attempt > 1 && taskLogger != nil {
				taskLogger(taskID, fmt.Sprintf("✓ Operation succeeded on retry %d/%d", attempt, maxAttempts))
			}
			return nil
		}

		lastErr = err

		// Don't sleep after last attempt
		if attempt < maxAttempts {
			backoffDuration := time.Duration(500*attempt*attempt) * time.Millisecond // 500ms, 2s, 4.5s
			if taskLogger != nil {
				taskLogger(taskID, fmt.Sprintf("⚠ Attempt %d/%d failed: %v (retrying in %v)", attempt, maxAttempts, err, backoffDuration))
			}
			log.Printf("Task %s: Retry %d/%d after %v: %v", taskID, attempt, maxAttempts, backoffDuration, err)
			time.Sleep(backoffDuration)
		} else {
			if taskLogger != nil {
				taskLogger(taskID, fmt.Sprintf("✗ All %d attempts failed: %v", maxAttempts, err))
			}
			log.Printf("Task %s: All %d attempts failed: %v", taskID, maxAttempts, err)
		}
	}
	return fmt.Errorf("failed after %d attempts: %w", maxAttempts, lastErr)
}

// updateProgress updates the progress of a transfer task
func (s *Service) updateProgress(taskID, status string, progress int, message string) {
	// Update in-memory store and capture messages array
	var allMessages []string

	s.taskMu.Lock()
	if p, exists := s.taskStore[taskID]; exists {
		p.Status = status
		p.Progress = progress
		p.Messages = append(p.Messages, message)
		allMessages = p.Messages // Capture full message array
	}
	s.taskMu.Unlock()

	// Update database
	db := database.GetDB()
	var taskProgress models.TaskProgress
	if err := db.Where("id = ?", taskID).First(&taskProgress).Error; err == nil {
		taskProgress.Status = status
		taskProgress.Progress = progress

		// Append message
		messages := s.unmarshalMessages(taskProgress.Messages)
		messages = append(messages, message)
		taskProgress.Messages = s.marshalMessages(messages)

		db.Save(&taskProgress)
	}

	// Emit event to frontend with full message array
	runtime.EventsEmit(s.ctx, fmt.Sprintf("transfer:%s", taskID), map[string]interface{}{
		"task_id":  taskID,
		"status":   status,
		"progress": progress,
		"message":  message,     // Keep latest message for backwards compat
		"messages": allMessages, // Add full message array for scrolling log
	})

	log.Printf("[%s] %s (%d%%): %s", taskID, status, progress, message)
}

// updateProgressOnly updates progress percentage and message without changing status
func (s *Service) updateProgressOnly(taskID string, progress int, message string) {
	s.taskMu.Lock()
	if p, exists := s.taskStore[taskID]; exists {
		p.Progress = progress
		p.Messages = append(p.Messages, message)
	}
	s.taskMu.Unlock()
}

// marshalMessages converts a string slice to JSON
func (s *Service) marshalMessages(messages []string) string {
	data, _ := json.Marshal(messages)
	return string(data)
}

// unmarshalMessages converts JSON to a string slice
func (s *Service) unmarshalMessages(messagesJSON string) []string {
	if messagesJSON == "" {
		return []string{}
	}
	var messages []string
	json.Unmarshal([]byte(messagesJSON), &messages)
	return messages
}

// ListOrganisationUnits retrieves org units at a specific level or roots (level 1)
func (s *Service) ListOrganisationUnits(profileID string, sourceOrDest string, level int) ([]OrgUnit, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Decrypt credentials and create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Default to level 1 (roots) if not specified
	if level <= 0 {
		level = 1
	}

	// Fetch org units at specified level
	params := map[string]string{
		"fields": "id,displayName,name,code,level,path,parent[id]",
		"filter": fmt.Sprintf("level:eq:%d", level),
		"paging": "false",
		"order":  "displayName:asc", // Sort alphabetically
	}

	resp, err := client.Get("api/organisationUnits.json", params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch org units: %w", err)
	}

	if !resp.IsSuccess() {
		return nil, fmt.Errorf("API request failed: %s", resp.Status())
	}

	var result struct {
		OrgUnits []OrgUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.OrgUnits, nil
}

// GetOrgUnitChildren retrieves children of a specific org unit
func (s *Service) GetOrgUnitChildren(profileID string, sourceOrDest string, parentID string) ([]OrgUnit, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Decrypt credentials and create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Fetch children of the specified parent
	params := map[string]string{
		"fields": "id,displayName,name,code,level,path,parent[id]",
		"filter": fmt.Sprintf("parent.id:eq:%s", parentID),
		"paging": "false",
		"order":  "displayName:asc", // Sort alphabetically
	}

	resp, err := client.Get("api/organisationUnits.json", params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch org unit children: %w", err)
	}

	if !resp.IsSuccess() {
		return nil, fmt.Errorf("API request failed: %s", resp.Status())
	}

	var result struct {
		OrgUnits []OrgUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.OrgUnits, nil
}

// GetOrgUnitsByLevelBatch fetches all org units grouped by level in parallel
// This is MUCH faster than fetching children per-parent for large hierarchies
// Instead of 100+ sequential API calls, this makes only ~5 parallel calls (one per level)
func (s *Service) GetOrgUnitsByLevelBatch(profileID string, sourceOrDest string, maxLevel int) (map[int][]OrgUnit, error) {
	// Get profile from database ONCE
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Create API client ONCE (uses the client's default 600s timeout)
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Default max level if not specified
	if maxLevel <= 0 {
		maxLevel = 10 // Most DHIS2 instances have max 6-7 levels
	}

	// Results map with mutex for concurrent access
	results := make(map[int][]OrgUnit)
	var mu sync.Mutex

	log.Printf("[OrgUnitBatch] Fetching org units for levels 1-%d", maxLevel)

	// Fetch levels sequentially but with concurrency limit of 3
	concurrency := 3
	semaphore := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var firstError error
	var errMu sync.Mutex

	for level := 1; level <= maxLevel; level++ {
		wg.Add(1)
		semaphore <- struct{}{} // acquire

		go func(lvl int) {
			defer wg.Done()
			defer func() { <-semaphore }() // release

			log.Printf("[OrgUnitBatch] Fetching level %d...", lvl)

			params := map[string]string{
				"fields": "id,displayName,name,code,level,path,parent[id]",
				"filter": fmt.Sprintf("level:eq:%d", lvl),
				"paging": "false",
				"order":  "displayName:asc",
			}

			resp, err := client.Get("api/organisationUnits.json", params)
			if err != nil {
				log.Printf("[OrgUnitBatch] Level %d error: %v", lvl, err)
				errMu.Lock()
				if firstError == nil {
					firstError = fmt.Errorf("level %d: %w", lvl, err)
				}
				errMu.Unlock()
				return
			}

			if !resp.IsSuccess() {
				// Level might not exist (e.g., asking for level 10 when only 5 exist)
				// Just return empty for non-existent levels
				log.Printf("[OrgUnitBatch] Level %d returned HTTP %d (may not exist)", lvl, resp.StatusCode())
				return
			}

			var r struct {
				OrgUnits []OrgUnit `json:"organisationUnits"`
			}

			if err := json.Unmarshal(resp.Body(), &r); err != nil {
				log.Printf("[OrgUnitBatch] Level %d parse error: %v", lvl, err)
				return
			}

			// Only store non-empty results
			if len(r.OrgUnits) > 0 {
				mu.Lock()
				results[lvl] = r.OrgUnits
				mu.Unlock()
				log.Printf("[OrgUnitBatch] Level %d: fetched %d org units", lvl, len(r.OrgUnits))
			} else {
				log.Printf("[OrgUnitBatch] Level %d: no org units found", lvl)
			}
		}(level)
	}

	wg.Wait()

	// If we got an error and no results, return the error
	if firstError != nil && len(results) == 0 {
		return nil, firstError
	}

	// Count total
	total := 0
	for _, units := range results {
		total += len(units)
	}
	log.Printf("[OrgUnitBatch] Complete: %d org units across %d levels", total, len(results))

	return results, nil
}

// GetUserRootOrgUnit fetches the user's root (top-level) organization unit from /api/me
func (s *Service) GetUserRootOrgUnit(profileID string, sourceOrDest string) (*OrgUnit, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Decrypt credentials and create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Fetch user's assigned org units
	params := map[string]string{
		"fields": "organisationUnits[id,name,displayName,level]",
	}

	resp, err := client.Get("api/me.json", params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user info: %w", err)
	}

	if !resp.IsSuccess() {
		return nil, fmt.Errorf("API request failed: %s", resp.Status())
	}

	var result struct {
		OrgUnits []OrgUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if len(result.OrgUnits) == 0 {
		return nil, fmt.Errorf("user has no assigned organization units")
	}

	// Find the top-level org unit (minimum level)
	rootOU := &result.OrgUnits[0]
	for i := range result.OrgUnits {
		if result.OrgUnits[i].Level < rootOU.Level {
			rootOU = &result.OrgUnits[i]
		}
	}

	return rootOU, nil
}

// DiscoverOrgUnitsWithData discovers all organization units that have data for the given dataset and period
// This replicates the Python CLI pattern: fetches data with children=true, then extracts unique org units
func (s *Service) DiscoverOrgUnitsWithData(profileID string, sourceOrDest string, datasetID string, period string, parentOU string) (map[string]string, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}

	// Decrypt credentials and create API client
	client, err := s.getAPIClient(&profile, sourceOrDest)
	if err != nil {
		return nil, err
	}

	// Discovery calls with children=true can return large payloads (10-100 MB for yearly data)
	// Increase timeout to allow time for large response body download and slow server processing
	client.SetTimeout(180 * time.Second)

	// Fetch data values for parent OU and all children
	params := map[string]string{
		"dataSet":  datasetID,
		"period":   period,
		"orgUnit":  parentOU,
		"children": "true",
		"paging":   "false",
	}

	resp, err := client.Get("api/dataValueSets", params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch data values: %w", err)
	}

	if !resp.IsSuccess() {
		// Treat any non-success response as "no data found" (match FastAPI behavior)
		// Log the details for debugging
		log.Printf("[DISCOVERY] HTTP %d for dataset=%s, period=%s, orgUnit=%s: %s",
			resp.StatusCode(), datasetID, period, parentOU, string(resp.Body()))
		return make(map[string]string), nil // Empty map, not an error
	}

	var result struct {
		DataValues []struct {
			OrgUnit string `json:"orgUnit"`
		} `json:"dataValues"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Extract unique org unit IDs
	orgUnitIDs := make(map[string]bool)
	for _, dv := range result.DataValues {
		if dv.OrgUnit != "" {
			orgUnitIDs[dv.OrgUnit] = true
		}
	}

	// Fetch names for all discovered org units
	discoveredOUs := make(map[string]string)
	for ouID := range orgUnitIDs {
		// Fetch org unit details to get name
		ouResp, err := client.Get(fmt.Sprintf("api/organisationUnits/%s.json", ouID), map[string]string{
			"fields": "id,name,displayName",
		})

		if err == nil && ouResp.IsSuccess() {
			var ouData OrgUnit
			if err := json.Unmarshal(ouResp.Body(), &ouData); err == nil {
				name := ouData.DisplayName
				if name == "" {
					name = ouData.Name
				}
				discoveredOUs[ouID] = name
			}
		}
	}

	return discoveredOUs, nil
}

// FindMatchingOrgUnit finds a matching org unit in the destination based on source org unit
// Tries exact ID match first, then falls back to case-insensitive name match
func (s *Service) FindMatchingOrgUnit(profileID string, sourceOrgUnitID string, sourceOrgUnitName string) (string, error) {
	// Get profile from database
	db := database.GetDB()
	var profile models.ConnectionProfile
	if err := db.Where("id = ?", profileID).First(&profile).Error; err != nil {
		return "", fmt.Errorf("profile not found: %w", err)
	}

	// Decrypt credentials and create API client for DESTINATION
	client, err := s.getAPIClient(&profile, "dest")
	if err != nil {
		return "", err
	}

	// Try exact ID match first (most common case for same-instance transfers)
	params := map[string]string{
		"filter": fmt.Sprintf("id:eq:%s", sourceOrgUnitID),
		"fields": "id,name",
		"paging": "false",
	}

	resp, err := client.Get("api/organisationUnits.json", params)
	if err == nil && resp.IsSuccess() {
		var result struct {
			OrgUnits []OrgUnit `json:"organisationUnits"`
		}
		if err := json.Unmarshal(resp.Body(), &result); err == nil {
			if len(result.OrgUnits) == 1 {
				return result.OrgUnits[0].ID, nil
			}
		}
	}

	// Fall back to case-insensitive name match
	params = map[string]string{
		"filter": fmt.Sprintf("name:ilike:%s", sourceOrgUnitName),
		"fields": "id,name",
		"paging": "false",
	}

	resp, err = client.Get("api/organisationUnits.json", params)
	if err != nil {
		return "", fmt.Errorf("failed to search org units by name: %w", err)
	}

	if !resp.IsSuccess() {
		return "", fmt.Errorf("API request failed: %s", resp.Status())
	}

	var result struct {
		OrgUnits []OrgUnit `json:"organisationUnits"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	// Find exact case-insensitive match
	lowerName := strings.ToLower(sourceOrgUnitName)
	for _, ou := range result.OrgUnits {
		if strings.ToLower(ou.Name) == lowerName {
			return ou.ID, nil
		}
	}

	return "", fmt.Errorf("no matching org unit found for: %s", sourceOrgUnitName)
}

// SkipUnmappedAndComplete marks the transfer as complete, skipping unmapped values
func (s *Service) SkipUnmappedAndComplete(taskID string) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	progress, exists := s.taskStore[taskID]
	if !exists {
		return fmt.Errorf("task not found: %s", taskID)
	}

	if progress.Status != "awaiting_user_decision" {
		return fmt.Errorf("task is not awaiting user decision (current status: %s)", progress.Status)
	}

	// Clear unmapped values and mark as completed
	progress.UnmappedValues = nil
	progress.Status = "completed"
	progress.Progress = 100
	progress.Messages = append(progress.Messages, "✓ User chose to skip unmapped values")
	progress.Messages = append(progress.Messages, "🎉 Transfer complete!")

	now := time.Now().Format(time.RFC3339)
	progress.CompletedAt = now

	// Update database
	db := database.GetDB()
	var taskProgress models.TaskProgress
	if err := db.Where("id = ?", taskID).First(&taskProgress).Error; err == nil {
		taskProgress.Status = "completed"
		taskProgress.Progress = 100
		messages := s.unmarshalMessages(taskProgress.Messages)
		messages = append(messages, "User skipped unmapped values", "Transfer complete")
		taskProgress.Messages = s.marshalMessages(messages)
		db.Save(&taskProgress)
	}

	log.Printf("[%s] Transfer completed (user skipped unmapped values)", taskID)
	return nil
}

// CancelTransfer cancels the entire transfer operation
func (s *Service) CancelTransfer(taskID string) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()

	progress, exists := s.taskStore[taskID]
	if !exists {
		return fmt.Errorf("task not found: %s", taskID)
	}

	if progress.Status != "awaiting_user_decision" {
		return fmt.Errorf("task is not awaiting user decision (current status: %s)", progress.Status)
	}

	// Mark as cancelled
	progress.Status = "cancelled"
	progress.Error = "Transfer cancelled by user"
	progress.Messages = append(progress.Messages, "✗ Transfer cancelled by user")

	now := time.Now().Format(time.RFC3339)
	progress.CompletedAt = now

	// Update database
	db := database.GetDB()
	var taskProgress models.TaskProgress
	if err := db.Where("id = ?", taskID).First(&taskProgress).Error; err == nil {
		taskProgress.Status = "cancelled"
		taskProgress.Progress = progress.Progress
		messages := s.unmarshalMessages(taskProgress.Messages)
		messages = append(messages, "Transfer cancelled by user")
		taskProgress.Messages = s.marshalMessages(messages)
		db.Save(&taskProgress)
	}

	log.Printf("[%s] Transfer cancelled by user", taskID)
	return nil
}

// RetryWithNewMappings applies new mappings and retries import for previously unmapped values
func (s *Service) RetryWithNewMappings(taskID string, newMappings map[string]string) error {
	s.taskMu.Lock()
	progress, exists := s.taskStore[taskID]
	if !exists {
		s.taskMu.Unlock()
		return fmt.Errorf("task not found: %s", taskID)
	}

	if progress.Status != "awaiting_user_decision" {
		s.taskMu.Unlock()
		return fmt.Errorf("task is not awaiting user decision (current status: %s)", progress.Status)
	}

	if len(progress.UnmappedValues) == 0 {
		s.taskMu.Unlock()
		return fmt.Errorf("no unmapped values to retry")
	}

	// Get unmapped values before releasing lock
	unmappedValuesCopy := make(map[string][]DataValue)
	for key, values := range progress.UnmappedValues {
		unmappedValuesCopy[key] = values
	}
	s.taskMu.Unlock()

	// Update status to running
	s.updateProgress(taskID, "running", 95, "Retrying import with new mappings...")

	// Get profile and create API client
	// Note: We need to extract profileID, datasetID, etc from the original request
	// For now, return error - this needs more context from the original transfer
	return fmt.Errorf("retry with new mappings not yet fully implemented - requires storing original transfer request")
}
