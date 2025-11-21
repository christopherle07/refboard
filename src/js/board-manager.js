// Board Manager - handles board CRUD operations and state

class BoardManager {
    constructor() {
        this.boards = [];
        this.currentBoard = null;
        this.STORAGE_KEY = 'reference_boards';
    }

    async loadBoards() {
        // Load from localStorage
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            this.boards = JSON.parse(stored);
        } else {
            // Default mock data
            this.boards = [
                { id: 1, name: 'Character References', bgColor: '#e3f2fd', createdAt: Date.now(), layers: [], assets: [] },
                { id: 2, name: 'Environment Art', bgColor: '#f3e5f5', createdAt: Date.now() - 86400000, layers: [], assets: [] },
                { id: 3, name: 'Color Palettes', bgColor: '#fff3e0', createdAt: Date.now() - 172800000, layers: [], assets: [] },
            ];
            this.saveToStorage();
        }
        return this.boards;
    }

    saveToStorage() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.boards));
    }

    async createBoard(name, bgColor) {
        const newBoard = {
            id: Date.now(),
            name,
            bgColor,
            createdAt: Date.now(),
            layers: [],
            assets: []
        };
        this.boards.push(newBoard);
        this.saveToStorage();
        return newBoard;
    }

    async getBoard(boardId) {
        const board = this.boards.find(b => b.id === boardId);
        if (board) {
            this.currentBoard = board;
        }
        return board;
    }

    async updateBoard(boardId, updates) {
        const board = this.boards.find(b => b.id === boardId);
        if (board) {
            Object.assign(board, updates);
            if (this.currentBoard && this.currentBoard.id === boardId) {
                Object.assign(this.currentBoard, updates);
            }
            this.saveToStorage();
        }
        return board;
    }

    async deleteBoard(boardId) {
        this.boards = this.boards.filter(b => b.id !== boardId);
        this.saveToStorage();
    }

    getAllBoards() {
        return this.boards;
    }
}

export const boardManager = new BoardManager();