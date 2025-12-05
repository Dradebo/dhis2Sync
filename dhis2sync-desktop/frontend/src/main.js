/**
 * DHIS2 Sync Desktop - Main Application
 * Wails-based desktop application for DHIS2 data synchronization
 */

import './style.css';
import './app.css';

// Import Wails Go bindings
import * as App from '../wailsjs/go/main/App';

// Import utilities
import { progressTracker } from './progress-tracker';
import { toast } from './toast';
import { renderStepper, renderSectionState } from './components';
import { generatePeriods } from './utils/periods';
import { SchedulerManager } from './components/scheduler';
// CompletenessModule removed - was dead code, all functionality consolidated in main.js
import { AuditModule } from './audit.js';
import { DataElementPicker } from './components/data-element-picker';

/**
 * Main DHIS2 Sync Application Class
 */
class DHIS2SyncApp {
    constructor() {
        this.currentProfile = null;
        this.sourceConnectionTested = false;
        this.destConnectionTested = false;
        this.currentDatasetInfo = null;
        this.completenessPeriods = new Set();
        this.completenessRunning = false;
        this.profileFormStep = 1;

        // Initialize components
        this.scheduler = new SchedulerManager('scheduler-content');
        this.dataElementPicker = new DataElementPicker('comp-de-picker-container');
        // Completeness functionality is now handled directly in main.js methods
        this.audit = new AuditModule(this);
        this.dataOUPicker = null; // Transfer tab org unit picker
        this.trkOUPicker = null;  // Tracker tab org unit picker

        this.init();
    }

    async init() {
        this.renderApp();
        this.setupEventListeners();
        this.loadSettings();
        await this.loadDashboard(); // Load dashboard on startup
        this.startJobPoller();
    }

    startJobPoller() {
        // Refresh job history every 30 seconds if on dashboard
        setInterval(() => {
            const dashboardTab = document.getElementById('dashboard-tab');
            if (dashboardTab && dashboardTab.classList.contains('active')) {
                this.refreshJobHistory();
            }
        }, 30000);
    }


    renderApp() {
        const transferStepper = renderStepper([
            { id: 'dataset', label: 'Dataset', description: 'Pick source dataset', status: 'active' },
            { id: 'periods', label: 'Periods', description: 'Choose timeframes', status: 'pending' },
            { id: 'preview', label: 'Preview', description: 'Review selections', status: 'pending' },
            { id: 'transfer', label: 'Transfer', description: 'Start & monitor', status: 'pending' }
        ]);

        const settingsHtml = this.renderSettingsTab();
        const transferHtml = this.renderTransferTab(transferStepper);
        const completenessHtml = this.renderCompletenessTab();

        const appHtml = `
            <!-- Main Header -->
            <header class="main-header">
                <div class="container">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h1 class="mb-1">DHIS2 Data Synchronization Tool</h1>
                            <p class="mb-0 opacity-75">Manage data transfers and completeness between DHIS2 instances</p>
                        </div>
                        <div class="text-end">
                            <div class="small opacity-75">Connection Status</div>
                            <div>
                                <span class="connection-status unknown"></span>
                                <small id="connection-status-text">Ready to Connect</small>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <!-- Main Container -->
            <div class="container my-4">
                <!-- Navigation Tabs -->
                <ul class="nav nav-tabs" id="mainTabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="dashboard-tab" data-bs-toggle="tab" data-bs-target="#dashboard-pane" type="button" role="tab" aria-controls="dashboard-pane" aria-selected="true" aria-label="Dashboard - View recent activity and system status">
                            <i class="tab-icon bi bi-speedometer2" aria-hidden="true"></i>Dashboard
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="settings-tab" data-bs-toggle="tab" data-bs-target="#settings-pane" type="button" role="tab" aria-controls="settings-pane" aria-selected="false" aria-label="Connections - Manage connection profiles and scheduled jobs">
                            <i class="tab-icon bi bi-hdd-network" aria-hidden="true"></i>Connections
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="transfer-tab" data-bs-toggle="tab" data-bs-target="#transfer-pane" type="button" role="tab" aria-controls="transfer-pane" aria-selected="false" aria-label="Transfer - Transfer data, metadata, and tracker events">
                            <i class="tab-icon bi bi-arrow-left-right" aria-hidden="true"></i>Transfer
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="completeness-tab" data-bs-toggle="tab" data-bs-target="#completeness-pane" type="button" role="tab" aria-controls="completeness-pane" aria-selected="false" aria-label="Completeness - Assess data completeness and quality">
                            <i class="tab-icon bi bi-check-circle" aria-hidden="true"></i>Completeness
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="audit-tab" data-bs-toggle="tab" data-bs-target="#audit-pane" type="button" role="tab" aria-controls="audit-pane" aria-selected="false" aria-label="Audit - Check for missing metadata before transfer">
                            <i class="tab-icon bi bi-shield-check" aria-hidden="true"></i>Audit
                        </button>
                    </li>
                </ul>

                <!-- Tab Content -->
                <div class="tab-content" id="mainTabContent">
                    <!-- Dashboard Tab -->
                    <div class="tab-pane fade show active" id="dashboard-pane" role="tabpanel" aria-labelledby="dashboard-tab">
                        <div class="row">
                            <div class="col-md-8">
                                <div class="card">
                                    <div class="card-header d-flex justify-content-between align-items-center">
                                        <h5 class="mb-0">
                                            <i class="bi bi-clock-history me-2"></i>Recent Jobs
                                        </h5>
                                        <button class="btn btn-sm btn-outline-primary" onclick="app.refreshJobHistory()">
                                            <i class="bi bi-arrow-clockwise"></i>
                                        </button>
                                    </div>
                                    <div class="card-body" id="job-history-container">
                                        <div class="d-flex justify-content-center py-4">
                                            <div class="spinner-border text-primary" role="status">
                                                <span class="visually-hidden">Loading...</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="col-md-4">
                                <div class="card mb-3">
                                    <div class="card-header">
                                        <h6 class="mb-0">Quick Actions</h6>
                                    </div>
                                    <div class="card-body">
                                        <div class="d-grid gap-2">
                                            <button class="btn btn-outline-primary" onclick="app.switchToTab('transfer-tab')">
                                                <i class="bi bi-arrow-left-right me-1"></i>New Transfer
                                            </button>
                                            <button class="btn btn-outline-success" onclick="app.switchToTab('completeness-tab')">
                                                <i class="bi bi-check-circle me-1"></i>Check Completeness
                                            </button>
                                            <button class="btn btn-outline-secondary" onclick="app.switchToTab('settings-tab')">
                                                <i class="bi bi-gear me-1"></i>Manage Settings
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div class="card">
                                    <div class="card-header">
                                        <h6 class="mb-0">System Status</h6>
                                    </div>
                                    <div class="card-body" id="system-status-container">
                                        <div class="d-flex justify-content-between align-items-center mb-2">
                                            <span>Source Connection</span>
                                            <span id="status-source-badge" class="badge bg-secondary">Not Configured</span>
                                        </div>
                                        <div class="d-flex justify-content-between align-items-center mb-2">
                                            <span>Destination Connection</span>
                                            <span id="status-dest-badge" class="badge bg-secondary">Not Configured</span>
                                        </div>
                                        <div class="d-flex justify-content-between align-items-center">
                                            <span>Sync Profiles</span>
                                            <span id="status-profiles-badge" class="badge bg-secondary">0</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    ${settingsHtml}
                    ${transferHtml}
                    ${completenessHtml}
                    
                    <!-- Audit Tab -->
                    <div class="tab-pane fade" id="audit-pane" role="tabpanel" aria-labelledby="audit-tab">
                        ${this.audit.render()}
                    </div>
                </div>
            </div>
        `;

        document.querySelector('#app').innerHTML = appHtml;
    }

    renderSettingsTab() {
        return `
            <!-- Settings Tab -->
                <div class="tab-pane fade" id="settings-pane" role="tabpanel" aria-labelledby="settings-tab">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h3><i class="bi bi-gear me-2"></i>Settings</h3>
                    </div>

                    <ul class="nav nav-pills mb-4" id="settingsTabs" role="tablist">
                        <li class="nav-item" role="presentation">
                            <button class="nav-link active" id="pills-profiles-tab" data-bs-toggle="pill" data-bs-target="#pills-profiles" type="button" role="tab">
                                <i class="bi bi-hdd-network me-2"></i>Connection Profiles
                            </button>
                        </li>
                        <li class="nav-item" role="presentation">
                            <button class="nav-link" id="pills-schedules-tab" data-bs-toggle="pill" data-bs-target="#pills-schedules" type="button" role="tab" onclick="app.loadSchedules()">
                                <i class="bi bi-calendar-event me-2"></i>Scheduled Jobs
                            </button>
                        </li>
                    </ul>

                    <div class="tab-content" id="settingsTabContent">
                        <!-- Profiles Pane -->
                        <div class="tab-pane fade show active" id="pills-profiles" role="tabpanel">
                            <p class="text-muted">Manage DHIS2 instance connections</p>

                            <!-- Profile Form (hidden by default) -->
                            <div id="profile-form-container" class="mb-4" style="display: none;">
                                <!-- ... existing form ... -->
                                <div class="card">
                                    <div class="card-header d-flex justify-content-between align-items-center">
                                        <h5 class="mb-0">
                                            <i class="bi bi-plus-circle me-2"></i><span id="form-title">New Profile</span>
                                        </h5>
                                        <button class="btn btn-sm btn-outline-secondary" onclick="app.hideProfileForm()">
                                            <i class="bi bi-x-lg"></i> Cancel
                                        </button>
                                    </div>
                                    <div class="card-body">
                                        <form id="connection-form">
                                            <div id="profile-step-indicator" class="mb-3"></div>

                                            <div id="profile-wizard-source" class="profile-wizard-step">
                                                <div class="mb-3">
                                                    <label for="profile_name" class="form-label">Profile Name</label>
                                                    <input type="text" class="form-control" id="profile_name" placeholder="e.g., Production ↔ Staging" required>
                                                </div>

                                                <div class="mb-3">
                                                    <label for="profile_owner" class="form-label">Owner (optional)</label>
                                                    <input type="text" class="form-control" id="profile_owner" placeholder="Your name">
                                                </div>

                                                <div class="mb-4">
                                                    <h6 class="text-primary">Source Instance</h6>
                                                    <div class="mb-3">
                                                        <label for="source_url" class="form-label">Server URL</label>
                                                        <input type="url" class="form-control" id="source_url" placeholder="https://source.dhis2.org" required>
                                                    </div>
                                                    <div class="row">
                                                        <div class="col-md-6 mb-3">
                                                            <label for="source_username" class="form-label">Username</label>
                                                            <input type="text" class="form-control" id="source_username" required>
                                                        </div>
                                                        <div class="col-md-6 mb-3">
                                                            <label for="source_password" class="form-label">Password</label>
                                                            <input type="password" class="form-control" id="source_password" required>
                                                        </div>
                                                    </div>
                                                    <button type="button" class="btn btn-sm btn-outline-primary" onclick="app.testSourceConnection()">
                                                        <i class="bi bi-plug me-1"></i>Test Source Connection
                                                    </button>
                                                    <div id="source-test-status" class="mt-2"></div>
                                                </div>

                                                <div class="d-flex justify-content-between gap-2">
                                                    <button type="button" class="btn btn-outline-secondary" onclick="app.hideProfileForm()">
                                                        Cancel
                                                    </button>
                                                    <button type="button" class="btn btn-primary" onclick="app.goToProfileFormStep(2)">
                                                        Next <i class="bi bi-arrow-right ms-1"></i>
                                                    </button>
                                                </div>
                                            </div>

                                            <div id="profile-wizard-dest" class="profile-wizard-step" style="display:none;">
                                                <div class="mb-4">
                                                    <h6 class="text-success">Destination Instance</h6>
                                                    <div class="mb-3">
                                                        <label for="dest_url" class="form-label">Server URL</label>
                                                        <input type="url" class="form-control" id="dest_url" placeholder="https://destination.dhis2.org" required>
                                                    </div>
                                                    <div class="row">
                                                        <div class="col-md-6 mb-3">
                                                            <label for="dest_username" class="form-label">Username</label>
                                                            <input type="text" class="form-control" id="dest_username" required>
                                                        </div>
                                                        <div class="col-md-6 mb-3">
                                                            <label for="dest_password" class="form-label">Password</label>
                                                            <input type="password" class="form-control" id="dest_password" required>
                                                        </div>
                                                    </div>
                                                    <button type="button" class="btn btn-sm btn-outline-success" onclick="app.testDestConnection()">
                                                        <i class="bi bi-plug me-1"></i>Test Destination Connection
                                                    </button>
                                                    <div id="dest-test-status" class="mt-2"></div>
                                                </div>

                                                <div class="d-flex justify-content-between gap-2">
                                                    <button type="button" class="btn btn-outline-secondary" onclick="app.goToProfileFormStep(1)">
                                                        <i class="bi bi-arrow-left me-1"></i>Back
                                                    </button>
                                                    <button type="button" class="btn btn-success" onclick="app.saveProfile()">
                                                        <i class="bi bi-check me-1"></i>Save Profile
                                                    </button>
                                                </div>
                                            </div>
                                        </form>

                                        <div id="form-status" class="mt-3"></div>
                                    </div>
                                </div>
                            </div>

                            <!-- Profiles List -->
                            <div id="settings-content">
                                <div class="d-flex justify-content-center py-4">
                                    <div class="spinner-border text-primary" role="status">
                                        <span class="visually-hidden">Loading...</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Schedules Pane -->
                        <div class="tab-pane fade" id="pills-schedules" role="tabpanel">
                            <div id="scheduler-content">
                                <!-- SchedulerManager renders here -->
                            </div>
                        </div>
                    </div>
                </div>

        `;
    }

