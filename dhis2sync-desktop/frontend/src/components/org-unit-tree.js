/**
 * Org Unit Tree Picker Component
 *
 * A reusable hierarchical organization unit picker with:
 * - Lazy loading (fetch children on expand)
 * - Multi-select with checkboxes
 * - Search/filter by name
 * - Expand/collapse controls
 * - Alphabetical sorting
 */

// Import Wails Go bindings
import * as App from '../../wailsjs/go/main/App';

export class OrgUnitTreePicker {
    constructor(containerId, profileId, instance) {
        this.containerId = containerId;
        this.profileId = profileId;
        this.instance = instance; // 'source' or 'dest'
        this.container = null;
        this.searchInput = null;
        this.treeContainer = null;

        // State
        this.selectedIds = new Set();
        this.expandedIds = new Set();
        this.orgUnitsCache = new Map(); // Cache fetched org units by ID
        this.childrenCache = new Map();  // Cache children by parent ID
        this.searchTerm = '';
    }

    /**
     * Initialize the picker UI and load root org units
     */
    async initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            throw new Error(`Container element '${this.containerId}' not found`);
        }

        // Build UI structure
        this.container.innerHTML = `
            <div class="org-unit-picker">
                <div class="input-group input-group-sm mb-2">
                    <span class="input-group-text"><i class="bi bi-search"></i></span>
                    <input type="text" class="form-control" id="${this.containerId}-search"
                           placeholder="Filter org units..." />
                    <button class="btn btn-outline-secondary" type="button" id="${this.containerId}-expand-all">
                        <i class="bi bi-arrows-expand"></i> Expand All
                    </button>
                    <button class="btn btn-outline-secondary" type="button" id="${this.containerId}-collapse-all">
                        <i class="bi bi-arrows-collapse"></i> Collapse All
                    </button>
                    <button class="btn btn-outline-secondary" type="button" id="${this.containerId}-clear">
                        <i class="bi bi-x-circle"></i> Clear
                    </button>
                </div>
                <div id="${this.containerId}-tree" class="org-unit-tree border rounded p-2"
                     style="max-height: 300px; overflow-y: auto;">
                    <div class="text-muted small">Loading...</div>
                </div>
                <div class="small text-muted mt-2">
                    <span id="${this.containerId}-count">0</span> org unit(s) selected
                </div>
            </div>
        `;

        // Get element references
        this.searchInput = document.getElementById(`${this.containerId}-search`);
        this.treeContainer = document.getElementById(`${this.containerId}-tree`);

        // Attach event listeners
        this.searchInput.addEventListener('input', () => this.handleSearch());
        document.getElementById(`${this.containerId}-expand-all`).addEventListener('click', () => this.expandAll());
        document.getElementById(`${this.containerId}-collapse-all`).addEventListener('click', () => this.collapseAll());
        document.getElementById(`${this.containerId}-clear`).addEventListener('click', () => this.clearSelection());

        // Load the entire hierarchy in one batch operation
        // This replaces the old loadRoots() + preloadAll() pattern
        await this.preloadAll();
    }

    /**
     * Load root org units (level 1)
     */
    /**
     * Load root org units (level 1)
     */
    async loadRoots() {
        try {
            const roots = await App.ListOrganisationUnits(this.profileId, this.instance, 1);

            if (!roots || roots.length === 0) {
                this.treeContainer.innerHTML = '<div class="text-muted small">No organization units found</div>';
                return false;
            }

            // Cache org units
            roots.forEach(ou => this.orgUnitsCache.set(ou.id, ou));

            // Render tree
            this.renderTree(roots);

            // Attach event listeners to rendered nodes (FIX: was missing)
            this.attachTreeEventListeners();

            return true;

        } catch (error) {
            console.error('Failed to load org units:', error);
            this.treeContainer.innerHTML = `<div class="text-danger small">Error: ${error}</div>`;
            return false;
        }
    }

    /**
     * Load all children for the entire hierarchy using BATCH level fetch.
     * This method uses GetOrgUnitsByLevelBatch which fetches all levels in parallel
     * (typically 5 API calls instead of 100+), dramatically improving performance.
     * Falls back to the old loadRoots() method if the batch fails.
     */
    async preloadAll() {
        // Show loading state
        this.treeContainer.innerHTML = '<div class="text-center py-2 text-muted small"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Loading hierarchy...</div>';

        try {
            console.log('[OrgUnitTree] Fetching org units by level (batch)...');

            // Fetch all levels in ONE batch call (new optimized endpoint)
            const orgUnitsByLevel = await App.GetOrgUnitsByLevelBatch(
                this.profileId,
                this.instance,
                10 // max levels to fetch
            );

            if (!orgUnitsByLevel || Object.keys(orgUnitsByLevel).length === 0) {
                console.warn('[OrgUnitTree] No org units returned from batch fetch, falling back to loadRoots');
                await this.loadRoots();
                return;
            }

            // Build parent-child relationships from flat level data
            const childrenByParent = new Map();

            // Process all levels and cache units
            for (const [levelStr, units] of Object.entries(orgUnitsByLevel)) {
                for (const ou of units) {
                    // Cache the org unit
                    this.orgUnitsCache.set(ou.id, ou);

                    // Track parent-child relationships
                    if (ou.parent?.id) {
                        if (!childrenByParent.has(ou.parent.id)) {
                            childrenByParent.set(ou.parent.id, []);
                        }
                        childrenByParent.get(ou.parent.id).push(ou);
                    }
                }
            }

            // Cache children for instant toggle (no more API calls needed!)
            for (const [parentId, children] of childrenByParent) {
                // Sort children alphabetically
                children.sort((a, b) => (a.displayName || a.name || '').localeCompare(b.displayName || b.name || ''));
                this.childrenCache.set(parentId, children);
            }

            console.log(`[OrgUnitTree] Pre-loaded ${this.orgUnitsCache.size} org units across ${Object.keys(orgUnitsByLevel).length} levels`);

            // Render tree with roots
            const roots = Array.from(this.orgUnitsCache.values()).filter(ou => ou.level === 1);
            roots.sort((a, b) => (a.displayName || a.name || '').localeCompare(b.displayName || b.name || ''));

            if (roots.length === 0) {
                this.treeContainer.innerHTML = '<div class="text-muted small">No organization units found</div>';
                return;
            }

            this.renderTree(roots);
            this.attachTreeEventListeners();

        } catch (error) {
            console.error('Failed to preload hierarchy:', error);
            // Fall back to old method
            console.log('[OrgUnitTree] Falling back to loadRoots...');
            await this.loadRoots();
        }
    }

    /**
     * Load children for a specific parent org unit
     */
    async loadChildren(parentId) {
        // Check cache first
        if (this.childrenCache.has(parentId)) {
            return this.childrenCache.get(parentId);
        }

        try {
            const children = await App.GetOrgUnitChildren(this.profileId, this.instance, parentId);

            // Cache children
            this.childrenCache.set(parentId, children);
            children.forEach(ou => this.orgUnitsCache.set(ou.id, ou));

            return children;

        } catch (error) {
            console.error(`Failed to load children for ${parentId}:`, error);
            return [];
        }
    }

    /**
     * Render the org unit tree
     */
    renderTree(orgUnits, parentElement = null) {
        const container = parentElement || this.treeContainer;

        if (!orgUnits || orgUnits.length === 0) {
            if (!parentElement) {
                container.innerHTML = '<div class="text-muted small">No organization units match your search</div>';
            }
            return;
        }

        // Filter by search term if set
        let filteredUnits = orgUnits;
        if (this.searchTerm) {
            filteredUnits = orgUnits.filter(ou =>
                (ou.displayName || ou.name || '').toLowerCase().includes(this.searchTerm.toLowerCase())
            );
        }

        // Build tree HTML
        const html = filteredUnits.map(ou => this.renderNode(ou, 0)).join('');

        if (parentElement) {
            parentElement.innerHTML = html;
        } else {
            container.innerHTML = html || '<div class="text-muted small">No matches found</div>';
        }
    }

    /**
     * Render a single org unit node
     */
    renderNode(orgUnit, level) {
        const isExpanded = this.expandedIds.has(orgUnit.id);
        const isSelected = this.selectedIds.has(orgUnit.id);
        const indent = level * 20;

        return `
            <div class="org-unit-node" data-ou-id="${orgUnit.id}" style="margin-left: ${indent}px;">
                <div class="d-flex align-items-center py-1">
                    <button class="btn btn-link btn-sm p-0 me-1 expand-toggle"
                            data-ou-id="${orgUnit.id}"
                            style="width: 20px; text-decoration: none;">
                        <i class="bi bi-${isExpanded ? 'dash-square' : 'plus-square'}"></i>
                    </button>
                    <div class="form-check">
                        <input class="form-check-input ou-checkbox" type="checkbox"
                               id="ou-${orgUnit.id}"
                               data-ou-id="${orgUnit.id}"
                               ${isSelected ? 'checked' : ''} />
                        <label class="form-check-label" for="ou-${orgUnit.id}" style="cursor: pointer;">
                            ${this.escapeHtml(orgUnit.displayName || orgUnit.name)}
                            <span class="text-muted small">(${orgUnit.code || 'no code'})</span>
                        </label>
                    </div>
                </div>
                <div class="org-unit-children" id="children-${orgUnit.id}"
                     style="display: ${isExpanded ? 'block' : 'none'};">
                    ${isExpanded ? '<div class="text-muted small ms-4">Loading...</div>' : ''}
                </div>
            </div>
        `;
    }

    /**
     * Handle expand/collapse toggle
     */
    async handleToggle(orgUnitId) {
        const isExpanded = this.expandedIds.has(orgUnitId);

        if (isExpanded) {
            // Collapse
            this.expandedIds.delete(orgUnitId);
            const childrenContainer = document.getElementById(`children-${orgUnitId}`);
            if (childrenContainer) {
                childrenContainer.style.display = 'none';
                childrenContainer.innerHTML = '';
            }

            // Update icon
            const toggleBtn = document.querySelector(`button.expand-toggle[data-ou-id="${orgUnitId}"]`);
            if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="bi bi-plus-square"></i>';
            }
        } else {
            // Expand
            this.expandedIds.add(orgUnitId);

            // Load children
            const children = await this.loadChildren(orgUnitId);

            // Render children
            const childrenContainer = document.getElementById(`children-${orgUnitId}`);
            if (childrenContainer) {
                childrenContainer.style.display = 'block';
                if (children && children.length > 0) {
                    childrenContainer.innerHTML = children.map(child => this.renderNode(child, 1)).join('');
                    this.attachNodeEventListeners(childrenContainer);
                } else {
                    childrenContainer.innerHTML = '<div class="text-muted small ms-4">No children</div>';
                }
            }

            // Update icon
            const toggleBtn = document.querySelector(`button.expand-toggle[data-ou-id="${orgUnitId}"]`);
            if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="bi bi-dash-square"></i>';
            }
        }
    }

    /**
     * Handle checkbox selection
     */
    handleSelection(orgUnitId) {
        if (this.selectedIds.has(orgUnitId)) {
            this.selectedIds.delete(orgUnitId);
        } else {
            this.selectedIds.add(orgUnitId);
        }

        this.updateSelectionCount();
    }

    /**
     * Handle search/filter
     */
    handleSearch() {
        this.searchTerm = this.searchInput.value.trim();

        // Re-render tree with filter
        const roots = Array.from(this.orgUnitsCache.values()).filter(ou => ou.level === 1);
        this.renderTree(roots);

        // Re-attach event listeners
        this.attachTreeEventListeners();
    }

    /**
     * Expand all nodes (only first level for performance)
     */
    async expandAll() {
        const roots = Array.from(this.orgUnitsCache.values()).filter(ou => ou.level === 1);

        for (const root of roots) {
            if (!this.expandedIds.has(root.id)) {
                await this.handleToggle(root.id);
            }
        }
    }

    /**
     * Collapse all nodes
     */
    collapseAll() {
        this.expandedIds.clear();

        // Re-render tree
        const roots = Array.from(this.orgUnitsCache.values()).filter(ou => ou.level === 1);
        this.renderTree(roots);

        // Re-attach event listeners
        this.attachTreeEventListeners();
    }

    /**
     * Clear all selections
     */
    clearSelection() {
        this.selectedIds.clear();

        // Uncheck all checkboxes
        this.treeContainer.querySelectorAll('.ou-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });

        this.updateSelectionCount();
    }

    /**
     * Get selected org unit IDs
     */
    getSelectedIds() {
        return Array.from(this.selectedIds);
    }

    /**
     * Update selection count display
     */
    updateSelectionCount() {
        const countElement = document.getElementById(`${this.containerId}-count`);
        if (countElement) {
            countElement.textContent = this.selectedIds.size;
        }
    }

    /**
     * Attach event listeners to tree nodes
     */
    attachTreeEventListeners() {
        this.attachNodeEventListeners(this.treeContainer);
    }

    /**
     * Attach event listeners to a specific container's nodes
     */
    attachNodeEventListeners(container) {
        // Toggle buttons
        container.querySelectorAll('.expand-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const ouId = btn.getAttribute('data-ou-id');
                this.handleToggle(ouId);
            });
        });

        // Checkboxes
        container.querySelectorAll('.ou-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const ouId = checkbox.getAttribute('data-ou-id');
                this.handleSelection(ouId);
            });
        });
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
