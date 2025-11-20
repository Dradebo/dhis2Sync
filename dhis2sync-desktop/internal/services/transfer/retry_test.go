package transfer

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestRetryWithBackoff tests the retry logic with exponential backoff
func TestRetryWithBackoff(t *testing.T) {
	t.Run("Should succeed on first attempt", func(t *testing.T) {
		attemptCount := 0
		operation := func() error {
			attemptCount++
			return nil
		}

		err := retryWithBackoff("test-task", operation, 3, nil)

		assert.NoError(t, err)
		assert.Equal(t, 1, attemptCount, "Should only attempt once on success")
	})

	t.Run("Should retry up to maxAttempts times", func(t *testing.T) {
		attemptCount := 0
		operation := func() error {
			attemptCount++
			return errors.New("temporary error")
		}

		err := retryWithBackoff("test-task", operation, 3, nil)

		assert.Error(t, err)
		assert.Equal(t, 3, attemptCount, "Should attempt exactly 3 times")
		assert.Contains(t, err.Error(), "failed after 3 attempts")
	})

	t.Run("Should succeed on second attempt", func(t *testing.T) {
		attemptCount := 0
		operation := func() error {
			attemptCount++
			if attemptCount < 2 {
				return errors.New("temporary error")
			}
			return nil
		}

		err := retryWithBackoff("test-task", operation, 3, nil)

		assert.NoError(t, err)
		assert.Equal(t, 2, attemptCount, "Should succeed on second attempt")
	})

	t.Run("Should call taskLogger with progress messages", func(t *testing.T) {
		loggedMessages := []string{}
		attemptCount := 0

		operation := func() error {
			attemptCount++
			if attemptCount < 3 {
				return errors.New("temporary error")
			}
			return nil
		}

		taskLogger := func(taskID, msg string) {
			loggedMessages = append(loggedMessages, msg)
		}

		err := retryWithBackoff("test-task", operation, 3, taskLogger)

		assert.NoError(t, err)
		assert.Equal(t, 3, attemptCount)
		assert.Len(t, loggedMessages, 3, "Should log: 2 retry messages + 1 success message")
		assert.Contains(t, loggedMessages[0], "Attempt 1/3 failed")
		assert.Contains(t, loggedMessages[1], "Attempt 2/3 failed")
		assert.Contains(t, loggedMessages[2], "Operation succeeded on retry 3/3")
	})

	t.Run("Should apply exponential backoff delays", func(t *testing.T) {
		attemptCount := 0
		attemptTimes := []time.Time{}

		operation := func() error {
			attemptCount++
			attemptTimes = append(attemptTimes, time.Now())
			if attemptCount < 3 {
				return errors.New("temporary error")
			}
			return nil
		}

		startTime := time.Now()
		err := retryWithBackoff("test-task", operation, 3, nil)
		totalDuration := time.Since(startTime)

		assert.NoError(t, err)
		assert.Equal(t, 3, attemptCount)

		// First backoff: 500ms (500 * 1 * 1)
		// Second backoff: 2000ms (500 * 2 * 2)
		// Total minimum delay: 2500ms
		assert.GreaterOrEqual(t, totalDuration.Milliseconds(), int64(2500),
			"Total duration should be at least 2.5 seconds (500ms + 2000ms)")

		// Verify actual delays between attempts
		if len(attemptTimes) >= 2 {
			delay1 := attemptTimes[1].Sub(attemptTimes[0])
			assert.GreaterOrEqual(t, delay1.Milliseconds(), int64(500),
				"First retry should wait at least 500ms")
		}

		if len(attemptTimes) >= 3 {
			delay2 := attemptTimes[2].Sub(attemptTimes[1])
			assert.GreaterOrEqual(t, delay2.Milliseconds(), int64(2000),
				"Second retry should wait at least 2000ms")
		}
	})

	t.Run("Should log all attempts failed message", func(t *testing.T) {
		loggedMessages := []string{}
		attemptCount := 0

		operation := func() error {
			attemptCount++
			return errors.New("persistent error")
		}

		taskLogger := func(taskID, msg string) {
			loggedMessages = append(loggedMessages, msg)
		}

		err := retryWithBackoff("test-task", operation, 3, taskLogger)

		assert.Error(t, err)
		assert.Equal(t, 3, attemptCount)
		assert.Len(t, loggedMessages, 3, "Should log 3 retry attempt messages")

		lastMessage := loggedMessages[len(loggedMessages)-1]
		assert.Contains(t, lastMessage, "All 3 attempts failed")
	})

	t.Run("Should handle nil taskLogger gracefully", func(t *testing.T) {
		attemptCount := 0
		operation := func() error {
			attemptCount++
			if attemptCount < 2 {
				return errors.New("temporary error")
			}
			return nil
		}

		// Should not panic with nil taskLogger
		err := retryWithBackoff("test-task", operation, 3, nil)

		assert.NoError(t, err)
		assert.Equal(t, 2, attemptCount)
	})

	t.Run("Should return wrapped error with context", func(t *testing.T) {
		originalError := errors.New("network timeout")
		operation := func() error {
			return originalError
		}

		err := retryWithBackoff("test-task", operation, 3, nil)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed after 3 attempts")
		assert.ErrorIs(t, err, originalError, "Should wrap original error")
	})
}

