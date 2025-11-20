/**
 * Progress Tracker Utility
 *
 * Replaces polling-based progress tracking with real-time event-based updates using Wails EventsOn.
 * This provides instant feedback with zero network overhead compared to the old 500ms polling approach.
 */

import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime';

/**
 * ProgressTracker - Manages real-time progress tracking for background tasks
 *
 * Event names used by backend:
 * - "transfer:{taskID}"   - Data transfer operations
 * - "tracker:{taskID}"    - Tracker event transfers
 * - "assessment:{taskID}" - Completeness assessments
 * - "metadata:{taskID}"   - Metadata comparisons
 * - "bulk-action:{taskID}"- Bulk completeness actions
 */
export class ProgressTracker {
    constructor() {
        this.activeTrackers = new Map(); // taskID -> { eventName, callback, cleanup }
    }

    /**
     * Start tracking a task with real-time event updates
     *
     * @param {string} taskID - Unique task identifier
     * @param {string} taskType - Type of task: 'transfer', 'tracker', 'assessment', 'metadata', or 'bulk-action'
     * @param {Object} options - Configuration options
     * @param {Function} options.onProgress - Callback(progressData) called on each update
     * @param {Function} options.onComplete - Callback(result) called when task completes
     * @param {Function} options.onError - Callback(error) called on task error
     * @param {HTMLElement} options.progressContainer - Optional DOM element to update with progress bar
     * @param {HTMLElement} options.messageContainer - Optional DOM element to update with messages
     */
    track(taskID, taskType, options = {}) {
        // Stop any existing tracker for this task
        this.stop(taskID);

        const eventName = `${taskType}:${taskID}`;

        // Event handler
        const handleProgress = (data) => {
            console.log(`[ProgressTracker] ${eventName}:`, data);

            // Update progress bar if container provided
            if (options.progressContainer) {
                this.updateProgressBar(options.progressContainer, data);
            }

            // Update messages if container provided
            if (options.messageContainer) {
                this.updateMessages(options.messageContainer, data);
            }

            // Call user callback
            if (options.onProgress) {
                options.onProgress(data);
            }

            // Handle completion
            if (data.status === 'completed') {
                if (options.onComplete) {
                    options.onComplete(data);
                }
                this.stop(taskID);
            }

            // Handle errors
            if (data.status === 'error') {
                if (options.onError) {
                    options.onError(data);
                }
                this.stop(taskID);
            }
        };

        // Register event listener
        EventsOn(eventName, handleProgress);

        // Store tracker info for cleanup
        this.activeTrackers.set(taskID, {
            eventName,
            callback: handleProgress,
            cleanup: () => EventsOff(eventName)
        });

        console.log(`[ProgressTracker] Started tracking ${eventName}`);
    }

    /**
     * Stop tracking a task and clean up event listeners
     *
     * @param {string} taskID - Task identifier to stop tracking
     */
    stop(taskID) {
        const tracker = this.activeTrackers.get(taskID);
        if (tracker) {
            tracker.cleanup();
            this.activeTrackers.delete(taskID);
            console.log(`[ProgressTracker] Stopped tracking ${tracker.eventName}`);
        }
    }

    /**
     * Stop all active trackers
     */
    stopAll() {
        for (const [taskID] of this.activeTrackers) {
            this.stop(taskID);
        }
        console.log('[ProgressTracker] Stopped all trackers');
    }

    /**
     * Update progress bar UI
     *
     * @param {HTMLElement} container - Container element
     * @param {Object} data - Progress data from backend
     */
    updateProgressBar(container, data) {
        const progress = data.progress || 0;
        const status = data.status || 'running';

        const statusClass = {
            'completed': 'bg-success',
            'error': 'bg-danger',
            'running': 'bg-primary',
            'pending': 'bg-secondary'
        }[status] || 'bg-primary';

        const statusBadge = `<span class="badge ${statusClass}">${status}</span>`;

        container.innerHTML = `
            <div class="mb-2">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span>Status: ${statusBadge}</span>
                    <span class="text-muted">${progress}%</span>
                </div>
                <div class="progress">
                    <div class="progress-bar ${statusClass}"
                         role="progressbar"
                         style="width: ${progress}%; transition: width 0.3s ease;"
                         aria-valuenow="${progress}"
                         aria-valuemin="0"
                         aria-valuemax="100">
                        ${progress}%
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Update messages UI
     *
     * @param {HTMLElement} container - Container element
     * @param {Object} data - Progress data from backend
     */
    updateMessages(container, data) {
        const message = data.message || '';

        if (!message) return;

        // Create new message element
        const entry = document.createElement('div');
        entry.className = 'progress-log-entry';

        const dot = document.createElement('span');
        dot.className = 'progress-log-dot';

        const copy = document.createElement('span');
        copy.textContent = message;

        entry.appendChild(dot);
        entry.appendChild(copy);

        // Add to container
        container.appendChild(entry);

        // Keep only last 8 messages
        const messages = container.querySelectorAll('.progress-log-entry');
        if (messages.length > 8) {
            messages[0].remove();
        }

        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    /**
     * Create a default progress UI container
     *
     * @returns {Object} - Object with progressContainer and messageContainer elements
     */
    createDefaultUI() {
        const wrapper = document.createElement('div');
        wrapper.className = 'progress-tracker-ui progress-panel';

        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-tracker-bar';

        const messageContainer = document.createElement('div');
        messageContainer.className = 'progress-tracker-messages progress-log';
        messageContainer.style.maxHeight = '200px';
        messageContainer.style.overflowY = 'auto';

        wrapper.appendChild(progressContainer);
        wrapper.appendChild(messageContainer);

        return {
            wrapper,
            progressContainer,
            messageContainer
        };
    }
}

// Export singleton instance
export const progressTracker = new ProgressTracker();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    progressTracker.stopAll();
});
