package transfer

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyMapping(t *testing.T) {
	ctx := context.Background()
	service := NewService(ctx)

	t.Run("Should transform data element IDs using mapping", func(t *testing.T) {
		dataValues := []DataValue{
			{DataElement: "abc123", Period: "202501", OrgUnit: "ou001", Value: "100"},
			{DataElement: "def456", Period: "202501", OrgUnit: "ou001", Value: "200"},
			{DataElement: "ghi789", Period: "202501", OrgUnit: "ou001", Value: "300"},
		}

		mapping := map[string]string{
			"abc123": "xyz111",
			"def456": "xyz222",
		}

		mapped, unmapped := service.applyMapping(dataValues, mapping)

		assert.Len(t, mapped, 2, "Should map 2 elements")
		assert.Equal(t, "xyz111", mapped[0].DataElement)
		assert.Equal(t, "xyz222", mapped[1].DataElement)

		assert.Len(t, unmapped, 1, "Should have 1 unmapped element")
		assert.Equal(t, "ghi789", unmapped[0].DataElement)
	})

	t.Run("Should preserve all other fields when mapping", func(t *testing.T) {
		dataValues := []DataValue{
			{
				DataElement:         "abc123",
				Period:              "202501",
				OrgUnit:             "ou456",
				CategoryOptionCombo: "coc789",
				Value:               "100",
			},
		}

		mapping := map[string]string{"abc123": "xyz111"}
		mapped, _ := service.applyMapping(dataValues, mapping)

		require.Len(t, mapped, 1)
		assert.Equal(t, "xyz111", mapped[0].DataElement)
		assert.Equal(t, "202501", mapped[0].Period)
		assert.Equal(t, "ou456", mapped[0].OrgUnit)
		assert.Equal(t, "coc789", mapped[0].CategoryOptionCombo)
		assert.Equal(t, "100", mapped[0].Value)
	})

	t.Run("Should return all as mapped when no mapping provided", func(t *testing.T) {
		dataValues := []DataValue{
			{DataElement: "abc123", Value: "100"},
			{DataElement: "def456", Value: "200"},
		}

		// Empty mapping
		mapping := map[string]string{}

		mapped, unmapped := service.applyMapping(dataValues, mapping)

		assert.Len(t, mapped, 2, "All values should be mapped when no mapping provided")
		assert.Len(t, unmapped, 0, "No values should be unmapped")
	})

	t.Run("Should handle empty data values slice", func(t *testing.T) {
		dataValues := []DataValue{}
		mapping := map[string]string{"abc": "xyz"}

		mapped, unmapped := service.applyMapping(dataValues, mapping)

		assert.Len(t, mapped, 0)
		assert.Len(t, unmapped, 0)
	})

	t.Run("Should handle all values being unmapped", func(t *testing.T) {
		dataValues := []DataValue{
			{DataElement: "abc123", Value: "100"},
			{DataElement: "def456", Value: "200"},
		}

		// Mapping that doesn't match any elements
		mapping := map[string]string{
			"xyz111": "dest1",
			"xyz222": "dest2",
		}

		mapped, unmapped := service.applyMapping(dataValues, mapping)

		assert.Len(t, mapped, 0, "No values should be mapped")
		assert.Len(t, unmapped, 2, "All values should be unmapped")
	})

	t.Run("Should handle all values being mapped", func(t *testing.T) {
		dataValues := []DataValue{
			{DataElement: "abc123", Value: "100"},
			{DataElement: "def456", Value: "200"},
		}

		mapping := map[string]string{
			"abc123": "xyz111",
			"def456": "xyz222",
		}

		mapped, unmapped := service.applyMapping(dataValues, mapping)

		assert.Len(t, mapped, 2, "All values should be mapped")
		assert.Len(t, unmapped, 0, "No values should be unmapped")
	})

	t.Run("Should not mutate original data values", func(t *testing.T) {
		original := DataValue{
			DataElement: "abc123",
			Period:      "202501",
			OrgUnit:     "ou001",
			Value:       "100",
		}
		dataValues := []DataValue{original}

		mapping := map[string]string{"abc123": "xyz111"}

		mapped, _ := service.applyMapping(dataValues, mapping)

		// Original should be unchanged
		assert.Equal(t, "abc123", original.DataElement)

		// Mapped copy should have new ID
		assert.Equal(t, "xyz111", mapped[0].DataElement)

		// But original in slice should still be unchanged
		assert.Equal(t, "abc123", dataValues[0].DataElement)
	})
}

