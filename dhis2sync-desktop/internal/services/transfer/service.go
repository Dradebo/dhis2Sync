package transfer

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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
		"fields": "id,name,displayName,code,periodType,dataSetElements[dataElement[id,name,displayName,code,valueType]],organisationUnits[id,name,displayName,code,level,path]",
	}

	resp, err := client.Get(endpoint, params)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch dataset info: %w", err)
	}

	if !resp.IsSuccess() {
		return nil, fmt.Errorf("API request failed: %s", resp.Status())
	}

	var datasetInfo DatasetInfo
	if err := json.Unmarshal(resp.Body(), &datasetInfo); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &datasetInfo, nil
}

// StartTransfer initiates a data transfer operation in the background
func (s *Service) StartTransfer(req TransferRequest) (string, error) {
	// Generate task ID
	taskID := uuid.New().String()

	// Initialize progress tracking
	progress := &TransferProgress{
		TaskID:     taskID,
		Status:     "starting",
		Progress:   0,
		Messages:   []string{"Initializing transfer..."},
		StartedAt:  time.Now(),
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

	// Discover all org units with data across all periods
	s.updateProgress(taskID, "running", 20, "Discovering organization units with data...")
	allDiscoveredOUs := make(map[string]string)

	totalPeriods := len(req.Periods)
	for i, period := range req.Periods {
		// Progress: 20-30% distributed across all periods
		periodProgress := 20 + (10 * i / totalPeriods)
		s.updateProgress(taskID, "running", periodProgress, fmt.Sprintf("Discovering org units for period %s...", period))

		discoveredOUs, err := s.DiscoverOrgUnitsWithData(req.ProfileID, "source", req.SourceDatasetID, period, rootOU.ID)
		if err != nil {
			s.updateProgress(taskID, "error", 0, fmt.Sprintf("Failed to discover org units for period %s: %v", period, err))
			return
		}

		// Merge discovered OUs
		for ouID, ouName := range discoveredOUs {
			allDiscoveredOUs[ouID] = ouName
		}

		periodProgressEnd := 20 + (10 * (i + 1) / totalPeriods)
		s.updateProgress(taskID, "running", periodProgressEnd,
			fmt.Sprintf("Found %d org units with data for period %s", len(discoveredOUs), period))
	}

	if len(allDiscoveredOUs) == 0 {
		s.updateProgress(taskID, "completed", 100, "No organization units found with data for the selected periods")
		return
	}

	s.updateProgress(taskID, "running", 30, fmt.Sprintf("Total: %d unique org units with data across all periods", len(allDiscoveredOUs)))

	// PHASE 1: Fetch and accumulate ALL data values before import (bulk strategy)
	s.updateProgress(taskID, "running", 35, "Fetching data from source (bulk accumulation)...")

	totalOUs := len(allDiscoveredOUs)
	processedOUs := 0
	notFoundOUs := []string{}

	// Accumulate all data values for bulk import
	allMappedValues := []DataValue{}

	// Track successful transfers for batched completeness marking
	// Map key: "destOUID:period", value: sourceOUName
	successfulTransfers := make(map[string]string)

	for sourceOUID, sourceOUName := range allDiscoveredOUs {
		processedOUs++
		progressPct := 35 + (35 * processedOUs / totalOUs) // 35-70% for fetching
		s.updateProgress(taskID, "running", progressPct, fmt.Sprintf("Fetching %d/%d: %s (%s)", processedOUs, totalOUs, sourceOUName, sourceOUID))

		// Find matching org unit in destination
		destOUID, err := s.FindMatchingOrgUnit(req.ProfileID, sourceOUID, sourceOUName)
		if err != nil {
			s.updateProgress(taskID, "running", progressPct,
				fmt.Sprintf("✗ No matching org unit found in destination\n  Source: %s (%s)\n  Reason: %v", sourceOUName, sourceOUID, err))
			notFoundOUs = append(notFoundOUs, sourceOUName)
			continue
		}

		// Fetch data for ALL periods for this org unit
		for _, period := range req.Periods {
			params := map[string]string{
				"dataSet": req.SourceDatasetID,
				"orgUnit": sourceOUID,
				"period":  period,
			}

			resp, err := sourceClient.Get("api/dataValueSets", params)
			if err != nil {
				s.updateProgress(taskID, "running", progressPct,
					fmt.Sprintf("⚠ Failed to fetch data from source\n  OU: %s (%s)\n  Period: %s\n  Error: %v",
						sourceOUName, sourceOUID, period, err))
				continue
			}

			if !resp.IsSuccess() {
				s.updateProgress(taskID, "running", progressPct,
					fmt.Sprintf("⚠ Source API returned HTTP %d for %s/%s: %s",
						resp.StatusCode(), sourceOUName, period, string(resp.Body())))
				continue
			}

			var sourceData DataValueSet
			if err := json.Unmarshal(resp.Body(), &sourceData); err != nil {
				s.updateProgress(taskID, "running", progressPct,
					fmt.Sprintf("⚠ Failed to parse source data\n  OU: %s (%s)\n  Period: %s\n  Error: %v",
						sourceOUName, sourceOUID, period, err))
				continue
			}

			if len(sourceData.DataValues) == 0 {
				continue // Skip empty data silently during accumulation
			}

			// Update org unit + period in values to match destination (required for Format 2)
			for i := range sourceData.DataValues {
				sourceData.DataValues[i].OrgUnit = destOUID
				sourceData.DataValues[i].Period = period // Explicitly set period on each value
			}

			// Apply element mapping if provided
			mappedValues, unmappedValues := s.applyMapping(sourceData.DataValues, req.ElementMapping)

			// Track unmapped values for final report
			if len(unmappedValues) > 0 {
				s.taskMu.Lock()
				if progress, exists := s.taskStore[taskID]; exists {
					if progress.UnmappedValues == nil {
						progress.UnmappedValues = make(map[string][]DataValue)
					}
					key := fmt.Sprintf("%s:%s", sourceOUName, period)
					progress.UnmappedValues[key] = unmappedValues
				}
				s.taskMu.Unlock()
			}

			if len(mappedValues) == 0 {
				continue // Skip if no mappable data
			}

			// ACCUMULATE instead of immediate import
			allMappedValues = append(allMappedValues, mappedValues...)

			// Log per-period fetch result for user visibility
			s.updateProgress(taskID, "running", progressPct,
				fmt.Sprintf("  ✓ Fetched %d values for period %s", len(mappedValues), period))

			// Track for completeness marking
			if req.MarkComplete {
				transferKey := fmt.Sprintf("%s:%s", destOUID, period)
				successfulTransfers[transferKey] = sourceOUName
			}
		}
	}

	s.updateProgress(taskID, "running", 70, fmt.Sprintf("✓ Fetched %d total data values from %d org units", len(allMappedValues), totalOUs))

	// PHASE 2: Bulk import all accumulated data values
	var totalImported, totalUpdated int

	if len(allMappedValues) > 0 {
		s.updateProgress(taskID, "running", 72, fmt.Sprintf("Importing %d data values sequentially (50 values per chunk)...", len(allMappedValues)))

		summaries, err := s.importDataValuesBulk(destClient, allMappedValues, 50, taskID) // 50 values per chunk (sequential, safer for slow server)
		if err != nil {
			s.updateProgress(taskID, "error", 72, fmt.Sprintf("✗ Bulk import failed: %v", err))
			return
		}

		// Aggregate all chunk summaries
		for _, summary := range summaries {
			totalImported += summary.ImportCount.Imported
			totalUpdated += summary.ImportCount.Updated
		}

		s.updateProgress(taskID, "running", 95, fmt.Sprintf("✓ Bulk import complete: imported=%d, updated=%d", totalImported, totalUpdated))
	} else {
		s.updateProgress(taskID, "completed", 100, "No data values to import after mapping")
		return
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
	msg := fmt.Sprintf("🎉 Transfer complete! Processed: %d org units, Imported: %d, Updated: %d, Not found: %d",
		totalOUs, totalImported, totalUpdated, len(notFoundOUs))
	s.updateProgress(taskID, "completed", 100, msg)

	if len(notFoundOUs) > 0 {
		s.updateProgress(taskID, "completed", 100, fmt.Sprintf("Note: %d org units not found in destination: %v", len(notFoundOUs), notFoundOUs))
	}

	// Mark completion time
	s.taskMu.Lock()
	if progress, exists := s.taskStore[taskID]; exists {
		now := time.Now()
		progress.CompletedAt = &now
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
func (s *Service) importDataValuesBulk(client *api.Client, allDataValues []DataValue, chunkSize int, taskID string) ([]*ImportSummary, error) {
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

			// Update UI progress
			progressPct := 72 + (23 * (chunkNum + 1) / numChunks) // 72-95%
			s.updateProgress(taskID, "running", progressPct,
				fmt.Sprintf("✓ Completed chunk %d/%d (imported=%d, updated=%d)",
					chunkNum+1, numChunks, summary.ImportCount.Imported, summary.ImportCount.Updated))

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
func (s *Service) importDataValuesBulkAsync(client *api.Client, allDataValues []DataValue, chunkSize int, taskID string) ([]*ImportSummary, error) {
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
	s.updateProgress(taskID, "running", 72, fmt.Sprintf("Submitting %d async import jobs to DHIS2...", numChunks))

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

		// POST with async=true and preheatCache=true
		resp, err := client.Post("api/dataValueSets?async=true&preheatCache=true", payload)
		if err != nil {
			submissionErrors = append(submissionErrors, fmt.Errorf("chunk %d submission failed: %w", chunkIdx+1, err))
			continue
		}

		if !resp.IsSuccess() {
			submissionErrors = append(submissionErrors, fmt.Errorf("chunk %d submission failed: HTTP %d: %s", chunkIdx+1, resp.StatusCode(), resp.String()))
			continue
		}

		// Parse async job response
		var jobResp AsyncJobResponse
		if err := json.Unmarshal(resp.Body(), &jobResp); err != nil {
			submissionErrors = append(submissionErrors, fmt.Errorf("chunk %d parse failed: %w", chunkIdx+1, err))
			continue
		}

		if jobResp.Response.ID == "" {
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

	s.updateProgress(taskID, "running", 75, fmt.Sprintf("✓ Submitted %d async jobs, polling for completion...", len(submittedJobs)))

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
			s.updateProgress(taskID, "running", 75,
				fmt.Sprintf("⏳ Polling job %d/%d (%d values)...", j.ChunkNum, numChunks, j.NumValues))

			// Poll this job until completion
			summary, err := s.pollAsyncJob(client, j.JobID, j.ChunkNum, numChunks, taskID)
			if err != nil {
				errChan <- fmt.Errorf("job %d (ID=%s) failed: %w", j.ChunkNum, j.JobID, err)
				return
			}

			// Update progress
			completedMu.Lock()
			completedCount++
			progressPct := 75 + (20 * completedCount / len(submittedJobs)) // 75-95%
			completedMu.Unlock()

			s.updateProgress(taskID, "running", progressPct,
				fmt.Sprintf("✓ Completed %d/%d async jobs (imported=%d, updated=%d)",
					completedCount, len(submittedJobs), summary.ImportCount.Imported, summary.ImportCount.Updated))

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

// pollAsyncJob polls a single DHIS2 async job until completion or failure
func (s *Service) pollAsyncJob(client *api.Client, jobID string, chunkNum, totalChunks int, taskID string) (*ImportSummary, error) {
	endpoint := fmt.Sprintf("api/system/tasks/DATAVALUE_IMPORT/%s", jobID)
	maxAttempts := 300 // 300 × 2s = 10 minutes max per job
	pollInterval := 2 * time.Second

	log.Printf("Polling job %d/%d (ID=%s)...", chunkNum, totalChunks, jobID)

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		resp, err := client.Get(endpoint, nil)
		if err != nil {
			return nil, fmt.Errorf("polling attempt %d failed: %w", attempt, err)
		}

		if !resp.IsSuccess() {
			return nil, fmt.Errorf("polling returned HTTP %d: %s", resp.StatusCode(), resp.String())
		}

		// Parse job status (DHIS2 returns array of status objects)
		var statuses []JobStatus
		if err := json.Unmarshal(resp.Body(), &statuses); err != nil {
			return nil, fmt.Errorf("failed to parse job status: %w", err)
		}

		if len(statuses) == 0 {
			time.Sleep(pollInterval)
			continue
		}

		jobStatus := statuses[0] // Get first (latest) status

		// Check if completed
		if jobStatus.Completed {
			log.Printf("✓ Job %d/%d complete after %d polls: level=%s", chunkNum, totalChunks, attempt, jobStatus.Level)

			if jobStatus.Level == "ERROR" {
				return nil, fmt.Errorf("job failed: %s", jobStatus.Message)
			}

			// Extract import summary
			if jobStatus.Summary == nil {
				return nil, fmt.Errorf("job completed but no summary available")
			}

			summary := &ImportSummary{
				Status:      jobStatus.Summary.Status,
				ImportCount: jobStatus.Summary.ImportCount,
				Conflicts:   jobStatus.Summary.Conflicts,
			}

			return summary, nil
		}

		// Not complete yet, wait and retry
		if attempt%15 == 0 { // Log every 30 seconds (15 attempts × 2s)
			elapsedSeconds := attempt * 2
			log.Printf("Job %d/%d still running after %d seconds...", chunkNum, totalChunks, elapsedSeconds)
			// Update UI to show job is still processing
			s.updateProgress(taskID, "running", 75,
				fmt.Sprintf("⏳ Job %d/%d still processing (%d seconds elapsed)...", chunkNum, totalChunks, elapsedSeconds))
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
		"message":  message,      // Keep latest message for backwards compat
		"messages": allMessages,  // Add full message array for scrolling log
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

// OrgUnit represents a DHIS2 organization unit
type OrgUnit struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Name        string `json:"name"`
	Code        string `json:"code,omitempty"`
	Level       int    `json:"level"`
	Path        string `json:"path"`
	Parent      *struct {
		ID string `json:"id"`
	} `json:"parent,omitempty"`
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
		"filter":  fmt.Sprintf("level:eq:%d", level),
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
		"filter":  fmt.Sprintf("parent.id:eq:%s", parentID),
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
	// Increase timeout to allow time for large response body download
	client.SetTimeout(60 * time.Second)

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
		return make(map[string]string), nil  // Empty map, not an error
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

	now := time.Now()
	progress.CompletedAt = &now

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

	now := time.Now()
	progress.CompletedAt = &now

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