    renderTransferTab(transferStepper) {
        return `
            <!-- Transfer Tab -->
                <div class="tab-pane fade" id="transfer-pane" role="tabpanel" aria-labelledby="transfer-tab">
                    <div class="card">
                        <div class="card-header">
                            <div class="d-flex align-items-center">
                                <h5 class="mb-0 me-3">
                                    <i class="bi bi-arrow-left-right me-2"></i>Transfer
                                </h5>
                                <ul class="nav nav-pills" id="transferSubtabs" role="tablist">
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link active" id="subtab-data" data-bs-toggle="tab" data-bs-target="#subtab-pane-data" type="button" role="tab">Data</button>
                                    </li>
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link" id="subtab-metadata" data-bs-toggle="tab" data-bs-target="#subtab-pane-metadata" type="button" role="tab">Metadata</button>
                                    </li>
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link" id="subtab-tracker" data-bs-toggle="tab" data-bs-target="#subtab-pane-tracker" type="button" role="tab">Tracker/Events</button>
                                    </li>
                                </ul>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="tab-content" id="transferSubtabContent">
                                <!-- Data Subtab -->
                                <div class="tab-pane fade show active" id="subtab-pane-data" role="tabpanel">
                                    <div id="data-transfer-content">
                                        <div class="mb-3" id="transfer-stepper">
                                            ${transferStepper}
                                        </div>
                                        <!-- Step 1: Dataset Selection -->
                                        <div class="row mb-3">
                                            <div class="col-md-8">
                                                <label for="source_dataset" class="form-label">Select Dataset</label>
                                                <select class="form-select" id="source_dataset" name="source_dataset" required>
                                                    <option value="">Choose a dataset...</option>
                                                </select>
                                                <div class="form-text">Choose dataset from the source instance. Details load automatically.</div>
                                            </div>
                                            <div class="col-md-4">
                                                <label class="form-label">&nbsp;</label>
                                                <button type="button" class="btn btn-outline-primary d-block w-100" onclick="app.loadDatasetInfo()" id="load-dataset-btn" disabled>
                                                    <i class="bi bi-arrow-repeat me-1"></i>Refresh Dataset Info
                                                </button>
                                            </div>
                                        </div>

                                        <!-- Org Unit Selection -->
                                        <div class="mb-4">
                                            <label class="form-label">Organization Units (Optional)</label>
                                            <div id="data-ou-picker-container" class="border rounded p-2 bg-light"></div>
                                            <div class="form-text small">Leave empty to transfer all accessible organization units.</div>
                                        </div>

                                        <!-- Step 2: Period Selection (hidden initially) -->
                                        <div id="period-selection-section" style="display: none;">
                                            <div class="card bg-light mb-3">
                                                <div class="card-header">
                                                    <h6 class="mb-0">
                                                        <i class="bi bi-calendar me-2"></i>Period Selection
                                                    </h6>
                                                </div>
                                                <div class="card-body">
                                                    <div class="mb-3" id="aoc-selection-container" style="display: none;">
                                                        <label for="attribute-option-combo" class="form-label">Attribute Option Combination</label>
                                                        <select class="form-select" id="attribute-option-combo">
                                                            <option value="">Default</option>
                                                        </select>
                                                        <div class="form-text">Select specific attribute option combination if required (e.g. Funding Source)</div>
                                                    </div>

                                                    <div id="dataset-info-display" class="mb-3"></div>

                                                    <div class="mb-3">
                                                        <label for="period-type" class="form-label">Period Type</label>
                                                        <select class="form-select" id="period-type" onchange="app.updatePeriodPicker()">
                                                            <option value="">Select period type...</option>
                                                        </select>
                                                    </div>

                                                    <div class="mb-3">
                                                        <label for="period-select" class="form-label">Select Periods</label>
                                                        <select class="form-select" id="period-select" multiple size="6">
                                                            <option value="">No periods available</option>
                                                        </select>
                                                        <div class="form-text">Hold Ctrl/Cmd to select multiple periods</div>
                                                    </div>

                                                    <div class="alert alert-info">
                                                        <i class="bi bi-info-circle me-2"></i>
                                                        <strong>Auto-Discovery:</strong> Organization units will be automatically discovered from your assigned org units.
                                                        The system will find all org units with data for the selected dataset and periods.
                                                    </div>

                                                    <div class="form-check mb-3">
                                                        <input class="form-check-input" type="checkbox" id="mark-complete-checkbox">
                                                            <label class="form-check-label" for="mark-complete-checkbox">
                                                                Mark datasets as complete after transfer
                                                                <small class="text-muted d-block">Registers completion in destination instance</small>
                                                            </label>
                                                    </div>

                                                    <button type="button" class="btn btn-success" onclick="app.startDataTransfer()" id="start-transfer-btn" disabled>
                                                        <i class="bi bi-play me-1"></i>Start Transfer
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Step 3: Transfer Progress -->
                                        <div id="transfer-progress-section" style="display: none;">
                                            <div class="card">
                                                <div class="card-header">
                                                    <h6 class="mb-0">
                                                        <i class="bi bi-hourglass-split me-2"></i>Transfer in Progress
                                                    </h6>
                                                </div>
                                                <div class="card-body">
                                                    <div id="transfer-progress-content"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Metadata Subtab -->
                                <div class="tab-pane fade" id="subtab-pane-metadata" role="tabpanel">
                                    <div id="metadata-transfer-content">
                                        <div class="alert alert-info">
                                            <i class="bi bi-info-circle me-2"></i>
                                            Assess metadata differences between source and destination before data transfers. No changes will be applied in this step.
                                        </div>

                                        <!-- Scope Selection -->
                                        <form id="metadata-scope-form" class="mb-3">
                                            <div class="row g-2">
                                                <div class="col-md-12">
                                                    <label class="form-label">Scope</label>
                                                    <div class="d-flex flex-wrap gap-2">
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" value="organisationUnits" id="md_ou" checked>
                                                                <label class="form-check-label" for="md_ou">Organisation Units</label>
                                                        </div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" value="categories" id="md_cat" checked>
                                                                <label class="form-check-label" for="md_cat">Categories/Combos</label>
                                                        </div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" value="categoryOptions" id="md_copt" checked>
                                                                <label class="form-check-label" for="md_copt">Category Options/COCs</label>
                                                        </div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" value="optionSets" id="md_opt" checked>
                                                                <label class="form-check-label" for="md_opt">Option Sets</label>
                                                        </div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" value="dataElements" id="md_de" checked>
                                                                <label class="form-check-label" for="md_de">Data Elements</label>
                                                        </div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" value="dataSets" id="md_ds" checked>
                                                                <label class="form-check-label" for="md_ds">Datasets</label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="mt-3 d-flex gap-2">
                                                <button type="button" id="btn-run-assessment" class="btn btn-primary" onclick="app.startMetadataAssessment()">
                                                    <i class="bi bi-search me-1"></i>Run Assessment
                                                </button>
                                            </div>
                                        </form>

                                        <!-- Progress Display -->
                                        <div id="metadata-progress" class="mb-3"></div>

                                        <!-- Results Display -->
                                        <div id="metadata-results"></div>

                                        <!-- Action Buttons (hidden until assessment complete) -->
                                        <div id="metadata-actions" class="mt-3 pt-3 border-top" style="display: none;">
                                            <div class="d-flex gap-2 flex-wrap">
                                                <button type="button" class="btn btn-outline-secondary" onclick="app.openSuggestionReview()">
                                                    <i class="bi bi-list-check me-1"></i>Review Suggestions
                                                </button>
                                                <button type="button" class="btn btn-outline-dark" onclick="app.previewMetadataPayload()">
                                                    <i class="bi bi-eye me-1"></i>Preview Payload
                                                </button>
                                                <button type="button" class="btn btn-outline-primary" onclick="app.runMetadataDryRun()">
                                                    <i class="bi bi-play-circle me-1"></i>Dry-Run Import
                                                </button>
                                                <button type="button" class="btn btn-success" onclick="app.applyMetadataImport()">
                                                    <i class="bi bi-check2-circle me-1"></i>Apply (After Dry-Run)
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Tracker Subtab -->
                                <div class="tab-pane fade" id="subtab-pane-tracker" role="tabpanel">
                                    <div id="tracker-transfer-content">
                                        <div class="alert alert-info">
                                            <i class="bi bi-info-circle me-2"></i>
                                            Event-only programs supported. Select a program and date range to preview and transfer events.
                                        </div>

                                        <form id="tracker-form" class="mb-3">
                                            <!-- Program Selection -->
                                            <div class="row g-3">
                                                <div class="col-md-6">
                                                    <label class="form-label">Program (source)</label>
                                                    <select class="form-select" id="trk-program">
                                                        <option value="">Choose a program...</option>
                                                    </select>
                                                    <div class="form-text">Event-only programs recommended. List loads from source.</div>
                                                </div>
                                                <div class="col-md-6">
                                                    <label class="form-label">Program Stage (optional)</label>
                                                    <select class="form-select" id="trk-stage">
                                                        <option value="">Any stage</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <!-- Org Unit and Date Selection -->
                                            <div class="row g-3 mt-1">
                                                <div class="col-md-4">
                                                    <label class="form-label">Org Unit (source)</label>
                                                    <input type="text" class="form-control" id="trk-orgunit-input" placeholder="Enter org unit UID" />
                                                    <div class="form-text">Enter source org unit UID; descendants will be included</div>
                                                </div>
                                                <div class="col-md-4">
                                                    <label class="form-label">Start Date</label>
                                                    <input type="date" class="form-control" id="trk-start-date" />
                                                    <div class="form-text">Start date for event query</div>
                                                </div>
                                                <div class="col-md-4">
                                                    <label class="form-label">End Date</label>
                                                    <input type="date" class="form-control" id="trk-end-date" />
                                                    <div class="form-text">End date for event query</div>
                                                </div>
                                            </div>

                                            <!-- Action Buttons -->
                                            <div class="mt-3 d-flex gap-2">
                                                <button type="button" class="btn btn-outline-primary" onclick="app.previewTrackerEvents()" id="trk-preview-btn">
                                                    <i class="bi bi-search me-1"></i>Preview
                                                </button>
                                                <button type="button" class="btn btn-success" onclick="app.startTrackerTransfer(false)" id="trk-transfer-btn" disabled>
                                                    <i class="bi bi-play me-1"></i>Transfer
                                                </button>
                                                <button type="button" class="btn btn-secondary" onclick="app.startTrackerTransfer(true)" id="trk-dryrun-btn" disabled>
                                                    <i class="bi bi-play-circle me-1"></i>Dry Run
                                                </button>
                                            </div>
                                        </form>

                                        <!-- Preview Display -->
                                        <div id="trk-preview" class="mb-3"></div>

                                        <!-- Progress Display -->
                                        <div id="trk-progress" class="mb-3"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

        `;
    }

    renderCompletenessTab() {
        return `
            <!-- Completeness Tab -->
                <div class="tab-pane fade" id="completeness-pane" role="tabpanel" aria-labelledby="completeness-tab">
                    <div class="row">
                        <div class="col-md-8">
                            <div class="card">
                                <div class="card-header">
                                    <h6 class="mb-0"><i class="bi bi-check2-square me-2"></i>Completeness Assessment</h6>
                                </div>
                                <div class="card-body">
                                    <form id="comp-form">
                                        <div class="row g-3">
                                            <div class="col-md-6">
                                                <label class="form-label">Instance</label>
                                                <select id="comp_instance" class="form-select">
                                                    <option value="source">Source</option>
                                                    <option value="dest">Destination</option>
                                                </select>
                                            </div>
                                            <div class="col-md-6">
                                                <label class="form-label">Dataset</label>
                                                <select id="comp_dataset_id" class="form-select">
                                                    <option value="">Choose a dataset...</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div class="row g-3 mt-1">
                                            <div class="col-md-12">
                                                <label class="form-label">Organization Units</label>
                                                <div id="comp-ou-picker-container"></div>
                                                <div class="form-text">Select one or more organization units from the hierarchy</div>
                                            </div>
                                        </div>

                                        <div class="row g-3 mt-1">
                                            <div class="col-md-12">
                                                <div id="comp-de-picker-container"></div>
                                            </div>
                                        </div>

                                        <div class="row g-3 mt-1">
                                            <div class="col-md-6">
                                                <label class="form-label">Quick Periods</label>
                                                <div class="d-flex flex-wrap gap-2" id="comp-period-chips">
                                                    <button type="button" class="btn btn-sm btn-outline-primary" data-period-chip="this-month">This Month</button>
                                                    <button type="button" class="btn btn-sm btn-outline-primary" data-period-chip="last-month">Last Month</button>
                                                    <button type="button" class="btn btn-sm btn-outline-primary" data-period-chip="last-quarter">Last Quarter</button>
                                                    <button type="button" class="btn btn-sm btn-outline-primary" data-period-chip="this-year">This Year</button>
                                                </div>
                                            </div>
                                            <div class="col-md-6">
                                                <label class="form-label">Custom Periods</label>
                                                <select id="comp-period-select" class="form-select" multiple size="5"></select>
                                                <div class="form-text">Use Cmd/Ctrl + Click to select multiple periods.</div>
                                            </div>
                                        </div>

                                        <div class="mt-2" id="comp-period-summary">
                                            <small class="text-muted">Choose at least one period to enable the assessment.</small>
                                        </div>

                                        <div class="row g-3 mt-1">
                                            <div class="col-md-6">
                                                <label class="form-label">Compliance Threshold (%)</label>
                                                <input id="comp_threshold" type="number" class="form-control" value="100" min="0" max="100" />
                                            </div>
                                            <div class="col-md-6 d-flex align-items-end">
                                                <div class="form-check">
                                                    <input id="comp_include_parents" class="form-check-input" type="checkbox" />
                                                    <label class="form-check-label" for="comp_include_parents">Include Parents</label>
                                                </div>
                                            </div>
                                        </div>
                                    </form>

                                    <div class="mt-3 d-flex gap-2">
                                        <button class="btn btn-primary" onclick="app.startCompletenessAssessment()" id="comp-run-btn" type="button">
                                            <i class="bi bi-play-circle me-1"></i>Run Assessment
                                        </button>
                                    </div>

                                    <div id="comp-progress" class="mt-3"></div>

                                    <div id="comp-actions" class="mt-3">
                                        <div class="d-flex gap-2">
                                            <button class="btn btn-outline-primary" id="comp-export-json" onclick="app.exportCompleteness('json')" disabled title="Run an assessment to enable exports">
                                                <i class="bi bi-filetype-json me-1"></i>Export JSON
                                            </button>
                                            <button class="btn btn-outline-secondary" id="comp-export-csv" onclick="app.exportCompleteness('csv')" disabled title="Run an assessment to enable exports">
                                                <i class="bi bi-filetype-csv me-1"></i>Export CSV
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-4">
                            <div class="card">
                                <div class="card-header"><h6 class="mb-0">Results</h6></div>
                                <div class="card-body">
                                    <div id="comp-results" class="small">No results yet.</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Tab change events
        const tabButtons = document.querySelectorAll('button[data-bs-toggle="tab"]');

        tabButtons.forEach(button => {
            button.addEventListener('shown.bs.tab', (event) => {
                const target = event.target.getAttribute('data-bs-target');

                // Load content when switching tabs
                if (target === '#dashboard-pane') {
                    this.loadDashboard();
                } else if (target === '#settings-pane') {
                    this.loadSettings();
                } else if (target === '#transfer-pane') {
                    this.loadTransferTab();
                } else if (target === '#completeness-pane') {
                    this.loadCompletenessTab();
                } else if (target === '#audit-pane') {
                    this.loadAuditTab();
                }
            });
        });
    }

    /**
     * Load dashboard with recent jobs
     */
    async loadDashboard() {
        console.log('Loading dashboard...');
        await this.refreshJobHistory();
        await this.updateSystemStatus();
    }

    /**
     * Refresh job history table
     */
    async loadSettings() {
        // If we are already on the settings tab, just refresh the current view
        const activeTab = document.querySelector('#settingsTabs .nav-link.active');
        if (activeTab && activeTab.id === 'pills-schedules-tab') {
            this.loadSchedules();
            return;
        }

        this.loadProfiles();
    }

    async loadSchedules() {
        const container = document.getElementById('scheduler-content');

        if (!this.currentProfile) {
            if (container) {
                container.innerHTML = `
                    <div class="text-center py-5">
                        <i class="bi bi-hdd-network text-muted fs-1 mb-3"></i>
                        <h5>No Profile Selected</h5>
                        <p class="text-muted">Please select a connection profile to manage scheduled jobs.</p>
                        <button class="btn btn-primary" onclick="document.getElementById('pills-profiles-tab').click()">
                            Go to Profiles
                        </button>
                    </div>
                `;
            }
            return;
        }

        if (this.scheduler) {
            // Ensure scheduler has the current profile
            this.scheduler.setProfile(this.currentProfile.id);
            // Load and render jobs
            await this.scheduler.loadJobs();
        }
    }

    /**
     * Initialize org unit picker for Transfer tab
     */
    async initTransferOUPicker() {
        if (this.dataOUPicker) {
            // Already initialized
            return;
        }

        if (!this.currentProfile) {
            console.warn('[Transfer] No profile selected, skipping OU picker initialization');
            return;
        }

        try {
            // Dynamically import the OrgUnitTreePicker component
            const { OrgUnitTreePicker } = await import('./components/org-unit-tree.js');

            // Initialize the picker with correct parameters: (containerId, profileId, instance)
            this.dataOUPicker = new OrgUnitTreePicker(
                'data-ou-picker-container',
                this.currentProfile.id,
                'source'
            );

            // Call initialize() to render the picker
            await this.dataOUPicker.initialize();

            console.log('[Transfer] Org unit picker initialized');
        } catch (error) {
            console.error('[Transfer] Failed to initialize org unit picker:', error);
        }
    }

    async loadProfiles() {
        const content = document.getElementById('settings-content');
        if (!content) return;

        try {
            const profiles = await window.go.main.App.ListProfiles();

            if (!profiles || profiles.length === 0) {
                content.innerHTML = `
            <div class="text-center py-5" >
                        <div class="mb-3">
                            <i class="bi bi-hdd-network text-muted" style="font-size: 3rem;"></i>
                        </div>
                        <h5>No Connection Profiles</h5>
                        <p class="text-muted mb-4">Create a profile to connect source and destination DHIS2 instances.</p>
                        <button class="btn btn-primary" onclick="app.showProfileForm()">
                            <i class="bi bi-plus-circle me-2"></i>Create First Profile
                        </button>
                    </div >
            `;
                return;
            }

            let html = `
            <div class="d-flex justify-content-between align-items-center mb-3" >
                    <h5 class="mb-0">Saved Profiles</h5>
                    <button class="btn btn-sm btn-primary" onclick="app.showProfileForm()">
                        <i class="bi bi-plus-circle me-2"></i>New Profile
                    </button>
                </div >
            <div class="list-group">
                `;

            profiles.forEach(p => {
                // Ensure loose comparison for ID or string conversion
                const isActive = this.currentProfile && String(this.currentProfile.id) === String(p.id);
                html += `
                <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center ${isActive ? 'active-profile-item border-primary' : ''}" style="${isActive ? 'background-color: #f8f9fa;' : ''}">
                    <div class="d-flex align-items-center" onclick="window.app.selectProfile('${p.id}')" style="cursor: pointer; flex-grow: 1;">
                        <div class="me-3">
                            <i class="bi bi-hdd-network fs-4 ${isActive ? 'text-primary' : 'text-secondary'}"></i>
                        </div>
                        <div>
                            <h6 class="mb-0 fw-bold ${isActive ? 'text-primary' : ''}">${p.name} ${isActive ? '<span class="badge bg-primary ms-2">Active</span>' : ''}</h6>
                            <small class="text-muted">
                                ${p.source_url} <i class="bi bi-arrow-right mx-1"></i> ${p.dest_url}
                            </small>
                        </div>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-outline-secondary" onclick="app.editProfile('${p.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="app.deleteProfile('${p.id}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
                `;
            });

            html += '</div>';
            content.innerHTML = html;

        } catch (err) {
            console.error("Failed to load profiles:", err);
            content.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    Failed to load profiles: ${err}
                </div>
            `;
        }
    }

