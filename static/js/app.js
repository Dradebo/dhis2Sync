/**
 * DHIS2 Data Exchange Tool - Vanilla JavaScript Implementation
 * Replaces HTMX with pure vanilla JavaScript for zero WebSocket dependencies
 */

class DHISApp {
    constructor() {
        this.init();
    }

    init() {
        console.log('🚀 DHIS2 Data Exchange Tool - JavaScript Initialized');
        this.setupEventListeners();
        this.setupFormHelpers();
    }

    /**
     * Core AJAX function to replace HTMX functionality
     */
    async makeRequest(url, options = {}) {
        const defaultOptions = {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin'  // Include cookies for session management
        };

        const config = { ...defaultOptions, ...options };

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.text();
            }
        } catch (error) {
            console.error('Request failed:', error);
            this.showError(`Request failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update a target element with new content
     */
    updateElement(targetId, content) {
        const target = document.getElementById(targetId);
        if (target) {
            target.innerHTML = content;
        } else {
            console.warn(`Target element ${targetId} not found`);
        }
    }

    /**
     * Show loading state for an element
     */
    showLoading(elementId, text = 'Loading...') {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = `
                <div class="text-center py-4">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <div class="mt-2">${text}</div>
                </div>
            `;
        }
    }

    /**
     * Show error message
     */
    showError(message, targetId = 'main-content') {
        const errorHtml = `
            <div class="alert alert-danger" role="alert">
                <i class="bi bi-exclamation-triangle me-2"></i>
                ${message}
            </div>
        `;
        this.updateElement(targetId, errorHtml);
    }

    /**
     * Show success message
     */
    showSuccess(message, targetId = 'main-content') {
        const successHtml = `
            <div class="alert alert-success" role="alert">
                <i class="bi bi-check-circle me-2"></i>
                ${message}
            </div>
        `;
        this.updateElement(targetId, successHtml);
    }

    /**
     * Handle form submissions with AJAX
     */
    async submitForm(form, targetId = 'main-content', loadingText = 'Processing...') {
        const formData = new FormData(form);
        const url = form.action || form.getAttribute('data-url');
        const method = form.method || 'POST';

        // Show loading state
        this.showLoading(targetId, loadingText);

        try {
            const response = await this.makeRequest(url, {
                method: method.toUpperCase(),
                body: 
                formData
            });

            // Update target with response
            this.updateElement(targetId, response);

            // Trigger custom event for successful form submission
            document.dispatchEvent(new CustomEvent('formSubmitted', {
                detail: { form, response, targetId }
            }));

        } catch (error) {
            this.showError(`Form submission failed: ${error.message}`, targetId);
        }
    }

    /**
     * Setup global event listeners
     */
    setupEventListeners() {
        // Form submission handler
        document.addEventListener('submit', (e) => {
            if (e.target.hasAttribute('data-ajax')) {
                e.preventDefault();
                const targetId = e.target.getAttribute('data-target') || 'main-content';
                const loadingText = e.target.getAttribute('data-loading') || 'Processing...';
                this.submitForm(e.target, targetId, loadingText);
            }
        });

        // Button click handler for AJAX requests
        document.addEventListener('click', async (e) => {
            if (e.target.hasAttribute('data-ajax-url')) {
                e.preventDefault();
                const url = e.target.getAttribute('data-ajax-url');
                const targetId = e.target.getAttribute('data-target') || 'main-content';
                const method = e.target.getAttribute('data-method') || 'GET';
                const loadingText = e.target.getAttribute('data-loading') || 'Loading...';

                this.showLoading(targetId, loadingText);

                try {
                    const response = await this.makeRequest(url, { method });
                    this.updateElement(targetId, response);
                } catch (error) {
                    this.showError(`Request failed: ${error.message}`, targetId);
                }
            }
        });

        // Step navigation handler
        document.addEventListener('click', (e) => {
            if (e.target.hasAttribute('data-step')) {
                e.preventDefault();
                const step = e.target.getAttribute('data-step');
                this.navigateToStep(step);
            }
        });
    }

    /**
     * Setup form helper functions
     */
    setupFormHelpers() {
        // Auto-enable submit buttons when forms are valid
        document.addEventListener('input', (e) => {
            if (e.target.closest('form')) {
                const form = e.target.closest('form');
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) {
                    submitBtn.disabled = !form.checkValidity();
                }
            }
        });
    }

    /**
     * Navigate to a specific step in the wizard
     */
    async navigateToStep(step) {
        try {
            this.showLoading('main-content', 'Loading step...');
            const response = await this.makeRequest(`/navigate/${step}`, { method: 'POST' });
            this.updateElement('main-content', response);
            this.updateStepIndicator(step);
            
            // Dispatch step changed event for step-specific functionality
            document.dispatchEvent(new CustomEvent('stepChanged', {
                detail: { step: step }
            }));
        } catch (error) {
            this.showError(`Failed to navigate to step ${step}: ${error.message}`);
        }
    }

    /**
     * Update step indicator in the UI
     */
    updateStepIndicator(activeStep) {
        document.querySelectorAll('.step').forEach((step, index) => {
            const stepNumber = index + 1;
            step.classList.remove('active', 'completed');
            
            if (stepNumber == activeStep) {
                step.classList.add('active');
            } else if (stepNumber < activeStep) {
                step.classList.add('completed');
            }
        });
    }

    /**
     * Poll for progress updates
     */
    async pollProgress(taskId, targetId = 'progress-container', interval = 500) {
        const pollInterval = setInterval(async () => {
            try {
                const progress = await this.makeRequest(`/progress/${taskId}`);
                
                if (progress.status === 'completed' || progress.status === 'error') {
                    clearInterval(pollInterval);
                    
                    if (progress.status === 'completed') {
                        this.showSuccess('Task completed successfully!', targetId);
                    } else {
                        this.showError('Task failed. Please check the logs.', targetId);
                    }
                } else {
                    // Update progress display
                    const progressHtml = `
                        <div class="progress mb-3">
                            <div class="progress-bar" role="progressbar" style="width: ${progress.progress || 0}%">
                                ${progress.progress || 0}%
                            </div>
                        </div>
                        <div class="small">
                            Status: ${progress.status || 'Unknown'}<br>
                            ${progress.messages ? progress.messages.slice(-3).join('<br>') : ''}
                        </div>
                    `;
                    this.updateElement(targetId, progressHtml);
                }
            } catch (error) {
                clearInterval(pollInterval);
                this.showError(`Progress polling failed: ${error.message}`, targetId);
            }
        }, interval);

        return pollInterval;
    }

    /**
     * Utility to serialize form data as JSON
     */
    formToJSON(form) {
        const formData = new FormData(form);
        const data = {};
        
        for (let [key, value] of formData.entries()) {
            if (data[key]) {
                // Handle multiple values (convert to array)
                if (Array.isArray(data[key])) {
                    data[key].push(value);
                } else {
                    data[key] = [data[key], value];
                }
            } else {
                data[key] = value;
            }
        }
        
        return data;
    }

    /**
     * Debounce function for search inputs
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dhisApp = new DHISApp();
});

// Export for use in other scripts
window.DHISApp = DHISApp;

// Global helpers used by completeness partials
(function(){
    if (!window.Comp) window.Comp = {};

    // Data Elements pagination + selection
    window.Comp.initDataElements = function(all){
        this._allDE = Array.isArray(all) ? all.slice() : [];
        this._filteredDE = null;
        this._dePage = 1;
        this._dePageSize = 30;
        // default: select all
        window.compSelectedElements = new Set(this._allDE.map(d => d.id));
        this.renderDEPage();
        const pager = document.getElementById('comp_de_pager');
        if (pager) pager.style.display = (this._allDE.length > this._dePageSize) ? 'flex' : 'none';
        this.updateDEPageInfo();
    };
    window.Comp.getDEWorkingSet = function(){ return this._filteredDE || this._allDE || []; };
    window.Comp.applyDEFilter = function(){
        const q = (document.getElementById('comp_de_search')?.value || '').toLowerCase();
        this._filteredDE = (q ? (this._allDE||[]).filter(d => (d.displayName||d.id).toLowerCase().includes(q)) : null);
        this._dePage = 1; this.renderDEPage(); this.updateDEPageInfo();
    };
    window.Comp.renderDEPage = function(){
        const listDiv = document.getElementById('comp_de_list'); if (!listDiv) return;
        const items = this.getDEWorkingSet();
        const start = (this._dePage - 1) * this._dePageSize;
        const pageItems = items.slice(start, start + this._dePageSize);
        listDiv.innerHTML = pageItems.map(item => {
            const checked = window.compSelectedElements?.has(item.id) ? 'checked' : '';
            return `<div class="form-check">
                <input class="form-check-input" type="checkbox" id="de_${item.id}" ${checked} onchange="Comp.toggleDE('${item.id}', this.checked)">
                <label class="form-check-label" for="de_${item.id}">${item.displayName || item.id}</label>
            </div>`;
        }).join('') || '<div class="text-muted small">No elements</div>';
    };
    window.Comp.updateDEPageInfo = function(){
        const info = document.getElementById('comp_de_page_info'); if (!info) return;
        const total = this.getDEWorkingSet().length;
        const start = total ? ((this._dePage - 1) * this._dePageSize + 1) : 0;
        const end = Math.min(total, this._dePage * this._dePageSize);
        info.textContent = total ? `Showing ${start}-${end} of ${total}` : 'No items';
    };
    window.Comp.nextDEPage = function(){
        const total = this.getDEWorkingSet().length;
        const maxPage = Math.max(1, Math.ceil(total / this._dePageSize));
        if (this._dePage < maxPage) { this._dePage++; this.renderDEPage(); this.updateDEPageInfo(); }
    };
    window.Comp.prevDEPage = function(){ if (this._dePage > 1) { this._dePage--; this.renderDEPage(); this.updateDEPageInfo(); } };
    window.Comp.toggleDE = function(id, checked){ if (checked) window.compSelectedElements.add(id); else window.compSelectedElements.delete(id); };
    window.Comp.selectAllDEOnPage = function(){
        const items = this.getDEWorkingSet();
        const start = (this._dePage - 1) * this._dePageSize;
        const pageItems = items.slice(start, start + this._dePageSize);
        pageItems.forEach(it => window.compSelectedElements.add(it.id));
        this.renderDEPage();
    };
    window.Comp.clearDEOnPage = function(){
        const items = this.getDEWorkingSet();
        const start = (this._dePage - 1) * this._dePageSize;
        const pageItems = items.slice(start, start + this._dePageSize);
        pageItems.forEach(it => window.compSelectedElements.delete(it.id));
        this.renderDEPage();
    };

    // Org Unit hierarchical tree
    window.Comp.loadOUTreeRoot = async function(){
        const inst = document.getElementById('comp_instance')?.value || 'source';
        const tree = document.getElementById('comp_ou_tree'); if (!tree) return;
        tree.innerHTML = '<div class="text-muted small">Loading…</div>';
        try {
            const r = await fetch(`/api/organisation-units?instance=${encodeURIComponent(inst)}`);
            if (!r.ok) throw new Error(await r.text());
            const roots = await r.json();
            tree.innerHTML = this.renderOUTreeNodes(roots);
        } catch (e) {
            tree.innerHTML = `<div class="text-danger small">${e.message}</div>`;
        }
    };
    window.Comp.renderOUTreeNodes = function(nodes){
        return `<ul class="list-unstyled mb-0">${(nodes||[]).map(n => this.renderOUTreeNode(n)).join('')}</ul>`;
    };
    window.Comp.renderOUTreeNode = function(n){
        const checked = window.compSelectedOrgUnits?.has(n.id) ? 'checked' : '';
        const caret = n.hasChildren ? `<button class="btn btn-sm btn-link p-0 me-1" onclick="Comp.toggleOUTree('${n.id}')" data-ou-caret="${n.id}">▶</button>` : '<span class="me-1"></span>';
        return `<li class="mb-1" data-ou-node="${n.id}">
            ${caret}
            <input class="form-check-input me-1" type="checkbox" id="ou_${n.id}" ${checked} onchange="Comp.toggleOU('${n.id}', this.checked)">
            <label for="ou_${n.id}" class="form-check-label">${n.displayName || n.id}</label>
            <div class="ms-4 mt-1" data-ou-children="${n.id}" style="display:none;"></div>
        </li>`;
    };
    window.Comp.toggleOUTree = async function(id){
        const caretBtn = document.querySelector(`[data-ou-caret='${id}']`);
        const container = document.querySelector(`[data-ou-children='${id}']`);
        if (!container) return;
        if (container.getAttribute('data-loaded') === '1') {
            const visible = container.style.display !== 'none';
            container.style.display = visible ? 'none' : 'block';
            if (caretBtn) caretBtn.textContent = visible ? '▶' : '▼';
            return;
        }
        try {
            const inst = document.getElementById('comp_instance')?.value || 'source';
            const r = await fetch(`/api/organisation-units?parent=${encodeURIComponent(id)}&instance=${encodeURIComponent(inst)}`);
            if (!r.ok) throw new Error(await r.text());
            const children = await r.json();
            container.innerHTML = this.renderOUTreeNodes(children);
            container.setAttribute('data-loaded', '1');
            container.style.display = 'block';
            if (caretBtn) caretBtn.textContent = '▼';
        } catch (e) {
            container.innerHTML = `<div class=\"text-danger small\">${e.message}</div>`;
        }
    };
    window.Comp.toggleOU = function(id, checked){ if (checked) window.compSelectedOrgUnits.add(id); else window.compSelectedOrgUnits.delete(id); if (typeof window.updateRunButtonState==='function') window.updateRunButtonState(); };
    window.Comp.expandAllOrgUnits = function(){ document.querySelectorAll('[data-ou-caret]').forEach(btn => btn.click()); };
    window.Comp.collapseAllOrgUnits = function(){ document.querySelectorAll('[data-ou-children]').forEach(div => { div.style.display = 'none'; }); document.querySelectorAll('[data-ou-caret]').forEach(btn => btn.textContent = '▶'); };
    window.Comp.filterOrgUnits = function(){
        const q = (document.getElementById('comp_ou_search')?.value || '').toLowerCase();
        document.querySelectorAll('[data-ou-node]').forEach(li => {
            const label = li.querySelector('label')?.textContent?.toLowerCase() || '';
            li.style.display = q && !label.includes(q) ? 'none' : '';
        });
    };
})();