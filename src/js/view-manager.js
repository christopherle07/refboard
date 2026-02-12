/**
 * ViewManager - Simplified for no tabs
 * Just toggles between home and board view
 */

import { initHomepage } from './main.js';
import { initEditor, cleanupEditor } from './editor.js';

export class ViewManager {
    constructor() {
        this.currentView = 'home'; // 'home' or 'board'
        this.currentBoardId = null;
        this.homeInitialized = false;

        // Get containers
        this.homeContainer = document.querySelector('.home-view');
        this.boardContainer = document.querySelector('.board-view');

        console.log('ViewManager initialized (simplified)');
    }

    /**
     * Show home view
     */
    async showHome() {
        console.log('[ViewManager] Showing home view');

        // Cleanup board if it was active
        if (this.currentView === 'board' && this.currentBoardId) {
            // Reset assets/canvas view state so next board open starts on canvas
            const assetsView = document.getElementById('assets-library-view');
            const canvasContainer = document.getElementById('canvas-container');
            if (assetsView) {
                assetsView.style.display = 'none';
                assetsView.classList.remove('fade-in');
            }
            if (canvasContainer) canvasContainer.style.display = 'block';

            // Reset elements that showAssetsView() hides with inline styles
            const sidebar = this.boardContainer.querySelector('#sidebar');
            const toolsSidebar = this.boardContainer.querySelector('.tools-sidebar');
            const drawingToolbar = this.boardContainer.querySelector('#drawing-toolbar');
            const sizeSlider = this.boardContainer.querySelector('#draw-size-slider-container');
            const opacitySlider = this.boardContainer.querySelector('#draw-opacity-slider-container');
            if (sidebar) sidebar.style.display = '';
            if (toolsSidebar) toolsSidebar.style.display = '';
            if (drawingToolbar) drawingToolbar.style.display = '';
            if (sizeSlider) sizeSlider.style.display = '';
            if (opacitySlider) opacitySlider.style.display = '';

            try {
                console.log('[ViewManager] Cleaning up board before showing home...');
                await cleanupEditor(this.boardContainer);
                console.log('[ViewManager] Board cleanup complete');
            } catch (err) {
                console.error('Error cleaning up board:', err);
            }
        }

        // Hide board, show home
        if (this.homeContainer) this.homeContainer.classList.add('active');
        if (this.boardContainer) this.boardContainer.classList.remove('active');

        // Initialize home if first time
        if (!this.homeInitialized) {
            await initHomepage();
            this.homeInitialized = true;
        }

        this.currentView = 'home';
        this.currentBoardId = null;
    }

    /**
     * Show board view
     */
    async showBoard(boardId) {
        console.log('[ViewManager] Showing board:', boardId);

        // Cleanup previous board if already in board view (including refreshes)
        if (this.currentView === 'board') {
            try {
                console.log('[ViewManager] Cleaning up previous board...');
                await cleanupEditor(this.boardContainer);
                console.log('[ViewManager] Previous board cleanup complete');
            } catch (err) {
                console.error('Error cleaning up previous board:', err);
            }
        }

        // Hide home, show board
        if (this.homeContainer) this.homeContainer.classList.remove('active');
        if (this.boardContainer) this.boardContainer.classList.add('active');

        // Initialize board
        try {
            await initEditor(boardId, this.boardContainer);
            this.currentView = 'board';
            this.currentBoardId = boardId;
        } catch (err) {
            console.error('Error initializing board:', err);
            // Fall back to home
            await this.showHome();
        }
    }
}