    async selectProfile(id) {
        try {
            await window.go.main.App.SelectProfile(id);

            // Fetch profiles to get the selected one
            const profiles = await App.ListProfiles();
            this.currentProfile = profiles.find(p => String(p.id) === String(id));

            if (!this.currentProfile) {
                throw new Error("Selected profile not found in list");
            }

            // Update Scheduler with new profile
            if (this.scheduler) {
                this.scheduler.setProfile(id);
            } else {
                console.warn('Scheduler instance not found!');
            }

            // Update UI
            this.updateUIForProfile();
            await this.loadProfiles(); // Reload to show active state

            toast.success(`Profile "${this.currentProfile.name}" activated`);
        } catch (err) {
            console.error("Failed to select profile:", err);
            toast.error(`Failed to select profile: ${err.message || err}`);
        }
    }

    updateUIForProfile() {
        if (!this.currentProfile) return;

        // Update header status
        const statusText = document.getElementById('connection-status-text');
        const statusIndicator = document.querySelector('.connection-status');

        if (statusText) {
            statusText.textContent = `Active: ${this.currentProfile.name}`;
            statusText.classList.remove('text-muted');
            statusText.classList.add('text-success', 'fw-bold');
        }

        if (statusIndicator) {
            statusIndicator.classList.remove('unknown');
            statusIndicator.classList.add('connected');
            statusIndicator.style.backgroundColor = '#198754';
        }

        // Update Dashboard Status
        const sourceBadge = document.getElementById('status-source-badge');
        const destBadge = document.getElementById('status-dest-badge');

        if (sourceBadge) {
            sourceBadge.className = 'badge bg-success';
            sourceBadge.textContent = 'Connected';
            sourceBadge.title = this.currentProfile.source_url;
        }

        if (destBadge) {
            destBadge.className = 'badge bg-success';
            destBadge.textContent = 'Connected';
            destBadge.title = this.currentProfile.dest_url;
        }

        // Refresh other tabs if needed
        this.loadDatasets();
        this.loadDestinationDatasets();
        this.loadTrackerPrograms();
        this.initCompletenessOUPicker();
    }

    /**
     * Wrapper method for completeness module to list datasets
     * @param {string} instance - 'source' or 'dest'
     * @returns {Promise<Array>} List of datasets
     */
    async listDatasets(instance) {
        if (!this.currentProfile) {
            throw new Error('No profile selected');
        }
        return await App.ListDatasets(this.currentProfile.id, instance);
    }

    /**
     * Wrapper method for completeness module to list org units
     * @param {string} parentId - Parent org unit ID (empty string for roots)
     * @param {string} instance - 'source' or 'dest'
     * @returns {Promise<Array>} List of organization units
     */
    async listOrgUnits(parentId, instance) {
        if (!this.currentProfile) {
            throw new Error('No profile selected');
        }

        if (parentId) {
            // Get children of specific org unit
            return await App.GetOrgUnitChildren(this.currentProfile.id, instance, parentId);
        } else {
            // Get root level org units (level 1)
            return await App.ListOrganisationUnits(this.currentProfile.id, instance, 1);
        }
    }

    async refreshJobHistory() {
        const container = document.getElementById('job-history-container');
        if (!container) return;

        try {
            const jobs = await App.ListJobs(10); // Get last 10 jobs

            if (!jobs || jobs.length === 0) {
                // Enhanced empty state
                container.innerHTML = `
                    <div class="text-center py-5">
                        <i class="bi bi-inbox text-muted" style="font-size: 4rem;"></i>
                        <h4 class="mt-3 mb-2">No Jobs Yet</h4>
                        <p class="text-muted mb-4">Your job history will appear here once you start running transfers, audits, or completeness checks.</p>
                        <div class="d-flex gap-2 justify-content-center">
                            <button class="btn btn-outline-primary" onclick="app.switchToTab('settings-tab')">
                                <i class="bi bi-hdd-network me-2"></i>Configure Connection
                            </button>
                            <button class="btn btn-outline-secondary" onclick="app.switchToTab('transfer-tab')">
                                <i class="bi bi-arrow-left-right me-2"></i>Start Transfer
                            </button>
                        </div>
                    </div>
                `;
                return;
            }

            // Render job history table
            const tableHtml = jobs.map(job => {
                // Comprehensive status badge mapping
                let statusBadge;
                switch (job.status) {
                    case 'completed':
                        statusBadge = '<span class="badge bg-success">Completed</span>';
                        break;
                    case 'failed':
                    case 'error':
                        statusBadge = '<span class="badge bg-danger">Failed</span>';
                        break;
                    case 'running':
                        statusBadge = `<span class="badge bg-primary">Running (${job.progress || 0}%)</span>`;
                        break;
                    case 'starting':
                        statusBadge = '<span class="badge bg-info">Starting...</span>';
                        break;
                    case 'stopped':
                        statusBadge = '<span class="badge bg-warning">Stopped</span>';
                        break;
                    default:
                        statusBadge = `<span class="badge bg-secondary">${job.status || 'Unknown'}</span>`;
                }

                const startedAt = new Date(job.started_at).toLocaleString();
                const completedAt = job.completed_at ? new Date(job.completed_at).toLocaleString() : '-';

                return `
            <tr>
                        <td>${job.job_type || 'Unknown'}</td>
                        <td>${statusBadge}</td>
                        <td><small>${startedAt}</small></td>
                        <td><small>${completedAt}</small></td>
                        <td><small>${job.summary}</small></td>
                    </tr >
            `;
            }).join('');

            container.innerHTML = `
            <div class="table-responsive" >
                <table class="table table-sm table-hover align-middle">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Started</th>
                            <th>Completed</th>
                            <th>Summary</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableHtml}
                    </tbody>
                </table>
                </div>
            `;
        } catch (error) {
            console.error('Failed to load job history:', error);
            container.innerHTML = `
            <div class="alert alert-danger" >
                <i class="bi bi-exclamation-triangle me-2"></i>
                    Failed to load job history: ${error.message}
                </div>
            `;
        }
    }

