/**
 * UI Component Utilities
 * Reusable HTML generators for common DHIS2 Sync patterns
 */

/**
 * Render a loading spinner with optional message
 * @param {string} message - Loading message to display
 * @returns {string} HTML string
 */
export function renderLoading(message = 'Loading...') {
    return `
        <div class="text-center py-4">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <div class="mt-2">${escapeHtml(message)}</div>
        </div>
    `;
}

/**
 * Render an alert box
 * @param {string} type - Alert type (info, success, warning, danger)
 * @param {string} message - Alert message
 * @param {boolean} showIcon - Whether to show an icon
 * @returns {string} HTML string
 */
export function renderAlert(type, message, showIcon = true) {
    const icons = {
        info: 'bi-info-circle',
        success: 'bi-check-circle',
        warning: 'bi-exclamation-triangle',
        danger: 'bi-exclamation-triangle'
    };

    const icon = showIcon ? `<i class="bi ${icons[type] || icons.info} me-2"></i>` : '';

    return `
        <div class="alert alert-${type}" role="alert">
            ${icon}${escapeHtml(message)}
        </div>
    `;
}

/**
 * Render a card component
 * @param {string} title - Card title
 * @param {string} content - Card content (HTML)
 * @param {string} headerActions - Optional header action buttons (HTML)
 * @returns {string} HTML string
 */
export function renderCard(title, content, headerActions = null) {
    return `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h6 class="mb-0">${escapeHtml(title)}</h6>
                ${headerActions || ''}
            </div>
            <div class="card-body">
                ${content}
            </div>
        </div>
    `;
}

/**
 * Render a table component
 * @param {Array<string>} columns - Column headers
 * @param {Array<Array<string>>} rows - Table rows (each row is array of cell values)
 * @param {Object} options - Table options
 * @returns {string} HTML string
 */
