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

        // Cleanup previous board if switching boards
        if (this.currentView === 'board' && this.currentBoardId !== boardId) {
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
