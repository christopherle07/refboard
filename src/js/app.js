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

        console.log('EyeDea app initialized');
    }

    /**
     * Show home view
     */
    async showHome() {
        this.currentBoardId = null;
        await this.viewManager.showHome();
        this.updateBreadcrumb('All Boards');

        // Hide floating window button on home
        const floatingBtn = document.getElementById('open-floating-btn');
        if (floatingBtn) floatingBtn.style.display = 'none';
    }

    /**
     * Open a board
     */
    async openBoard(boardId, boardName) {
        this.currentBoardId = boardId;
        await this.viewManager.showBoard(boardId);
        this.updateBreadcrumb(`All Boards > ${boardName}`);

        // Show floating window button in board view
        const floatingBtn = document.getElementById('open-floating-btn');
        if (floatingBtn) floatingBtn.style.display = 'flex';
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
            breadcrumb.addEventListener('click', async () => {
                if (this.currentBoardId) {
                    console.log('[Breadcrumb] Navigating to home...');
                    await this.showHome();
                    console.log('[Breadcrumb] Navigation complete');
                }
            });
        }

        // Setup floating window button
        const floatingBtn = document.getElementById('open-floating-btn');
        if (floatingBtn) {
            floatingBtn.addEventListener('click', () => {
                this.openFloatingWindow();
            });
        }
    }

    /**
     * Open floating window for current board
     */
    async openFloatingWindow() {
        if (!this.currentBoardId) return;

        // Import board manager and editor module to access current board and save function
        const { boardManager } = await import('./board-manager.js');

        // Trigger save via global save function if available
        if (window.editorSaveNow) {
            await window.editorSaveNow();
        }

        if (!window.__TAURI__) {
            window.open('floating.html?id=' + this.currentBoardId, '_blank', 'width=800,height=600');
            return;
        }

        try {
            const { WebviewWindow } = window.__TAURI__.webviewWindow;
            const windowLabel = 'floating_' + this.currentBoardId + '_' + Date.now();
            const currentUrl = window.location.href.split('?')[0];
            const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/'));
            const floatingUrl = `${baseUrl}/floating.html?id=${this.currentBoardId}`;

            const floatingWindow = new WebviewWindow(windowLabel, {
                url: floatingUrl,
                title: boardManager.currentBoard?.name || 'Board',
                width: 800,
                height: 600,
                alwaysOnTop: false,
            });

            floatingWindow.once('tauri://created', () => {
                console.log('Floating window created');
            });

            floatingWindow.once('tauri://error', (e) => {
                console.error('Error creating floating window:', e);
            });
        } catch (err) {
            console.error('Error opening floating window:', err);
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
