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

        // Hide floating window button and help button on home
        const floatingBtn = document.getElementById('open-floating-btn');
        const helpBtn = document.getElementById('floating-help-btn');
        if (floatingBtn) floatingBtn.style.display = 'none';
        if (helpBtn) helpBtn.style.display = 'none';

        // Remove any open tooltip and onboarding effects
        const tooltip = document.querySelector('.onboarding-tooltip');
        if (tooltip) tooltip.remove();
        const overlay = document.querySelector('.onboarding-overlay');
        if (overlay) overlay.remove();
        document.querySelectorAll('.onboarding-spotlight, .onboarding-dimmed').forEach(el => {
            el.classList.remove('onboarding-spotlight', 'onboarding-dimmed');
        });
    }

    /**
     * Open a board
     */
    async openBoard(boardId, boardName) {
        this.currentBoardId = boardId;
        await this.viewManager.showBoard(boardId);
        this.updateBreadcrumb(`All Boards > ${boardName}`);

        // Show floating window button and help button in board view
        const floatingBtn = document.getElementById('open-floating-btn');
        const helpBtn = document.getElementById('floating-help-btn');
        if (floatingBtn) floatingBtn.style.display = 'flex';
        if (helpBtn) helpBtn.style.display = 'flex';

        // Show onboarding tutorial (first time only)
        if (!localStorage.getItem('onboarding_complete')) {
            setTimeout(() => this.startOnboardingTutorial(), 500);
        }
    }

    /**
     * Start the onboarding tutorial that walks through key features
     */
    startOnboardingTutorial() {
        // Define the tutorial steps
        const steps = [
            {
                element: '#open-floating-btn',
                title: 'Floating Window',
                description: 'Open your board in a floating window that stays on top of other apps.',
                position: 'below'
            },
            {
                element: '#drawing-mode-btn',
                title: 'Drawing Tool',
                description: 'Draw freehand on your canvas with a pen, highlighter, and eraser',
                position: 'left'
            },
            {
                element: '#shape-tool-btn',
                title: 'Shape Tool',
                description: 'Add shapes to your canvas. More coming soon...',
                position: 'left'
            },
            {
                element: '#text-tool-btn',
                title: 'Text Tool',
                description: 'Add text labels with custom fonts, sizes, and colors.',
                position: 'left'
            },
            {
                element: '#color-extractor-btn',
                title: 'Color Extractor',
                description: 'Extract color palettes from any image on your canvas.',
                position: 'left'
            }
        ];

        let currentStep = 0;
        let overlay = null;
        let tooltip = null;
        let previousHighlight = null;

        const showStep = (stepIndex) => {
            const step = steps[stepIndex];
            const element = document.querySelector(step.element);

            if (!element || (step.element === '#open-floating-btn' && element.style.display === 'none')) {
                // Skip this step if element not found or hidden
                if (stepIndex < steps.length - 1) {
                    currentStep++;
                    showStep(currentStep);
                } else {
                    cleanup();
                }
                return;
            }

            // Create overlay if it doesn't exist
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'onboarding-overlay';
                document.body.appendChild(overlay);
            }

            // Dim previous highlight
            if (previousHighlight) {
                previousHighlight.classList.remove('onboarding-spotlight');
                previousHighlight.classList.add('onboarding-dimmed');
            }

            // Spotlight current element (brings it above the overlay)
            element.classList.add('onboarding-spotlight');
            previousHighlight = element;

            // Remove existing tooltip
            if (tooltip) tooltip.remove();

            // Create tooltip (hidden initially for positioning)
            tooltip = document.createElement('div');
            tooltip.className = 'onboarding-tooltip';
            tooltip.style.visibility = 'hidden';
            tooltip.innerHTML = `
                <strong>${step.title}</strong>
                <p>${step.description}</p>
                <span class="tooltip-hint">Click anywhere to continue${stepIndex < steps.length - 1 ? ' (' + (stepIndex + 1) + '/' + steps.length + ')' : ''}</span>
            `;
            document.body.appendChild(tooltip);

            // Position tooltip after it's in DOM (so we can measure it)
            const rect = element.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();

            if (step.position === 'below') {
                // Center horizontally below the element
                let leftPos = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                // Keep within screen bounds
                leftPos = Math.max(10, Math.min(window.innerWidth - tooltipRect.width - 10, leftPos));
                tooltip.style.top = (rect.bottom + 12) + 'px';
                tooltip.style.left = leftPos + 'px';
                tooltip.classList.add('tooltip-below');
            } else if (step.position === 'left') {
                // Center vertically to the left of the element
                const topPos = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
                tooltip.style.top = topPos + 'px';
                tooltip.style.left = (rect.left - tooltipRect.width - 12) + 'px';
                tooltip.classList.add('tooltip-left');
            }

            // Now show the tooltip
            tooltip.style.visibility = 'visible';
        };

        const cleanup = () => {
            if (overlay) overlay.remove();
            if (tooltip) tooltip.remove();
            // Remove all spotlights and dims
            document.querySelectorAll('.onboarding-spotlight, .onboarding-dimmed').forEach(el => {
                el.classList.remove('onboarding-spotlight', 'onboarding-dimmed');
            });
            localStorage.setItem('onboarding_complete', 'true');
            document.removeEventListener('click', handleClick);
        };

        const handleClick = () => {
            currentStep++;
            if (currentStep < steps.length) {
                showStep(currentStep);
            } else {
                cleanup();
            }
        };

        // Start the tutorial
        showStep(0);

        // Add click listener after a short delay
        setTimeout(() => {
            document.addEventListener('click', handleClick);
        }, 100);
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

        // Setup help button to restart onboarding tutorial
        const helpBtn = document.getElementById('floating-help-btn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                this.startOnboardingTutorial();
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
