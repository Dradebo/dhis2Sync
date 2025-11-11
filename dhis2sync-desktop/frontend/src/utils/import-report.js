/**
 * DHIS2 Import Report Renderer
 * Renders import reports from Transfer, Metadata, and Tracker operations
 */

import { escapeHtml } from '../components/index.js';

/**
 * Render a DHIS2 import report
 * @param {Object} report - Import report object from DHIS2 API
 * @param {Object} options - Rendering options
 * @returns {string} HTML string
 */
export function renderImportReport(report, options = {}) {
    if (!report) {
        return '<p class="text-muted">No import report available</p>';
    }

    const {
        showDetails = true,
        showValidation = true,
        compact = false
    } = options;

    const status = report.status || 'UNKNOWN';
    const stats = report.stats || {};
    const isSuccess = status === 'OK' || status === 'SUCCESS';

    const statusClass = isSuccess ? 'bg-success' : 'bg-warning';
    const statusText = isSuccess ? 'Success' : status;

    let html = `
        <div class="card">
            <div class="card-header ${statusClass} text-white">
                <h6 class="mb-0">
                    <i class="bi bi-check-circle me-2"></i>
                    Import Report: ${escapeHtml(statusText)}
                </h6>
            </div>
            <div class="card-body">
    `;

    // Statistics row
    html += renderImportStats(stats, compact);

    // Type-specific reports
    if (showDetails && report.typeReports && report.typeReports.length > 0) {
        html += '<hr>';
        html += renderTypeReports(report.typeReports, compact);
    }

    // Validation report
    if (showValidation && report.validationReport) {
        html += '<hr>';
        html += renderValidationReport(report.validationReport);
    }

    // Import summary message
    if (report.message) {
        html += `<div class="alert alert-info mt-3 mb-0"><small>${escapeHtml(report.message)}</small></div>`;
    }

    html += `
            </div>
        </div>
    `;

    return html;
}

/**
 * Render import statistics
 */