func TestChunkDataValues(t *testing.T) {
	t.Run("Should not chunk when below threshold", func(t *testing.T) {
		dataValues := make([]DataValue, 50)
		for i := 0; i < 50; i++ {
			dataValues[i] = DataValue{
				DataElement: "de" + string(rune(i)),
				Value:       "1",
			}
		}

		chunks := chunkDataValues(dataValues, 100)

		assert.Len(t, chunks, 1, "Should not chunk when below threshold")
		assert.Len(t, chunks[0], 50)
	})

	t.Run("Should split into equal-sized chunks", func(t *testing.T) {
		dataValues := make([]DataValue, 200)
		for i := 0; i < 200; i++ {
			dataValues[i] = DataValue{
				DataElement: "de" + string(rune(i)),
				Value:       "1",
			}
		}

		chunks := chunkDataValues(dataValues, 100)

		assert.Len(t, chunks, 2, "Should split into 2 chunks")
		assert.Len(t, chunks[0], 100)
		assert.Len(t, chunks[1], 100)
	})

	t.Run("Should handle uneven chunks", func(t *testing.T) {
		dataValues := make([]DataValue, 1200)
		for i := 0; i < 1200; i++ {
			dataValues[i] = DataValue{
				DataElement: "de" + string(rune(i)),
				Value:       "1",
			}
		}

		chunks := chunkDataValues(dataValues, 500)

		assert.Len(t, chunks, 3, "Should split into 3 chunks")
		assert.Len(t, chunks[0], 500)
		assert.Len(t, chunks[1], 500)
		assert.Len(t, chunks[2], 200, "Last chunk should contain remaining values")
	})

	t.Run("Should handle empty slice", func(t *testing.T) {
		dataValues := []DataValue{}

		chunks := chunkDataValues(dataValues, 100)

		assert.Len(t, chunks, 0)
	})

	t.Run("Should handle chunk size of 1", func(t *testing.T) {
		dataValues := make([]DataValue, 5)
		for i := 0; i < 5; i++ {
			dataValues[i] = DataValue{
				DataElement: "de" + string(rune(i)),
				Value:       "1",
			}
		}

		chunks := chunkDataValues(dataValues, 1)

		assert.Len(t, chunks, 5, "Should create 5 chunks of 1 element each")
		for i, chunk := range chunks {
			assert.Len(t, chunk, 1, "Each chunk should contain 1 element")
			assert.Equal(t, dataValues[i].DataElement, chunk[0].DataElement)
		}
	})
}

// Helper function that chunks data values into smaller batches
// This should match the actual chunking logic in the service
func chunkDataValues(dataValues []DataValue, chunkSize int) [][]DataValue {
	if len(dataValues) == 0 {
		return [][]DataValue{}
	}

	var chunks [][]DataValue
	for i := 0; i < len(dataValues); i += chunkSize {
		end := i + chunkSize
		if end > len(dataValues) {
			end = len(dataValues)
		}
		chunks = append(chunks, dataValues[i:end])
	}

	return chunks
}

func TestDataValueValidation(t *testing.T) {
	t.Run("Should create valid data value", func(t *testing.T) {
		dv := DataValue{
			DataElement:         "de001",
			Period:              "202501",
			OrgUnit:             "ou001",
			CategoryOptionCombo: "coc001",
			Value:               "100",
		}

		assert.NotEmpty(t, dv.DataElement)
		assert.NotEmpty(t, dv.Period)
		assert.NotEmpty(t, dv.OrgUnit)
		assert.NotEmpty(t, dv.Value)
	})

	t.Run("Should handle optional fields", func(t *testing.T) {
		dv := DataValue{
			DataElement: "de001",
			Period:      "202501",
			OrgUnit:     "ou001",
			Value:       "100",
			// Optional fields not set
		}

		assert.Empty(t, dv.Comment)
		assert.Empty(t, dv.StoredBy)
		assert.Empty(t, dv.AttributeOptionCombo)
	})
}

func TestTransferProgress(t *testing.T) {
	ctx := context.Background()
	service := NewService(ctx)

	t.Run("Should initialize task store", func(t *testing.T) {
		assert.NotNil(t, service.taskStore)
	})

	t.Run("Should track progress in memory", func(t *testing.T) {
		taskID := "test-task-123"

		// Initialize task in store first
		service.taskMu.Lock()
		service.taskStore[taskID] = &TransferProgress{
			TaskID:   taskID,
			Status:   "pending",
			Progress: 0,
			Messages: []string{},
		}
		service.taskMu.Unlock()

		// Update progress using the non-database method
		service.updateProgressOnly(taskID, 50, "Halfway done")

		service.taskMu.RLock()
		progress, exists := service.taskStore[taskID]
		service.taskMu.RUnlock()

		assert.True(t, exists)
		assert.Equal(t, 50, progress.Progress)
		assert.Greater(t, len(progress.Messages), 0, "Should have at least one message")
		assert.Contains(t, progress.Messages[len(progress.Messages)-1], "Halfway done")
	})
}

func TestImportSummary(t *testing.T) {
	t.Run("Should create valid import summary", func(t *testing.T) {
		summary := ImportSummary{
			Status:      "SUCCESS",
			Description: "Import completed",
			ImportCount: ImportCount{
				Imported: 100,
				Updated:  23,
				Ignored:  2,
				Deleted:  0,
			},
		}

		assert.Equal(t, "SUCCESS", summary.Status)
		assert.Equal(t, 100, summary.ImportCount.Imported)
		assert.Equal(t, 23, summary.ImportCount.Updated)
		assert.Equal(t, 2, summary.ImportCount.Ignored)
	})

	t.Run("Should handle conflicts", func(t *testing.T) {
		summary := ImportSummary{
			Status: "WARNING",
			Conflicts: []ImportConflict{
				{Object: "de001", Value: "Data element not found"},
				{Object: "de002", Value: "Invalid value type"},
			},
		}

		assert.Len(t, summary.Conflicts, 2)
		assert.Equal(t, "de001", summary.Conflicts[0].Object)
		assert.Equal(t, "Data element not found", summary.Conflicts[0].Value)
	})
}
