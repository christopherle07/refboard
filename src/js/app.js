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
        this._currentBoardName = null;
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
        this._currentBoardName = boardName;
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
        if (this._currentBoardName) return this._currentBoardName;
        const breadcrumb = document.getElementById('nav-breadcrumb');
        if (breadcrumb) {
            const text = breadcrumb.textContent;
            const parts = text.split('/').map(p => p.trim());
            return parts.length > 1 ? parts[1] : 'Board';
        }
        return 'Board';
    }

    /**
     * Update breadcrumb navigation with clickable segments
     * Segments are separated by >, e.g. "All Boards > MyBoard > Assets"
     */
    updateBreadcrumb(text) {
        const breadcrumb = document.getElementById('nav-breadcrumb');
        const backBtn = document.getElementById('nav-back-btn');
        if (!breadcrumb) return;

        // Preserve the floating button before clearing
        const floatingBtn = breadcrumb.querySelector('.breadcrumb-floating-btn');

        const segments = text.split('>').map(s => s.trim()).filter(Boolean);
        breadcrumb.innerHTML = '';

        segments.forEach((seg, i) => {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = '/';
                breadcrumb.appendChild(sep);
            }

            const span = document.createElement('span');
            const isLast = i === segments.length - 1;

            // First segment (Home) gets an icon
            if (i === 0) {
                const icon = document.createElement('img');
                icon.src = '/assets/home(1).png';
                icon.alt = 'Home';
                icon.className = 'breadcrumb-home-icon';
                span.appendChild(icon);
                const label = document.createTextNode('Home');
                span.appendChild(label);
            } else {
                span.textContent = seg;
            }

            if (isLast) {
                span.className = 'breadcrumb-item active';
            } else {
                span.className = 'breadcrumb-item clickable';
                span.addEventListener('click', () => this.handleBreadcrumbClick(i));
            }
            breadcrumb.appendChild(span);
        });

        // Re-append the floating button
        if (floatingBtn) {
            breadcrumb.appendChild(floatingBtn);
        }

        // Show back button when not on home
        if (backBtn) {
            backBtn.style.display = segments.length > 1 ? 'flex' : 'none';
        }
    }

    /**
     * Handle clicking a breadcrumb segment by index
     */
    handleBreadcrumbClick(segIndex) {
        if (segIndex === 0) {
            // "All Boards" — go home
            this.showHome();
        } else if (segIndex === 1) {
            // Board name — go back to board canvas (from assets view)
            if (window.showCanvasView) {
                window.showCanvasView();
            }
        }
    }

    /**
     * Handle back button — navigates one level up
     */
    handleBackNavigation() {
        const breadcrumb = document.getElementById('nav-breadcrumb');
        if (!breadcrumb) return;

        const segments = breadcrumb.querySelectorAll('.breadcrumb-item');
        if (segments.length <= 1) return;

        // Go to the second-to-last segment
        const targetIndex = segments.length - 2;
        this.handleBreadcrumbClick(targetIndex);
    }

    /**
     * Setup breadcrumb and back button navigation
     */
    setupBreadcrumbNavigation() {
        const backBtn = document.getElementById('nav-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.handleBackNavigation());
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

        // Force save current state so floating window gets latest data
        if (window.editorForceSave) {
            await window.editorForceSave();
        } else if (window.editorSaveNow) {
            await window.editorSaveNow();
        }

        if (!window.__TAURI__) {
            window.open('floating.html?id=' + this.currentBoardId, '_blank', 'width=800,height=600');
            return;
        }

        try {
            const { WebviewWindow } = window.__TAURI__.webviewWindow;
            const windowLabel = 'floating_' + this.currentBoardId + '_' + Date.now();
            // Construct URL using the same origin as current window
            const url = new URL(window.location.href);
            url.pathname = '/floating.html';
            url.search = `?id=${this.currentBoardId}`;
            const floatingUrl = url.toString();
            console.log('Opening floating window with URL:', floatingUrl);

            const floatingWindow = new WebviewWindow(windowLabel, {
                url: floatingUrl,
                title: boardManager.currentBoard?.name || 'Board',
                width: 800,
                height: 600,
                alwaysOnTop: false,
                decorations: false,
                titleBarStyle: 'overlay',
                resizable: true,
                center: true,
                transparent: false,
                dragDropEnabled: false
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
