/**
 * Completeness Assessment Module
 * Handles data completeness assessment UI and logic for DHIS2 Sync Desktop
 */

import { generatePeriods } from './utils/periods';

export class CompletenessModule {
    constructor(app) {
        this.app = app;
        this.selectedPeriods = [];
        this.selectedOrgUnits = new Set();
        this.selectedElements = new Set();
        this.datasetInfo = null;
        this.currentInstance = 'source';

        // Data elements pagination
        this._allDE = [];
        this._filteredDE = null;
        this._dePage = 1;
        this._dePageSize = 30;

        // Detail modal state
        this._detailPresent = [];
        this._detailMissing = [];
        this._detailQuery = { present: '', missing: '' };

        // Results state
        this.lastResults = null;
        this.selectedResultOUs = new Set();
    }

    /**
     * Initialize completeness tab when activated
     */
    async init() {
        console.log('[Completeness] Initializing...');

        // Load datasets for currently selected instance
        await this.loadDatasets();

        // Load OU tree
        await this.loadOUTreeRoot();

        // Setup event listeners
        this.setupEventListeners();

        console.log('[Completeness] Initialized');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Instance change
        const instSelect = document.getElementById('comp_instance');
        if (instSelect) {
            instSelect.addEventListener('change', async () => {
                this.currentInstance = instSelect.value;
                await this.loadDatasets();
                await this.loadOUTreeRoot();
                this.reset();
            });
        }

        // Dataset change - load dataset info
        const datasetSelect = document.getElementById('comp_dataset_id');
        if (datasetSelect) {
            datasetSelect.addEventListener('change', async (e) => {
                const datasetId = e.target.value;
                this.selectedPeriods = [];
                this.renderSelectedPeriods();

                if (!datasetId) {
                    document.getElementById('comp-period-section').style.display = 'none';
                    return;
                }

                try {
                    console.log('[Completeness] Loading dataset info', datasetId);
                    const info = await this.app.getDatasetInfo(datasetId, this.currentInstance);
                    this.datasetInfo = info;
                    console.log('[Completeness] Dataset info loaded', info);

                    this.buildPeriodPicker(info.period_type || 'Monthly');
                    this.initDataElements(info.data_elements || []);
                    document.getElementById('comp-period-section').style.display = 'block';
                    this.updateRunButtonState();
                } catch (error) {
                    console.error('[Completeness] Failed to load dataset info', error);
                    document.getElementById('comp-period-section').style.display = 'none';
                }
            });
        }
    }

    /**
     * Load datasets from selected instance
     */
    async loadDatasets() {
        const select = document.getElementById('comp_dataset_id');
        if (!select) return;

        try {
            select.innerHTML = '<option value="">Loading...</option>';
            const datasets = await this.app.listDatasets(this.currentInstance);

            select.innerHTML = '<option value="">Select dataset...</option>';
            datasets.forEach(ds => {
                const option = document.createElement('option');
                option.value = ds.id;
                option.textContent = ds.displayName || ds.name || ds.id;
                select.appendChild(option);
            });
            console.log('[Completeness] Loaded', datasets.length, 'datasets');
        } catch (error) {
            console.error('[Completeness] Failed to load datasets', error);
            select.innerHTML = '<option value="">Failed to load</option>';
        }
    }

    /**
     * Build period picker based on dataset's period type
     */
    buildPeriodPicker(periodType) {
        const container = document.getElementById('comp-period-picker-container');
        if (!container) return;

        const periods = generatePeriods(periodType, 50);

        container.innerHTML = `
            <div class="mb-2">
                <select class="form-select" id="comp-period-select">
                    <option value="">Select a ${periodType.toLowerCase()} period...</option>
                    ${periods.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
            </div>
        `;

        const select = document.getElementById('comp-period-select');
        select.addEventListener('change', () => {
            const val = select.value;
            if (val && !this.selectedPeriods.includes(val)) {
                this.selectedPeriods.push(val);
                this.renderSelectedPeriods();
                this.updateRunButtonState();
            }
            select.value = '';
        });
    }

