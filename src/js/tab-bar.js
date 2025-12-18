/**
 * TabBar - Manages tab bar UI and interactions
 * Renders tabs, handles clicks, drag & drop
 */

export class TabBar {
    constructor(tabManager) {
        this.tabManager = tabManager;
        this.tabsContainer = document.getElementById('tabs-container');
        this.draggedTabId = null;
        this.tabs = new Map(); // Map<tabId, HTMLElement>

        this.MIN_TAB_WIDTH = 120;
        this.MAX_TAB_WIDTH = 200;
        this.RESERVED_DRAG_SPACE = 100; // Space for drag region on right
        this.LEFT_RESERVED_SPACE = 0; // Tabs start immediately after home button

        // Listen for window resize to update tab widths
        window.addEventListener('resize', () => this.updateTabWidths());
    }

    /**
     * Render a tab in the tab bar
     */
    renderTab(tab) {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.tabId = tab.id;
        tabEl.draggable = true;

        // Tab title
        const titleEl = document.createElement('span');
        titleEl.className = 'tab-title';
        titleEl.textContent = tab.title;
        tabEl.appendChild(titleEl);

        // Close button (only for closeable tabs)
        if (tab.closeable) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.setAttribute('aria-label', 'Close tab');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.tabManager.closeTab(tab.id);
            });
            tabEl.appendChild(closeBtn);
        } else {
            tabEl.classList.add('non-closeable');
        }

        // Tab click to switch
        tabEl.addEventListener('click', () => {
            this.tabManager.switchToTab(tab.id);
        });

        // Drag & drop events
        this.setupDragAndDrop(tabEl, tab);

        // Add to container
        this.tabsContainer.appendChild(tabEl);
        this.tabs.set(tab.id, tabEl);

        // Update tab widths
        this.updateTabWidths();
    }

    /**
     * Setup drag and drop for reordering tabs
     */
    setupDragAndDrop(tabEl, tab) {
        // Drag start
        tabEl.addEventListener('dragstart', (e) => {
            this.draggedTabId = tab.id;
            tabEl.classList.add('tab-drag-ghost');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.id.toString());
        });

        // Drag over (for drop target)
        tabEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (this.draggedTabId !== null && this.draggedTabId !== tab.id) {
                // Show visual feedback
                const rect = tabEl.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;
                const insertBefore = e.clientX < midpoint;

                // Add drop indicator class
                tabEl.classList.toggle('drop-before', insertBefore);
                tabEl.classList.toggle('drop-after', !insertBefore);
            }
        });

        // Drag leave
        tabEl.addEventListener('dragleave', () => {
            tabEl.classList.remove('drop-before', 'drop-after');
        });

        // Drop
        tabEl.addEventListener('drop', (e) => {
            e.preventDefault();
            tabEl.classList.remove('drop-before', 'drop-after');

            if (this.draggedTabId !== null && this.draggedTabId !== tab.id) {
                this.tabManager.reorderTabs(this.draggedTabId, tab.id);
            }
        });

        // Drag end
        tabEl.addEventListener('dragend', () => {
            tabEl.classList.remove('tab-drag-ghost', 'drop-before', 'drop-after');
            this.draggedTabId = null;
        });
    }

    /**
     * Remove a tab from the UI
     */
    removeTab(tabId) {
        const tabEl = this.tabs.get(tabId);
        if (tabEl) {
            tabEl.remove();
            this.tabs.delete(tabId);
            this.updateTabWidths();
        }
    }

    /**
     * Set tab as active or inactive
     */
    setTabActive(tabId, active) {
        const tabEl = this.tabs.get(tabId);
        if (tabEl) {
            tabEl.classList.toggle('active', active);
        }
    }

    /**
     * Update tab title
     */
    updateTabTitle(tabId, newTitle) {
        const tabEl = this.tabs.get(tabId);
        if (tabEl) {
            const titleEl = tabEl.querySelector('.tab-title');
            if (titleEl) {
                titleEl.textContent = newTitle;
            }
        }
    }

    /**
     * Reorder tabs after drag & drop
     */
    reorderTabs(tabs) {
        // Clear container
        this.tabsContainer.innerHTML = '';

        // Re-render tabs in new order
        tabs.forEach(tab => {
            const tabEl = this.tabs.get(tab.id);
            if (tabEl) {
                this.tabsContainer.appendChild(tabEl);
            }
        });
    }

    /**
     * Update tab widths dynamically (Chrome-style scaling)
     */
    updateTabWidths() {
        const numTabs = this.tabs.size;
        if (numTabs === 0) return;

        // Get the full width available for tabs (entire titlebar-tabs container)
        const containerWidth = this.tabsContainer.parentElement?.clientWidth || 0;

        // Available width = container width - drag region on right
        const availableWidth = Math.max(0, containerWidth - this.RESERVED_DRAG_SPACE);

        // Calculate ideal width per tab
        const idealWidth = availableWidth / numTabs;

        // Clamp between min and max
        const tabWidth = Math.max(
            this.MIN_TAB_WIDTH,
            Math.min(this.MAX_TAB_WIDTH, idealWidth)
        );

        // Apply width to all tabs
        this.tabs.forEach(tabEl => {
            tabEl.style.width = `${tabWidth}px`;
        });
    }

    /**
     * Get tab element by ID
     */
    getTabElement(tabId) {
        return this.tabs.get(tabId);
    }
}
