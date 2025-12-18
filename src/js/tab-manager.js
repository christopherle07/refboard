/**
 * TabManager - Manages tab lifecycle and coordination
 * Handles opening, closing, switching, and reordering tabs
 */

export class TabManager {
    constructor(viewManager, tabBar) {
        this.viewManager = viewManager;
        this.tabBar = tabBar;
        this.tabs = [];
        this.activeTabId = null;
        this.nextTabId = 0;
        this.homeTabId = null;
    }

    /**
     * Initialize without creating a Home tab
     */
    init() {
        // Home view is always available, no need for a tab
        this.homeTabId = 'home'; // Special ID for home view

        // Create home view
        this.viewManager.createView(this.homeTabId, 'home', null);

        // Set home as initially active
        this.activeTabId = this.homeTabId;

        // Setup home button click handler
        this.setupHomeButton();
    }

    /**
     * Setup home button in titlebar
     */
    setupHomeButton() {
        const homeBtn = document.getElementById('home-btn');
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                this.switchToHomeTab();
            });
        }
    }

    /**
     * Open a board in a tab
     * If tab already exists for this board, switch to it
     * Otherwise create new tab
     */
    async openBoardTab(boardId, boardName) {
        console.log('[TabManager.openBoardTab] Called with:', { boardId, boardName });

        // Check if tab already exists for this board
        const existingTab = this.getTabByBoardId(boardId);
        if (existingTab) {
            console.log('[TabManager.openBoardTab] Tab already exists, switching to it:', existingTab.id);
            this.switchToTab(existingTab.id);
            return existingTab;
        }

        // Create new tab
        const tab = {
            id: this.nextTabId++,
            type: 'board',
            boardId: boardId,
            title: boardName,
            closeable: true
        };

        console.log('[TabManager.openBoardTab] Created new tab:', tab);

        this.tabs.push(tab);

        // Create view for this tab
        console.log('[TabManager.openBoardTab] Creating view...');
        await this.viewManager.createView(tab.id, 'board', boardId);

        // Render tab in UI
        console.log('[TabManager.openBoardTab] Rendering tab in UI...');
        this.tabBar.renderTab(tab);

        // Switch to new tab
        console.log('[TabManager.openBoardTab] Switching to new tab...');
        this.switchToTab(tab.id);

        console.log('[TabManager.openBoardTab] Complete!');
        return tab;
    }

    /**
     * Close a tab
     */
    closeTab(tabId) {
        const tab = this.getTab(tabId);
        if (!tab) {
            return;
        }

        // Find adjacent tab to switch to
        const tabIndex = this.tabs.findIndex(t => t.id === tabId);
        const nextTab = this.tabs[tabIndex + 1] || this.tabs[tabIndex - 1];

        // Cleanup view
        this.viewManager.destroyView(tabId);

        // Remove tab from list
        this.tabs = this.tabs.filter(t => t.id !== tabId);

        // Remove from UI
        this.tabBar.removeTab(tabId);

        // Switch to next tab or home if this was active
        if (this.activeTabId === tabId) {
            if (nextTab) {
                this.switchToTab(nextTab.id);
            } else {
                // No more tabs, switch to home
                this.switchToHomeTab();
            }
        }
    }

    /**
     * Switch to a different tab
     */
    switchToTab(tabId) {
        if (this.activeTabId === tabId) {
            return; // Already active
        }

        // Deactivate current tab/view
        if (this.activeTabId !== null) {
            this.viewManager.deactivateView(this.activeTabId);

            // Deactivate UI for current tab
            if (this.activeTabId === this.homeTabId) {
                this.setHomeButtonActive(false);
            } else {
                this.tabBar.setTabActive(this.activeTabId, false);
            }
        }

        // Activate new tab/view
        this.activeTabId = tabId;
        this.viewManager.activateView(tabId);

        // Activate UI for new tab
        if (tabId === this.homeTabId) {
            this.setHomeButtonActive(true);
        } else {
            this.tabBar.setTabActive(tabId, true);
            const tab = this.getTab(tabId);
            if (tab) {
                this.updateTitlebarTitle(tab);
            }
        }
    }

    /**
     * Switch to Home view
     */
    switchToHomeTab() {
        this.switchToTab(this.homeTabId);
    }

    /**
     * Set home button active state
     */
    setHomeButtonActive(active) {
        const homeBtn = document.getElementById('home-btn');
        if (homeBtn) {
            if (active) {
                homeBtn.classList.add('active');
            } else {
                homeBtn.classList.remove('active');
            }
        }
    }

    /**
     * Switch to next tab (for Ctrl+Tab)
     */
    switchToNextTab() {
        if (this.tabs.length <= 1) return;

        const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
        const nextIndex = (currentIndex + 1) % this.tabs.length;
        this.switchToTab(this.tabs[nextIndex].id);
    }

    /**
     * Switch to previous tab (for Ctrl+Shift+Tab)
     */
    switchToPreviousTab() {
        if (this.tabs.length <= 1) return;

        const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
        const prevIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
        this.switchToTab(this.tabs[prevIndex].id);
    }

    /**
     * Switch to tab by index (for Ctrl+1-9)
     */
    switchToTabByIndex(index) {
        if (index >= 0 && index < this.tabs.length) {
            this.switchToTab(this.tabs[index].id);
        }
    }

    /**
     * Reorder tabs (from drag & drop)
     */
    reorderTabs(draggedTabId, targetTabId) {
        const draggedIndex = this.tabs.findIndex(t => t.id === draggedTabId);
        const targetIndex = this.tabs.findIndex(t => t.id === targetTabId);

        if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
            return;
        }

        // Remove dragged tab
        const [draggedTab] = this.tabs.splice(draggedIndex, 1);

        // Insert at target position
        const newTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
        this.tabs.splice(newTargetIndex, 0, draggedTab);

        // Re-render tab bar
        this.tabBar.reorderTabs(this.tabs);
    }

    /**
     * Update tab title (e.g., when board is renamed)
     */
    updateTabTitle(tabId, newTitle) {
        const tab = this.getTab(tabId);
        if (tab) {
            tab.title = newTitle;
            this.tabBar.updateTabTitle(tabId, newTitle);

            // Update titlebar if this is active tab
            if (this.activeTabId === tabId) {
                this.updateTitlebarTitle(tab);
            }
        }
    }

    /**
     * Get tab by ID
     */
    getTab(tabId) {
        return this.tabs.find(t => t.id === tabId);
    }

    /**
     * Get tab by board ID
     */
    getTabByBoardId(boardId) {
        return this.tabs.find(t => t.type === 'board' && t.boardId === boardId);
    }

    /**
     * Get all tabs
     */
    getAllTabs() {
        return [...this.tabs];
    }

    /**
     * Update titlebar title based on active tab
     */
    updateTitlebarTitle(tab) {
        const titleElement = document.querySelector('.titlebar-title');
        if (titleElement) {
            if (tab.type === 'home') {
                titleElement.textContent = 'EyeDea';
            } else {
                titleElement.textContent = `EyeDea - ${tab.title}`;
            }
        }
    }
}