    /**
     * Update system status card
     */
    async updateSystemStatus() {
        const container = document.getElementById('system-status-container');
        if (!container) return;

        try {
            const profiles = await App.ListProfiles();
            const profileCount = profiles ? profiles.length : 0;

            // Check if there's a selected profile
            const hasProfile = this.currentProfile !== null;

            container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2" >
                    <span>Source Connection</span>
                    <span class="badge ${hasProfile ? 'bg-success' : 'bg-secondary'}">${hasProfile ? 'Configured' : 'Not Configured'}</span>
                </div>
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span>Destination Connection</span>
                    <span class="badge ${hasProfile ? 'bg-success' : 'bg-secondary'}">${hasProfile ? 'Configured' : 'Not Configured'}</span>
                </div>
                <div class="d-flex justify-content-between align-items-center">
                    <span>Sync Profiles</span>
                    <span class="badge ${profileCount > 0 ? 'bg-primary' : 'bg-secondary'}">${profileCount}</span>
                </div>
        `;
        } catch (error) {
            console.error('Failed to update system status:', error);
        }
    }

    /**
     * Switch to a specific tab
     */
    switchToTab(tabId) {
        const tabElement = document.getElementById(tabId);
        if (tabElement) {
            const tab = new bootstrap.Tab(tabElement);
            tab.show();
        }
    }

    /**
     * Load Transfer tab - populate datasets and programs
     */
    async loadTransferTab() {
        await this.loadDatasets();
        await this.loadDestinationDatasets();
        await this.loadTrackerPrograms();
    }

    /**
     * Load datasets from selected profile
     */
    async loadDatasets() {
        const datasetSelect = document.getElementById('source_dataset');
        if (!datasetSelect) return;

        if (!this.currentProfile) {
            datasetSelect.innerHTML = '<option value="">No profile selected - go to Settings</option>';
            return;
        }

        try {
            datasetSelect.innerHTML = '<option value="">Loading datasets...</option>';

            const datasets = await App.ListDatasets(this.currentProfile.id, 'source');

            if (!datasets || datasets.length === 0) {
                datasetSelect.innerHTML = '<option value="">No datasets available</option>';

                // Show empty state message
                const transferContent = document.getElementById('data-transfer-content');
                if (transferContent) {
                    const emptyState = `
                        <div class="text-center py-5">
                            <i class="bi bi-database text-muted" style="font-size: 4rem;"></i>
                            <h4 class="mt-3 mb-2">No Datasets Available</h4>
                            <p class="text-muted mb-4">No datasets were found in the source instance. Please check your connection or contact your DHIS2 administrator.</p>
                            <button class="btn btn-outline-primary" onclick="app.switchToTab('settings-tab')">
                                <i class="bi bi-hdd-network me-2"></i>Check Connection
                            </button>
                        </div>
                    `;
                    transferContent.insertAdjacentHTML('afterbegin', emptyState);
                }
                return;
            }

            datasetSelect.innerHTML = '<option value="">Choose a dataset...</option>';
            datasets.forEach(ds => {
                const option = document.createElement('option');
                option.value = ds.id;
                option.textContent = ds.displayName || ds.name;
                datasetSelect.appendChild(option);
            });

            if (!datasetSelect.dataset.listenerAdded) {
                datasetSelect.addEventListener('change', () => {
                    const loadBtn = document.getElementById('load-dataset-btn');
                    if (loadBtn) {
                        loadBtn.disabled = !datasetSelect.value;
                    }

                    if (datasetSelect.value) {
                        this.loadDatasetInfo();
                    } else {
                        this.resetDatasetState();
                    }
                });
                datasetSelect.dataset.listenerAdded = 'true';
            }

            // Initialize org unit picker for Transfer tab
            await this.initTransferOUPicker();

        } catch (error) {
            console.error('Failed to load datasets:', error);
            datasetSelect.innerHTML = '<option value="">Error loading datasets</option>';
            toast.error(`Failed to load datasets: ${error} `);
        }
    }

    /**
     * Load destination datasets for mapping override
     */
    async loadDestinationDatasets() {
        const destSelect = document.getElementById('dest_dataset');
        if (!destSelect) return;

        if (!this.currentProfile) {
            destSelect.innerHTML = '<option value="">No profile selected - go to Settings</option>';
            return;
        }

        try {
            destSelect.innerHTML = '<option value="">Loading datasets...</option>';
            const datasets = await App.ListDatasets(this.currentProfile.id, 'dest');

            if (!datasets || datasets.length === 0) {
                destSelect.innerHTML = '<option value="">No datasets found</option>';
                return;
            }

            destSelect.innerHTML = '<option value="">Match source dataset</option>';
            datasets.forEach(ds => {
                const option = document.createElement('option');
                option.value = ds.id;
                option.textContent = ds.displayName || ds.name;
                destSelect.appendChild(option);
            });

            if (!destSelect.dataset.listenerAdded) {
                destSelect.addEventListener('change', () => this.updateMappingDetails());
                destSelect.dataset.listenerAdded = 'true';
            }

            this.updateMappingDetails();

        } catch (error) {
            console.error('Failed to load destination datasets:', error);
            destSelect.innerHTML = '<option value="">Error loading datasets</option>';
            toast.error(`Failed to load destination datasets: ${error} `);
        }
    }

    /**
     * Load dataset info and show period selection
     */
    async loadDatasetInfo() {

        const datasetSelect = document.getElementById('source_dataset');
        const datasetId = datasetSelect?.value;

        if (!datasetId || !this.currentProfile) {
            console.warn('[Transfer] Missing dataset or profile');
            toast.warning('Please select a dataset first');
            return;
        }

        this.updateTransferStepper('dataset');

        // Reset mark complete checkbox when dataset changes
        const markCompleteCheckbox = document.getElementById('mark-complete-checkbox');
        if (markCompleteCheckbox) {
            markCompleteCheckbox.checked = false;
        }

        try {
            const infoDisplay = document.getElementById('dataset-info-display');
            if (infoDisplay) {
                infoDisplay.innerHTML = '<div class="spinner-border spinner-border-sm me-2"></div>Loading dataset info...';
            }

            // Fixed: Pass profile ID instead of full object
            const info = await App.GetDatasetInfo(this.currentProfile.id, datasetId, 'source');

            this.currentDatasetInfo = info;

            // Display dataset info
            if (infoDisplay) {
                const elementCount = info.dataElements?.length || 0;
                const comboCount = info.categoryCombos?.length || 0;
                const orgCount = info.organisationUnits?.length || 0;
                infoDisplay.innerHTML = renderSectionState({
                    title: info.displayName || info.name || 'Dataset',
                    subtitle: `${info.periodType || 'Unknown period type'} • ${elementCount} data elements`,
                    status: 'info',
                    body: `
            <div class="row g-2" >
                            <div class="col-md-4">
                                <small class="text-muted d-block">Category Combos</small>
                                <span class="fw-semibold">${comboCount}</span>
                        </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block">Assigned Org Units</small>
                                <span class="fw-semibold">${orgCount}</span>
                    </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block">Period Type</small>
                                <span class="fw-semibold">${this.escapeHtml(info.periodType || 'N/A')}</span>
                            </div>
                        </div>
            `
                });
            }

            // Populate period type selector
            const periodTypeSelect = document.getElementById('period-type');
            if (periodTypeSelect && info.periodType) {
                periodTypeSelect.innerHTML = `<option value= "${info.periodType}" selected> ${info.periodType}</option> `;
                this.updatePeriodPicker(info.periodType);
            }

            // Populate Attribute Option Combo selector
            const aocContainer = document.getElementById('aoc-selection-container');
            const aocSelect = document.getElementById('attribute-option-combo');

            if (aocContainer && aocSelect) {
                aocSelect.innerHTML = '<option value="">Default</option>';

                if (info.categoryCombo && info.categoryCombo.categoryOptionCombos && info.categoryCombo.categoryOptionCombos.length > 0) {
                    const options = info.categoryCombo.categoryOptionCombos.filter(coc => coc.name.toLowerCase() !== 'default');

                    if (options.length > 0) {
                        options.forEach(coc => {
                            const option = document.createElement('option');
                            option.value = coc.id;
                            option.textContent = coc.name;
                            aocSelect.appendChild(option);
                        });
                        aocContainer.style.display = 'block';
                    } else {
                        aocContainer.style.display = 'none';
                    }
                } else {
                    aocContainer.style.display = 'none';
                }
            }

            // Show period selection section
            const periodSection = document.getElementById('period-selection-section');
            if (periodSection) {
                periodSection.style.display = 'block';
            }

            const previewSection = document.getElementById('data-preview-section');
            if (previewSection) {
                previewSection.style.display = 'block';
            }

            const mappingSection = document.getElementById('mapping-section');
            if (mappingSection) {
                mappingSection.style.display = 'block';
            }

            // Default destination dataset to match source if available
            const destSelect = document.getElementById('dest_dataset');
            if (destSelect && datasetId && destSelect.querySelector(`option[value = "${datasetId}"]`)) {
                destSelect.value = datasetId;
            }
            this.updateMappingDetails();

            this.updateTransferStepper('periods');
            this.handlePeriodSelectionChange();

            // Initialize OU picker if not already initialized
            // OU picker no longer needed - org units are auto-discovered

            toast.success('Dataset info loaded successfully');

        } catch (error) {
            console.error('Failed to load dataset info:', error);
            toast.error(`Failed to load dataset info: ${error} `);
            this.resetDatasetState();
            const infoDisplay = document.getElementById('dataset-info-display');
            if (infoDisplay) {
                infoDisplay.innerHTML = `
            <div class="alert alert-danger" >
                <i class="bi bi-x-circle me-2"></i>Failed to load dataset details.Try refreshing or check your connection.
                    </div>
            `;
            }
        }
    }

    /**
     * Initialize org unit picker for Transfer tab
     */
    // initTransferOUPicker() removed - org units are auto-discovered from user's assigned OUs

    /**
     * Update period picker based on selected period type
     */
    updatePeriodPicker(periodType) {
        const periodTypeSelect = document.getElementById('period-type');
        const periodSelect = document.getElementById('period-select');

        if (!periodSelect) return;

        const type = periodType || periodTypeSelect?.value;
        if (!type) {
            periodSelect.innerHTML = '<option value="">Select period type first</option>';
            return;
        }

        try {
            // Import periods utility
            import('./utils/periods.js').then(module => {
                // Use a larger history window for shorter periods to allow more flexible selection
                let count = 12;
                switch (type) {
                    case 'Daily':
                        count = 90; // roughly last 3 months
                        break;
                    case 'Weekly':
                    case 'WeeklyWednesday':
                    case 'WeeklyThursday':
                    case 'WeeklySaturday':
                    case 'WeeklySunday':
                    case 'BiWeekly':
                        count = 52; // roughly last year of weeks/biweeks
                        break;
                    case 'Monthly':
                        count = 24; // last 2 years of months
                        break;
                    default:
                        count = 12; // keep sensible default for longer periods
                }

                const periods = module.generatePeriods(type, count);

                periodSelect.innerHTML = '';
                periods.forEach(period => {
                    const option = document.createElement('option');
                    option.value = period.id;
                    option.textContent = period.name;
                    periodSelect.appendChild(option);
                });

                // Make list taller when many periods are available
                if (count > 20) {
                    periodSelect.size = 10;
                }

                if (!periodSelect.dataset.listenerAdded) {
                    periodSelect.addEventListener('change', () => this.handlePeriodSelectionChange());
                    periodSelect.dataset.listenerAdded = 'true';
                }

                this.handlePeriodSelectionChange();
            });
        } catch (error) {
            console.error('Failed to generate periods:', error);
            periodSelect.innerHTML = '<option value="">Error generating periods</option>';
        }
    }

    /**
     * Update mapping details UI
     */
    updateMappingDetails() {
        const mappingSection = document.getElementById('mapping-section');
        const sourceDatasetSelect = document.getElementById('source_dataset');
        const destDatasetSelect = document.getElementById('dest_dataset');
        const mappingInfo = document.getElementById('mapping-info');

        if (!mappingSection || !sourceDatasetSelect || !destDatasetSelect) return;

        const sourceId = sourceDatasetSelect.value;
        const destId = destDatasetSelect.value;

        if (!sourceId) {
            mappingSection.style.display = 'none';
            return;
        }

        mappingSection.style.display = 'block';

        if (sourceId === destId) {
            mappingInfo.innerHTML = `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle me-2"></i>
                    <strong>Direct Mapping:</strong> Source and destination datasets are the same. 
                    Data elements will be mapped by ID (or Code/Name if ID mapping fails).
                </div>
            `;
        } else {
            const sourceName = sourceDatasetSelect.options[sourceDatasetSelect.selectedIndex]?.text || sourceId;
            const destName = destDatasetSelect.options[destDatasetSelect.selectedIndex]?.text || destId;

            mappingInfo.innerHTML = `
                <div class="alert alert-warning">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    <strong>Cross-Dataset Mapping:</strong> 
                    Transferring from <strong>${this.escapeHtml(sourceName)}</strong> to <strong>${this.escapeHtml(destName)}</strong>.
                    <div class="mt-2 small">
                        Data elements will be matched by Code or Name. Elements that cannot be matched will be ignored.
                    </div>
                </div>
            `;
        }
    }

    /**
     * Start data transfer
     */
    async startDataTransfer() {
        const datasetSelect = document.getElementById('source_dataset');
        const periodSelect = document.getElementById('period-select');
        const destDatasetSelect = document.getElementById('dest_dataset');

        const datasetId = datasetSelect?.value;
        const selectedPeriods = Array.from(periodSelect?.selectedOptions || []).map(opt => opt.value);

        if (!datasetId || selectedPeriods.length === 0) {
            toast.warning('Please select dataset and periods');
            return;
        }

        // Get selected org units from picker (if any)
        let selectedOrgUnits = [];
        if (this.dataOUPicker) {
            selectedOrgUnits = this.dataOUPicker.getSelectedOrgUnits();
        }

        if (!this.currentProfile) {
            toast.error('No profile selected');
            return;
        }

        try {
            const startBtn = document.getElementById('start-transfer-btn');
            if (startBtn) {
                startBtn.disabled = true;
            }

            if (selectedOrgUnits.length > 0) {
                toast.info(`Starting transfer for ${selectedOrgUnits.length} selected org unit(s)...`);
            } else {
                toast.info('Starting transfer with auto-discovery (all accessible org units)...');
            }

            // Get checkbox value for marking datasets complete
            const markCompleteCheckbox = document.getElementById('mark-complete-checkbox');
            const markComplete = markCompleteCheckbox ? markCompleteCheckbox.checked : false;

            // Build transfer request
            const aocSelect = document.getElementById('attribute-option-combo');
            const request = {
                profile_id: this.currentProfile.id,
                source_dataset: datasetId,
                dest_dataset: destDatasetSelect?.value || datasetId,
                periods: selectedPeriods,
                mark_complete: markComplete,
                attribute_option_combo_id: aocSelect?.value || ''
            };

            // Add org units if selected (otherwise backend uses auto-discovery)
            if (selectedOrgUnits.length > 0) {
                request.org_units = selectedOrgUnits;
            }

            const taskId = await App.StartTransfer(request);

            const progressSection = document.getElementById('transfer-progress-section');
            if (progressSection) {
                progressSection.style.display = 'block';
            }
            const progressUI = this.mountProgressUI('transfer-progress-content', {
                title: 'Transfer in Progress',
                icon: 'bi bi-hourglass-split'
            });

            this.updateTransferStepper('transfer');

            progressTracker.track(taskId, 'transfer', {
                progressContainer: progressUI?.progressContainer,
                messageContainer: progressUI?.messageContainer,
                onComplete: (data) => {
                    if (startBtn) {
                        startBtn.disabled = false;
                    }
                    toast.success('Transfer completed successfully!');

                    if (progressUI?.messageContainer && data?.result) {
                        const imported = data.result.imported ?? data.result.created ?? 0;
                        const updated = data.result.updated ?? 0;
                        const ignored = data.result.ignored ?? 0;
                        progressUI.messageContainer.insertAdjacentHTML('beforeend', `
            <div class="alert alert-success mt-3" >
                                <strong>Transfer Complete!</strong>
                                <div class="mt-2">
                                    <div>Imported: ${imported}</div>
                                    <div>Updated: ${updated}</div>
                                    <div>Ignored: ${ignored}</div>
                            </div>
                            </div>
            `);
                    }
                },
                onError: (data) => {
                    if (startBtn) {
                        startBtn.disabled = false;
                    }
                    const message = data?.message || 'Transfer failed';
                    toast.error(message);
                }
            });

        } catch (error) {
            console.error('Failed to start transfer:', error);
            const startBtn = document.getElementById('start-transfer-btn');
            if (startBtn) {
                startBtn.disabled = false;
            }
            toast.error(`Failed to start transfer: ${error} `);
        }
    }

    /**
     * ========================================================================
     * METADATA ASSESSMENT METHODS
     * ========================================================================
     */

    /**
     * Start metadata assessment
     */
    async startMetadataAssessment() {
        const scope = Array.from(document.querySelectorAll('#metadata-scope-form input[type="checkbox"]:checked')).map(cb => cb.value);
        const progressDiv = document.getElementById('metadata-progress');
        const resultsDiv = document.getElementById('metadata-results');

        if (!this.currentProfile) {
            toast.error('No profile selected. Please go to Settings.');
            return;
        }

        const progressUI = this.mountProgressUI('metadata-progress');
        resultsDiv.innerHTML = '';
        this.setMetadataUIRunning(true);

        const actionsContainer = document.getElementById('metadata-actions');
        if (actionsContainer) {
            actionsContainer.style.display = 'none';
        }

        try {
            const taskId = await App.StartMetadataDiff(this.currentProfile.id, scope);
            progressTracker.track(taskId, 'metadata', {
                progressContainer: progressUI?.progressContainer,
                messageContainer: progressUI?.messageContainer,
                onComplete: (data) => {
                    this.setMetadataUIRunning(false);
                    if (actionsContainer) {
                        actionsContainer.style.display = 'block';
                    }
                    this.renderMetadataResults(data?.results);
                    toast.success('Metadata assessment completed');
                },
                onError: (data) => {
                    this.setMetadataUIRunning(false);
                    const message = data?.message || 'Metadata assessment failed';
                    if (progressDiv) {
                        progressDiv.innerHTML = `<div class="alert alert-danger" > <i class="bi bi-x-circle me-2"></i>${this.escapeHtml(message)}</div> `;
                    }
                    toast.error(message);
                }
            });
        } catch (error) {
            console.error('Failed to start metadata assessment:', error);
            progressDiv.innerHTML = `<div class="alert alert-danger" > <i class="bi bi-x-circle me-2"></i>${this.escapeHtml(String(error))}</div> `;
            this.setMetadataUIRunning(false);
        }
    }

    /**
     * Enable/disable metadata UI during assessment
     */
    setMetadataUIRunning(isRunning) {
        const btn = document.getElementById('btn-run-assessment');
        if (btn) btn.disabled = !!isRunning;

        // Disable scope checkboxes during run
        document.querySelectorAll('#metadata-scope-form input[type="checkbox"]').forEach(cb => cb.disabled = !!isRunning);
    }

    /**
     * Render metadata assessment results
     */
    renderMetadataResults(results) {
        const resultsDiv = document.getElementById('metadata-results');
        if (!results) {
            resultsDiv.innerHTML = '<div class="alert alert-warning">No results</div>';
            return;
        }

        // Store results in window for later use
        window.mdResults = results;
        window.mdPage = window.mdPage || {};

        const renderSectionList = (items, typeKey, sectionKey, pageSize = 25) => {
            const stateKey = `${typeKey}:${sectionKey} `;
            const page = (window.mdPage[stateKey] || 1);
            const start = 0;
            const end = page * pageSize;
            const slice = items.slice(start, end);
            const left = Math.max(0, items.length - slice.length);

            let body = '';
            if (sectionKey === 'missing') {
                body = slice.map(m => `<div class="small text-muted" > ${this.escapeHtml(m.name || m.code || m.id)}</div> `).join('');
            } else if (sectionKey === 'conflicts') {
                body = slice.map(c => `<div class="small text-muted" > ${this.escapeHtml(c.name || c.code || c.id)}</div> `).join('');
            } else if (sectionKey === 'suggestions') {
                body = slice.map(s => {
                    const sourceName = this.escapeHtml(s.source?.name || s.source?.code || s.source?.id);
                    const destName = this.escapeHtml(s.dest?.name || s.dest?.code || s.dest?.id);
                    const by = this.escapeHtml(s.by);
                    const confidence = this.escapeHtml(s.confidence);
                    return `<div class="small text-muted" > ${sourceName} → ${destName} (${by}, ${confidence})</div> `;
                }).join('');
            }

            const moreBtn = left > 0 ? `<button class="btn btn-sm btn-outline-secondary mt-2" onclick="app.loadMoreMd('${typeKey}','${sectionKey}')" > Load more(${left} remaining)</button> ` : '';
            return `${body}${moreBtn} `;
        };

        const makeCard = (title, key, data) => `
            <div class="card mb-3" >
                <div class="card-header"><strong>${this.escapeHtml(title)}</strong></div>
                <div class="card-body">
                    <div class="row mb-2">
                        <div class="col-md-4"><div class="badge bg-secondary">Missing: ${data.missing?.length || 0}</div></div>
                        <div class="col-md-4"><div class="badge bg-warning text-dark">Conflicts: ${data.conflicts?.length || 0}</div></div>
                        <div class="col-md-4"><div class="badge bg-info">Suggestions: ${data.suggestions?.length || 0}</div></div>
                    </div>
                    <div class="accordion" id="acc-${key}">
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="h-${key}-missing">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#c-${key}-missing">Missing</button>
                            </h2>
                            <div id="c-${key}-missing" class="accordion-collapse collapse" data-bs-parent="#acc-${key}">
                                <div class="accordion-body" id="md-${key}-missing">${renderSectionList(data.missing || [], key, 'missing')}</div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="h-${key}-conflicts">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#c-${key}-conflicts">Conflicts</button>
                            </h2>
                            <div id="c-${key}-conflicts" class="accordion-collapse collapse" data-bs-parent="#acc-${key}">
                                <div class="accordion-body" id="md-${key}-conflicts">${renderSectionList(data.conflicts || [], key, 'conflicts')}</div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="h-${key}-suggestions">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#c-${key}-suggestions">Suggestions</button>
                            </h2>
                            <div id="c-${key}-suggestions" class="accordion-collapse collapse" data-bs-parent="#acc-${key}">
                                <div class="accordion-body" id="md-${key}-suggestions">${renderSectionList(data.suggestions || [], key, 'suggestions')}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div> `;

        const order = [
            'organisationUnits', 'categories', 'categoryCombos', 'categoryOptions', 'categoryOptionCombos', 'optionSets', 'dataElements', 'dataSets'
        ];

        let html = '';
        for (const key of order) {
            if (results[key]) {
                html += makeCard(key, key, results[key]);
            }
        }

        resultsDiv.innerHTML = html || '<div class="alert alert-info">No differences detected.</div>';
    }

    /**
     * Load more items in metadata results section
     */
    loadMoreMd(typeKey, sectionKey) {
        const stateKey = `${typeKey}:${sectionKey} `;
        window.mdPage[stateKey] = (window.mdPage[stateKey] || 1) + 1;

        // Rerender the specific section
        const target = document.getElementById(`md - ${typeKey} -${sectionKey} `);
        if (!target) return;

        const data = window.mdResults[typeKey];
        const list = sectionKey === 'missing' ? data.missing : sectionKey === 'conflicts' ? data.conflicts : data.suggestions;

        // Recreate renderSectionList inline here
        const pageSize = 25;
        const page = window.mdPage[stateKey];
        const start = 0;
        const end = page * pageSize;
        const slice = list.slice(start, end);
        const left = Math.max(0, list.length - slice.length);

        let body = '';
        if (sectionKey === 'missing') {
            body = slice.map(m => `<div class="small text-muted" > ${this.escapeHtml(m.name || m.code || m.id)}</div> `).join('');
        } else if (sectionKey === 'conflicts') {
            body = slice.map(c => `<div class="small text-muted" > ${this.escapeHtml(c.name || c.code || c.id)}</div> `).join('');
        } else if (sectionKey === 'suggestions') {
            body = slice.map(s => {
                const sourceName = this.escapeHtml(s.source?.name || s.source?.code || s.source?.id);
                const destName = this.escapeHtml(s.dest?.name || s.dest?.code || s.dest?.id);
                const by = this.escapeHtml(s.by);
                const confidence = this.escapeHtml(s.confidence);
                return `<div class="small text-muted" > ${sourceName} → ${destName} (${by}, ${confidence})</div> `;
            }).join('');
        }

        const moreBtn = left > 0 ? `<button class="btn btn-sm btn-outline-secondary mt-2" onclick="app.loadMoreMd('${typeKey}','${sectionKey}')" > Load more(${left} remaining)</button> ` : '';
        target.innerHTML = `${body}${moreBtn} `;
    }

    /**
     * Open suggestion review modal
     */
    openSuggestionReview() {
        if (!window.mdResults) {
            alert('No results yet. Run an assessment first.');
            return;
        }

        // Create modal
        const container = document.createElement('div');
        container.className = 'modal fade';
        container.id = 'mdSuggestModal';
        container.tabIndex = -1;
        container.innerHTML = `
            <div class="modal-dialog modal-xl" >
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="bi bi-lightbulb me-2"></i>Metadata Mapping Suggestions</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="small text-muted mb-2">Select suggestions to save as mappings (stored in session).</div>
                        <div id="md-suggest-list" style="max-height:60vh; overflow:auto;"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" onclick="app.saveSelectedMappings()">Save Selected</button>
                    </div>
                </div>
        </div> `;

        document.body.appendChild(container);
        const modal = new bootstrap.Modal(container);
        modal.show();

        // Render suggestions
        const listDiv = container.querySelector('#md-suggest-list');
        const order = ['organisationUnits', 'categories', 'categoryCombos', 'categoryOptions', 'categoryOptionCombos', 'optionSets', 'dataElements', 'dataSets'];
        let html = '';

        for (const key of order) {
            const sec = window.mdResults[key];
            if (!sec || !sec.suggestions || sec.suggestions.length === 0) continue;

            html += `<div class="mb-2" > <strong>${this.escapeHtml(key)}</strong></div> `;
            html += sec.suggestions.slice(0, 200).map((s, idx) => {
                const sid = `${key} -${idx} `;
                const sName = this.escapeHtml(s.source?.name || s.source?.code || s.source?.id);
                const dName = this.escapeHtml(s.dest?.name || s.dest?.code || s.dest?.id);
                const by = this.escapeHtml(s.by);
                const confidence = this.escapeHtml(s.confidence);
                return `<div class="form-check" >
            <input class="form-check-input" type="checkbox" value="" id="chk-${sid}" data-type="${key}" data-source="${s.source?.id}" data-dest="${s.dest?.id}">
                <label class="form-check-label" for="chk-${sid}">
                    ${sName} → ${dName} <span class="text-muted">(${by}, ${confidence})</span>
                </label>
            </div>`;
            }).join('');
            html += '<hr />';
        }

        listDiv.innerHTML = html || '<div class="text-muted">No suggestions available.</div>';
    }

    /**
     * Save selected mappings
     */
    async saveSelectedMappings() {
        const checks = Array.from(document.querySelectorAll('#md-suggest-list .form-check-input:checked'));
        if (checks.length === 0) {
            alert('Select at least one suggestion to save');
            return;
        }

        const pairs = checks.map(chk => ({
            type: chk.getAttribute('data-type'),
            sourceId: chk.getAttribute('data-source'),
            destId: chk.getAttribute('data-dest')
        }));

        try {
            const saved = await App.SaveMetadataMappings(this.currentProfile.id, pairs);
            alert(`Saved ${saved} mapping(s).`);
            toast.success(`Saved ${saved} mapping(s).`);
        } catch (error) {
            console.error('Failed to save mappings:', error);
            alert(`Failed to save mappings: ${error} `);
        }
    }

    /**
     * Preview metadata payload
     */
    async previewMetadataPayload() {
        const scope = Array.from(document.querySelectorAll('#metadata-scope-form input[type="checkbox"]:checked')).map(cb => cb.value);
        const progressDiv = document.getElementById('metadata-progress');

        progressDiv.innerHTML = '<div class="alert alert-info"><i class="bi bi-eye me-2"></i>Building payload preview...</div>';

        try {
            const preview = await App.BuildMetadataPayloadPreview(this.currentProfile.id, scope, {});
            const summary = JSON.stringify(preview.counts || {}, null, 2);
            const snippet = JSON.stringify(preview.payload || {}, null, 2).slice(0, 4000);

            document.getElementById('metadata-results').innerHTML = `
            <div class="card mt-3" >
                    <div class="card-header"><strong>Payload Preview</strong></div>
                    <div class="card-body">
                        <div class="mb-2"><strong>Counts by type</strong></div>
                        <pre style="white-space: pre-wrap;">${this.escapeHtml(summary)}</pre>
                        <div class="mb-2"><strong>Payload (truncated)</strong></div>
                        <pre style="white-space: pre-wrap;">${this.escapeHtml(snippet)}</pre>
                    </div>
                </div> `;
        } catch (error) {
            console.error('Preview error:', error);
            document.getElementById('metadata-results').innerHTML = `<div class="alert alert-danger" > Preview error: ${this.escapeHtml(String(error))}</div> `;
        }
    }

    /**
     * Run metadata dry-run import
     */
    async runMetadataDryRun() {
        const scope = Array.from(document.querySelectorAll('#metadata-scope-form input[type="checkbox"]:checked')).map(cb => cb.value);
        const progressDiv = document.getElementById('metadata-progress');

        progressDiv.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split me-2"></i>Running dry-run...</div>';

        try {
            const preview = await App.BuildMetadataPayloadPreview(this.currentProfile.id, scope, {});
            const report = await App.MetadataDryRun(this.currentProfile.id, scope, preview.payload, {});
            document.getElementById('metadata-results').innerHTML = this.renderImportReport('Dry-Run Import Report', report);
        } catch (error) {
            console.error('Dry-run error:', error);
            document.getElementById('metadata-results').innerHTML = `<div class="alert alert-danger" > Dry - run failed: ${this.escapeHtml(String(error))}</div> `;
        }
    }

    /**
     * Apply metadata import
     */
    async applyMetadataImport() {
        if (!confirm('Are you sure you want to apply metadata changes to the destination? Make sure you ran a dry-run and reviewed the report.')) {
            return;
        }

        const scope = Array.from(document.querySelectorAll('#metadata-scope-form input[type="checkbox"]:checked')).map(cb => cb.value);
        const progressDiv = document.getElementById('metadata-progress');

        progressDiv.innerHTML = '<div class="alert alert-warning"><i class="bi bi-exclamation-triangle me-2"></i>Applying metadata... This may take a while.</div>';

        try {
            const preview = await App.BuildMetadataPayloadPreview(this.currentProfile.id, scope, {});
            const report = await App.MetadataApply(this.currentProfile.id, scope, preview.payload, {});
            document.getElementById('metadata-results').innerHTML = this.renderImportReport('Apply Import Report', report);
            toast.success('Metadata applied successfully!');
        } catch (error) {
            console.error('Apply error:', error);
            document.getElementById('metadata-results').innerHTML = `<div class="alert alert-danger" > Apply failed: ${this.escapeHtml(String(error))}</div> `;
            toast.error('Metadata apply failed!');
        }
    }

    /**
     * Render DHIS2 import report (for metadata dry-run/apply)
     */
    renderImportReport(title, raw) {
        const report = raw?.response || raw;
        const importCount = report?.importCount || report?.stats || {};
        const typeReports = report?.typeReports || [];

        const counts = {
            imported: importCount.imported ?? importCount.created ?? 0,
            updated: importCount.updated ?? 0,
            ignored: importCount.ignored ?? importCount.failed ?? 0,
            deleted: importCount.deleted ?? 0
        };

        const perType = typeReports.map(tr => {
            const stats = tr.stats || tr.importCount || {};
            const errors = (tr.objectReports || []).flatMap(o => (o.errorReports || []).map(e => e.message)).slice(0, 5);
            const klass = tr.klass || tr.type || 'Unknown';
            const typeName = (klass.includes('.') ? klass.split('.').pop() : klass);
            return {
                type: typeName,
                imported: stats.imported ?? stats.created ?? 0,
                updated: stats.updated ?? 0,
                ignored: stats.ignored ?? stats.failed ?? 0,
                errors
            };
        });

        const header = `
            <div class="card mt-3" >
              <div class="card-header"><strong>${this.escapeHtml(title)}</strong></div>
              <div class="card-body">
                <div class="row g-2 mb-2">
                  <div class="col-auto"><span class="badge bg-success">Imported: ${counts.imported}</span></div>
                  <div class="col-auto"><span class="badge bg-primary">Updated: ${counts.updated}</span></div>
                  <div class="col-auto"><span class="badge bg-warning text-dark">Ignored: ${counts.ignored}</span></div>
                  <div class="col-auto"><span class="badge bg-secondary">Deleted: ${counts.deleted}</span></div>
                </div>
                ${perType.length ? '<div class="mb-2"><strong>By type</strong></div>' : ''}
                ${perType.map(p => `
                  <div class="border rounded p-2 mb-2">
                    <div class="fw-bold">${this.escapeHtml(p.type)}</div>
                    <div class="small">
                      <span class="badge bg-success">Imported ${p.imported}</span>
                      <span class="badge bg-primary ms-1">Updated ${p.updated}</span>
                      <span class="badge bg-warning text-dark ms-1">Ignored ${p.ignored}</span>
                    </div>
                    ${p.errors.length ? `<div class="small text-danger mt-1">Errors: ${p.errors.map(e => `<div>• ${this.escapeHtml(e)}</div>`).join('')}</div>` : ''}
                  </div>`).join('')}
              </div>
            </div>
            `;

        const rawSnippet = JSON.stringify(raw, null, 2).slice(0, 3000);
        const rawBlock = `
            <div class="card mt-2" >
            <div class="card-header"><strong>Raw Report (truncated)</strong></div>
            <div class="card-body"><pre style="white-space: pre-wrap;">${this.escapeHtml(rawSnippet)}</pre></div>
          </div> `;

        return header + rawBlock;
    }

    /**
     * ========================================================================
     * TRACKER/EVENTS TRANSFER METHODS
     * ========================================================================
     */

    /**
     * Load tracker programs from source instance
     */
    async loadTrackerPrograms() {
        const programSelect = document.getElementById('trk-program');
        if (!programSelect) return;

        if (!this.currentProfile) {
            programSelect.innerHTML = '<option value="">No profile selected - go to Settings</option>';
            return;
        }

        try {
            programSelect.innerHTML = '<option value="">Loading programs...</option>';

            const programs = await App.ListTrackerPrograms(this.currentProfile.id, 'source', false, '');

            if (!programs || programs.length === 0) {
                programSelect.innerHTML = '<option value="">No programs found</option>';
                return;
            }

            programSelect.innerHTML = '<option value="">Choose a program...</option>';
            programs.forEach(prog => {
                const option = document.createElement('option');
                option.value = prog.id;
                option.textContent = prog.displayName || prog.name;
                option.dataset.withRegistration = prog.withRegistration;
                programSelect.appendChild(option);
            });

            // Load stages when program is selected
            programSelect.addEventListener('change', async () => {
                const programId = programSelect.value;
                if (programId) {
                    await this.loadProgramStages(programId);
                } else {
                    document.getElementById('trk-stage').innerHTML = '<option value="">Any stage</option>';
                }
            });

        } catch (error) {
            console.error('Failed to load tracker programs:', error);
            programSelect.innerHTML = '<option value="">Error loading programs</option>';
            toast.error(`Failed to load tracker programs: ${error} `);
        }
    }

    /**
     * Load program stages for selected program
     */
    async loadProgramStages(programId) {
        const stageSelect = document.getElementById('trk-stage');
        if (!stageSelect) return;

        try {
            stageSelect.innerHTML = '<option value="">Loading stages...</option>';

            const detail = await App.GetTrackerProgramDetail(this.currentProfile.id, programId, 'source');

            stageSelect.innerHTML = '<option value="">Any stage</option>';
            if (detail.programStages && detail.programStages.length > 0) {
                detail.programStages.forEach(stage => {
                    const option = document.createElement('option');
                    option.value = stage.id;
                    option.textContent = stage.displayName || stage.name;
                    stageSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Failed to load program stages:', error);
            stageSelect.innerHTML = '<option value="">Error loading stages</option>';
        }
    }

    /**
     * Preview tracker events before transfer
     */
    async previewTrackerEvents() {
        const programId = document.getElementById('trk-program')?.value;
        const stageId = document.getElementById('trk-stage')?.value || '';
        const orgUnit = document.getElementById('trk-orgunit-input')?.value;
        const startDate = document.getElementById('trk-start-date')?.value;
        const endDate = document.getElementById('trk-end-date')?.value;

        if (!programId || !orgUnit || !startDate || !endDate) {
            toast.warning('Please fill in all required fields');
            return;
        }

        if (!this.currentProfile) {
            toast.error('No profile selected');
            return;
        }

        try {
            const previewDiv = document.getElementById('trk-preview');
            previewDiv.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split me-2"></i>Loading preview...</div>';

            const request = {
                profile_id: this.currentProfile.id,
                program_id: programId,
                program_stage_id: stageId,
                org_unit: orgUnit,
                start_date: startDate,
                end_date: endDate,
                include_descendants: true,
                dry_run: false
            };

            const preview = await App.PreviewTrackerEvents(request);

            // Enable transfer buttons
            document.getElementById('trk-transfer-btn').disabled = false;
            document.getElementById('trk-dryrun-btn').disabled = false;

            previewDiv.innerHTML = `
            <div class="card" >
                    <div class="card-header">
                        <h6 class="mb-0"><i class="bi bi-eye me-2"></i>Event Preview</h6>
                    </div>
                    <div class="card-body">
                        <div class="row g-2 mb-3">
                            <div class="col-md-3">
                                <div class="text-muted small">Events Found</div>
                                <div class="fs-4 fw-bold">${preview.total || 0}</div>
                            </div>
                            <div class="col-md-3">
                                <div class="text-muted small">Program</div>
                                <div class="small">${this.escapeHtml(preview.program_name || 'N/A')}</div>
                            </div>
                            <div class="col-md-3">
                                <div class="text-muted small">Org Units</div>
                                <div class="small">${preview.org_unit_count || 1}</div>
                            </div>
                            <div class="col-md-3">
                                <div class="text-muted small">Date Range</div>
                                <div class="small">${startDate} to ${endDate}</div>
                            </div>
                        </div>
                        ${preview.events && preview.events.length > 0 ? `
                            <div class="mb-2"><strong>Sample Events (first 5):</strong></div>
                            <div class="table-responsive">
                                <table class="table table-sm table-striped">
                                    <thead>
                                        <tr>
                                            <th>Event UID</th>
                                            <th>Org Unit</th>
                                            <th>Event Date</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${preview.events.slice(0, 5).map(evt => `
                                            <tr>
                                                <td><small>${this.escapeHtml(evt.event || evt.uid || 'N/A')}</small></td>
                                                <td><small>${this.escapeHtml(evt.orgUnit || 'N/A')}</small></td>
                                                <td><small>${this.escapeHtml(evt.eventDate || evt.occurredAt || 'N/A')}</small></td>
                                                <td><span class="badge bg-${evt.status === 'COMPLETED' ? 'success' : 'secondary'}">${this.escapeHtml(evt.status || 'N/A')}</span></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : '<div class="text-muted">No events found in preview</div>'}
                    </div>
                </div>
            `;

            toast.success(`Found ${preview.total || 0} events`);

        } catch (error) {
            console.error('Failed to preview events:', error);
            document.getElementById('trk-preview').innerHTML = `
            <div class="alert alert-danger" >
                <i class="bi bi-x-circle me-2"></i>Failed to preview events: ${this.escapeHtml(String(error))}
                </div>
            `;
            toast.error('Failed to preview events');
        }
    }

    /**
     * Start tracker transfer
     */
    async startTrackerTransfer(dryRun = false) {
        const programId = document.getElementById('trk-program')?.value;
        const stageId = document.getElementById('trk-stage')?.value || '';
        const orgUnit = document.getElementById('trk-orgunit-input')?.value;
        const startDate = document.getElementById('trk-start-date')?.value;
        const endDate = document.getElementById('trk-end-date')?.value;

        if (!programId || !orgUnit || !startDate || !endDate) {
            toast.warning('Please fill in all required fields');
            return;
        }

        if (!this.currentProfile) {
            toast.error('No profile selected');
            return;
        }

        if (!dryRun && !confirm('Are you sure you want to start the tracker transfer? This will push events to the destination instance.')) {
            return;
        }

        try {
            toast.info(dryRun ? 'Starting dry-run...' : 'Starting transfer...');

            const request = {
                profile_id: this.currentProfile.id,
                program_id: programId,
                program_stage_id: stageId,
                org_unit: orgUnit,
                start_date: startDate,
                end_date: endDate,
                include_descendants: true,
                dry_run: dryRun
            };

            const taskId = await App.StartTrackerTransfer(request);

            const progressUI = this.mountProgressUI('trk-progress', {
                title: `${dryRun ? 'Dry-Run' : 'Transfer'} in Progress`,
                icon: 'bi bi-hourglass-split'
            });

            this.setTrackerButtonsDisabled(true);

            progressTracker.track(taskId, 'tracker', {
                progressContainer: progressUI?.progressContainer,
                messageContainer: progressUI?.messageContainer,
                onComplete: (data) => {
                    this.setTrackerButtonsDisabled(false);
                    toast.success(dryRun ? 'Tracker dry-run completed!' : 'Tracker transfer completed successfully!');

                    if (progressUI?.messageContainer && data?.result) {
                        progressUI.messageContainer.insertAdjacentHTML('beforeend', `
            <div class="alert alert-success mt-3" >
                                <strong>Summary</strong>
                                <div class="mt-2">
                                    <div>Fetched: ${data.result.total_fetched ?? 0}</div>
                                    <div>Sent: ${data.result.total_sent ?? 0}</div>
                                    <div>Batches: ${data.result.batches_sent ?? 0}</div>
                                    ${data.result.partial ? '<div class="text-warning mt-2">Completed partially due to runtime limits</div>' : ''}
                    </div>
                            </div>
            `);
                    }
                },
                onError: (data) => {
                    this.setTrackerButtonsDisabled(false);
                    const message = data?.message || 'Tracker transfer failed';
                    if (progressUI?.messageContainer) {
                        progressUI.messageContainer.insertAdjacentHTML('beforeend', `
            <div class="alert alert-danger mt-3" >
                                <strong>Transfer Failed</strong>
                                <div class="mt-2">${this.escapeHtml(message)}</div>
                        </div>
            `);
                    }
                    toast.error(message);
                }
            });

        } catch (error) {
            console.error('Failed to start tracker transfer:', error);
            this.setTrackerButtonsDisabled(false);
            toast.error(`Failed to start transfer: ${error} `);
        }
    }

    setTrackerButtonsDisabled(disabled) {
        ['trk-preview-btn', 'trk-transfer-btn', 'trk-dryrun-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = !!disabled;
            }
        });
    }

    handlePeriodSelectionChange() {
        const periodSelect = document.getElementById('period-select');
        const selected = Array.from(periodSelect?.selectedOptions || []).map(opt => ({
            id: opt.value,
            name: opt.textContent || opt.value
        })).filter(p => p.id);

        const display = document.getElementById('selected-periods-display');
        if (display) {
            display.innerHTML = selected.length
                ? selected.map(period => `<span class="badge bg-light text-dark me-1 mb-1" > ${this.escapeHtml(period.name)}</span> `).join('')
                : '<small class="text-muted">No periods selected</small>';
        }

        const transferBtn = document.getElementById('start-transfer-btn');
        if (transferBtn) {
            transferBtn.disabled = selected.length === 0;
        }

        const syncSection = document.getElementById('sync-button-section');
        if (syncSection) {
            syncSection.style.display = selected.length ? 'block' : 'none';
        }

        if (selected.length) {
            this.updateTransferStepper('preview');
        } else if (this.currentDatasetInfo) {
            this.updateTransferStepper('periods');
        }

        this.renderTransferPreview();
    }

    renderTransferPreview() {
        const previewDiv = document.getElementById('data-preview-content');
        if (!previewDiv) return;

        if (!this.currentDatasetInfo) {
            previewDiv.innerHTML = '<div class="text-muted">Select a dataset to see a summary preview.</div>';
            return;
        }

        const periodSelect = document.getElementById('period-select');
        const selected = Array.from(periodSelect?.selectedOptions || []).map(opt => opt.textContent || opt.value).filter(Boolean);

        const elementCount = this.currentDatasetInfo.dataElements?.length || 0;
        const orgCount = this.currentDatasetInfo.organisationUnits?.length || 0;

        const periodSummary = selected.length
            ? `<div class="selected-period-badges" > ${selected.map(name => `<span class="badge bg-secondary text-light me-1 mb-1">${this.escapeHtml(name)}</span>`).join('')}</div> `
            : '<div class="text-muted">Select at least one period to continue.</div>';

        previewDiv.innerHTML = `
            <div class="row g-3" >
                <div class="col-md-4">
                    <div class="mini-stat">
                        <div class="mini-stat-label">Data Elements</div>
                        <div class="mini-stat-value">${elementCount}</div>
                                </div>
                </div>
                <div class="col-md-4">
                    <div class="mini-stat">
                        <div class="mini-stat-label">Assigned Org Units</div>
                        <div class="mini-stat-value">${orgCount}</div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="mini-stat">
                        <div class="mini-stat-label">Selected Periods</div>
                        <div class="mini-stat-value">${selected.length}</div>
                    </div>
                </div>
            </div>
            <div class="mt-3">
                <div class="fw-semibold mb-1">Periods in Scope</div>
                ${periodSummary}
            </div>
        `;
    }

    updateMappingDetails() {
        const details = document.getElementById('mapping-details');
        if (!details) return;

        const sourceDataset = document.getElementById('source_dataset')?.value;
        const destDataset = document.getElementById('dest_dataset')?.value;

        if (!destDataset || destDataset === sourceDataset) {
            details.innerHTML = `
            <div class="text-muted" >
                Source and destination datasets match.Data elements will reuse their existing IDs.
                </div>
            `;
        } else {
            details.innerHTML = `
            <div class="text-warning" >
                Datasets differ.Ensure element mappings exist on the destination instance to avoid missing values.
                            </div>
            `;
        }
    }

    updateTransferStepper(activeStep) {
        const steps = ['dataset', 'periods', 'preview', 'transfer'];
        const activeIndex = steps.indexOf(activeStep);
        steps.forEach((step, index) => {
            const el = document.querySelector(`.stepper-step[data-step="${step}"]`);
            if (!el) return;
            el.classList.remove('active', 'complete', 'pending');
            if (index < activeIndex) {
                el.classList.add('complete');
            } else if (index === activeIndex) {
                el.classList.add('active');
            } else {
                el.classList.add('pending');
            }
        });
    }

    initCompletenessPeriodControls() {
        const chipsContainer = document.getElementById('comp-period-chips');
        if (chipsContainer && !chipsContainer.dataset.initialized) {
            chipsContainer.querySelectorAll('[data-period-chip]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const key = btn.getAttribute('data-period-chip');
                    this.applyQuickCompletenessPeriod(key);
                });
            });
            chipsContainer.dataset.initialized = 'true';
        }

        const select = document.getElementById('comp-period-select');
        if (select && !select.dataset.initialized) {
            const monthlyOptions = generatePeriods('Monthly', 18);
            select.innerHTML = monthlyOptions.map(period => `<option value= "${period.id}" > ${period.name}</option> `).join('');
            select.addEventListener('change', () => {
                this.completenessPeriods = new Set(Array.from(select.selectedOptions || []).map(opt => opt.value));
                this.updateCompletenessPeriodSummary();
            });
            select.dataset.initialized = 'true';
        }

        if (!this.completenessPeriods || this.completenessPeriods.size === 0) {
            this.applyQuickCompletenessPeriod('last-month');
        } else {
            this.updateCompletenessPeriodSummary();
        }
    }

    applyQuickCompletenessPeriod(key) {
        const now = new Date();
        let reference = new Date(now);
        let periods = [];

        switch (key) {
            case 'this-month':
                periods = generatePeriods('Monthly', 1, reference);
                break;
            case 'last-month':
                reference = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                periods = generatePeriods('Monthly', 1, reference);
                break;
            case 'last-quarter':
                reference = new Date(now.getFullYear(), now.getMonth() - 3, 1);
                periods = generatePeriods('Quarterly', 1, reference);
                break;
            case 'this-year':
                periods = generatePeriods('Yearly', 1, reference);
                break;
            default:
                periods = [];
        }

        this.completenessPeriods = new Set(periods.map(p => p.id));

        const select = document.getElementById('comp-period-select');
        if (select) {
            Array.from(select.options).forEach(option => {
                option.selected = this.completenessPeriods.has(option.value);
            });
        }

        this.updateCompletenessPeriodSummary();
    }

    updateCompletenessPeriodSummary() {
        const summaryDiv = document.getElementById('comp-period-summary');
        const runBtn = document.getElementById('comp-run-btn');
        const selectedCount = this.completenessPeriods ? this.completenessPeriods.size : 0;

        if (summaryDiv) {
            if (!selectedCount) {
                summaryDiv.innerHTML = '<div class="text-warning small">Select at least one period to run the assessment.</div>';
            } else {
                const select = document.getElementById('comp-period-select');
                const labels = select
                    ? Array.from(select.options)
                        .filter(opt => this.completenessPeriods.has(opt.value))
                        .map(opt => opt.textContent)
                    : [];
                summaryDiv.innerHTML = `
            <div class="small text-muted" > Selected periods(${selectedCount}): ${labels.slice(0, 4).join(', ')}${labels.length > 4 ? '…' : ''}</div>
                `;
            }
        }

        if (runBtn && !this.completenessRunning) {
            runBtn.disabled = selectedCount === 0;
        }
    }

    setCompletenessExportState(enabled) {
        ['comp-export-json', 'comp-export-csv'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = !enabled;
                btn.title = enabled ? '' : 'Run an assessment to enable exports';
            }
        });
    }

    goToProfileFormStep(step) {
        if (step === 2) {
            const requiredFields = ['profile_name', 'source_url', 'source_username', 'source_password'];
            const missing = requiredFields.filter(id => {
                const el = document.getElementById(id);
                return !el || !el.value;
            });
            if (missing.length > 0) {
                toast.warning('Fill in the source details before continuing.');
                return;
            }
        }
        this.setProfileFormStep(step);
    }

    setProfileFormStep(step) {
        this.profileFormStep = step;
        const sourceStep = document.getElementById('profile-wizard-source');
        const destStep = document.getElementById('profile-wizard-dest');
        if (sourceStep) {
            sourceStep.style.display = step === 1 ? 'block' : 'none';
        }
        if (destStep) {
            destStep.style.display = step === 2 ? 'block' : 'none';
        }

        const indicator = document.getElementById('profile-step-indicator');
        if (indicator) {
            indicator.innerHTML = `
                <span class="badge ${step === 1 ? 'bg-primary' : 'bg-secondary'} me-1" > 1. Source</span>
                    <span class="badge ${step === 2 ? 'bg-primary' : 'bg-secondary'}">2. Destination</span>
        `;
        }
    }

    /**
     * ========================================================================
     * COMPLETENESS ASSESSMENT METHODS
     * ========================================================================
     */

    /**
     * Load Completeness tab - populate datasets
     */
    async loadCompletenessTab() {
        // Prevent multiple concurrent loads
        if (this._loadingCompletenessTab) {
            return;
        }
        this._loadingCompletenessTab = true;

        console.log('Loading Completeness tab...');

        try {
            // Setup instance change listener
            const instanceSelect = document.getElementById('comp_instance');
            if (instanceSelect && !instanceSelect.dataset.listenerAdded) {
                instanceSelect.addEventListener('change', async () => {
                    await this.loadCompletenessDatasets();
                    // Reinitialize OU picker for the new instance
                    this.completenessOUPicker = null; // Reset so it can be re-created
                    await this.initCompletenessOUPicker();
                });
                instanceSelect.dataset.listenerAdded = 'true';
            }

            await this.loadCompletenessDatasets();
            this.initCompletenessPeriodControls();
            this.setCompletenessExportState(false);

            // Initialize OU picker
            await this.initCompletenessOUPicker();
        } finally {
            this._loadingCompletenessTab = false;
        }
    }

    /**
     * Load Audit tab - initialize audit module
     */
    async loadAuditTab() {
        if (this.audit) {
            await this.audit.init();
        }
    }

    /**
     * Initialize org unit picker for Completeness tab
     */
    async initCompletenessOUPicker() {
        // Prevent multiple/concurrent initializations
        if (this.completenessOUPicker || this._completenessOUPickerInitializing) {
            return;
        }
        this._completenessOUPickerInitializing = true;

        try {
            const container = document.getElementById('comp-ou-picker-container');
            if (!container) {
                this._completenessOUPickerInitializing = false;
                return;
            }

            if (!this.currentProfile) {
                container.innerHTML = '<div class="alert alert-warning small">Please select a connection profile in Settings first.</div>';
                this._completenessOUPickerInitializing = false;
                return;
            }

            const instanceSelect = document.getElementById('comp_instance');
            const instance = instanceSelect?.value || 'source';

            // Dynamically import the OrgUnitTreePicker component
            const { OrgUnitTreePicker } = await import('./components/org-unit-tree.js');

            // Initialize picker
            this.completenessOUPicker = new OrgUnitTreePicker(
                'comp-ou-picker-container',
                this.currentProfile.id,
                instance
            );

            await this.completenessOUPicker.initialize();

            console.log('Completeness OU picker initialized');

        } catch (error) {
            console.error('Failed to initialize OU picker:', error);
            const container = document.getElementById('comp-ou-picker-container');
            if (container) {
                container.innerHTML = `<div class="alert alert-danger small">Failed to initialize picker: ${error}</div>`;
            }
        } finally {
            this._completenessOUPickerInitializing = false;
        }
    }

    /**
     * Load datasets for completeness assessment
     */
    async loadCompletenessDatasets() {
        console.log('[Completeness] loadCompletenessDatasets START');

        const datasetSelect = document.getElementById('comp_dataset_id');
        if (!datasetSelect) {
            console.error('[Completeness] CRITICAL: comp_dataset_id element not found!');
            return;
        }
        console.log('[Completeness] Found datasetSelect element');

        if (!this.currentProfile) {
            console.warn('[Completeness] No currentProfile');
            datasetSelect.innerHTML = '<option value="">No profile selected - go to Settings</option>';
            return;
        }
        console.log('[Completeness] Using profile:', this.currentProfile.id);

        const instanceSelect = document.getElementById('comp_instance');
        const instance = instanceSelect?.value || 'source';
        console.log('[Completeness] Instance:', instance);

        try {
            datasetSelect.innerHTML = '<option value="">Loading datasets...</option>';
            console.log('[Completeness] Calling App.ListDatasets...');

            const datasets = await App.ListDatasets(this.currentProfile.id, instance);
            console.log('[Completeness] ListDatasets returned:', datasets?.length, 'datasets');

            if (!datasets || datasets.length === 0) {
                datasetSelect.innerHTML = '<option value="">No datasets found</option>';
                return;
            }

            datasetSelect.innerHTML = '<option value="">Choose a dataset...</option>';
            datasets.forEach(ds => {
                const option = document.createElement('option');
                option.value = ds.id;
                option.textContent = ds.displayName || ds.name;
                datasetSelect.appendChild(option);
            });
            console.log('[Completeness] Dataset dropdown populated successfully');

            // Add change listener for data element picker
            datasetSelect.onchange = () => {
                if (datasetSelect.value && this.dataElementPicker) {
                    this.dataElementPicker.load(this.currentProfile, datasetSelect.value);
                }
            };

        } catch (error) {
            console.error('[Completeness] Failed to load datasets:', error);
            datasetSelect.innerHTML = '<option value="">Error loading datasets</option>';
            toast.error(`Failed to load datasets: ${error} `);
        }
    }

    /**
     * Start completeness assessment
     */
    async startCompletenessAssessment() {
        const instance = document.getElementById('comp_instance')?.value;
        const datasetId = document.getElementById('comp_dataset_id')?.value;
        const threshold = parseInt(document.getElementById('comp_threshold')?.value || '100', 10);
        const includeParents = document.getElementById('comp_include_parents')?.checked || false;

        if (!datasetId) {
            toast.warning('Please select a dataset');
            return;
        }

        // Get selected org units from picker
        const orgUnits = this.completenessOUPicker ? this.completenessOUPicker.getSelectedIds() : [];
        if (orgUnits.length === 0) {
            toast.warning('Please select at least one organization unit');
            return;
        }

        if (!this.completenessPeriods || this.completenessPeriods.size === 0) {
            toast.warning('Select at least one period');
            return;
        }

        if (!this.currentProfile) {
            toast.error('No profile selected');
            return;
        }

        try {
            const progressUI = this.mountProgressUI('comp-progress', {
                title: 'Assessment Progress',
                icon: 'bi bi-activity'
            });

            document.getElementById('comp-results').textContent = 'No results yet.';
            const runBtn = document.getElementById('comp-run-btn');
            if (runBtn) {
                runBtn.disabled = true;
            }
            this.completenessRunning = true;
            this.setCompletenessExportState(false);

            const request = {
                profile_id: this.currentProfile.id,
                instance: instance,
                dataset_id: datasetId,
                parent_org_units: orgUnits,
                periods: Array.from(this.completenessPeriods),
                required_elements: this.dataElementPicker ? this.dataElementPicker.getSelectedIds() : [],
                compliance_threshold: threshold,
                include_parents: includeParents
            };

            const taskId = await App.StartCompletenessAssessment(request);
            this.completenessTaskId = taskId;

            progressTracker.track(taskId, 'assessment', {
                progressContainer: progressUI?.progressContainer,
                messageContainer: progressUI?.messageContainer,
                onComplete: (data) => {
                    if (runBtn) {
                        runBtn.disabled = false;
                    }
                    this.completenessRunning = false;
                    this.updateCompletenessPeriodSummary();
                    const actions = document.getElementById('comp-actions');
                    if (actions) {
                        actions.style.display = 'block';
                    }
                    window.completenessResults = data?.results;
                    this.renderCompletenessResults(data?.results);
                    this.setCompletenessExportState(true);
                    toast.success('Assessment completed!');
                },
                onError: (data) => {
                    if (runBtn) {
                        runBtn.disabled = false;
                    }
                    this.completenessRunning = false;
                    this.updateCompletenessPeriodSummary();
                    const message = data?.message || 'Assessment failed';
                    const progressDiv = document.getElementById('comp-progress');
                    if (progressDiv) {
                        progressDiv.innerHTML = `<div class="alert alert-danger" > ${this.escapeHtml(message)}</div> `;
                    }
                    toast.error('Assessment failed');
                }
            });

        } catch (error) {
            console.error('Failed to start assessment:', error);
            document.getElementById('comp-progress').innerHTML = `<div class="alert alert-danger" > ${this.escapeHtml(String(error))}</div> `;
            document.getElementById('comp-run-btn').disabled = false;
            this.completenessRunning = false;
            this.updateCompletenessPeriodSummary();
            toast.error('Failed to start assessment');
        }
    }

    /**
 * Render completeness results
 * 
 * Backend returns:
 * {
 *   total_compliant: number,
 *   total_non_compliant: number, 
 *   total_errors: number,
 *   hierarchy: { [parentId]: { name, compliant: [], non_compliant: [] } },
 *   compliance_details: { [orgUnitId]: { id, name, compliance_percentage, elements_present, elements_required, ... } }
 * }
 */
    renderCompletenessResults(results) {
        const resultsDiv = document.getElementById('comp-results');

        if (!results) {
            resultsDiv.innerHTML = '<div class="text-muted">No results to display</div>';
            return;
        }

        console.log('[Completeness] Rendering results:', results);

        // Extract org units from compliance_details or hierarchy
        let orgUnits = [];

        if (results.compliance_details && Object.keys(results.compliance_details).length > 0) {
            // Use compliance_details - contains all org units with details
            orgUnits = Object.entries(results.compliance_details).map(([id, info]) => ({
                id: id,
                name: info.name || id,
                compliance_percentage: info.compliance_percentage || 0,
                elements_present: info.elements_present || 0,
                elements_required: info.elements_required || 0,
                has_data: info.has_data || false,
                compliant: (info.compliance_percentage || 0) >= 100
            }));
        } else if (results.hierarchy && Object.keys(results.hierarchy).length > 0) {
            // Fallback to hierarchy - extract from compliant/non_compliant arrays
            for (const [parentId, hierarchyResult] of Object.entries(results.hierarchy)) {
                if (hierarchyResult.compliant) {
                    orgUnits.push(...hierarchyResult.compliant.map(ou => ({ ...ou, compliant: true })));
                }
                if (hierarchyResult.non_compliant) {
                    orgUnits.push(...hierarchyResult.non_compliant.map(ou => ({ ...ou, compliant: false })));
                }
            }
        } else if (results.org_units) {
            // Legacy format fallback
            orgUnits = results.org_units;
        }

        if (orgUnits.length === 0) {
            resultsDiv.innerHTML = '<div class="text-muted">No organization units found in results</div>';
            return;
        }

        // Sort by name
        orgUnits.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const compliantCount = results.total_compliant || orgUnits.filter(ou => ou.compliant).length;
        const nonCompliantCount = results.total_non_compliant || orgUnits.filter(ou => !ou.compliant).length;
        const totalCount = compliantCount + nonCompliantCount;
        const complianceRate = totalCount > 0 ? (compliantCount / totalCount * 100).toFixed(1) : 0;

        let html = `
        <div class="mb-3">
            <div class="d-flex justify-content-between mb-2">
                <strong>Summary</strong>
                <div>
                    <span class="badge bg-success me-1">${compliantCount} Compliant</span>
                    <span class="badge bg-danger">${nonCompliantCount} Non-compliant</span>
                </div>
            </div>
            <div class="progress" style="height: 20px;">
                <div class="progress-bar bg-success" style="width: ${complianceRate}%">
                    ${complianceRate}% (${compliantCount}/${totalCount})
                </div>
            </div>
        </div>
        <div class="small" style="max-height: 400px; overflow:auto;">
            <table class="table table-sm table-striped">
                <thead>
                    <tr>
                        <th>Org Unit</th>
                        <th class="text-end">Present/Required</th>
                        <th class="text-end">Compliance %</th>
                        <th class="text-center">Status</th>
                    </tr>
                </thead>
                <tbody>`;

        orgUnits.slice(0, 100).forEach(ou => {
            const compliancePercent = ou.compliance_percentage !== undefined
                ? ou.compliance_percentage.toFixed(1)
                : (ou.elements_required > 0 ? (ou.elements_present / ou.elements_required * 100).toFixed(1) : '0.0');

            const statusBadge = ou.compliant
                ? '<span class="badge bg-success">Compliant</span>'
                : '<span class="badge bg-danger">Incomplete</span>';

            html += `
            <tr>
                <td><small>${this.escapeHtml(ou.name || ou.id || 'Unknown')}</small></td>
                <td class="text-end"><small>${ou.elements_present || 0}/${ou.elements_required || 0}</small></td>
                <td class="text-end"><small>${compliancePercent}%</small></td>
                <td class="text-center">${statusBadge}</td>
            </tr>`;
        });

        html += '</tbody></table>';

        if (orgUnits.length > 100) {
            html += `<div class="text-muted text-center">Showing first 100 of ${orgUnits.length} org units. Export for full results.</div>`;
        }

        html += '</div>';
        resultsDiv.innerHTML = html;
    }

    /**
     * Export completeness results
     */
    async exportCompleteness(format) {
        if (!this.completenessTaskId) {
            toast.warning('No results to export');
            return;
        }

        try {
            const savedPath = await App.ExportCompletenessResults(
                this.completenessTaskId,
                format,
                200
            );

            if (!savedPath) {
                toast.info('Export cancelled');
                return;
            }

            toast.success(`Saved results to ${savedPath}`);

        } catch (error) {
            console.error('Failed to export:', error);
            toast.error(`Failed to export: ${error}`);
        }
    }

    /**
     * Load connection profiles from backend
     */
    async loadSettings() {
        const settingsContent = document.getElementById('settings-content');
        if (!settingsContent) return;

        try {
            const profiles = await App.ListProfiles();
            this.renderProfiles(profiles);
        } catch (error) {
            console.error('Failed to load profiles:', error);
            settingsContent.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    Failed to load connection profiles: ${error}
                </div>
            `;
        }
    }