    /**
     * Render selected periods as badges
     */
    renderSelectedPeriods() {
        const div = document.getElementById('comp-selected-periods');
        if (!div) return;

        if (this.selectedPeriods.length === 0) {
            div.innerHTML = '<small class="text-muted">No periods selected</small>';
            return;
        }

        div.innerHTML = this.selectedPeriods.map(p => `
            <span class="badge bg-primary me-1 mb-1">
                ${p}
                <button type="button" class="btn-close btn-close-white btn-sm ms-1" onclick="app.completeness.removePeriod('${p}')"></button>
            </span>
        `).join('');
    }

    /**
     * Select recent periods (Last 6)
     */
    selectRecentPeriods() {
        const periodType = this.datasetInfo?.period_type || 'Monthly';
        const periods = generatePeriods(periodType, 50);
        this.selectedPeriods = periods.slice(0, 6).map(p => p.id);
        this.renderSelectedPeriods();
        this.updateRunButtonState();
    }

    /**
     * Select current year periods
     */
    selectYearPeriods() {
        const periodType = this.datasetInfo?.period_type || 'Monthly';
        const currentYear = new Date().getFullYear();
        const periods = generatePeriods(periodType, 50);
        this.selectedPeriods = periods.filter(p => p.id.includes(String(currentYear))).map(p => p.id);
        this.renderSelectedPeriods();
        this.updateRunButtonState();
    }

    /**
     * Clear selected periods
     */
    clearPeriods() {
        this.selectedPeriods = [];
        this.renderSelectedPeriods();
        this.updateRunButtonState();
    }

    /**
     * Remove a specific period
     */
    removePeriod(periodId) {
        this.selectedPeriods = this.selectedPeriods.filter(p => p !== periodId);
        this.renderSelectedPeriods();
        this.updateRunButtonState();
    }

    /**
     * Load root org units
     */
    async loadOUTreeRoot() {
        const tree = document.getElementById('comp_ou_tree');
        if (!tree) return;

        tree.innerHTML = '<div class="text-muted small">Loading...</div>';

        try {
            const roots = await this.app.listOrgUnits('', this.currentInstance);
            tree.innerHTML = this.renderOUTreeNodes(roots);
        } catch (error) {
            console.error('[Completeness] Failed to load OU tree', error);
            tree.innerHTML = `<div class="text-danger small">${error.message}</div>`;
        }
    }

    /**
     * Render OU tree nodes
     */
    renderOUTreeNodes(nodes) {
        const sorted = (nodes || []).slice().sort((a, b) => {
            const an = (a.displayName || a.name || a.id || '').toLowerCase();
            const bn = (b.displayName || b.name || b.id || '').toLowerCase();
            return an.localeCompare(bn);
        });

        return `<ul class="list-unstyled mb-0">${sorted.map(n => this.renderOUTreeNode(n)).join('')}</ul>`;
    }

    /**
     * Render single OU tree node
     */
    renderOUTreeNode(node) {
        const checked = this.selectedOrgUnits.has(node.id) ? 'checked' : '';
        const caret = node.hasChildren ? `
            <button type="button" class="btn btn-sm btn-secondary p-0 px-1 me-1"
                    onclick="app.completeness.toggleOUTree('${node.id}', event)"
                    data-ou-caret="${node.id}" title="Expand/Collapse">
                <i class="bi bi-caret-right-fill" data-ou-icon="${node.id}"></i>
            </button>
        ` : '<span class="me-1"></span>';

        return `
            <li class="mb-1" data-ou-node="${node.id}">
                ${caret}
                <input class="form-check-input me-1" type="checkbox" id="ou_${node.id}" ${checked}
                       onchange="app.completeness.toggleOU('${node.id}', this.checked)">
                <label for="ou_${node.id}" class="form-check-label">${node.displayName || node.name || node.id}</label>
                <div class="ms-4 mt-1" data-ou-children="${node.id}" style="display:none;"></div>
            </li>
        `;
    }

