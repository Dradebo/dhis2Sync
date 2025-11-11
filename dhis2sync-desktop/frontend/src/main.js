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

/**
 * Main DHIS2 Sync Application Class
 */
class DHIS2SyncApp {
    constructor() {
        this.currentProfile = null;
        this.sourceConnectionTested = false;
        this.destConnectionTested = false;
        this.init();
    }

    init() {
        console.log('🚀 DHIS2 Sync Desktop - Initializing...');
        this.renderApp();
        this.setupEventListeners();
        this.loadSettings();
        console.log('✅ Application initialized');
    }

    /**
     * Render the main application UI
     */
    renderApp() {
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
                        <button class="nav-link active" id="dashboard-tab" data-bs-toggle="tab" data-bs-target="#dashboard-pane" type="button" role="tab" aria-controls="dashboard-pane" aria-selected="true">
                            <i class="tab-icon bi bi-speedometer2"></i>Dashboard
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="settings-tab" data-bs-toggle="tab" data-bs-target="#settings-pane" type="button" role="tab" aria-controls="settings-pane" aria-selected="false">
                            <i class="tab-icon bi bi-gear"></i>Settings
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="transfer-tab" data-bs-toggle="tab" data-bs-target="#transfer-pane" type="button" role="tab" aria-controls="transfer-pane" aria-selected="false">
                            <i class="tab-icon bi bi-arrow-left-right"></i>Transfer
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="completeness-tab" data-bs-toggle="tab" data-bs-target="#completeness-pane" type="button" role="tab" aria-controls="completeness-pane" aria-selected="false">
                            <i class="tab-icon bi bi-check-circle"></i>Completeness
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
                                            <span class="badge bg-secondary">Not Configured</span>
                                        </div>
                                        <div class="d-flex justify-content-between align-items-center mb-2">
                                            <span>Destination Connection</span>
                                            <span class="badge bg-secondary">Not Configured</span>
                                        </div>
                                        <div class="d-flex justify-content-between align-items-center">
                                            <span>Sync Profiles</span>
                                            <span class="badge bg-secondary">0</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Tab -->
                    <div class="tab-pane fade" id="settings-pane" role="tabpanel" aria-labelledby="settings-tab">
                        <h3><i class="bi bi-gear me-2"></i>Connection Profiles</h3>
                        <p class="text-muted">Manage DHIS2 instance connections</p>

                        <!-- Profile Form (hidden by default) -->
                        <div id="profile-form-container" class="mb-4" style="display: none;">
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

                                        <div class="d-flex gap-2">
                                            <button type="button" class="btn btn-success" onclick="app.saveProfile()">
                                                <i class="bi bi-check me-1"></i>Save Profile
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary" onclick="app.hideProfileForm()">
                                                Cancel
                                            </button>
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
                                            <!-- Step 1: Dataset Selection -->
                                            <div class="row mb-3">
                                                <div class="col-md-8">
                                                    <label for="source_dataset" class="form-label">Select Dataset</label>
                                                    <select class="form-select" id="source_dataset" name="source_dataset" required>
                                                        <option value="">Choose a dataset...</option>
                                                    </select>
                                                    <div class="form-text">Choose dataset from source instance</div>
                                                </div>
                                                <div class="col-md-4">
                                                    <label class="form-label">&nbsp;</label>
                                                    <button type="button" class="btn btn-outline-primary d-block w-100" onclick="app.loadDatasetInfo()" id="load-dataset-btn" disabled>
                                                        <i class="bi bi-info-circle me-1"></i>Load Dataset Info
                                                    </button>
                                                </div>
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

                                        <div id="comp-actions" class="mt-3" style="display:none;">
                                            <div class="d-flex gap-2">
                                                <button class="btn btn-outline-primary" onclick="app.exportCompleteness('json')">
                                                    <i class="bi bi-filetype-json me-1"></i>Export JSON
                                                </button>
                                                <button class="btn btn-outline-secondary" onclick="app.exportCompleteness('csv')">
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
                </div>
            </div>
        `;

        document.querySelector('#app').innerHTML = appHtml;
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
                console.log(`Switched to tab: ${target}`);

                // Load content when switching tabs
                if (target === '#dashboard-pane') {
                    this.loadDashboard();
                } else if (target === '#settings-pane') {
                    this.loadSettings();
                } else if (target === '#transfer-pane') {
                    this.loadTransferTab();
                } else if (target === '#completeness-pane') {
                    this.loadCompletenessTab();
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
    async refreshJobHistory() {
        const container = document.getElementById('job-history-container');
        if (!container) return;

        try {
            const jobs = await App.ListJobs(10); // Get last 10 jobs

            if (!jobs || jobs.length === 0) {
                // No jobs yet - show placeholder
                container.innerHTML = `
                    <div class="text-center py-5 text-muted">
                        <i class="bi bi-inbox fs-1 mb-3"></i>
                        <h6>No jobs yet</h6>
                        <p>Configure your settings and run your first sync to see job history here.</p>
                        <button class="btn btn-primary" onclick="app.switchToTab('settings-tab')">
                            <i class="bi bi-gear me-1"></i>Configure Settings
                        </button>
                    </div>
                `;
                return;
            }

            // Render job history table
            const tableHtml = jobs.map(job => {
                const statusBadge = job.status === 'completed'
                    ? '<span class="badge bg-success">Completed</span>'
                    : job.status === 'failed'
                    ? '<span class="badge bg-danger">Failed</span>'
                    : `<span class="badge bg-primary">Running (${job.progress}%)</span>`;

                const startedAt = new Date(job.started_at).toLocaleString();
                const completedAt = job.completed_at ? new Date(job.completed_at).toLocaleString() : '-';

                return `
                    <tr>
                        <td>${job.job_type || 'Unknown'}</td>
                        <td>${statusBadge}</td>
                        <td><small>${startedAt}</small></td>
                        <td><small>${completedAt}</small></td>
                        <td><small>${job.summary}</small></td>
                    </tr>
                `;
            }).join('');

            container.innerHTML = `
                <div class="table-responsive">
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
                <div class="alert alert-danger">
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
                <div class="d-flex justify-content-between align-items-center mb-2">
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
        console.log('Loading Transfer tab...');
        await this.loadDatasets();
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

            const datasets = await App.ListDatasets(this.currentProfile, 'source');

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

            // Enable the "Load Dataset Info" button when a dataset is selected
            datasetSelect.addEventListener('change', () => {
                const loadBtn = document.getElementById('load-dataset-btn');
                if (loadBtn) {
                    loadBtn.disabled = !datasetSelect.value;
                }
            });

        } catch (error) {
            console.error('Failed to load datasets:', error);
            datasetSelect.innerHTML = '<option value="">Error loading datasets</option>';
            toast.error(`Failed to load datasets: ${error}`);
        }
    }

    /**
     * Load dataset info and show period selection
     */
    async loadDatasetInfo() {
        const datasetSelect = document.getElementById('source_dataset');
        const datasetId = datasetSelect?.value;

        if (!datasetId || !this.currentProfile) {
            toast.warning('Please select a dataset first');
            return;
        }

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

            const info = await App.GetDatasetInfo(this.currentProfile, datasetId, 'source');

            // Display dataset info
            if (infoDisplay) {
                infoDisplay.innerHTML = `
                    <div class="alert alert-success">
                        <strong>${this.escapeHtml(info.name)}</strong>
                        <div class="small mt-1">
                            Period Type: ${this.escapeHtml(info.periodType)} |
                            Elements: ${info.dataElements?.length || 0}
                        </div>
                    </div>
                `;
            }

            // Populate period type selector
            const periodTypeSelect = document.getElementById('period-type');
            if (periodTypeSelect && info.periodType) {
                periodTypeSelect.innerHTML = `<option value="${info.periodType}" selected>${info.periodType}</option>`;
                this.updatePeriodPicker(info.periodType);
            }

            // Show period selection section
            const periodSection = document.getElementById('period-selection-section');
            if (periodSection) {
                periodSection.style.display = 'block';
            }

            // Initialize OU picker if not already initialized
            // OU picker no longer needed - org units are auto-discovered

            toast.success('Dataset info loaded successfully');

        } catch (error) {
            console.error('Failed to load dataset info:', error);
            toast.error(`Failed to load dataset info: ${error}`);
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
                const periods = module.generatePeriods(type, 12); // Generate last 12 periods

                periodSelect.innerHTML = '';
                periods.forEach(period => {
                    const option = document.createElement('option');
                    option.value = period.id;
                    option.textContent = period.name;
                    periodSelect.appendChild(option);
                });

                // Enable transfer button when periods are selected
                periodSelect.addEventListener('change', () => {
                    const transferBtn = document.getElementById('start-transfer-btn');
                    if (transferBtn) {
                        transferBtn.disabled = periodSelect.selectedOptions.length === 0;
                    }
                });
            });
        } catch (error) {
            console.error('Failed to generate periods:', error);
            periodSelect.innerHTML = '<option value="">Error generating periods</option>';
        }
    }

    /**
     * Start data transfer
     */
    async startDataTransfer() {
        const datasetSelect = document.getElementById('source_dataset');
        const periodSelect = document.getElementById('period-select');

        const datasetId = datasetSelect?.value;
        const selectedPeriods = Array.from(periodSelect?.selectedOptions || []).map(opt => opt.value);

        if (!datasetId || selectedPeriods.length === 0) {
            toast.warning('Please select dataset and periods');
            return;
        }

        // No org unit selection needed - they will be auto-discovered

        if (!this.currentProfile) {
            toast.error('No profile selected');
            return;
        }

        try {
            toast.info('Starting transfer with auto-discovery...');

            // Get checkbox value for marking datasets complete
            const markCompleteCheckbox = document.getElementById('mark-complete-checkbox');
            const markComplete = markCompleteCheckbox ? markCompleteCheckbox.checked : false;

            // Build transfer request (no org_units - auto-discovered from user's assigned OUs)
            const request = {
                profile_id: this.currentProfile,
                source_dataset: datasetId,
                dest_dataset: datasetId,  // Same dataset for both source and dest (no mapping scenario)
                periods: selectedPeriods,
                mark_complete: markComplete
            };

            const taskId = await App.StartTransfer(request);

            // Show progress section
            const progressSection = document.getElementById('transfer-progress-section');
            if (progressSection) {
                progressSection.style.display = 'block';

                const progressContent = document.getElementById('transfer-progress-content');
                if (progressContent) {
                    progressContent.innerHTML = `
                        <div class="mb-3">
                            <div class="progress">
                                <div class="progress-bar progress-bar-striped progress-bar-animated"
                                     role="progressbar" style="width: 0%" id="transfer-progress-bar">0%</div>
                            </div>
                        </div>
                        <div id="transfer-progress-messages"></div>
                    `;
                }
            }

            // Poll for progress
            this.pollTransferProgress(taskId);

        } catch (error) {
            console.error('Failed to start transfer:', error);
            toast.error(`Failed to start transfer: ${error}`);
        }
    }

    /**
     * Poll transfer progress
     */
    async pollTransferProgress(taskId) {
        const progressBar = document.getElementById('transfer-progress-bar');
        const messagesDiv = document.getElementById('transfer-progress-messages');

        const poll = async () => {
            try {
                const progress = await App.GetTransferProgress(taskId);

                // Update progress bar
                if (progressBar && progress.progress !== undefined) {
                    const percent = Math.round(progress.progress);
                    progressBar.style.width = `${percent}%`;
                    progressBar.textContent = `${percent}%`;
                }

                // Update messages - show scrolling log of all messages
                if (messagesDiv) {
                    if (progress.messages && progress.messages.length > 0) {
                        // Render all messages as a scrolling log
                        const messagesHTML = progress.messages.map((msg, idx) => {
                            const isLatest = idx === progress.messages.length - 1;
                            const alertClass = isLatest ? 'alert-primary' : 'alert-secondary';
                            const opacity = isLatest ? '1.0' : '0.7';
                            return `<div class="alert ${alertClass} py-2 mb-1" style="opacity: ${opacity}">
                                <small>${this.escapeHtml(msg)}</small>
                            </div>`;
                        }).join('');

                        messagesDiv.innerHTML = `<div style="max-height: 400px; overflow-y: auto;" id="messages-scroll-container">${messagesHTML}</div>`;

                        // Auto-scroll to bottom to show latest message
                        const scrollContainer = document.getElementById('messages-scroll-container');
                        if (scrollContainer) {
                            scrollContainer.scrollTop = scrollContainer.scrollHeight;
                        }
                    } else if (progress.message) {
                        // Fallback to single message display
                        messagesDiv.innerHTML = `<div class="alert alert-info">${this.escapeHtml(progress.message)}</div>`;
                    }
                }

                // Check if complete
                if (progress.status === 'completed') {
                    if (progressBar) {
                        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
                        progressBar.classList.add('bg-success');
                    }
                    toast.success('Transfer completed successfully!');

                    // Show result summary
                    if (messagesDiv && progress.result) {
                        messagesDiv.innerHTML = `
                            <div class="alert alert-success">
                                <strong>Transfer Complete!</strong>
                                <div class="mt-2">${this.escapeHtml(JSON.stringify(progress.result, null, 2))}</div>
                            </div>
                        `;
                    }
                    return;
                }

                if (progress.status === 'failed' || progress.status === 'error') {
                    if (progressBar) {
                        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
                        progressBar.classList.add('bg-danger');
                    }
                    toast.error('Transfer failed!');

                    if (messagesDiv) {
                        messagesDiv.innerHTML = `
                            <div class="alert alert-danger">
                                <strong>Transfer Failed</strong>
                                <div class="mt-2">${this.escapeHtml(progress.message || 'Unknown error')}</div>
                            </div>
                        `;
                    }
                    return;
                }

                // Continue polling
                setTimeout(poll, 2000);

            } catch (error) {
                console.error('Error polling progress:', error);
                toast.error('Error checking transfer progress');
            }
        };

        poll();
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

        progressDiv.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split me-2"></i>Starting metadata assessment...</div>';
        resultsDiv.innerHTML = '';
        this.setMetadataUIRunning(true);

        // Hide post-assessment actions until completed
        document.getElementById('metadata-actions').style.display = 'none';

        try {
            const taskId = await App.StartMetadataDiff(this.currentProfile, scope);
            this.pollMetadataProgress(taskId);
        } catch (error) {
            console.error('Failed to start metadata assessment:', error);
            progressDiv.innerHTML = `<div class="alert alert-danger"><i class="bi bi-x-circle me-2"></i>${this.escapeHtml(String(error))}</div>`;
            this.setMetadataUIRunning(false);
        }
    }

    /**
     * Poll metadata diff progress
     */
    async pollMetadataProgress(taskId) {
        const progressDiv = document.getElementById('metadata-progress');
        const resultsDiv = document.getElementById('metadata-results');

        const render = (progress) => {
            const pct = progress.progress || 0;
            const status = progress.status || 'unknown';
            const msgs = (progress.messages || []).slice(-10);

            progressDiv.innerHTML = `
                <div class="mb-2">Status: <span class="badge ${status === 'completed' ? 'bg-success' : status === 'error' ? 'bg-danger' : 'bg-primary'}">${status}</span></div>
                <div class="progress mb-2"><div class="progress-bar" role="progressbar" style="width:${pct}%">${pct}%</div></div>
                <div class="small text-muted" style="max-height: 140px; overflow:auto;">${msgs.map(m => `<div>${this.escapeHtml(m)}</div>`).join('')}</div>
            `;
        };

        const poll = async () => {
            try {
                const progress = await App.GetMetadataDiffProgress(taskId);
                render(progress);

                if (progress.status === 'completed') {
                    this.renderMetadataResults(progress.results);
                    this.setMetadataUIRunning(false);
                    // Show post-assessment actions
                    document.getElementById('metadata-actions').style.display = 'block';
                    return;
                }

                if (progress.status === 'error') {
                    this.setMetadataUIRunning(false);
                    return;
                }

                // Continue polling
                setTimeout(poll, 2000);
            } catch (error) {
                console.error('Error polling metadata progress:', error);
                this.setMetadataUIRunning(false);
            }
        };

        poll();
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
            const stateKey = `${typeKey}:${sectionKey}`;
            const page = (window.mdPage[stateKey] || 1);
            const start = 0;
            const end = page * pageSize;
            const slice = items.slice(start, end);
            const left = Math.max(0, items.length - slice.length);

            let body = '';
            if (sectionKey === 'missing') {
                body = slice.map(m => `<div class="small text-muted">${this.escapeHtml(m.name || m.code || m.id)}</div>`).join('');
            } else if (sectionKey === 'conflicts') {
                body = slice.map(c => `<div class="small text-muted">${this.escapeHtml(c.name || c.code || c.id)}</div>`).join('');
            } else if (sectionKey === 'suggestions') {
                body = slice.map(s => {
                    const sourceName = this.escapeHtml(s.source?.name || s.source?.code || s.source?.id);
                    const destName = this.escapeHtml(s.dest?.name || s.dest?.code || s.dest?.id);
                    const by = this.escapeHtml(s.by);
                    const confidence = this.escapeHtml(s.confidence);
                    return `<div class="small text-muted">${sourceName} → ${destName} (${by}, ${confidence})</div>`;
                }).join('');
            }

            const moreBtn = left > 0 ? `<button class="btn btn-sm btn-outline-secondary mt-2" onclick="app.loadMoreMd('${typeKey}','${sectionKey}')">Load more (${left} remaining)</button>` : '';
            return `${body}${moreBtn}`;
        };

        const makeCard = (title, key, data) => `
            <div class="card mb-3">
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
            </div>`;

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
        const stateKey = `${typeKey}:${sectionKey}`;
        window.mdPage[stateKey] = (window.mdPage[stateKey] || 1) + 1;

        // Rerender the specific section
        const target = document.getElementById(`md-${typeKey}-${sectionKey}`);
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
            body = slice.map(m => `<div class="small text-muted">${this.escapeHtml(m.name || m.code || m.id)}</div>`).join('');
        } else if (sectionKey === 'conflicts') {
            body = slice.map(c => `<div class="small text-muted">${this.escapeHtml(c.name || c.code || c.id)}</div>`).join('');
        } else if (sectionKey === 'suggestions') {
            body = slice.map(s => {
                const sourceName = this.escapeHtml(s.source?.name || s.source?.code || s.source?.id);
                const destName = this.escapeHtml(s.dest?.name || s.dest?.code || s.dest?.id);
                const by = this.escapeHtml(s.by);
                const confidence = this.escapeHtml(s.confidence);
                return `<div class="small text-muted">${sourceName} → ${destName} (${by}, ${confidence})</div>`;
            }).join('');
        }

        const moreBtn = left > 0 ? `<button class="btn btn-sm btn-outline-secondary mt-2" onclick="app.loadMoreMd('${typeKey}','${sectionKey}')">Load more (${left} remaining)</button>` : '';
        target.innerHTML = `${body}${moreBtn}`;
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
        <div class="modal-dialog modal-xl">
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
        </div>`;

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

            html += `<div class="mb-2"><strong>${this.escapeHtml(key)}</strong></div>`;
            html += sec.suggestions.slice(0, 200).map((s, idx) => {
                const sid = `${key}-${idx}`;
                const sName = this.escapeHtml(s.source?.name || s.source?.code || s.source?.id);
                const dName = this.escapeHtml(s.dest?.name || s.dest?.code || s.dest?.id);
                const by = this.escapeHtml(s.by);
                const confidence = this.escapeHtml(s.confidence);
                return `<div class="form-check">
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
            const saved = await App.SaveMetadataMappings(this.currentProfile, pairs);
            alert(`Saved ${saved} mapping(s).`);
            toast.success(`Saved ${saved} mapping(s).`);
        } catch (error) {
            console.error('Failed to save mappings:', error);
            alert(`Failed to save mappings: ${error}`);
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
            const preview = await App.BuildMetadataPayloadPreview(this.currentProfile, scope, {});
            const summary = JSON.stringify(preview.counts || {}, null, 2);
            const snippet = JSON.stringify(preview.payload || {}, null, 2).slice(0, 4000);

            document.getElementById('metadata-results').innerHTML = `
                <div class="card mt-3">
                    <div class="card-header"><strong>Payload Preview</strong></div>
                    <div class="card-body">
                        <div class="mb-2"><strong>Counts by type</strong></div>
                        <pre style="white-space: pre-wrap;">${this.escapeHtml(summary)}</pre>
                        <div class="mb-2"><strong>Payload (truncated)</strong></div>
                        <pre style="white-space: pre-wrap;">${this.escapeHtml(snippet)}</pre>
                    </div>
                </div>`;
        } catch (error) {
            console.error('Preview error:', error);
            document.getElementById('metadata-results').innerHTML = `<div class="alert alert-danger">Preview error: ${this.escapeHtml(String(error))}</div>`;
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
            const preview = await App.BuildMetadataPayloadPreview(this.currentProfile, scope, {});
            const report = await App.MetadataDryRun(this.currentProfile, scope, preview.payload, {});
            document.getElementById('metadata-results').innerHTML = this.renderImportReport('Dry-Run Import Report', report);
        } catch (error) {
            console.error('Dry-run error:', error);
            document.getElementById('metadata-results').innerHTML = `<div class="alert alert-danger">Dry-run failed: ${this.escapeHtml(String(error))}</div>`;
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
            const preview = await App.BuildMetadataPayloadPreview(this.currentProfile, scope, {});
            const report = await App.MetadataApply(this.currentProfile, scope, preview.payload, {});
            document.getElementById('metadata-results').innerHTML = this.renderImportReport('Apply Import Report', report);
            toast.success('Metadata applied successfully!');
        } catch (error) {
            console.error('Apply error:', error);
            document.getElementById('metadata-results').innerHTML = `<div class="alert alert-danger">Apply failed: ${this.escapeHtml(String(error))}</div>`;
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
            <div class="card mt-3">
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
          <div class="card mt-2">
            <div class="card-header"><strong>Raw Report (truncated)</strong></div>
            <div class="card-body"><pre style="white-space: pre-wrap;">${this.escapeHtml(rawSnippet)}</pre></div>
          </div>`;

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

            const programs = await App.ListTrackerPrograms(this.currentProfile, 'source', false, '');

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
            toast.error(`Failed to load tracker programs: ${error}`);
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

            const detail = await App.GetTrackerProgramDetail(this.currentProfile, programId, 'source');

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
                profile_id: this.currentProfile,
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
                <div class="card">
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
                <div class="alert alert-danger">
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
                profile_id: this.currentProfile,
                program_id: programId,
                program_stage_id: stageId,
                org_unit: orgUnit,
                start_date: startDate,
                end_date: endDate,
                include_descendants: true,
                dry_run: dryRun
            };

            const taskId = await App.StartTrackerTransfer(request);

            // Show progress section
            const progressDiv = document.getElementById('trk-progress');
            progressDiv.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">
                            <i class="bi bi-hourglass-split me-2"></i>${dryRun ? 'Dry-Run' : 'Transfer'} in Progress
                        </h6>
                    </div>
                    <div class="card-body">
                        <div class="mb-3">
                            <div class="progress">
                                <div class="progress-bar progress-bar-striped progress-bar-animated"
                                     role="progressbar" style="width: 0%" id="trk-progress-bar">0%</div>
                            </div>
                        </div>
                        <div id="trk-progress-messages"></div>
                    </div>
                </div>
            `;

            // Disable buttons during transfer
            document.getElementById('trk-preview-btn').disabled = true;
            document.getElementById('trk-transfer-btn').disabled = true;
            document.getElementById('trk-dryrun-btn').disabled = true;

            // Poll for progress
            this.pollTrackerProgress(taskId);

        } catch (error) {
            console.error('Failed to start tracker transfer:', error);
            toast.error(`Failed to start transfer: ${error}`);
        }
    }

    /**
     * Poll tracker transfer progress
     */
    async pollTrackerProgress(taskId) {
        const progressBar = document.getElementById('trk-progress-bar');
        const messagesDiv = document.getElementById('trk-progress-messages');

        const poll = async () => {
            try {
                const progress = await App.GetTrackerTransferProgress(taskId);

                // Update progress bar
                if (progressBar && progress.progress !== undefined) {
                    const percent = Math.round(progress.progress);
                    progressBar.style.width = `${percent}%`;
                    progressBar.textContent = `${percent}%`;
                }

                // Update messages
                if (messagesDiv && progress.message) {
                    messagesDiv.innerHTML = `<div class="alert alert-info">${this.escapeHtml(progress.message)}</div>`;
                }

                // Check if complete
                if (progress.status === 'completed') {
                    if (progressBar) {
                        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
                        progressBar.classList.add('bg-success');
                    }
                    toast.success('Tracker transfer completed successfully!');

                    // Show result summary
                    if (messagesDiv && progress.result) {
                        const result = progress.result;
                        messagesDiv.innerHTML = `
                            <div class="alert alert-success">
                                <strong>Transfer Complete!</strong>
                                <div class="mt-2">
                                    <div>Events transferred: ${result.imported || result.created || 0}</div>
                                    <div>Events updated: ${result.updated || 0}</div>
                                    <div>Events ignored: ${result.ignored || 0}</div>
                                </div>
                            </div>
                        `;
                    }

                    // Re-enable buttons
                    document.getElementById('trk-preview-btn').disabled = false;
                    document.getElementById('trk-transfer-btn').disabled = false;
                    document.getElementById('trk-dryrun-btn').disabled = false;
                    return;
                }

                if (progress.status === 'failed' || progress.status === 'error') {
                    if (progressBar) {
                        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
                        progressBar.classList.add('bg-danger');
                    }
                    toast.error('Tracker transfer failed!');

                    if (messagesDiv) {
                        messagesDiv.innerHTML = `
                            <div class="alert alert-danger">
                                <strong>Transfer Failed</strong>
                                <div class="mt-2">${this.escapeHtml(progress.message || 'Unknown error')}</div>
                            </div>
                        `;
                    }

                    // Re-enable buttons
                    document.getElementById('trk-preview-btn').disabled = false;
                    document.getElementById('trk-transfer-btn').disabled = false;
                    document.getElementById('trk-dryrun-btn').disabled = false;
                    return;
                }

                // Continue polling
                setTimeout(poll, 2000);

            } catch (error) {
                console.error('Error polling tracker progress:', error);
                toast.error('Error checking transfer progress');

                // Re-enable buttons on error
                document.getElementById('trk-preview-btn').disabled = false;
                document.getElementById('trk-transfer-btn').disabled = false;
                document.getElementById('trk-dryrun-btn').disabled = false;
            }
        };

        poll();
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
        console.log('Loading Completeness tab...');

        // Setup instance change listener
        const instanceSelect = document.getElementById('comp_instance');
        if (instanceSelect && !instanceSelect.dataset.listenerAdded) {
            instanceSelect.addEventListener('change', async () => {
                await this.loadCompletenessDatasets();
                // Reinitialize OU picker for the new instance
                await this.initCompletenessOUPicker();
            });
            instanceSelect.dataset.listenerAdded = 'true';
        }

        await this.loadCompletenessDatasets();

        // Initialize OU picker
        await this.initCompletenessOUPicker();
    }

    /**
     * Initialize org unit picker for Completeness tab
     */
    async initCompletenessOUPicker() {
        try {
            const instanceSelect = document.getElementById('comp_instance');
            const instance = instanceSelect?.value || 'source';

            // Dynamically import the OrgUnitTreePicker component
            const { OrgUnitTreePicker } = await import('./components/org-unit-tree.js');

            // Initialize picker
            this.completenessOUPicker = new OrgUnitTreePicker(
                'comp-ou-picker-container',
                this.currentProfile,
                instance
            );

            await this.completenessOUPicker.initialize();

            console.log('Completeness OU picker initialized');

        } catch (error) {
            console.error('Failed to initialize OU picker:', error);
            toast.error(`Failed to initialize org unit picker: ${error}`);
        }
    }

    /**
     * Load datasets for completeness assessment
     */
    async loadCompletenessDatasets() {
        const datasetSelect = document.getElementById('comp_dataset_id');
        if (!datasetSelect) return;

        if (!this.currentProfile) {
            datasetSelect.innerHTML = '<option value="">No profile selected - go to Settings</option>';
            return;
        }

        const instanceSelect = document.getElementById('comp_instance');
        const instance = instanceSelect?.value || 'source';

        try {
            datasetSelect.innerHTML = '<option value="">Loading datasets...</option>';
            const datasets = await App.ListDatasets(this.currentProfile, instance);

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

        } catch (error) {
            console.error('Failed to load datasets:', error);
            datasetSelect.innerHTML = '<option value="">Error loading datasets</option>';
            toast.error(`Failed to load datasets: ${error}`);
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

        if (!this.currentProfile) {
            toast.error('No profile selected');
            return;
        }

        try {
            const progressDiv = document.getElementById('comp-progress');
            progressDiv.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split me-2"></i>Starting assessment...</div>';

            document.getElementById('comp-results').textContent = 'No results yet.';
            document.getElementById('comp-run-btn').disabled = true;

            const request = {
                profile_id: this.currentProfile,
                instance: instance,
                dataset_id: datasetId,
                parent_org_units: orgUnits,  // Fixed: was org_units
                periods: [],  // TODO: Add period picker UI
                required_elements: [],  // TODO: Add data elements UI (empty = all)
                compliance_threshold: threshold,  // Fixed: was threshold
                include_parents: includeParents
            };

            const taskId = await App.StartCompletenessAssessment(request);
            this.pollCompletenessProgress(taskId);

        } catch (error) {
            console.error('Failed to start assessment:', error);
            document.getElementById('comp-progress').innerHTML = `<div class="alert alert-danger">${this.escapeHtml(String(error))}</div>`;
            document.getElementById('comp-run-btn').disabled = false;
            toast.error('Failed to start assessment');
        }
    }

    /**
     * Poll completeness assessment progress
     */
    async pollCompletenessProgress(taskId) {
        const progressDiv = document.getElementById('comp-progress');
        const resultsDiv = document.getElementById('comp-results');

        // Store taskID for export
        this.completenessTaskId = taskId;

        const poll = async () => {
            try {
                const progress = await App.GetCompletenessAssessmentProgress(taskId);

                // Update progress
                if (progressDiv && progress.progress !== undefined) {
                    const percent = Math.round(progress.progress);
                    progressDiv.innerHTML = `
                        <div class="progress">
                            <div class="progress-bar ${progress.status === 'completed' ? 'bg-success' : progress.status === 'error' ? 'bg-danger' : 'progress-bar-striped progress-bar-animated'}"
                                 role="progressbar" style="width: ${percent}%">${percent}%</div>
                        </div>
                        <div class="small text-muted mt-2">${this.escapeHtml(progress.message || '')}</div>
                    `;
                }

                // Check if complete
                if (progress.status === 'completed') {
                    document.getElementById('comp-run-btn').disabled = false;

                    // Show export buttons
                    document.getElementById('comp-actions').style.display = 'block';

                    // Store results for rendering
                    window.completenessResults = progress.results;

                    // Render results
                    this.renderCompletenessResults(progress.results);
                    toast.success('Assessment completed!');
                    return;
                }

                if (progress.status === 'failed' || progress.status === 'error') {
                    document.getElementById('comp-run-btn').disabled = false;
                    resultsDiv.innerHTML = `<div class="alert alert-danger">Assessment failed: ${this.escapeHtml(progress.message || 'Unknown error')}</div>`;
                    toast.error('Assessment failed');
                    return;
                }

                // Continue polling
                setTimeout(poll, 2000);

            } catch (error) {
                console.error('Error polling progress:', error);
                document.getElementById('comp-run-btn').disabled = false;
                toast.error('Error checking progress');
            }
        };

        poll();
    }

    /**
     * Render completeness results
     */
    renderCompletenessResults(results) {
        const resultsDiv = document.getElementById('comp-results');

        if (!results || !results.org_units || results.org_units.length === 0) {
            resultsDiv.innerHTML = '<div class="text-muted">No results to display</div>';
            return;
        }

        const compliantCount = results.org_units.filter(ou => ou.compliant).length;
        const totalCount = results.org_units.length;

        let html = `
            <div class="mb-3">
                <div class="d-flex justify-content-between mb-2">
                    <strong>Summary</strong>
                    <span class="badge bg-${compliantCount === totalCount ? 'success' : 'warning'}">${compliantCount}/${totalCount} Compliant</span>
                </div>
                <div class="progress" style="height: 20px;">
                    <div class="progress-bar bg-success" style="width: ${(compliantCount/totalCount*100).toFixed(1)}%">
                        ${(compliantCount/totalCount*100).toFixed(1)}%
                    </div>
                </div>
            </div>
            <div class="small" style="max-height: 400px; overflow:auto;">
                <table class="table table-sm table-striped">
                    <thead>
                        <tr>
                            <th>Org Unit</th>
                            <th>Compliance %</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        results.org_units.slice(0, 50).forEach(ou => {
            const compliancePercent = ((ou.present_count / ou.required_count) * 100).toFixed(1);
            html += `
                <tr>
                    <td><small>${this.escapeHtml(ou.org_unit_name || ou.org_unit_id)}</small></td>
                    <td><small>${compliancePercent}%</small></td>
                    <td><span class="badge bg-${ou.compliant ? 'success' : 'danger'} badge-sm">${ou.compliant ? 'OK' : 'Incomplete'}</span></td>
                </tr>
            `;
        });

        html += '</tbody></table>';

        if (results.org_units.length > 50) {
            html += `<div class="text-muted text-center">Showing first 50 of ${results.org_units.length} org units. Export for full results.</div>`;
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
            // Backend signature: ExportCompletenessResults(taskID, format, limit)
            const exportPath = await App.ExportCompletenessResults(
                this.completenessTaskId,
                format,
                200  // limit to 200 rows for CSV
            );

            toast.success(`Exported successfully: ${exportPath}`);

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
                <div class="alert alert-warning">
                    <i class="bi bi-info-circle me-2"></i>
                    No connection profiles configured yet. Add your first profile below.
                </div>
                <button class="btn btn-primary" onclick="app.showAddProfileForm()">
                    <i class="bi bi-plus-circle"></i> Add Profile
                </button>
            `;
            return;
        }

        let html = `
            <div class="mb-3">
                <button class="btn btn-primary" onclick="app.showAddProfileForm()">
                    <i class="bi bi-plus-circle"></i> Add Profile
                </button>
            </div>
            <div class="table-responsive">
                <table class="table table-striped table-hover">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Owner</th>
                            <th>Source URL</th>
                            <th>Destination URL</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        profiles.forEach(profile => {
            html += `
                <tr>
                    <td><strong>${this.escapeHtml(profile.name)}</strong></td>
                    <td>${this.escapeHtml(profile.owner || '-')}</td>
                    <td><small>${this.escapeHtml(profile.source_url)}</small></td>
                    <td><small>${this.escapeHtml(profile.dest_url)}</small></td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="app.selectProfile('${profile.id}')">
                            <i class="bi bi-check-circle"></i> Select
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="app.deleteProfile('${profile.id}')">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        settingsContent.innerHTML = html;
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
     * Select a profile
     */
    async selectProfile(profileId) {
        try {
            await App.SelectProfile(profileId);
            this.currentProfile = profileId;
            toast.success('Profile selected successfully!');
        } catch (error) {
            console.error('Failed to select profile:', error);
            toast.error(`Failed to select profile: ${error}`);
        }
    }

    /**
     * Delete a profile
     */
    async deleteProfile(profileId) {
        if (!confirm('Are you sure you want to delete this profile?')) {
            return;
        }

        try {
            await App.DeleteProfile(profileId);
            toast.success('Profile deleted successfully!');
            this.loadSettings();
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
});

