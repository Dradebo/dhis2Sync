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
