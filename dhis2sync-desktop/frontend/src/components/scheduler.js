import * as App from '../../wailsjs/go/main/App';
import { toast } from '../toast';

export class SchedulerManager {
    constructor(containerId) {
        this.containerId = containerId;
        this.jobs = [];
        this.currentProfile = null;
    }

    setProfile(profileId) {
        this.currentProfile = profileId;
        if (this.currentProfile) {
            this.loadJobs();
        } else {
            this.renderEmptyState();
        }
    }

    async loadJobs() {
        if (!this.currentProfile) return;

        try {
            this.renderLoading();
            const jobs = await App.ListScheduledJobs(this.currentProfile);
            this.jobs = jobs || [];
            this.renderList();
        } catch (error) {
            console.error('Failed to load jobs:', error);
            toast.error('Failed to load scheduled jobs');
            this.renderError(error);
        }
    }

    renderLoading() {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = `
                <div class="d-flex justify-content-center py-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                </div>
            `;
        }
    }

    renderError(error) {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger m-3">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    Failed to load jobs: ${error}
                    <button class="btn btn-sm btn-outline-danger ms-3" onclick="app.scheduler.loadJobs()">Retry</button>
                </div>
            `;
        }
    }

    renderEmptyState() {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = `
                <div class="text-center py-5 text-muted">
                    <i class="bi bi-calendar-x fs-1 mb-3"></i>
                    <h6>No Scheduled Jobs</h6>
                    <p>Create a job to automate data transfers or completeness checks.</p>
                    <button class="btn btn-primary" onclick="app.scheduler.openJobModal()">
                        <i class="bi bi-plus-lg me-1"></i>Create First Job
                    </button>
                </div>
            `;
        }
    }

    renderList() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        if (this.jobs.length === 0) {
            this.renderEmptyState();
            return;
        }

        const html = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h5 class="mb-0">Scheduled Jobs</h5>
                <button class="btn btn-primary btn-sm" onclick="app.scheduler.openJobModal()">
                    <i class="bi bi-plus-lg me-1"></i>New Job
                </button>
            </div>
            <div class="table-responsive">
                <table class="table table-hover align-middle">
                    <thead class="table-light">
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Schedule (Cron)</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.jobs.map(job => `
                            <tr>
                                <td>
                                    <div class="fw-bold">${job.name}</div>
                                    <small class="text-muted">${job.id}</small>
                                </td>
                                <td>
                                    <span class="badge bg-${job.job_type === 'transfer' ? 'info' : 'success'}">
                                        ${job.job_type === 'transfer' ? 'Transfer' : 'Completeness'}
                                    </span>
                                </td>
                                <td>
                                    <code>${job.cron_expression}</code>
                                </td>
                                <td>
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox" 
                                            ${job.enabled ? 'checked' : ''} 
                                            onchange="scheduler.toggleJob('${job.id}', this.checked)">
                                        <label class="form-check-label small text-muted">
                                            ${job.enabled ? 'Enabled' : 'Disabled'}
                                        </label>
                                    </div>
                                </td>
                                <td>
                                    <div class="btn-group btn-group-sm">
                                        <button class="btn btn-outline-secondary" onclick="app.scheduler.editJob('${job.id}')" title="Edit">
                                            <i class="bi bi-pencil"></i>
                                        </button>
                                        <button class="btn btn-outline-danger" onclick="app.scheduler.deleteJob('${job.id}')" title="Delete">
                                            <i class="bi bi-trash"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    openJobModal(jobId = null) {
        const job = jobId ? this.jobs.find(j => j.id === jobId) : null;
        const isEdit = !!job;

        // Default values
        const name = job?.name || '';
        const type = job?.job_type || 'transfer';
        const cron = job?.cron_expression || '0 0 * * *'; // Daily midnight
        const enabled = job ? job.enabled : true;

        // Parse payload for defaults if editing
        let payload = {};
        try {
            payload = job?.payload ? JSON.parse(job.payload) : {};
        } catch (e) {
            console.error('Error parsing payload', e);
        }

        const modalHtml = `
            <div class="modal fade" id="schedulerModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${isEdit ? 'Edit Job' : 'New Scheduled Job'}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="scheduler-form">
                                <input type="hidden" id="job-id" value="${jobId || ''}">
                                
                                <div class="row mb-3">
                                    <div class="col-md-8">
                                        <label class="form-label">Job Name</label>
                                        <input type="text" class="form-control" id="job-name" value="${name}" required>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Type</label>
                                        <select class="form-select" id="job-type" ${isEdit ? 'disabled' : ''} onchange="scheduler.renderPayloadFields()">
                                            <option value="transfer" ${type === 'transfer' ? 'selected' : ''}>Data Transfer</option>
                                            <option value="completeness" ${type === 'completeness' ? 'selected' : ''}>Completeness Check</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label">Schedule (Cron Expression)</label>
                                    <div class="input-group">
                                        <select class="form-select" style="max-width: 150px;" onchange="document.getElementById('job-cron').value = this.value">
                                            <option value="">Presets...</option>
                                            <option value="0 * * * *">Hourly</option>
                                            <option value="0 0 * * *">Daily (Midnight)</option>
                                            <option value="0 0 * * 0">Weekly (Sunday)</option>
                                            <option value="0 0 1 * *">Monthly (1st)</option>
                                        </select>
                                        <input type="text" class="form-control font-monospace" id="job-cron" value="${cron}" placeholder="* * * * *" required>
                                    </div>
                                    <div class="form-text">Format: Minute Hour Day Month Weekday</div>
                                </div>

                                <hr>
                                <h6 class="mb-3">Job Configuration</h6>
                                <div id="payload-fields">
                                    <!-- Dynamic fields rendered here -->
                                </div>

                                <div class="form-check mt-3">
                                    <input class="form-check-input" type="checkbox" id="job-enabled" ${enabled ? 'checked' : ''}>
                                    <label class="form-check-label" for="job-enabled">Enable this job</label>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" onclick="app.scheduler.saveJob()">Save Job</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('schedulerModal');
        if (existingModal) existingModal.remove();

        // Append new modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialize Bootstrap modal
        const modalEl = document.getElementById('schedulerModal');
        this.modal = new bootstrap.Modal(modalEl);

        // Render initial payload fields
        this.renderPayloadFields(payload);

        this.modal.show();
    }

    renderPayloadFields(values = {}) {
        const type = document.getElementById('job-type').value;
        const container = document.getElementById('payload-fields');

        if (type === 'transfer') {
            container.innerHTML = `
                <div class="mb-3">
                    <label class="form-label">Source Dataset ID</label>
                    <input type="text" class="form-control" id="pl-dataset" value="${values.dataset_id || ''}" required>
                    <div class="form-text">The UID of the dataset to transfer</div>
                </div>
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="pl-mark-complete" ${values.mark_complete ? 'checked' : ''}>
                    <label class="form-check-label">Mark complete in destination</label>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="mb-3">
                    <label class="form-label">Dataset ID</label>
                    <input type="text" class="form-control" id="pl-dataset" value="${values.dataset_id || ''}" required>
                </div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label">Threshold (%)</label>
                        <input type="number" class="form-control" id="pl-threshold" value="${values.threshold || 100}" min="0" max="100">
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label">Instance</label>
                        <select class="form-select" id="pl-instance">
                            <option value="source" ${values.instance === 'source' ? 'selected' : ''}>Source</option>
                            <option value="destination" ${values.instance === 'destination' ? 'selected' : ''}>Destination</option>
                        </select>
                    </div>
                </div>
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="pl-include-parents" ${values.include_parents ? 'checked' : ''}>
                    <label class="form-check-label">Include parent org units</label>
                </div>
            `;
        }
    }

    async saveJob() {
        const id = document.getElementById('job-id').value;
        const name = document.getElementById('job-name').value;
        const type = document.getElementById('job-type').value;
        const cron = document.getElementById('job-cron').value;
        const enabled = document.getElementById('job-enabled').checked;

        if (!name || !cron) {
            toast.warning('Please fill in all required fields');
            return;
        }

        // Build payload
        const payload = {};
        if (type === 'transfer') {
            payload.dataset_id = document.getElementById('pl-dataset').value;
            payload.mark_complete = document.getElementById('pl-mark-complete').checked;
        } else {
            payload.dataset_id = document.getElementById('pl-dataset').value;
            payload.threshold = parseInt(document.getElementById('pl-threshold').value);
            payload.instance = document.getElementById('pl-instance').value;
            payload.include_parents = document.getElementById('pl-include-parents').checked;
        }

        if (!payload.dataset_id) {
            toast.warning('Dataset ID is required');
            return;
        }

        const job = {
            id: id || '', // Empty for new
            name: name,
            job_type: type,
            cron_expression: cron,
            enabled: enabled,
            profile_id: this.currentProfile,
            payload: JSON.stringify(payload)
        };

        try {
            await App.UpsertScheduledJob(job);
            toast.success(`Job ${id ? 'updated' : 'created'} successfully`);
            this.modal.hide();
            this.loadJobs();
        } catch (error) {
            console.error('Failed to save job:', error);
            toast.error(`Failed to save job: ${error}`);
        }
    }

    async deleteJob(id) {
        if (!confirm('Are you sure you want to delete this job?')) return;

        try {
            await App.DeleteScheduledJob(id);
            toast.success('Job deleted');
            this.loadJobs();
        } catch (error) {
            console.error('Failed to delete job:', error);
            toast.error(`Failed to delete job: ${error}`);
        }
    }

    async toggleJob(id, enabled) {
        const job = this.jobs.find(j => j.id === id);
        if (!job) return;

        job.enabled = enabled;

        try {
            await App.UpsertScheduledJob(job);
            toast.success(`Job ${enabled ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error('Failed to toggle job:', error);
            toast.error(`Failed to update job status: ${error}`);
            // Revert UI
            this.loadJobs();
        }
    }
}
