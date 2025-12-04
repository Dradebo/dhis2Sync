import * as App from '../wailsjs/go/main/App';

export class AuditModule {
    constructor(appInstance) {
        this.app = appInstance;
        this.activeTaskID = null;
        this.pollInterval = null;
        this.auditResults = null;
        this.datasets = [];
        this.selectedPeriods = [];
    }

    render() {
        return `<div>
            <!-- Empty State (shown when no profile selected) -->
            <div id="audit-empty-state" class="text-center py-5" style="display: none;">
                <i class="bi bi-shield-check text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3 mb-2">No Connection Profile Selected</h4>
                <p class="text-muted mb-4">Select a profile to begin auditing your data for missing metadata and quality issues.</p>
                <button class="btn btn-primary" onclick="app.switchToTab('settings-tab')">
                    <i class="bi bi-gear me-2"></i>Go to Connections
                </button>
            </div>

            <!-- Main Audit Interface -->
            <div id="audit-main-interface">
                <div class="card-header bg-white py-3">
                    <div class="d-flex justify-content-between align-items-center">
                        <h5 class="mb-0 text-primary"><i class="bi bi-shield-check me-2"></i>Data Audit</h5>
                        <span id="audit-status-badge" class="badge bg-light text-dark border">Ready</span>
                    </div>
                </div>
                <div class="card-body">
                    <!-- Configuration Section -->
                    <div id="audit-config">
                        <div class="alert alert-info border-0 bg-light">
                            <i class="bi bi-info-circle me-2"></i>
                            <strong>Pre-flight Check:</strong> Scan your source data to identify missing metadata and data quality issues before transferring.
                        </div>
                        
                        <div class="row g-3 mb-3">
                            <div class="col-md-6">
                                <label class="form-label fw-medium">Dataset</label>
                                <select id="audit_dataset_id" class="form-select" onchange="window.auditModule.onDatasetChange()">
                                    <option value="">Choose a dataset...</option>
                                </select>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label fw-medium">Select Periods</label>
                                <select id="audit_period_dropdown" class="form-select">
                                    <option value="">Select dataset first...</option>
                                </select>
                                <div class="form-text" id="period-help-text">Click a period to add it</div>
                            </div>
                        </div>

                        <!-- Selected Periods (Chips) -->
                        <div class="mb-3">
                            <label class="form-label fw-medium">Selected Periods</label>
                            <div id="audit-selected-periods" class="border rounded p-2 bg-light" style="min-height: 50px;">
                                <small class="text-muted">No periods selected</small>
                            </div>
                        </div>

                        <div class="d-flex justify-content-end">
                            <button class="btn btn-primary" onclick="window.auditModule.startAudit()" id="btn-start-audit" disabled>
                                <i class="bi bi-play-fill me-1"></i>Start Audit
                            </button>
                        </div>
                    </div>

                    <!-- Progress Section (hidden initially) -->
                    <div id="audit-progress-container" class="border-top pt-3 mt-3" style="display: none;">
                        <h6 class="fw-bold mb-3">
                            <i class="bi bi-hourglass-split me-2"></i>Audit in Progress
                        </h6>
                        <div class="mb-2">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="small text-muted" id="audit-step-indicator">Initializing...</span>
                                <span class="small fw-bold" id="audit-progress-text">0%</span>
                            </div>
                            <div class="progress" style="height: 24px;">
                                <div id="audit-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                                    <span class="px-2">0%</span>
                                </div>
                            </div>
                        </div>
                        <div id="audit-progress-messages" class="small text-muted mt-2"></div>
                    </div>

                    <!-- Results Section (Resolution Wizard) -->
                    <div id="audit-results-container" style="display: none;" class="mt-4">
                        <div class="d-flex align-items-center mb-3">
                            <h6 class="mb-0 me-3">Findings</h6>
                            <ul class="nav nav-pills nav-sm" id="auditResultTabs" role="tablist">
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link active py-1 px-3" id="tab-missing-ou" data-bs-toggle="tab" data-bs-target="#pane-missing-ou" type="button" role="tab">
                                        Missing Org Units <span id="badge-missing-ou" class="badge bg-white text-danger ms-1 border">0</span>
                                    </button>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link py-1 px-3" id="tab-missing-coc" data-bs-toggle="tab" data-bs-target="#pane-missing-coc" type="button" role="tab">
                                        Missing COCs <span id="badge-missing-coc" class="badge bg-white text-danger ms-1 border">0</span>
                                    </button>
                                </li>
                            </ul>
                        </div>

                        <div class="tab-content border rounded p-3 bg-light" id="auditResultContent" style="min-height: 300px;">
                            <!-- Missing OUs Pane -->
                            <div class="tab-pane fade show active" id="pane-missing-ou" role="tabpanel">
                                <div class="table-responsive bg-white rounded border">
                                    <table class="table table-hover table-sm mb-0 align-middle">
                                        <thead class="table-light">
                                            <tr>
                                                <th class="ps-3">Source Name (ID)</th>
                                                <th>Suggested Match</th>
                                                <th class="pe-3 text-end">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody id="table-missing-ou">
                                            <!-- Rows injected here -->
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <!-- Missing COCs Pane -->
                            <div class="tab-pane fade" id="pane-missing-coc" role="tabpanel">
                                <div class="table-responsive bg-white rounded border">
                                    <table class="table table-hover table-sm mb-0 align-middle">
                                        <thead class="table-light">
                                            <tr>
                                                <th class="ps-3">Source Name (ID)</th>
                                                <th>Structural Match</th>
                                                <th class="pe-3 text-end">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody id="table-missing-coc">
                                            <!-- Rows injected here -->
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="d-flex justify-content-end mt-3">
                            <button class="btn btn-success" onclick="window.auditModule.applyResolutions()">
                                <i class="bi bi-check-lg me-1"></i>Apply Resolutions & Proceed
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    async init() {
        // Check if profile is selected and show appropriate state
        if (!this.app.currentProfile) {
            document.getElementById('audit-empty-state').style.display = 'block';
            document.getElementById('audit-main-interface').style.display = 'none';
            return;
        }

        document.getElementById('audit-empty-state').style.display = 'none';
        document.getElementById('audit-main-interface').style.display = 'block';

        // Initialize selected periods array
        this.selectedPeriods = [];

        await this.loadDatasets();
        this.setupPeriodDropdownListener();
    }

    setupPeriodDropdownListener() {
        const dropdown = document.getElementById('audit_period_dropdown');
        if (!dropdown) return;

        dropdown.addEventListener('change', () => {
            const period = dropdown.value;
            if (period && !this.selectedPeriods.includes(period)) {
                this.selectedPeriods.push(period);
                this.renderSelectedPeriods();
                this.updateStartButtonState();
            }
            // Reset dropdown
            dropdown.value = '';
        });
    }

    renderSelectedPeriods() {
        const container = document.getElementById('audit-selected-periods');
        if (!container) return;

        if (this.selectedPeriods.length === 0) {
            container.innerHTML = '<small class="text-muted">No periods selected</small>';
            return;
        }

        container.innerHTML = this.selectedPeriods.map(period => `
            <span class="badge bg-primary me-2 mb-2 d-inline-flex align-items-center" style="font-size: 0.9rem; padding: 0.5rem 0.75rem;">
                ${period}
                <button type="button" class="btn-close btn-close-white ms-2" 
                        style="font-size: 0.7rem;" 
                        onclick="window.auditModule.removePeriod('${period}')"
                        aria-label="Remove ${period}"></button>
            </span>
        `).join('');
    }

    removePeriod(period) {
        this.selectedPeriods = this.selectedPeriods.filter(p => p !== period);
        this.renderSelectedPeriods();
        this.updateStartButtonState();
    }

    updateStartButtonState() {
        const btn = document.getElementById('btn-start-audit');
        const datasetID = document.getElementById('audit_dataset_id')?.value;

        if (btn) {
            btn.disabled = !datasetID || this.selectedPeriods.length === 0;
        }
    }

    async loadDatasets() {
        const select = document.getElementById('audit_dataset_id');
        if (!select) return;

        if (!this.app.currentProfile) {
            select.innerHTML = '<option value="">No profile selected</option>';
            return;
        }

        try {
            select.innerHTML = '<option value="">Loading...</option>';
            this.datasets = await App.ListDatasets(this.app.currentProfile.id, 'source');

            select.innerHTML = '<option value="">Choose a dataset...</option>' +
                this.datasets.map(ds => `<option value="${ds.id}">${ds.displayName}</option>`).join('');
        } catch (err) {
            console.error("Failed to load datasets:", err);
            select.innerHTML = '<option value="">Error loading datasets</option>';
        }
    }

    onDatasetChange() {
        const select = document.getElementById('audit_dataset_id');
        const datasetID = select.value;

        // Reset periods when dataset changes
        this.selectedPeriods = [];
        this.renderSelectedPeriods();

        if (!datasetID) {
            document.getElementById('audit_period_dropdown').innerHTML = '<option value="">Select dataset first...</option>';
            this.updateStartButtonState();
            return;
        }

        const dataset = this.datasets.find(ds => ds.id === datasetID);
        if (dataset) {
            this.loadPeriods(dataset.periodType || 'Monthly');
        }

        this.updateStartButtonState();
    }

    loadPeriods(periodType = 'Monthly') {
        const dropdown = document.getElementById('audit_period_dropdown');
        if (!dropdown) return;

        let periods = [];
        const date = new Date();
        const year = date.getFullYear();

        // Helper to format date
        const pad = (n) => String(n).padStart(2, '0');

        switch (periodType) {
            case 'Daily':
                // Last 30 days
                for (let i = 0; i < 30; i++) {
                    const d = new Date(date);
                    d.setDate(d.getDate() - i);
                    periods.push(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
                }
                break;
            case 'Weekly':
                // Last 12 weeks
                for (let i = 0; i < 12; i++) {
                    const weekNum = 52 - i;
                    periods.push(`${year}W${weekNum}`);
                }
                break;
            case 'Monthly':
            default:
                // Last 24 months
                for (let i = 0; i < 24; i++) {
                    const d = new Date(year, date.getMonth() - i, 1);
                    periods.push(`${d.getFullYear()}${pad(d.getMonth() + 1)}`);
                }
                break;
            case 'Quarterly':
                // Last 8 quarters
                const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
                for (let i = 0; i < 8; i++) {
                    const qYear = year - Math.floor(i / 4);
                    const qNum = 4 - (i % 4);
                    periods.push(`${qYear}${quarters[qNum - 1]}`);
                }
                break;
            case 'Yearly':
                // Last 5 years
                for (let i = 0; i < 5; i++) {
                    periods.push(`${year - i}`);
                }
                break;
        }

        dropdown.innerHTML = '<option value="">Click to select a period...</option>' +
            periods.map(p => `<option value="${p}">${p}</option>`).join('');

        // Update help text
        const helpText = document.getElementById('period-help-text');
        if (helpText) {
            helpText.textContent = `Showing ${periodType} periods`;
        }
    }

    async startAudit() {
        const datasetID = document.getElementById('audit_dataset_id').value;

        if (!datasetID) {
            alert("Please select a dataset");
            return;
        }

        if (this.selectedPeriods.length === 0) {
            alert("Please select at least one period");
            return;
        }

        document.getElementById('audit-config').style.opacity = '0.5';
        document.getElementById('btn-start-audit').disabled = true;
        document.getElementById('audit-progress-container').style.display = 'block';
        document.getElementById('audit-results-container').style.display = 'none';

        try {
            // Get current profile ID from app
            const profileID = this.app.currentProfile.id;
            this.activeTaskID = await App.StartAudit(profileID, datasetID, this.selectedPeriods);
            this.pollProgress();
        } catch (err) {
            console.error(err);
            alert("Failed to start audit: " + err);
            this.resetUI();
        }
    }

    pollProgress() {
        if (this.pollInterval) clearInterval(this.pollInterval);

        this.pollInterval = setInterval(async () => {
            try {
                const progress = await App.GetAuditProgress(this.activeTaskID);
                this.updateProgress(progress);

                if (progress.status === 'completed') {
                    clearInterval(this.pollInterval);
                    this.showResults(progress.results);
                } else if (progress.status === 'failed') {
                    clearInterval(this.pollInterval);
                    alert("Audit failed: " + progress.message);
                    this.resetUI();
                }
            } catch (err) {
                console.error("Poll error:", err);
            }
        }, 1000);
    }

    updateProgress(progress) {
        const bar = document.getElementById('audit-progress-bar');
        const text = document.getElementById('audit-progress-text');
        const stepIndicator = document.getElementById('audit-step-indicator');
        const messages = document.getElementById('audit-progress-messages');

        const percent = progress.percent || 0;

        // Update progress bar with percentage
        if (bar) {
            bar.style.width = `${percent}%`;
            bar.setAttribute('aria-valuenow', percent);
            bar.querySelector('span').textContent = `${percent}%`;
        }

        // Update percentage text
        if (text) {
            text.textContent = `${percent}%`;
        }

        // Update step indicator with current operation
        if (stepIndicator && progress.message) {
            stepIndicator.textContent = progress.message;
        }

        // Update messages log
        if (messages && progress.logs) {
            messages.innerHTML = progress.logs.slice(-5).map(log =>
                `<div class="text-muted small"><i class="bi bi-dot"></i> ${log}</div>`
            ).join('');
        }
    }

    showResults(results) {
        this.auditResults = results;

        document.getElementById('audit-config').style.display = 'none';
        document.getElementById('audit-progress-container').style.display = 'none';
        document.getElementById('audit-results-container').style.display = 'block';

        // Update badges
        document.getElementById('badge-missing-ou').textContent = results.missing_org_units?.length || 0;
        document.getElementById('badge-missing-coc').textContent = results.missing_cocs?.length || 0;

        // Render tables
        this.renderMissingOUs(results.missing_org_units || []);
        this.renderMissingCOCs(results.missing_cocs || []);
    }

    renderMissingOUs(items) {
        const tbody = document.getElementById('table-missing-ou');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No missing organization units found</td></tr>';
            return;
        }

        tbody.innerHTML = items.map(item => `
            <tr>
                <td class="ps-3">
                    <div class="fw-medium">${item.name || item.id}</div>
                    <small class="text-muted">${item.id}</small>
                </td>
                <td>
                    ${item.suggestion ? `
                        <div class="text-success">
                            <i class="bi bi-check-circle me-1"></i>${item.suggestion.name}
                            <small class="text-muted">(${item.suggestion.score}% match)</small>
                        </div>
                    ` : '<span class="text-muted">No match found</span>'}
                </td>
                <td class="pe-3 text-end">
                    <select class="form-select form-select-sm action-select" data-id="${item.id}" data-type="orgUnit" style="width: 150px;">
                        <option value="skip">Skip</option>
                        ${item.suggestion ? `<option value="map:${item.suggestion.id}">Map to Suggestion</option>` : ''}
                    </select>
                </td>
            </tr>
        `).join('');
    }

    renderMissingCOCs(items) {
        const tbody = document.getElementById('table-missing-coc');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No missing category option combos found</td></tr>';
            return;
        }

        tbody.innerHTML = items.map(item => `
            <tr>
                <td class="ps-3">
                    <div class="fw-medium">${item.name || item.id}</div>
                    <small class="text-muted">${item.id}</small>
                </td>
                <td>
                    ${item.structural_match ? `
                        <div class="text-success">
                            <i class="bi bi-check-circle me-1"></i>${item.structural_match.name}
                            <small class="text-muted">(Structural match)</small>
                        </div>
                    ` : '<span class="text-muted">No match found</span>'}
                </td>
                <td class="pe-3 text-end">
                    <select class="form-select form-select-sm action-select" data-id="${item.id}" data-type="coc" style="width: 150px;">
                        <option value="skip">Skip</option>
                        ${item.structural_match ? `<option value="map:${item.structural_match.id}">Map to Match</option>` : ''}
                    </select>
                </td>
            </tr>
        `).join('');
    }

    async applyResolutions() {
        // Gather all selections
        const resolutions = [];
        document.querySelectorAll('.action-select').forEach(select => {
            resolutions.push({
                id: select.dataset.id,
                type: select.dataset.type,
                action: select.value
            });
        });

        // Get context from audit config
        const datasetID = document.getElementById('audit_dataset_id').value;

        if (!datasetID) {
            alert("Dataset context lost. Please restart audit.");
            return;
        }

        if (!confirm(`Apply ${resolutions.length} resolutions and start transfer?`)) {
            return;
        }

        // Show loading state
        const btn = document.querySelector('button[onclick="window.auditModule.applyResolutions()"]');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Starting Transfer...';

        try {
            const profileID = this.app.currentProfile.id;

            // Construct TransferRequest
            const req = {
                profile_id: profileID,
                source_dataset: datasetID,
                dest_dataset: datasetID,
                periods: this.selectedPeriods,
                resolutions: resolutions,
                mark_complete: false,
                element_mapping: {}
            };

            // Call backend
            const taskID = await App.StartTransfer(req);
            console.log("Transfer started with Task ID:", taskID);

            // Switch UI to transfer progress mode
            this.showTransferProgress(taskID);

        } catch (err) {
            console.error("Failed to start transfer:", err);
            alert("Failed to start transfer: " + err);
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    showTransferProgress(taskID) {
        // Hide audit results
        document.getElementById('audit-results-container').style.display = 'none';

        // Show progress
        const progressContainer = document.getElementById('audit-progress-container');
        progressContainer.style.display = 'block';

        document.getElementById('audit-progress-text').textContent = 'Transfer in progress...';
        document.getElementById('audit-progress-bar').style.width = '0%';

        // Poll transfer progress
        this.pollTransferProgress(taskID);
    }

    pollTransferProgress(taskID) {
        if (this.pollInterval) clearInterval(this.pollInterval);

        this.pollInterval = setInterval(async () => {
            try {
                const progress = await App.GetTransferProgress(taskID);
                this.updateProgress(progress);

                if (progress.status === 'completed') {
                    clearInterval(this.pollInterval);
                    alert("Transfer completed successfully!");
                    this.resetUI();
                } else if (progress.status === 'failed') {
                    clearInterval(this.pollInterval);
                    alert("Transfer failed: " + progress.message);
                    this.resetUI();
                }
            } catch (err) {
                console.error("Poll error:", err);
            }
        }, 1000);
    }

    resetUI() {
        document.getElementById('audit-config').style.opacity = '1';
        document.getElementById('audit-config').style.display = 'block';
        document.getElementById('btn-start-audit').disabled = false;
        document.getElementById('audit-progress-container').style.display = 'none';
        document.getElementById('audit-results-container').style.display = 'none';

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
}
