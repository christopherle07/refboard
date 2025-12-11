class BoardManager {
    constructor() {
        this.boards = [];
        this.currentBoard = null;
        this.STORAGE_KEY = 'reference_boards';
        this.ALL_ASSETS_KEY = 'all_assets';
    }

    async invoke(cmd, args = {}) {
        if (window.__TAURI__) {
            return await window.__TAURI__.core.invoke(cmd, args);
        }
        return null;
    }

    async loadBoards() {
        if (window.__TAURI__) {
            this.boards = await this.invoke('get_all_boards');
        } else {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                this.boards = JSON.parse(stored);
            } else {
                this.boards = [];
            }
        }
        return this.boards;
    }

    saveToStorage() {
        if (!window.__TAURI__) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.boards));
        }
    }

    async createBoard(name, bgColor) {
        if (window.__TAURI__) {
            const board = await this.invoke('create_board', { name, bgColor });
            this.boards.push(board);
            return board;
        }
        const newBoard = {
            id: Date.now(),
            name,
            bgColor,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            layers: [],
            assets: []
        };
        this.boards.push(newBoard);
        this.saveToStorage();
        return newBoard;
    }

    async getBoard(boardId) {
        if (window.__TAURI__) {
            try {
                this.currentBoard = await this.invoke('get_board', { id: boardId });
                return this.currentBoard;
            } catch (e) {
                console.error('Failed to load board:', e);
                return null;
            }
        }
        const board = this.boards.find(b => b.id === boardId);
        if (board) {
            this.currentBoard = board;
        }
        return board;
    }

    async updateBoard(boardId, updates) {
        if (window.__TAURI__) {
            const board = await this.invoke('update_board', { id: boardId, updates });
            const idx = this.boards.findIndex(b => b.id === boardId);
            if (idx !== -1) {
                this.boards[idx] = board;
            }
            if (this.currentBoard && this.currentBoard.id === boardId) {
                this.currentBoard = board;
            }
            return board;
        }
        const board = this.boards.find(b => b.id === boardId);
        if (board) {
            Object.assign(board, updates, { updatedAt: Date.now() });
            if (this.currentBoard && this.currentBoard.id === boardId) {
                Object.assign(this.currentBoard, updates);
            }
            this.saveToStorage();
        }
        return board;
    }

    async deleteBoard(boardId) {
        if (window.__TAURI__) {
            await this.invoke('delete_board', { id: boardId });
        }
        this.boards = this.boards.filter(b => b.id !== boardId);
        this.saveToStorage();
    }

    async getAllAssets() {
        if (window.__TAURI__) {
            try {
                return await this.invoke('get_all_assets');
            } catch (e) {
                console.error('Failed to load all assets:', e);
                return [];
            }
        }
        const stored = localStorage.getItem(this.ALL_ASSETS_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
        return [];
    }

    async addToAllAssets(name, src) {
        if (window.__TAURI__) {
            try {
                return await this.invoke('add_to_all_assets', { name, src });
            } catch (e) {
                console.error('Failed to add to all assets:', e);
                return null;
            }
        }
        let allAssets = await this.getAllAssets();
        
        const existing = allAssets.find(a => a.name === name && a.src === src);
        if (existing) {
            return existing;
        }
        
        const asset = {
            id: Date.now() + Math.random(),
            name,
            src
        };
        allAssets.push(asset);
        localStorage.setItem(this.ALL_ASSETS_KEY, JSON.stringify(allAssets));
        return asset;
    }

    async deleteFromAllAssets(assetId) {
        if (window.__TAURI__) {
            try {
                await this.invoke('delete_from_all_assets', { id: assetId });
            } catch (e) {
                console.error('Failed to delete from all assets:', e);
            }
            return;
        }
        let allAssets = await this.getAllAssets();
        allAssets = allAssets.filter(a => a.id != assetId); // Use != instead of !== to handle type coercion
        localStorage.setItem(this.ALL_ASSETS_KEY, JSON.stringify(allAssets));
    }

    async deleteBoardAsset(boardId, assetId) {
        if (window.__TAURI__) {
            try {
                const board = await this.invoke('delete_board_asset', { boardId, assetId });
                const idx = this.boards.findIndex(b => b.id === boardId);
                if (idx !== -1) {
                    this.boards[idx] = board;
                }
                if (this.currentBoard && this.currentBoard.id === boardId) {
                    this.currentBoard = board;
                }
                return board;
            } catch (e) {
                console.error('Failed to delete board asset:', e);
                return null;
            }
        }
        const board = this.boards.find(b => b.id === boardId);
        if (board && board.assets) {
            board.assets = board.assets.filter(a => a.id !== assetId);
            if (this.currentBoard && this.currentBoard.id === boardId) {
                this.currentBoard.assets = board.assets;
            }
            this.saveToStorage();
        }
        return board;
    }

    getAllBoards() {
        return this.boards;
    }
}

export const boardManager = new BoardManager();