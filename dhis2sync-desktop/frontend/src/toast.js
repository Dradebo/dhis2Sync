/**
 * Toast Notification System
 *
 * Replaces intrusive alert() dialogs with non-blocking toast notifications.
 * Supports success, warning, error, and info variants with auto-dismiss and action buttons.
 */

/**
 * ToastManager - Manages toast notifications
 */
export class ToastManager {
    constructor() {
        this.toasts = [];
        this.container = null;
        this.maxToasts = 5;
        this.defaultDuration = 5000; // 5 seconds
        this.init();
    }

    /**
     * Initialize toast container
     */
    init() {
        // Create toast container
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.className = 'toast-container position-fixed top-0 end-0 p-3';
        this.container.style.zIndex = '9999';
        document.body.appendChild(this.container);
    }

    /**
     * Show a toast notification
     *
     * @param {string} message - Toast message
     * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
     * @param {Object} options - Additional options
     * @param {number} options.duration - Auto-dismiss duration in ms (0 = no auto-dismiss)
     * @param {Array} options.actions - Action buttons [{label, onClick}]
     * @param {string} options.icon - Bootstrap icon class (overrides default)
     */
    show(message, type = 'info', options = {}) {
        const duration = options.duration !== undefined ? options.duration : this.defaultDuration;
        const actions = options.actions || [];

        // Create toast element
        const toast = this.createToast(message, type, options.icon, actions);

        // Add to container
        this.container.appendChild(toast);
        this.toasts.push(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Auto-dismiss if duration > 0
        if (duration > 0) {
            setTimeout(() => this.hide(toast), duration);
        }

        // Remove excess toasts
        if (this.toasts.length > this.maxToasts) {
            const oldestToast = this.toasts.shift();
            this.hide(oldestToast);
        }

        return toast;
    }

    /**
     * Create toast DOM element
     */
    createToast(message, type, customIcon, actions) {
        const toast = document.createElement('div');
        toast.className = 'toast align-items-center border-0';
        toast.setAttribute('role', 'alert');

        // Type-specific styling
        const typeConfig = {
            success: { bg: 'bg-success', icon: 'bi-check-circle-fill', text: 'text-white' },
            error: { bg: 'bg-danger', icon: 'bi-exclamation-triangle-fill', text: 'text-white' },
            warning: { bg: 'bg-warning', icon: 'bi-exclamation-circle-fill', text: 'text-dark' },
            info: { bg: 'bg-primary', icon: 'bi-info-circle-fill', text: 'text-white' }
        };

        const config = typeConfig[type] || typeConfig.info;
        const icon = customIcon || config.icon;

        toast.classList.add(config.bg, config.text);

        let html = `
            <div class="d-flex">
                <div class="toast-body d-flex align-items-start">
                    <i class="bi ${icon} me-2 mt-1"></i>
                    <div class="flex-grow-1">${message}</div>
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        `;

        // Add action buttons if provided
        if (actions.length > 0) {
            const buttonHtml = actions.map(action => `
                <button type="button" class="btn btn-sm btn-${config.text === 'text-white' ? 'light' : 'dark'} toast-action-btn">
                    ${action.label}
                </button>
            `).join('');

            html = `
                <div class="d-flex flex-column">
                    <div class="d-flex">
                        <div class="toast-body d-flex align-items-start flex-grow-1">
                            <i class="bi ${icon} me-2 mt-1"></i>
                            <div class="flex-grow-1">${message}</div>
                        </div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                    </div>
                    <div class="toast-body pt-0 d-flex gap-2">
                        ${buttonHtml}
                    </div>
                </div>
            `;
        }

        toast.innerHTML = html;

        // Attach action button handlers
        if (actions.length > 0) {
            const actionButtons = toast.querySelectorAll('.toast-action-btn');
            actionButtons.forEach((btn, index) => {
                btn.addEventListener('click', () => {
                    if (actions[index].onClick) {
                        actions[index].onClick();
                    }
                    this.hide(toast);
                });
            });
        }

        // Attach close button handler
        const closeBtn = toast.querySelector('[data-bs-dismiss="toast"]');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide(toast));
        }

        return toast;
    }

    /**
     * Hide a toast
     */
    hide(toast) {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            const index = this.toasts.indexOf(toast);
            if (index > -1) {
                this.toasts.splice(index, 1);
            }
        }, 300); // Match CSS transition duration
    }

    /**
     * Convenience methods for different toast types
     */
    success(message, options = {}) {
        return this.show(message, 'success', options);
    }

    error(message, options = {}) {
        return this.show(message, 'error', options);
    }

    warning(message, options = {}) {
        return this.show(message, 'warning', options);
    }

    info(message, options = {}) {
        return this.show(message, 'info', options);
    }

    /**
     * Clear all toasts
     */
    clear() {
        this.toasts.forEach(toast => this.hide(toast));
    }
}

// Export singleton instance
export const toast = new ToastManager();

// Add toast CSS styles
const style = document.createElement('style');
style.textContent = `
    .toast {
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease-in-out;
    }

    .toast.show {
        opacity: 1;
        transform: translateX(0);
    }

    .toast-container {
        max-width: 400px;
    }

    .toast-body {
        word-break: break-word;
    }

    .btn-close-white {
        filter: brightness(0) invert(1);
    }
`;
document.head.appendChild(style);