// TestParseImportConflicts tests the conflict parsing function
func TestParseImportConflicts(t *testing.T) {
	t.Run("Should return empty string for nil summary", func(t *testing.T) {
		result := parseImportConflicts(nil)
		assert.Empty(t, result)
	})

	t.Run("Should return empty string for summary with no conflicts", func(t *testing.T) {
		summary := &ImportSummary{
			Status:      "SUCCESS",
			Description: "All imported",
			Conflicts:   []ImportConflict{},
		}

		result := parseImportConflicts(summary)
		assert.Empty(t, result)
	})

	t.Run("Should format single conflict correctly", func(t *testing.T) {
		summary := &ImportSummary{
			Status: "ERROR",
			Conflicts: []ImportConflict{
				{
					Object:    "DataValue",
					Value:     "Invalid value for data element XYZ",
					ErrorCode: "E1234",
				},
			},
		}

		result := parseImportConflicts(summary)

		assert.Contains(t, result, "Import conflicts (1 total)")
		assert.Contains(t, result, "DataValue")
		assert.Contains(t, result, "Invalid value for data element XYZ")
		assert.Contains(t, result, "E1234")
	})

	t.Run("Should format multiple conflicts correctly", func(t *testing.T) {
		summary := &ImportSummary{
			Status: "ERROR",
			Conflicts: []ImportConflict{
				{
					Object:    "DataValue",
					Value:     "Invalid value A",
					ErrorCode: "E1001",
				},
				{
					Object:    "OrgUnit",
					Value:     "OrgUnit not found",
					ErrorCode: "E2002",
				},
				{
					Object:    "Period",
					Value:     "Invalid period format",
					ErrorCode: "E3003",
				},
			},
		}

		result := parseImportConflicts(summary)

		assert.Contains(t, result, "Import conflicts (3 total)")
		assert.Contains(t, result, "DataValue")
		assert.Contains(t, result, "Invalid value A")
		assert.Contains(t, result, "E1001")
		assert.Contains(t, result, "OrgUnit")
		assert.Contains(t, result, "OrgUnit not found")
		assert.Contains(t, result, "E2002")
	})

	t.Run("Should limit output to first 10 conflicts", func(t *testing.T) {
		conflicts := []ImportConflict{}
		for i := 0; i < 15; i++ {
			conflicts = append(conflicts, ImportConflict{
				Object:    "DataValue",
				Value:     "Error " + string(rune(i)),
				ErrorCode: "E" + string(rune(1000+i)),
			})
		}

		summary := &ImportSummary{
			Status:    "ERROR",
			Conflicts: conflicts,
		}

		result := parseImportConflicts(summary)

		assert.Contains(t, result, "Import conflicts (15 total)")
		assert.Contains(t, result, "... and 5 more conflicts")
	})

	t.Run("Should format conflict details with proper indentation", func(t *testing.T) {
		summary := &ImportSummary{
			Status: "ERROR",
			Conflicts: []ImportConflict{
				{
					Object:    "DataValue",
					Value:     "Test error",
					ErrorCode: "E9999",
				},
			},
		}

		result := parseImportConflicts(summary)

		// Check for proper formatting with indentation
		assert.Contains(t, result, "  - DataValue: Test error (code: E9999)")
	})
}