function renderImportStats(stats, compact) {
    const items = [
        { label: 'Created', value: stats.created || 0, variant: 'success' },
        { label: 'Updated', value: stats.updated || 0, variant: 'primary' },
        { label: 'Ignored', value: stats.ignored || 0, variant: 'secondary' },
        { label: 'Deleted', value: stats.deleted || 0, variant: 'danger' }
    ];

    if (compact) {
        return `
            <div class="d-flex justify-content-around align-items-center py-2">
                ${items.map(item => `
                    <div class="text-center">
                        <div class="h4 text-${item.variant} mb-0">${item.value}</div>
                        <small class="text-muted">${item.label}</small>
                    </div>
                `).join('')}
            </div>
        `;
    }

    return `
        <div class="row">
            ${items.map(item => `
                <div class="col-md-3">
                    <div class="text-center py-3">
                        <div class="display-6 text-${item.variant}">${item.value}</div>
                        <small class="text-muted">${item.label}</small>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Render type-specific reports
 */
function renderTypeReports(typeReports, compact) {
    let html = '<h6>Details by Type:</h6>';

    typeReports.forEach(typeReport => {
        const typeName = typeReport.klass || typeReport.type || 'Unknown';
        const stats = typeReport.stats || {};

        html += `
            <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center">
                    <strong>${escapeHtml(typeName)}</strong>
                    <div class="small">
                        <span class="badge bg-success">${stats.created || 0} created</span>
                        <span class="badge bg-primary">${stats.updated || 0} updated</span>
                        <span class="badge bg-secondary">${stats.ignored || 0} ignored</span>
                    </div>
                </div>
            </div>
        `;

        // Show object reports if present and errors exist
        if (typeReport.objectReports && typeReport.objectReports.length > 0) {
            const errorReports = typeReport.objectReports.filter(obj =>
                obj.errorReports && obj.errorReports.length > 0
            );

            if (errorReports.length > 0) {
                html += '<div class="ms-3">';
                html += '<small class="text-danger">Errors:</small>';
                html += '<ul class="small text-danger mb-0">';
                errorReports.forEach(obj => {
                    obj.errorReports.forEach(err => {
                        html += `<li>${escapeHtml(err.message || 'Unknown error')}</li>`;
                    });
                });
                html += '</ul>';
                html += '</div>';
            }
        }
    });

    return html;
}

/**
 * Render validation report
 */
function renderValidationReport(validationReport) {
    if (!validationReport.errorReports || validationReport.errorReports.length === 0) {
        return '<div class="alert alert-success mb-0"><small><i class="bi bi-check-circle me-2"></i>No validation errors</small></div>';
    }

    let html = '<h6 class="text-danger">Validation Errors:</h6>';
    html += '<ul class="small text-danger mb-0">';

    validationReport.errorReports.forEach(error => {
        const message = error.message || 'Unknown validation error';
        const property = error.property ? ` (${error.property})` : '';
        html += `<li>${escapeHtml(message)}${escapeHtml(property)}</li>`;
    });

    html += '</ul>';

    return html;
}

/**
 * Render a simple import summary
 * @param {Object} report - Import report object
 * @returns {string} HTML string
 */
export function renderImportSummary(report) {
    if (!report) {
        return '<p class="text-muted">No import report available</p>';
    }

    const stats = report.stats || {};
    const status = report.status || 'UNKNOWN';
    const isSuccess = status === 'OK' || status === 'SUCCESS';

    const statusBadge = isSuccess
        ? '<span class="badge bg-success">Success</span>'
        : `<span class="badge bg-warning">${escapeHtml(status)}</span>`;

    return `
        <div class="alert ${isSuccess ? 'alert-success' : 'alert-warning'}" role="alert">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>Import Status:</strong> ${statusBadge}
                </div>
                <div class="small">
                    ${stats.created || 0} created,
                    ${stats.updated || 0} updated,
                    ${stats.ignored || 0} ignored
                </div>
            </div>
        </div>
    `;
}

/**
 * Render transfer-specific import report
 * @param {Object} result - Transfer result from backend
 * @returns {string} HTML string
 */
export function renderTransferReport(result) {
    if (!result) {
        return '<p class="text-muted">No transfer report available</p>';
    }

    const {
        imported = 0,
        updated = 0,
        ignored = 0,
        deleted = 0,
        conflicts = [],
        errors = []
    } = result;

    let html = `
        <div class="card">
            <div class="card-header ${errors.length > 0 ? 'bg-warning' : 'bg-success'} text-white">
                <h6 class="mb-0">
                    <i class="bi bi-arrow-left-right me-2"></i>
                    Transfer Report
                </h6>
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-3 text-center">
                        <div class="display-6 text-success">${imported}</div>
                        <small class="text-muted">Imported</small>
                    </div>
                    <div class="col-md-3 text-center">
                        <div class="display-6 text-primary">${updated}</div>
                        <small class="text-muted">Updated</small>
                    </div>
                    <div class="col-md-3 text-center">
                        <div class="display-6 text-secondary">${ignored}</div>
                        <small class="text-muted">Ignored</small>
                    </div>
                    <div class="col-md-3 text-center">
                        <div class="display-6 text-danger">${deleted}</div>
                        <small class="text-muted">Deleted</small>
                    </div>
                </div>
    `;

    // Show conflicts if present
    if (conflicts && conflicts.length > 0) {
        html += '<hr><h6 class="text-warning">Conflicts:</h6><ul class="small">';
        conflicts.forEach(conflict => {
            html += `<li>${escapeHtml(conflict)}</li>`;
        });
        html += '</ul>';
    }

    // Show errors if present
    if (errors && errors.length > 0) {
        html += '<hr><h6 class="text-danger">Errors:</h6><ul class="small text-danger">';
        errors.forEach(error => {
            html += `<li>${escapeHtml(error)}</li>`;
        });
        html += '</ul>';
    }

    html += `
            </div>
        </div>
    `;

    return html;
}