    /**
     * Toggle OU tree node expansion
     */
    async toggleOUTree(ouId, event) {
        if (event && event.preventDefault) event.preventDefault();
        if (event && event.stopPropagation) event.stopPropagation();

        const container = document.querySelector(`[data-ou-children='${ouId}']`);
        if (!container) return;

        // If already loaded, just toggle visibility
        if (container.getAttribute('data-loaded') === '1') {
            const visible = container.style.display !== 'none';
            container.style.display = visible ? 'none' : 'block';
            const icon = document.querySelector(`[data-ou-icon='${ouId}']`);
            if (icon) icon.className = visible ? 'bi bi-caret-right-fill' : 'bi bi-caret-down-fill';
            return;
        }

        // Load children
        try {
            const children = await this.app.listOrgUnits(ouId, this.currentInstance);
            container.innerHTML = this.renderOUTreeNodes(children);
            container.setAttribute('data-loaded', '1');
            container.style.display = 'block';
            const icon = document.querySelector(`[data-ou-icon='${ouId}']`);
            if (icon) icon.className = 'bi bi-caret-down-fill';
        } catch (error) {
            console.error('[Completeness] Failed to load OU children', error);
            container.innerHTML = `<div class="text-danger small">${error.message}</div>`;
        }
    }

    /**
     * Toggle OU selection
     */
    toggleOU(ouId, checked) {
        if (checked) {
            this.selectedOrgUnits.add(ouId);
        } else {
            this.selectedOrgUnits.delete(ouId);
        }
        this.updateRunButtonState();
    }

    /**
     * Expand all OU nodes
     */
    expandAllOrgUnits() {
        document.querySelectorAll('[data-ou-caret]').forEach(btn => btn.click());
    }

    /**
     * Collapse all OU nodes
     */
    collapseAllOrgUnits() {
        document.querySelectorAll('[data-ou-children]').forEach(div => {
            div.style.display = 'none';
        });
        document.querySelectorAll('[data-ou-icon]').forEach(icon => {
            icon.className = 'bi bi-caret-right-fill';
        });
    }

    /**
     * Filter org units by search query
     */
    filterOrgUnits() {
        const query = (document.getElementById('comp_ou_search')?.value || '').toLowerCase();
        document.querySelectorAll('[data-ou-node]').forEach(li => {
            const label = li.querySelector('label')?.textContent?.toLowerCase() || '';
            li.style.display = query && !label.includes(query) ? 'none' : '';
        });
    }

