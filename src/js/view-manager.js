/**
 * ViewManager - Manages view rendering and state
 * Handles switching between Home and Board views
 */

import { initHomepage, saveHomeState, restoreHomeState } from './main.js';
import { initEditor, saveBoardState, restoreBoardState, cleanupEditor, setActiveEditorInstance } from './editor.js';

export class ViewManager {
    constructor() {
        this.views = new Map(); // Map<tabId, ViewState>
        this.activeViewId = null;

        // Get home container
        this.homeContainer = document.querySelector('.home-view');

        // Single shared board container (reused for all board tabs)
        this.sharedBoardContainer = document.querySelector('.board-view');

        // Save the original HTML template of the board container for resetting
        if (this.sharedBoardContainer) {
            this.boardContainerTemplate = this.sharedBoardContainer.cloneNode(true);
            console.log('Board container template saved for resetting');
        }

        console.log('ViewManager initialized:', {
            homeContainer: this.homeContainer ? 'found' : 'NOT FOUND',
            sharedBoardContainer: this.sharedBoardContainer ? 'found' : 'NOT FOUND'
        });
    }

    /**
     * Reset the board container to its original state
     */
    resetBoardContainer() {
        if (!this.sharedBoardContainer || !this.boardContainerTemplate) return;

        console.log('Resetting board container to template state...');
        // Replace the container's innerHTML with the template's innerHTML
        this.sharedBoardContainer.innerHTML = this.boardContainerTemplate.innerHTML;
    }

    /**
     * Create a new view for a tab
     */
    async createView(tabId, type, boardId) {
        const view = {
            tabId,
            type,
            boardId,
            initialized: false,
            state: null,
            // All board tabs share the same container - no cloning!
            container: type === 'board' ? this.sharedBoardContainer : null
        };

        this.views.set(tabId, view);

        console.log(`Created view for tab ${tabId}, type: ${type}, boardId: ${boardId}`);

        // Don't initialize yet - will happen on first activation
        return view;
    }

    /**
     * Activate a view (show it)
     */
    async activateView(tabId) {
        const view = this.views.get(tabId);
        if (!view) {
            console.error(`View not found for tab ${tabId}`);
            return;
        }

        console.log('Activating view:', { tabId, type: view.type, initialized: view.initialized, boardId: view.boardId });

        // Save state of currently active board view before switching
        if (this.activeViewId !== null && this.activeViewId !== tabId) {
            const activeView = this.views.get(this.activeViewId);
            if (activeView && activeView.type === 'board' && activeView.initialized) {
                console.log('Saving state of active board before switching...');
                try {
                    activeView.state = saveBoardState();
                    console.log('State saved successfully');
                } catch (err) {
                    console.error('Error saving board state:', err);
                }
                // Don't cleanup yet - wait until we successfully switch
            } else if (activeView && activeView.type === 'home') {
                // Save home state
                try {
                    activeView.state = saveHomeState();
                } catch (err) {
                    console.error('Error saving home state:', err);
                }
            }
        }

        // Hide/show containers
        if (this.homeContainer) this.homeContainer.classList.remove('active');
        if (this.sharedBoardContainer) this.sharedBoardContainer.classList.remove('active');

        if (view.type === 'home') {
            // Cleanup previous board if switching from board to home
            if (this.activeViewId !== null) {
                const prevView = this.views.get(this.activeViewId);
                if (prevView && prevView.type === 'board' && prevView.initialized) {
                    console.log('Cleaning up board before showing home...');
                    try {
                        cleanupEditor(prevView.container);
                        prevView.initialized = false;
                    } catch (err) {
                        console.error('Error cleaning up board:', err);
                    }
                }
            }

            if (this.homeContainer) {
                this.homeContainer.classList.add('active');
            }

            // Initialize home if first time
            if (!view.initialized) {
                await initHomepage();
                view.initialized = true;
            }

            if (view.state) {
                restoreHomeState(view.state);
            }
        } else if (view.type === 'board') {
            // Cleanup previous board if switching from board to board
            if (this.activeViewId !== null) {
                const prevView = this.views.get(this.activeViewId);
                if (prevView && prevView.type === 'board' && prevView.initialized && prevView.tabId !== view.tabId) {
                    console.log('Cleaning up previous board before loading new one...');
                    try {
                        cleanupEditor(prevView.container);
                        prevView.initialized = false;
                    } catch (err) {
                        console.error('Error cleaning up previous board:', err);
                    }
                }
            }

            if (this.sharedBoardContainer) {
                this.sharedBoardContainer.classList.add('active');
            }

            // Initialize/reinitialize board view
            console.log('Initializing board view...');
            try {
                // Reset container to pristine state before initialization
                this.resetBoardContainer();

                await this.initializeView(view);
                view.initialized = true;

                // Restore saved state if exists
                if (view.state) {
                    console.log('Restoring saved board state...');
                    restoreBoardState(view.state);
                }
            } catch (err) {
                console.error('Error initializing board view:', err);
                // Show error to user
                if (this.sharedBoardContainer) {
                    this.sharedBoardContainer.innerHTML = `<div style="color: red; padding: 20px;">Error loading board: ${err.message}</div>`;
                }
            }
        }

        this.activeViewId = tabId;
    }

    /**
     * Deactivate a view (hide it, save state)
     */
    deactivateView(tabId) {
        const view = this.views.get(tabId);
        if (!view || !view.initialized) {
            return;
        }

        // Save current state
        if (view.type === 'home') {
            view.state = saveHomeState();
        } else if (view.type === 'board') {
            view.state = saveBoardState();
        }

        // Container will be hidden when next view activates
    }

    /**
     * Destroy a view (cleanup when tab closes)
     */
    destroyView(tabId) {
        const view = this.views.get(tabId);
        if (!view) {
            return;
        }

        // If this was the active board view, cleanup the canvas
        if (view.type === 'board' && view.initialized && tabId === this.activeViewId) {
            cleanupEditor(view.container);
        }

        // Just remove from map - don't remove DOM (shared container)
        this.views.delete(tabId);
    }

    /**
     * Initialize a view for the first time
     */
    async initializeView(view) {
        if (view.type === 'home') {
            // Initialize homepage
            await initHomepage();
        } else if (view.type === 'board') {
            // Initialize board editor with its dedicated container
            await initEditor(view.boardId, view.container);
        }
    }

    /**
     * Get view by tab ID
     */
    getView(tabId) {
        return this.views.get(tabId);
    }

    /**
     * Get active view
     */
    getActiveView() {
        return this.activeViewId !== null ? this.views.get(this.activeViewId) : null;
    }
}
