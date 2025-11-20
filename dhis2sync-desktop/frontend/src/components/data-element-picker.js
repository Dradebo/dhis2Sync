import * as App from '../../wailsjs/go/main/App';
import { toast } from '../toast';

export class DataElementPicker {
    constructor(containerId) {
        this.containerId = containerId;
        this.elements = []; // Full list of {id, name, code}
        this.filteredElements = [];
        this.selectedIds = new Set();
        this.datasetId = null;
        this.profileId = null;

        // Expose instance for inline event handlers
        window[`dataElementPicker_${containerId}`] = this;
    }

    /**
     * Initialize and load data elements for a dataset
     * @param {string} profileId 
     * @param {string} datasetId 
     */
    async load(profileId, datasetId) {
        this.profileId = profileId;
        this.datasetId = datasetId;
        this.elements = [];
        this.selectedIds.clear();

        this.renderLoading();

        try {
            // We can get data elements from GetDatasetInfo
            // Assuming 'source' instance for now as that's usually where we check completeness against?
            // Or maybe we want to check destination? Usually completeness is checked on the source before transfer,
            // or on destination after transfer. The python app checks source completeness usually?
            // Let's assume source for now, or make it configurable if needed.
            // Actually, completeness check in this app seems to be configurable (instance='source' or 'dest').
            // We might need to know which instance to fetch from. 
            // For now, let's default to 'source' as that's the most common use case for "Compliance".

            const info = await App.GetDatasetInfo(profileId, datasetId, 'source');

            if (info && info.dataElements) {
                this.elements = info.dataElements.map(de => ({
                    id: de.id,
                    name: de.displayName || de.name,
                    code: de.code
                })).sort((a, b) => a.name.localeCompare(b.name));
            }

            this.filteredElements = [...this.elements];
            this.render();

        } catch (error) {
            console.error('Failed to load data elements:', error);
            this.renderError(error);
        }
    }

    renderLoading() {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = `
                <div class="d-flex justify-content-center py-4">
                    <div class="spinner-border text-primary spinner-sm" role="status">
                        <span class="visually-hidden">Loading elements...</span>
                    </div>
                </div>
            `;
        }
    }

    renderError(error) {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger small mb-0">
                    <i class="bi bi-exclamation-triangle me-1"></i> Failed to load elements
                </div>
            `;
        }
    }

    render() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        const allSelected = this.elements.length > 0 && this.selectedIds.size === this.elements.length;
        const indeterminate = this.selectedIds.size > 0 && this.selectedIds.size < this.elements.length;

        const html = `
            <div class="card bg-light border-0">
                <div class="card-body p-2">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <div class="fw-bold small text-muted">Required Data Elements</div>
                        <div class="badge bg-secondary">${this.selectedIds.size} / ${this.elements.length}</div>
                    </div>
                    
                    <div class="input-group input-group-sm mb-2">
                        <span class="input-group-text bg-white border-end-0"><i class="bi bi-search"></i></span>
                        <input type="text" class="form-control border-start-0" id="${this.containerId}-search" placeholder="Filter elements..." onkeyup="dataElementPicker_${this.containerId}.filter(this.value)">
                    </div>

                    <div class="form-check mb-2 border-bottom pb-2">
                        <input class="form-check-input" type="checkbox" id="${this.containerId}-select-all" 
                            ${allSelected ? 'checked' : ''} 
                            onchange="dataElementPicker_${this.containerId}.toggleAll(this.checked)">
                        <label class="form-check-label small fw-bold" for="${this.containerId}-select-all">
                            Select All
                        </label>
                    </div>

                    <div class="overflow-auto" style="max-height: 200px; background: white; border: 1px solid #dee2e6; border-radius: 4px;">
                        <div class="list-group list-group-flush">
                            ${this.filteredElements.length > 0 ? this.filteredElements.map(de => `
                                <label class="list-group-item list-group-item-action py-1 px-2 d-flex align-items-center" style="font-size: 0.9rem;">
                                    <input class="form-check-input me-2 mt-0" type="checkbox" value="${de.id}" 
                                        ${this.selectedIds.has(de.id) ? 'checked' : ''} 
                                        onchange="dataElementPicker_${this.containerId}.toggleOne('${de.id}', this.checked)">
                                    <div class="text-truncate" title="${de.name}">
                                        ${de.name}
                                    </div>
                                </label>
                            `).join('') : `
                                <div class="p-3 text-center text-muted small">No elements found</div>
                            `}
                        </div>
                    </div>
                    <div class="form-text small mt-1">
                        <i class="bi bi-info-circle me-1"></i> Only selected elements will be checked for completeness.
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Handle indeterminate state for select all
        const selectAll = document.getElementById(`${this.containerId}-select-all`);
        if (selectAll) {
            selectAll.indeterminate = indeterminate;
        }
    }

    filter(query) {
        if (!query) {
            this.filteredElements = [...this.elements];
        } else {
            const lower = query.toLowerCase();
            this.filteredElements = this.elements.filter(de =>
                de.name.toLowerCase().includes(lower) ||
                (de.code && de.code.toLowerCase().includes(lower)) ||
                de.id.toLowerCase().includes(lower)
            );
        }
        this.render();

        // Restore focus to search input
        const searchInput = document.getElementById(`${this.containerId}-search`);
        if (searchInput) {
            searchInput.value = query;
            searchInput.focus();
        }
    }

    toggleAll(checked) {
        if (checked) {
            this.elements.forEach(de => this.selectedIds.add(de.id));
        } else {
            this.selectedIds.clear();
        }
        this.filter(document.getElementById(`${this.containerId}-search`)?.value || '');
    }

    toggleOne(id, checked) {
        if (checked) {
            this.selectedIds.add(id);
        } else {
            this.selectedIds.delete(id);
        }
        this.render();
        // Restore search query and focus
        const searchInput = document.getElementById(`${this.containerId}-search`);
        if (searchInput) {
            const val = searchInput.value;
            searchInput.focus();
            // Re-apply filter if needed, though render() uses filteredElements which should be preserved if we didn't reset it.
            // Actually render() uses filteredElements which is state.
            // But render() re-generates HTML, so we lose focus.
            // The filter method re-renders.
            // Here we called render() directly.
        }
    }

    getSelectedIds() {
        return Array.from(this.selectedIds);
    }
}