    /**
     * Clear all org unit selections
     */
    clearOrgUnits() {
        this.selectedOrgUnits.clear();
        document.querySelectorAll('#comp_ou_tree input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        this.updateRunButtonState();
    }

    /**
     * Initialize data elements list
     */
    initDataElements(elements) {
        const sorted = (elements || []).slice().sort((a, b) => {
            const an = (a.displayName || a.id || '').toLowerCase();
            const bn = (b.displayName || b.id || '').toLowerCase();
            return an.localeCompare(bn);
        });

        this._allDE = sorted;
        this._filteredDE = null;
        this._dePage = 1;
        this.selectedElements = new Set();
        this.renderDEPage();

        const pager = document.getElementById('comp_de_pager');
        if (pager) {
            pager.style.display = (this._allDE.length > this._dePageSize) ? 'flex' : 'none';
        }
        this.updateDEPageInfo();
    }

    /**
     * Get working set of data elements (filtered or all)
     */
    getDEWorkingSet() {
        return this._filteredDE || this._allDE || [];
    }

    /**
     * Apply data element filter
     */
    applyDEFilter() {
        const query = (document.getElementById('comp_de_search')?.value || '').toLowerCase();
        this._filteredDE = query ? (this._allDE || []).filter(d =>
            (d.displayName || d.id).toLowerCase().includes(query)
        ) : null;
        this._dePage = 1;
        this.renderDEPage();
        this.updateDEPageInfo();
    }

    /**
     * Render current page of data elements
     */
    renderDEPage() {
        const listDiv = document.getElementById('comp_de_list');
        if (!listDiv) return;

        const items = this.getDEWorkingSet();
        const start = (this._dePage - 1) * this._dePageSize;
        const pageItems = items.slice(start, start + this._dePageSize);

        listDiv.innerHTML = pageItems.map(item => {
            const checked = this.selectedElements.has(item.id) ? 'checked' : '';
            return `
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="de_${item.id}" ${checked}
                           onchange="app.completeness.toggleDE('${item.id}', this.checked)">
                    <label class="form-check-label" for="de_${item.id}">${item.displayName || item.id}</label>
                </div>
            `;
        }).join('') || '<div class="text-muted small">No elements</div>';
    }

    /**
     * Update DE page info
     */
    updateDEPageInfo() {
        const info = document.getElementById('comp_de_page_info');
        if (!info) return;

        const total = this.getDEWorkingSet().length;
        const start = total ? ((this._dePage - 1) * this._dePageSize + 1) : 0;
        const end = Math.min(total, this._dePage * this._dePageSize);
        info.textContent = total ? `Showing ${start}-${end} of ${total}` : 'No items';
    }

    /**
     * Next DE page
     */
    nextDEPage() {
        const total = this.getDEWorkingSet().length;
        const maxPage = Math.max(1, Math.ceil(total / this._dePageSize));
        if (this._dePage < maxPage) {
            this._dePage++;
            this.renderDEPage();
            this.updateDEPageInfo();
        }
    }

    /**
     * Previous DE page
     */
    prevDEPage() {
        if (this._dePage > 1) {
            this._dePage--;
            this.renderDEPage();
            this.updateDEPageInfo();
        }
    }

    /**
     * Toggle data element selection
     */
    toggleDE(deId, checked) {
        if (checked) {
            this.selectedElements.add(deId);
        } else {
            this.selectedElements.delete(deId);
        }
    }

    /**
     * Select all DE on current page
     */
    selectAllDEOnPage() {
        const items = this.getDEWorkingSet();
        const start = (this._dePage - 1) * this._dePageSize;
        const pageItems = items.slice(start, start + this._dePageSize);
        pageItems.forEach(it => this.selectedElements.add(it.id));
        this.renderDEPage();
    }

    /**
     * Clear all DE on current page
     */
    clearDEOnPage() {
        const items = this.getDEWorkingSet();
        const start = (this._dePage - 1) * this._dePageSize;
        const pageItems = items.slice(start, start + this._dePageSize);
        pageItems.forEach(it => this.selectedElements.delete(it.id));
        this.renderDEPage();
    }

    /**
     * Update run button state
     */
    updateRunButtonState() {
        const btn = document.getElementById('comp-run-btn');
        if (!btn) return;

        const hasDataset = !!document.getElementById('comp_dataset_id')?.value;
        const hasPeriods = this.selectedPeriods.length > 0;
        const hasOUs = this.selectedOrgUnits.size > 0;

        btn.disabled = !(hasDataset && hasPeriods && hasOUs);
    }

    /**
     * Preview assessment configuration
     */
    preview() {
        const previewDiv = document.getElementById('comp-preview');
        if (!previewDiv) return;

        const dsName = this.datasetInfo?.dataset_name || this.datasetInfo?.displayName || 'Dataset';
        const elsCount = this.selectedElements.size;
        const ouCount = this.selectedOrgUnits.size;
        const pCount = this.selectedPeriods.length;
        const threshold = parseInt(document.getElementById('comp_threshold')?.value || '100', 10);

        previewDiv.style.display = 'block';
        previewDiv.innerHTML = `
            <div class="card">
                <div class="card-header"><strong>Assessment Preview</strong></div>
                <div class="card-body small">
                    <div class="mb-2"><span class="badge bg-secondary">Dataset:</span> ${dsName}</div>
                    <div class="mb-2"><span class="badge bg-info">Periods:</span> ${pCount}</div>
                    <div class="mb-2"><span class="badge bg-primary">Required Elements:</span> ${elsCount} ${elsCount===0?'(all)': ''}</div>
                    <div class="mb-2"><span class="badge bg-dark">Parent OUs:</span> ${ouCount}</div>
                    <div class="mb-2"><span class="badge bg-warning text-dark">Threshold:</span> ${threshold}%</div>
                </div>
            </div>
        `;
    }

    /**
     * Reset form state
     */
    reset() {
        this.selectedPeriods = [];
        this.selectedElements = new Set();
        this.selectedOrgUnits = new Set();
        this.datasetInfo = null;
        this.renderSelectedPeriods();
        this.updateRunButtonState();

        const preview = document.getElementById('comp-preview');
        if (preview) preview.style.display = 'none';
    }

    /**
     * Render assessment results
     */
    renderResults(results) {
        const resultsDiv = document.getElementById('comp-results');
        if (!resultsDiv) return;

        if (!results || !results.org_units || results.org_units.length === 0) {
            resultsDiv.innerHTML = '<div class="text-muted small">No results to display</div>';
            return;
        }

        this.lastResults = results;

        const compliant = results.org_units.filter(ou => ou.compliant).length;
        const total = results.org_units.length;

        let html = `
            <div class="mb-2">
                <span class="badge bg-success">Compliant: ${compliant}</span>
                <span class="badge bg-warning text-dark ms-1">Non-compliant: ${total - compliant}</span>
            </div>
            <div class="mt-2 d-flex gap-2">
                <button type="button" class="btn btn-sm btn-outline-warning" onclick="app.completeness.selectNonCompliant()">Select Non-compliant</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.completeness.clearResultSelection()">Clear Selection</button>
            </div>
            <div class="mt-2">
                <div class="table-responsive" style="max-height: 280px; overflow:auto;">
                    <table class="table table-sm align-middle">
                        <thead>
                            <tr>
                                <th style="width:32px;"><input type="checkbox" onclick="app.completeness.toggleAllResults(this.checked)"></th>
                                <th>Org Unit</th>
                                <th class="text-end">Compliance %</th>
                                <th class="text-end">Present / Required</th>
                                <th style="width:80px;"></th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        results.org_units.forEach(ou => {
            const percent = ((ou.present_count / ou.required_count) * 100).toFixed(1);
            const selected = this.selectedResultOUs.has(ou.org_unit_id) ? 'checked' : '';
            html += `
                <tr>
                    <td><input type="checkbox" ${selected} onclick="app.completeness.toggleResultOU('${ou.org_unit_id}', this.checked)"></td>
                    <td><small>${ou.org_unit_name || ou.org_unit_id}</small></td>
                    <td class="text-end"><small>${percent}%</small></td>
                    <td class="text-end"><small>${ou.present_count} / ${ou.required_count}</small></td>
                    <td class="text-end"><button type="button" class="btn btn-sm btn-secondary" onclick="app.completeness.openDetail('${ou.org_unit_id}')">View</button></td>
                </tr>
            `;
        });

        html += '</tbody></table></div></div>';
        resultsDiv.innerHTML = html;

        // Show bulk actions
        document.getElementById('comp-bulk-actions').style.display = 'block';
    }

    /**
     * Toggle result OU selection
     */
    toggleResultOU(ouId, checked) {
        if (checked) {
            this.selectedResultOUs.add(ouId);
        } else {
            this.selectedResultOUs.delete(ouId);
        }
    }

    /**
     * Toggle all results
     */
    toggleAllResults(checked) {
        if (checked && this.lastResults) {
            this.selectedResultOUs = new Set(this.lastResults.org_units.map(ou => ou.org_unit_id));
        } else {
            this.selectedResultOUs.clear();
        }
        this.renderResults(this.lastResults);
    }

    /**
     * Select non-compliant org units
     */
    selectNonCompliant() {
        if (this.lastResults) {
            this.selectedResultOUs = new Set(
                this.lastResults.org_units.filter(ou => !ou.compliant).map(ou => ou.org_unit_id)
            );
            this.renderResults(this.lastResults);
        }
    }

    /**
     * Clear result selection
     */
    clearResultSelection() {
        this.selectedResultOUs.clear();
        this.renderResults(this.lastResults);
    }

    /**
     * Open detail modal for an org unit
     */
    openDetail(ouId) {
        if (!this.lastResults) return;

        const ouResult = this.lastResults.org_units.find(ou => ou.org_unit_id === ouId);
        if (!ouResult) return;

        const title = document.getElementById('compDetailTitle');
        const summary = document.getElementById('compDetailSummary');

        title.textContent = `${ouResult.org_unit_name || ouId} (${ouId})`;

        const percent = ((ouResult.present_count / ouResult.required_count) * 100).toFixed(1);
        summary.innerHTML = `
            <div class="d-flex flex-wrap gap-2">
                <span class="badge bg-primary">Compliance: ${percent}%</span>
                <span class="badge bg-success">Present: ${ouResult.present_count}</span>
                <span class="badge bg-secondary">Required: ${ouResult.required_count}</span>
            </div>
        `;

        // Map element IDs to names
        const nameMap = new Map();
        (this.datasetInfo?.data_elements || []).forEach(de => {
            nameMap.set(de.id, de.displayName || de.id);
        });

        const missingIds = ouResult.missing_elements || [];
        const requiredIds = (this.selectedElements && this.selectedElements.size > 0)
            ? Array.from(this.selectedElements)
            : (this.datasetInfo?.data_elements || []).map(de => de.id);

        const missingSet = new Set(missingIds);
        const presentIds = requiredIds.filter(id => !missingSet.has(id));

        this._detailPresent = presentIds.map(id => ({ id, name: nameMap.get(id) || id }));
        this._detailMissing = missingIds.map(id => ({ id, name: nameMap.get(id) || id }));

        this._detailPresent.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
        this._detailMissing.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));

        this._detailQuery = { present: '', missing: '' };
        this._renderDetailLists();

        // Show modal
        const modalEl = document.getElementById('compDetailModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }

    /**
     * Filter detail list
     */
    filterDetailList(which) {
        const searchInput = which === 'present'
            ? document.getElementById('compDetailPresentSearch')
            : document.getElementById('compDetailMissingSearch');

        const query = (searchInput?.value || '').toLowerCase();
        this._detailQuery[which] = query;
        this._renderDetailLists();
    }

    /**
     * Render detail lists (present/missing)
     */
    _renderDetailLists() {
        const presentList = document.getElementById('compDetailPresentList');
        const missingList = document.getElementById('compDetailMissingList');

        const qp = this._detailQuery.present || '';
        const qm = this._detailQuery.missing || '';

        const filter = (arr, q) => arr.filter(e =>
            (e.name || '').toLowerCase().includes(q) || (e.id || '').toLowerCase().includes(q)
        );

        const pr = filter(this._detailPresent || [], qp);
        const mr = filter(this._detailMissing || [], qm);

        presentList.innerHTML = pr.length
            ? pr.map(e => `<div>${e.name} <span class="text-muted">(${e.id})</span></div>`).join('')
            : '<div class="text-muted small">None</div>';

        missingList.innerHTML = mr.length
            ? mr.map(e => `<div>${e.name} <span class="text-muted">(${e.id})</span></div>`).join('')
            : '<div class="text-muted small">None</div>';
    }

    /**
     * Bulk complete selected org units
     */
    async bulkCompleteSelected() {
        await this._bulkAction('complete');
    }

    /**
     * Bulk mark selected org units incomplete
     */
    async bulkIncompleteSelected() {
        await this._bulkAction('incomplete');
    }

    /**
     * Execute bulk action
     */
    async _bulkAction(action) {
        const orgUnits = this.selectedResultOUs.size > 0
            ? Array.from(this.selectedResultOUs)
            : Array.from(this.selectedOrgUnits);

        if (orgUnits.length === 0 || this.selectedPeriods.length === 0) {
            this.app.toast.warning('Select org units and periods');
            return;
        }

        const progressDiv = document.getElementById('comp-bulk-progress');
        progressDiv.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split me-2"></i>Starting bulk action...</div>';

        try {
            const request = {
                profile_id: this.app.currentProfile,
                instance: this.currentInstance,
                dataset_id: document.getElementById('comp_dataset_id')?.value,
                org_units: orgUnits,
                periods: this.selectedPeriods,
                action: action
            };

            const taskId = await this.app.startCompletenessBulkAction(request);
            this._pollBulkProgress(taskId);

        } catch (error) {
            console.error('[Completeness] Bulk action failed', error);
            progressDiv.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    }

    /**
     * Poll bulk action progress
     */
    async _pollBulkProgress(taskId) {
        const progressDiv = document.getElementById('comp-bulk-progress');

        const poll = async () => {
            try {
                const progress = await this.app.getCompletenessBulkActionProgress(taskId);

                const percent = Math.round(progress.progress || 0);
                progressDiv.innerHTML = `
                    <div>Status: <span class="badge ${progress.status==='completed'?'bg-success':progress.status==='error'?'bg-danger':'bg-primary'}">${progress.status}</span></div>
                    <div class="progress my-2">
                        <div class="progress-bar" style="width:${percent}%">${percent}%</div>
                    </div>
                    <div class="small text-muted">${progress.message || ''}</div>
                `;

                if (progress.status === 'completed' || progress.status === 'error') {
                    this.app.toast.success('Bulk action completed');
                    return;
                }

                setTimeout(poll, 2000);
            } catch (error) {
                console.error('[Completeness] Polling error', error);
            }
        };

        poll();
    }
}