// TestParseImportMessageCounts tests the message string parsing function
func TestParseImportMessageCounts(t *testing.T) {
	t.Run("Should parse standard DHIS2 success message", func(t *testing.T) {
		message := "Import complete with status SUCCESS, 0 created, 0 updated, 0 deleted, 328 ignored"

		counts, err := parseImportMessageCounts(message)

		assert.NoError(t, err)
		assert.NotNil(t, counts)
		assert.Equal(t, 0, counts.Imported, "Should parse created count")
		assert.Equal(t, 0, counts.Updated, "Should parse updated count")
		assert.Equal(t, 0, counts.Deleted, "Should parse deleted count")
		assert.Equal(t, 328, counts.Ignored, "Should parse ignored count")
	})

	t.Run("Should parse message with all non-zero counts", func(t *testing.T) {
		message := "Import complete with status SUCCESS, 100 created, 50 updated, 10 deleted, 25 ignored"

		counts, err := parseImportMessageCounts(message)

		assert.NoError(t, err)
		assert.Equal(t, 100, counts.Imported)
		assert.Equal(t, 50, counts.Updated)
		assert.Equal(t, 10, counts.Deleted)
		assert.Equal(t, 25, counts.Ignored)
	})

	t.Run("Should parse message with extra whitespace", func(t *testing.T) {
		message := "Import complete with status SUCCESS,  1234  created,  567  updated,  89  deleted,  0  ignored"

		counts, err := parseImportMessageCounts(message)

		assert.NoError(t, err)
		assert.Equal(t, 1234, counts.Imported)
		assert.Equal(t, 567, counts.Updated)
		assert.Equal(t, 89, counts.Deleted)
		assert.Equal(t, 0, counts.Ignored)
	})

	t.Run("Should return error for empty message", func(t *testing.T) {
		counts, err := parseImportMessageCounts("")

		assert.Error(t, err)
		assert.Nil(t, counts)
		assert.Contains(t, err.Error(), "empty message")
	})

	t.Run("Should return error for malformed message", func(t *testing.T) {
		message := "Some random text without counts"

		counts, err := parseImportMessageCounts(message)

		assert.Error(t, err)
		assert.Nil(t, counts)
		assert.Contains(t, err.Error(), "could not parse import counts")
	})

	t.Run("Should return error for partially matching message", func(t *testing.T) {
		message := "Import complete with 100 created, 50 updated"

		counts, err := parseImportMessageCounts(message)

		assert.Error(t, err)
		assert.Nil(t, counts)
	})

	t.Run("Should parse message with large numbers", func(t *testing.T) {
		message := "Import complete with status SUCCESS, 99999 created, 88888 updated, 7777 deleted, 66666 ignored"

		counts, err := parseImportMessageCounts(message)

		assert.NoError(t, err)
		assert.Equal(t, 99999, counts.Imported)
		assert.Equal(t, 88888, counts.Updated)
		assert.Equal(t, 7777, counts.Deleted)
		assert.Equal(t, 66666, counts.Ignored)
	})

	t.Run("Should parse actual DHIS2 API response format", func(t *testing.T) {
		// This is the exact format from the user's debug logs
		message := "Import complete with status SUCCESS, 0 created, 0 updated, 0 deleted, 328 ignored"

		counts, err := parseImportMessageCounts(message)

		assert.NoError(t, err)
		assert.NotNil(t, counts)
		// All values ignored means data already exists - this is SUCCESS
		assert.Equal(t, 0, counts.Imported)
		assert.Equal(t, 0, counts.Updated)
		assert.Equal(t, 0, counts.Deleted)
		assert.Equal(t, 328, counts.Ignored)
	})
}
