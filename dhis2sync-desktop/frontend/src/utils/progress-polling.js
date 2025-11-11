/**
 * Polling-based Progress Tracker
 * Compatible with Go backend that returns progress via polling methods
 * (GetTransferProgress, GetCompletenessAssessmentProgress, etc.)
 */

/**
 * ProgressTracker Class
 * Manages polling for long-running background tasks
 */
export class ProgressTracker {
    constructor(taskId, pollMethod, onUpdate, onComplete, onError, options = {}) {
        this.taskId = taskId;
        this.pollMethod = pollMethod; // Wails method like App.GetTransferProgress
        this.onUpdate = onUpdate;
        this.onComplete = onComplete;
        this.onError = onError;

        this.options = {
            intervalMs: 2000,
            maxAttempts: 300, // 10 minutes at 2s intervals
            ...options
        };

        this.intervalId = null;
        this.attempts = 0;
        this.stopped = false;
    }

    /**
     * Start polling for progress
     */
    start() {
        if (this.intervalId) {
            console.warn('Progress tracker already running');
            return;
        }

        console.log(`Starting progress tracker for task: ${this.taskId}`);

        // Immediate first poll
        this.poll();

        // Set up interval
        this.intervalId = setInterval(() => this.poll(), this.options.intervalMs);
    }

    /**
     * Poll for current progress
     */
    async poll() {
        if (this.stopped) {
            return;
        }

        this.attempts++;

        // Check max attempts
        if (this.attempts > this.options.maxAttempts) {
            console.error(`Max polling attempts (${this.options.maxAttempts}) exceeded for task: ${this.taskId}`);
            this.stop();
            if (this.onError) {
                this.onError({
                    status: 'error',
                    message: 'Task timed out - exceeded maximum polling attempts'
                });
            }
            return;
        }

        try {
            const progress = await this.pollMethod(this.taskId);

            if (!progress) {
                throw new Error('No progress data returned');
            }

            const status = (progress.status || '').toLowerCase();

            if (status === 'completed' || status === 'success') {
                console.log(`Task ${this.taskId} completed successfully`);
                this.stop();
                if (this.onComplete) {
                    this.onComplete(progress);
                }
            } else if (status === 'failed' || status === 'error') {
                console.error(`Task ${this.taskId} failed:`, progress.message || progress.error);
                this.stop();
                if (this.onError) {
                    this.onError(progress);
                }
            } else if (status === 'running' || status === 'in_progress' || status === 'pending') {
                // Task still running, update UI
                if (this.onUpdate) {
                    this.onUpdate(progress);
                }
            } else {
                console.warn(`Unknown task status: ${status}`);
                if (this.onUpdate) {
                    this.onUpdate(progress);
                }
            }
        } catch (error) {
            console.error(`Error polling task ${this.taskId}:`, error);
            this.stop();
            if (this.onError) {
                this.onError({
                    status: 'error',
                    message: error.message || 'Failed to poll task progress'
                });
            }
        }
    }

    /**
     * Stop polling
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.stopped = true;
        console.log(`Stopped progress tracker for task: ${this.taskId}`);
    }

    /**
     * Check if tracker is running
     */
    isRunning() {
        return this.intervalId !== null && !this.stopped;
    }
}

/**
 * Create and start a progress tracker
 * @param {string} taskId - Task identifier
 * @param {Function} pollMethod - Wails method to poll progress
 * @param {Object} callbacks - Callbacks object {onUpdate, onComplete, onError}
 * @param {Object} options - Options {intervalMs, maxAttempts}
 * @returns {ProgressTracker} Tracker instance
 */
export function trackProgress(taskId, pollMethod, callbacks, options) {
    const tracker = new ProgressTracker(
        taskId,
        pollMethod,
        callbacks.onUpdate,
        callbacks.onComplete,
        callbacks.onError,
        options
    );

    tracker.start();
    return tracker;
}
