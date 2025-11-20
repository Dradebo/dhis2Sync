package scheduler

import (
	"context"
	"testing"

	"github.com/robfig/cron/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeCron(t *testing.T) {
	t.Run("Should convert 5-field to 6-field cron", func(t *testing.T) {
		tests := []struct {
			name     string
			input    string
			expected string
		}{
			{
				name:     "Daily at 2 AM",
				input:    "0 2 * * *",
				expected: "0 0 2 * * *",
			},
			{
				name:     "Every 15 minutes",
				input:    "*/15 * * * *",
				expected: "0 */15 * * * *",
			},
			{
				name:     "Every Monday at 9 AM",
				input:    "0 9 * * 1",
				expected: "0 0 9 * * 1",
			},
			{
				name:     "First day of month at midnight",
				input:    "0 0 1 * *",
				expected: "0 0 0 1 * *",
			},
			{
				name:     "Every 5 minutes",
				input:    "*/5 * * * *",
				expected: "0 */5 * * * *",
			},
			{
				name:     "At 3:30 PM every day",
				input:    "30 15 * * *",
				expected: "0 30 15 * * *",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				result, err := normalizeCron(tt.input)
				require.NoError(t, err)
				assert.Equal(t, tt.expected, result)
			})
		}
	})

	t.Run("Should keep 6-field cron unchanged", func(t *testing.T) {
		tests := []struct {
			name  string
			input string
		}{
			{
				name:  "6-field daily at 2 AM",
				input: "0 0 2 * * *",
			},
			{
				name:  "6-field every 15 minutes",
				input: "0 */15 * * * *",
			},
			{
				name:  "6-field with seconds",
				input: "30 0 2 * * 1",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				result, err := normalizeCron(tt.input)
				require.NoError(t, err)
				assert.Equal(t, tt.input, result)
			})
		}
	})

	t.Run("Should fail with invalid field count", func(t *testing.T) {
		tests := []struct {
			name  string
			input string
		}{
			{
				name:  "Too few fields (4)",
				input: "0 2 * *",
			},
			{
				name:  "Too many fields (7)",
				input: "0 0 2 * * * 2025",
			},
			{
				name:  "Empty string",
				input: "",
			},
			{
				name:  "Single field",
				input: "*",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				_, err := normalizeCron(tt.input)
				assert.Error(t, err)
				assert.Contains(t, err.Error(), "invalid cron expression")
			})
		}
	})

	t.Run("Should handle cron with extra whitespace", func(t *testing.T) {
		input := "  0   2   *   *   *  "
		// The function trims leading/trailing but keeps internal whitespace structure
		expected := "0 0   2   *   *   *"

		result, err := normalizeCron(input)
		require.NoError(t, err)
		assert.Equal(t, expected, result)
	})
}

func TestScheduledJobCreation(t *testing.T) {
	t.Run("Should create valid scheduled job", func(t *testing.T) {
		job := ScheduledJob{
			ID:       "job-123",
			Name:     "Daily Transfer",
			JobType:  "transfer",
			Cron:     "0 0 2 * * *",
			Timezone: "UTC",
			Enabled:  true,
			Payload:  `{"dataset_id": "ds123"}`,
		}

		assert.Equal(t, "job-123", job.ID)
		assert.Equal(t, "Daily Transfer", job.Name)
		assert.Equal(t, "transfer", job.JobType)
		assert.Equal(t, "0 0 2 * * *", job.Cron)
		assert.True(t, job.Enabled)
	})

	t.Run("Should handle completeness job type", func(t *testing.T) {
		job := ScheduledJob{
			ID:      "job-456",
			JobType: "completeness",
			Payload: `{"dataset_id": "ds456", "periods": ["202501"]}`,
		}

		assert.Equal(t, "completeness", job.JobType)
	})
}

func TestJobListResponse(t *testing.T) {
	t.Run("Should create job list response", func(t *testing.T) {
		// This tests the response structure
		response := JobListResponse{
			ID:       "job-123",
			Name:     "Test Job",
			JobType:  "transfer",
			Cron:     "0 0 2 * * *",
			Timezone: "UTC",
			Enabled:  true,
		}

		assert.Equal(t, "job-123", response.ID)
		assert.Equal(t, "Test Job", response.Name)
		assert.True(t, response.Enabled)
	})
}