export function renderTable(columns, rows, options = {}) {
    const {
        responsive = true,
        striped = true,
        hover = true,
        small = false
    } = options;

    const tableClasses = [
        'table',
        striped && 'table-striped',
        hover && 'table-hover',
        small && 'table-sm'
    ].filter(Boolean).join(' ');

    const headerHtml = columns.map(col => `<th>${escapeHtml(col)}</th>`).join('');
    const rowsHtml = rows.map(row => `
        <tr>
            ${row.map(cell => `<td>${cell}</td>`).join('')}
        </tr>
    `).join('');

    const tableHtml = `
        <table class="${tableClasses}">
            <thead>
                <tr>${headerHtml}</tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;

    return responsive ? `<div class="table-responsive">${tableHtml}</div>` : tableHtml;
}

/**
 * Render a progress bar
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} message - Progress message
 * @param {string} variant - Bootstrap variant (primary, success, info, warning, danger)
 * @returns {string} HTML string
 */
export function renderProgressBar(percent, message = '', variant = 'primary') {
    const clampedPercent = Math.max(0, Math.min(100, percent));

    return `
        <div class="mb-3">
            ${message ? `<div class="mb-2"><small>${escapeHtml(message)}</small></div>` : ''}
            <div class="progress">
                <div class="progress-bar bg-${variant}" role="progressbar"
                     style="width: ${clampedPercent}%"
                     aria-valuenow="${clampedPercent}"
                     aria-valuemin="0"
                     aria-valuemax="100">
                    ${clampedPercent}%
                </div>
            </div>
        </div>
    `;
}

/**
 * Render period selection badges
 * @param {Array<{id: string, name: string}>} periods - Selected periods
 * @param {Function} onRemove - Callback when remove button clicked
 * @returns {string} HTML string
 */
export function renderPeriodBadges(periods, onRemove) {
    if (!periods || periods.length === 0) {
        return '<small class="text-muted">No periods selected</small>';
    }

    return periods.map((period, index) => `
        <span class="period-badge">
            ${escapeHtml(period.name)}
            <button type="button" class="btn-close"
                    onclick="window.removePeriod && window.removePeriod(${index})"
                    aria-label="Remove ${escapeHtml(period.name)}"></button>
        </span>
    `).join('');
}

/**
 * Render an empty state message
 * @param {string} icon - Bootstrap icon class
 * @param {string} title - Empty state title
 * @param {string} message - Empty state message
 * @param {string} actionButton - Optional action button HTML
 * @returns {string} HTML string
 */
export function renderEmptyState(icon, title, message, actionButton = '') {
    return `
        <div class="text-center py-5 text-muted">
            <i class="bi ${icon} fs-1 mb-3"></i>
            <h6>${escapeHtml(title)}</h6>
            <p>${escapeHtml(message)}</p>
            ${actionButton}
        </div>
    `;
}

/**
 * Render a multi-step progress indicator
 * @param {Array<{label: string, description?: string, status?: 'complete' | 'active' | 'pending' | 'disabled'}>} steps
 * @returns {string} HTML string
 */
export function renderStepper(steps = []) {
    if (!steps.length) return '';

    const items = steps.map((step, index) => {
        const status = step.status || 'pending';
        const label = step.label || `Step ${index + 1}`;
        const description = step.description ? `<div class="stepper-description">${escapeHtml(step.description)}</div>` : '';
        const stepIdAttr = step.id ? ` data-step="${escapeHtml(step.id)}"` : '';

        let indexContent = `${index + 1}`;
        if (status === 'complete') {
            indexContent = '<i class="bi bi-check-lg"></i>';
        }

        return `
            <li class="stepper-step ${status}"${stepIdAttr}>
                <div class="stepper-index">${indexContent}</div>
                <div class="stepper-copy">
                    <div class="stepper-label">${escapeHtml(label)}</div>
                    ${description}
                </div>
            </li>
        `;
    }).join('');

    return `<ol class="stepper">${items}</ol>`;
}

/**
 * Render a section state card that highlights status + actions
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {string} [options.status] - success|warning|info|danger|neutral
 * @param {string} [options.body] - HTML content for the body
 * @param {string} [options.actions] - HTML for the actions footer
 * @returns {string} HTML string
 */
export function renderSectionState({
    title,
    subtitle = '',
    status = 'info',
    body = '',
    actions = ''
} = {}) {
    const statusConfig = {
        success: { icon: 'bi-check-circle', label: 'Ready' },
        warning: { icon: 'bi-exclamation-triangle', label: 'Needs attention' },
        danger: { icon: 'bi-x-circle', label: 'Blocked' },
        info: { icon: 'bi-info-circle', label: 'In progress' },
        neutral: { icon: 'bi-dot', label: '' }
    };

    const cfg = statusConfig[status] || statusConfig.info;
    const subtitleHtml = subtitle ? `<div class="section-state-subtitle">${escapeHtml(subtitle)}</div>` : '';
    const actionsHtml = actions ? `<div class="section-state-actions">${actions}</div>` : '';

    return `
        <div class="section-state">
            <div class="section-state-header">
                <div>
                    <div class="section-state-title">${escapeHtml(title)}</div>
                    ${subtitleHtml}
                </div>
                <span class="status-pill status-${status}">
                    <i class="bi ${cfg.icon} me-1"></i>${cfg.label}
                </span>
            </div>
            ${body ? `<div class="section-state-body">${body}</div>` : ''}
            ${actionsHtml}
        </div>
    `;
}

/**
 * Render a compact progress panel with percentage + log stream
 * @param {Object} options
 * @param {string} [options.title]
 * @param {number} [options.percent]
 * @param {string} [options.status]
 * @param {string} [options.message]
 * @param {Array<string>} [options.logs]
 * @returns {string} HTML string
 */
export function renderProgressPanel({
    title = 'Progress',
    percent = 0,
    status = 'running',
    message = '',
    logs = []
} = {}) {
    const clamped = Math.max(0, Math.min(100, percent));
    const badgeClass = {
        completed: 'bg-success',
        error: 'bg-danger',
        failed: 'bg-danger',
        running: 'bg-primary',
        pending: 'bg-secondary'
    }[status] || 'bg-primary';

    const logHtml = (logs || []).slice(-6).map(entry => `
        <div class="progress-log-entry">
            <span class="progress-log-dot"></span>
            <span>${escapeHtml(entry)}</span>
        </div>
    `).join('');

    return `
        <div class="progress-panel">
            <div class="progress-panel-header">
                <div class="fw-semibold">${escapeHtml(title)}</div>
                <span class="badge ${badgeClass}">${escapeHtml(status)}</span>
            </div>
            <div class="progress mb-2">
                <div class="progress-bar ${badgeClass}" role="progressbar"
                     style="width: ${clamped}%"
                     aria-valuenow="${clamped}" aria-valuemin="0" aria-valuemax="100">
                    ${clamped}%
                </div>
            </div>
            ${message ? `<div class="small text-muted mb-2">${escapeHtml(message)}</div>` : ''}
            ${logHtml ? `<div class="progress-log">${logHtml}</div>` : ''}
        </div>
    `;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

export { escapeHtml };