    /**
     * Render connection profiles
     */
    renderProfiles(profiles) {
        const settingsContent = document.getElementById('settings-content');

        if (!profiles || profiles.length === 0) {
            settingsContent.innerHTML = `
                <div class="card card-body text-center text-muted">
                    <p class="mb-2"><i class="bi bi-info-circle me-1"></i>No connection profiles configured yet.</p>
                <button class="btn btn-primary" onclick="app.showAddProfileForm()">
                        <i class="bi bi-plus-circle me-1"></i>Add Profile
                </button>
                </div>
            `;
            return;
        }

        const cards = profiles.map(profile => {
            const isActive = this.currentProfile === profile.id;
            const safeName = this.escapeHtml(profile.name);
            const safeOwner = profile.owner ? this.escapeHtml(profile.owner) : 'Unassigned';
            const safeSource = this.escapeHtml(profile.source_url);
            const safeDest = this.escapeHtml(profile.dest_url);
            const safeNameJS = (profile.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

            return `
                <div class="col-md-6">
                    <div class="card profile-card ${isActive ? 'active-profile' : ''}">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                    <h5 class="mb-0">${safeName}</h5>
                                    <small class="text-muted">${safeOwner}</small>
                                </div>
                                ${isActive ? '<span class="badge bg-success">Active</span>' : ''}
                            </div>
                            <div class="small text-muted mb-3">
                                <div><i class="bi bi-arrow-up-right me-1 text-primary"></i>${safeSource}</div>
                                <div><i class="bi bi-arrow-down-left me-1 text-success"></i>${safeDest}</div>
                            </div>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm ${isActive ? 'btn-outline-secondary' : 'btn-primary'}" ${isActive ? 'disabled' : ''} onclick="app.selectProfile('${profile.id}')">
                                    ${isActive ? '<i class="bi bi-check-lg me-1"></i>Active' : '<i class="bi bi-check-circle me-1"></i>Set Active'}
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="app.deleteProfile('${profile.id}', '${safeNameJS}')">
                                    <i class="bi bi-trash"></i>
                </button>
            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        settingsContent.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                <div>
                    <h4 class="mb-0">Connection Profiles</h4>
                    <small class="text-muted">Select a profile to activate it for transfers.</small>
                </div>
                <button class="btn btn-primary" onclick="app.showAddProfileForm()">
                    <i class="bi bi-plus-circle me-1"></i>New Profile
                        </button>
            </div>
            <div class="row g-3">${cards}</div>
        `;
    }

    mountProgressUI(container, options = {}) {
        const target = typeof container === 'string' ? document.getElementById(container) : container;
        if (!target) return null;

        const { title = '', icon = 'bi bi-hourglass-split' } = options;
        const ui = progressTracker.createDefaultUI();

        if (title) {
            target.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0"><i class="${icon} me-2"></i>${this.escapeHtml(title)}</h6>
                    </div>
                    <div class="card-body"></div>
            </div>
        `;
            const body = target.querySelector('.card-body');
            if (body) {
                body.appendChild(ui.wrapper);
            }
        } else {
            target.innerHTML = '';
            target.appendChild(ui.wrapper);
        }

        return ui;
    }

    resetDatasetState() {
        this.currentDatasetInfo = null;
        ['period-selection-section', 'data-preview-section', 'mapping-section', 'sync-button-section'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = 'none';
            }
        });
        const infoDisplay = document.getElementById('dataset-info-display');
        if (infoDisplay) {
            infoDisplay.innerHTML = '<div class="text-muted">Select a dataset to configure the transfer.</div>';
        }
        this.handlePeriodSelectionChange();
        this.updateTransferStepper('dataset');
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Show add profile form
     */
    showAddProfileForm() {
        const formContainer = document.getElementById('profile-form-container');
        const formTitle = document.getElementById('form-title');
        const form = document.getElementById('connection-form');

        if (formContainer && formTitle && form) {
            formTitle.textContent = 'New Profile';
            form.reset();
            formContainer.style.display = 'block';
            this.setProfileFormStep(1);

            // Reset connection test status
            this.sourceConnectionTested = false;
            this.destConnectionTested = false;
            const sourceStatus = document.getElementById('source-test-status');
            const destStatus = document.getElementById('dest-test-status');
            if (sourceStatus) sourceStatus.innerHTML = '';
            if (destStatus) destStatus.innerHTML = '';

            // Scroll to form
            formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /**
     * Hide profile form
     */
    hideProfileForm() {
        const formContainer = document.getElementById('profile-form-container');
        const form = document.getElementById('connection-form');
        const formStatus = document.getElementById('form-status');

        if (formContainer) {
            formContainer.style.display = 'none';
        }
        if (form) {
            form.reset();
        }
        if (formStatus) {
            formStatus.innerHTML = '';
        }

        // Reset connection test status
        this.sourceConnectionTested = false;
        this.destConnectionTested = false;
        const sourceStatus = document.getElementById('source-test-status');
        const destStatus = document.getElementById('dest-test-status');
        if (sourceStatus) sourceStatus.innerHTML = '';
        if (destStatus) destStatus.innerHTML = '';
        this.setProfileFormStep(1);
    }

    /**
     * Test source connection
     */
    async testSourceConnection() {
        const statusDiv = document.getElementById('source-test-status');
        const sourceUrl = document.getElementById('source_url')?.value;
        const sourceUsername = document.getElementById('source_username')?.value;
        const sourcePassword = document.getElementById('source_password')?.value;

        // Validate fields are filled
        if (!sourceUrl || !sourceUsername || !sourcePassword) {
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div class="alert alert-warning alert-sm">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Please fill in all source connection fields
                    </div>
                `;
            }
            return;
        }

        try {
            // Show testing state
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div class="alert alert-info alert-sm">
                        <i class="bi bi-hourglass-split me-2"></i>
                        Testing connection...
                    </div>
                `;
            }

            // Call backend to test connection
            const result = await App.TestConnection({
                url: sourceUrl,
                username: sourceUsername,
                password: sourcePassword
            });

            if (result.success) {
                this.sourceConnectionTested = true;
                if (statusDiv) {
                    statusDiv.innerHTML = `
                        <div class="alert alert-success alert-sm">
                            <i class="bi bi-check-circle me-2"></i>
                            Connected successfully as <strong>${result.user_name}</strong>
                        </div>
                    `;
                }
                toast.success(`Source connection successful: ${result.user_name}`);
            } else {
                this.sourceConnectionTested = false;
                if (statusDiv) {
                    statusDiv.innerHTML = `
                        <div class="alert alert-danger alert-sm">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            ${result.error}
                        </div>
                    `;
                }
                toast.error(`Source connection failed: ${result.error}`);
            }

        } catch (error) {
            this.sourceConnectionTested = false;
            console.error('Failed to test source connection:', error);
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div class="alert alert-danger alert-sm">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Connection test failed: ${error}
                    </div>
                `;
            }
            toast.error(`Failed to test source connection: ${error}`);
        }
    }

    /**
     * Test destination connection
     */
    async testDestConnection() {
        const statusDiv = document.getElementById('dest-test-status');
        const destUrl = document.getElementById('dest_url')?.value;
        const destUsername = document.getElementById('dest_username')?.value;
        const destPassword = document.getElementById('dest_password')?.value;

        // Validate fields are filled
        if (!destUrl || !destUsername || !destPassword) {
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div class="alert alert-warning alert-sm">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Please fill in all destination connection fields
                    </div>
                `;
            }
            return;
        }

        try {
            // Show testing state
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div class="alert alert-info alert-sm">
                        <i class="bi bi-hourglass-split me-2"></i>
                        Testing connection...
                    </div>
                `;
            }

            // Call backend to test connection
            const result = await App.TestConnection({
                url: destUrl,
                username: destUsername,
                password: destPassword
            });

            if (result.success) {
                this.destConnectionTested = true;
                if (statusDiv) {
                    statusDiv.innerHTML = `
                        <div class="alert alert-success alert-sm">
                            <i class="bi bi-check-circle me-2"></i>
                            Connected successfully as <strong>${result.user_name}</strong>
                        </div>
                    `;
                }
                toast.success(`Destination connection successful: ${result.user_name}`);
            } else {
                this.destConnectionTested = false;
                if (statusDiv) {
                    statusDiv.innerHTML = `
                        <div class="alert alert-danger alert-sm">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            ${result.error}
                        </div>
                    `;
                }
                toast.error(`Destination connection failed: ${result.error}`);
            }

        } catch (error) {
            this.destConnectionTested = false;
            console.error('Failed to test destination connection:', error);
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div class="alert alert-danger alert-sm">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Connection test failed: ${error}
                    </div>
                `;
            }
            toast.error(`Failed to test destination connection: ${error}`);
        }
    }

    /**
     * Save profile (create or update)
     */
    async saveProfile() {
        const formStatus = document.getElementById('form-status');

        // Get form values
        const name = document.getElementById('profile_name')?.value;
        const owner = document.getElementById('profile_owner')?.value;
        const sourceUrl = document.getElementById('source_url')?.value;
        const sourceUsername = document.getElementById('source_username')?.value;
        const sourcePassword = document.getElementById('source_password')?.value;
        const destUrl = document.getElementById('dest_url')?.value;
        const destUsername = document.getElementById('dest_username')?.value;
        const destPassword = document.getElementById('dest_password')?.value;

        // Validate required fields
        if (!name || !sourceUrl || !sourceUsername || !sourcePassword || !destUrl || !destUsername || !destPassword) {
            if (formStatus) {
                formStatus.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Please fill in all required fields
                    </div>
                `;
            }
            return;
        }