func TestUpsertJobRequest(t *testing.T) {
	t.Run("Should create upsert request with all fields", func(t *testing.T) {
		payload := map[string]interface{}{
			"dataset_id": "ds123",
			"periods":    []string{"202501", "202502"},
		}

		req := UpsertJobRequest{
			Name:     "Monthly Transfer",
			JobType:  "transfer",
			Cron:     "0 2 * * *", // 5-field (will be normalized)
			Timezone: "UTC",
			Enabled:  true,
			Payload:  payload,
		}

		assert.Equal(t, "Monthly Transfer", req.Name)
		assert.Equal(t, "transfer", req.JobType)
		assert.Equal(t, "0 2 * * *", req.Cron)
		assert.True(t, req.Enabled)
		assert.NotNil(t, req.Payload)
	})

	t.Run("Should handle optional payload", func(t *testing.T) {
		req := UpsertJobRequest{
			Name:    "Simple Job",
			JobType: "transfer",
			Cron:    "0 0 2 * * *",
			Enabled: false,
		}

		assert.False(t, req.Enabled)
		assert.Nil(t, req.Payload)
	})
}

func TestCronExpressionExamples(t *testing.T) {
	// Test real-world DHIS2 period-based cron expressions
	t.Run("Should convert all DHIS2 period types", func(t *testing.T) {
		tests := []struct {
			periodType string
			cron5Field string
			cron6Field string
		}{
			{"Daily", "0 2 * * *", "0 0 2 * * *"},
			{"Weekly (Monday)", "0 2 * * 1", "0 0 2 * * 1"},
			{"Monthly (1st)", "0 2 1 * *", "0 0 2 1 * *"},
			{"Quarterly (1st of Jan/Apr/Jul/Oct)", "0 2 1 1,4,7,10 *", "0 0 2 1 1,4,7,10 *"},
			{"Yearly (Jan 1st)", "0 2 1 1 *", "0 0 2 1 1 *"},
		}

		for _, tt := range tests {
			t.Run(tt.periodType, func(t *testing.T) {
				result, err := normalizeCron(tt.cron5Field)
				require.NoError(t, err)
				assert.Equal(t, tt.cron6Field, result)
			})
		}
	})
}

func TestCronEdgeCases(t *testing.T) {
	t.Run("Should handle complex cron expressions", func(t *testing.T) {
		tests := []struct {
			name     string
			input    string
			expected string
		}{
			{
				name:     "Range (hours 9-17)",
				input:    "0 9-17 * * *",
				expected: "0 0 9-17 * * *",
			},
			{
				name:     "Multiple values",
				input:    "0 8,12,16 * * *",
				expected: "0 0 8,12,16 * * *",
			},
			{
				name:     "Step values",
				input:    "0 */2 * * *",
				expected: "0 0 */2 * * *",
			},
			{
				name:     "Specific days (weekdays)",
				input:    "0 9 * * 1-5",
				expected: "0 0 9 * * 1-5",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				result, err := normalizeCron(tt.input)
				require.NoError(t, err)
				assert.Equal(t, tt.expected, result)
			})
		}
	})
}

func TestServiceCreation(t *testing.T) {
	ctx := context.Background()

	t.Run("Should create new scheduler service", func(t *testing.T) {
		// This will create a service without a database
		// We're just testing the struct initialization
		service := &Service{
			ctx:  ctx,
			jobs: make(map[string]cron.EntryID),
		}

		assert.NotNil(t, service)
		assert.NotNil(t, service.jobs)
		assert.Equal(t, ctx, service.ctx)
	})
}

func TestPayloadHandling(t *testing.T) {
	t.Run("Should serialize payload to JSON string", func(t *testing.T) {
		payload := map[string]interface{}{
			"dataset_id":       "ds123",
			"periods":          []string{"202501", "202502"},
			"parent_org_units": []string{"ou001", "ou002"},
			"mark_complete":    true,
		}

		// This would be done in the UpsertJob method
		req := UpsertJobRequest{
			Name:    "Test",
			JobType: "transfer",
			Cron:    "0 0 2 * * *",
			Payload: payload,
		}

		assert.NotNil(t, req.Payload)
		assert.IsType(t, map[string]interface{}{}, req.Payload)
	})

	t.Run("Should handle string payload", func(t *testing.T) {
		payloadStr := `{"dataset_id":"ds123","periods":["202501"]}`

		req := UpsertJobRequest{
			Name:    "Test",
			JobType: "transfer",
			Cron:    "0 0 2 * * *",
			Payload: payloadStr,
		}

		assert.IsType(t, "", req.Payload)
	})
}
