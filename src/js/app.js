/**
 * App - Main application coordinator
 * Initializes and coordinates TabManager, ViewManager, and TabBar
 */

import { TabManager } from './tab-manager.js';
import { ViewManager } from './view-manager.js';
import { TabBar } from './tab-bar.js';

class App {
    constructor() {
        this.viewManager = null;
        this.tabBar = null;
        this.tabManager = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing EyeDea app...');

        // Create managers
        this.viewManager = new ViewManager();
        this.tabBar = new TabBar(null); // Will set tabManager reference after creation
        this.tabManager = new TabManager(this.viewManager, this.tabBar);

        // Link tabBar to tabManager
        this.tabBar.tabManager = this.tabManager;

        // Initialize with Home tab
        this.tabManager.init();

        // Activate home view
        await this.viewManager.activateView(this.tabManager.homeTabId);

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();

        console.log('EyeDea app initialized');
    }

    /**
     * Open a board in a new tab
     */
    async openBoardTab(boardId, boardName) {
        return await this.tabManager.openBoardTab(boardId, boardName);
    }

    /**
     * Switch to home tab
     */
    switchToHomeTab() {
        this.tabManager.switchToHomeTab();
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+W: Close current tab
            if (e.ctrlKey && e.key === 'w') {
                e.preventDefault();
                this.tabManager.closeTab(this.tabManager.activeTabId);
            }

            // Ctrl+Tab: Next tab
            if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                this.tabManager.switchToNextTab();
            }

            // Ctrl+Shift+Tab: Previous tab
            if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
                e.preventDefault();
                this.tabManager.switchToPreviousTab();
            }

            // Ctrl+1-9: Switch to tab by index
            if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
                e.preventDefault();
                const index = parseInt(e.key) - 1;
                this.tabManager.switchToTabByIndex(index);
            }
        });
    }

    /**
     * Get tab manager instance
     */
    getTabManager() {
        return this.tabManager;
    }

    /**
     * Get view manager instance
     */
    getViewManager() {
        return this.viewManager;
    }
}

// Create global app instance
let appInstance = null;

/**
 * Initialize the app
 */
export async function initApp() {
    if (!appInstance) {
        appInstance = new App();
        await appInstance.init();

        // Make app instance globally accessible
        window.appInstance = appInstance;
    }
    return appInstance;
}

/**
 * Get the app instance
 */
export function getApp() {
    return appInstance;
}