        // Warn if connections haven't been tested (recommended but not required)
        if (!this.sourceConnectionTested || !this.destConnectionTested) {
            if (formStatus) {
                formStatus.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="bi bi-info-circle me-2"></i>
                        <strong>Recommendation:</strong> Test both connections before saving to ensure credentials are valid.
                        You can still save without testing, but invalid credentials will be discovered later.
                    </div>
                `;
            }
            toast.warning('Consider testing connections before saving');
        }

        try {
            // Show loading state
            if (formStatus) {
                formStatus.innerHTML = `
                    <div class="alert alert-info">
                        <i class="bi bi-hourglass-split me-2"></i>
                        Saving profile...
                    </div>
                `;
            }

            // Call backend to create profile
            await App.CreateProfile({
                name: name,
                owner: owner || '',
                source_url: sourceUrl,
                source_username: sourceUsername,
                source_password: sourcePassword,
                dest_url: destUrl,
                dest_username: destUsername,
                dest_password: destPassword
            });

            toast.success('Profile created successfully!');
            this.hideProfileForm();
            await this.loadSettings();

        } catch (error) {
            console.error('Failed to create profile:', error);
            if (formStatus) {
                formStatus.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Failed to create profile: ${error}
                    </div>
                `;
            }
            toast.error(`Failed to create profile: ${error}`);
        }
    }



    /**
     * Delete a profile
     */
    async deleteProfile(profileId, profileName = '') {
        if (!window.confirm(`Are you sure you want to delete "${profileName || 'this profile'}"?`)) {
            return;
        }

        try {
            await App.DeleteProfile(profileId);
            toast.success('Profile deleted successfully!');
            await this.loadSettings();
        } catch (error) {
            console.error('Failed to delete profile:', error);
            toast.error(`Failed to delete profile: ${error}`);
        }
    }

    /**
     * Demo: Show success toast
     */
    demoToastSuccess() {
        toast.success('Transfer completed successfully! Imported 1,247 data values.', {
            duration: 4000
        });
    }

    /**
     * Demo: Show error toast with retry action
     */
    demoToastError() {
        toast.error('Connection to DHIS2 instance failed. Please check your credentials.', {
            duration: 0, // No auto-dismiss
            actions: [
                {
                    label: 'Retry',
                    onClick: () => {
                        toast.info('Retrying connection...');
                    }
                }
            ]
        });
    }

    /**
     * Demo: Show warning toast
     */
    demoToastWarning() {
        toast.warning('Some data elements could not be mapped. 15 values will be skipped.', {
            duration: 6000
        });
    }

    /**
     * Demo: Show info toast
     */
    demoToastInfo() {
        toast.info('Fetching datasets from source instance...', {
            duration: 3000
        });
    }
}

// Initialize the application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.app = new DHIS2SyncApp();

    // Hide loading screen after app initializes
    const loadingScreen = document.getElementById('app-loading');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }
});

