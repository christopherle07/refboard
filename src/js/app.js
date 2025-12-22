/**
 * App - Main application coordinator
 * Simplified without tabs - just switches between home and board views
 */

import { ViewManager } from './view-manager.js';

class App {
    constructor() {
        this.viewManager = null;
        this.currentBoardId = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing EyeDea app...');

        // Create view manager
        this.viewManager = new ViewManager();

        // Show home view by default
        await this.showHome();

        // Setup breadcrumb navigation
        this.setupBreadcrumbNavigation();

        // Setup refresh button
        this.setupRefreshButton();

        console.log('EyeDea app initialized');
    }

    /**
     * Show home view
     */
    async showHome() {
        this.currentBoardId = null;
        await this.viewManager.showHome();
        this.updateBreadcrumb('All Boards');
        this.hideRefreshButton();
    }

    /**
     * Open a board
     */
    async openBoard(boardId, boardName) {
        this.currentBoardId = boardId;
        await this.viewManager.showBoard(boardId);
        this.updateBreadcrumb(`All Boards > ${boardName}`);
        this.showRefreshButton();
    }

    /**
     * Refresh current board
     */
    async refreshBoard() {
        if (this.currentBoardId) {
            await this.viewManager.showBoard(this.currentBoardId);
            console.log('Board refreshed');
        }
    }

    /**
     * Get current board name from breadcrumb
     */
    getBoardName() {
        const breadcrumb = document.getElementById('nav-breadcrumb');
        if (breadcrumb) {
            const text = breadcrumb.textContent;
            const parts = text.split('/').map(p => p.trim());
            return parts.length > 1 ? parts[1] : 'Board';
        }
        return 'Board';
    }

    /**
     * Update breadcrumb navigation
     */
    updateBreadcrumb(text) {
        const breadcrumb = document.getElementById('nav-breadcrumb');
        if (breadcrumb) {
            // Replace > with /
            const formattedText = text.replace(/>/g, '/');
            breadcrumb.innerHTML = `<span class="breadcrumb-item active">${formattedText}</span>`;
        }
    }

    /**
     * Setup breadcrumb click to go home
     */
    setupBreadcrumbNavigation() {
        const breadcrumb = document.getElementById('nav-breadcrumb');
        if (breadcrumb) {
            breadcrumb.addEventListener('click', () => {
                if (this.currentBoardId) {
                    this.showHome();
                }
            });
        }
    }

    /**
     * Setup refresh button
     */
    setupRefreshButton() {
        const refreshBtn = document.getElementById('refresh-board-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshBoard();
            });
        }
    }

    /**
     * Show refresh button (when in board view)
     */
    showRefreshButton() {
        const refreshBtn = document.getElementById('refresh-board-btn');
        if (refreshBtn) {
            refreshBtn.style.display = 'flex';
        }
    }

    /**
     * Hide refresh button (when in home view)
     */
    hideRefreshButton() {
        const refreshBtn = document.getElementById('refresh-board-btn');
        if (refreshBtn) {
            refreshBtn.style.display = 'none';
        }
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
