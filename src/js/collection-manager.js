class CollectionManager {
    constructor() {
        this.STORAGE_KEY = 'board_collections';
        this.collections = [];
        this.loadCollections();
    }

    loadCollections() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try {
                this.collections = JSON.parse(saved);
            } catch (e) {
                console.error('Failed to load collections:', e);
                this.collections = [];
            }
        }
    }

    saveCollections() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.collections));
    }

    createCollection(name, color = null) {
        const collection = {
            id: 'col_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: name,
            color: color,
            boardIds: [],
            createdAt: Date.now()
        };
        this.collections.push(collection);
        this.saveCollections();
        return collection;
    }

    getCollection(collectionId) {
        return this.collections.find(c => c.id === collectionId);
    }

    getAllCollections() {
        return [...this.collections].sort((a, b) => a.name.localeCompare(b.name));
    }

    updateCollection(collectionId, updates) {
        const collection = this.getCollection(collectionId);
        if (collection) {
            Object.assign(collection, updates);
            this.saveCollections();
            return true;
        }
        return false;
    }

    deleteCollection(collectionId) {
        const index = this.collections.findIndex(c => c.id === collectionId);
        if (index !== -1) {
            this.collections.splice(index, 1);
            this.saveCollections();
            return true;
        }
        return false;
    }

    addBoardToCollection(collectionId, boardId) {
        const collection = this.getCollection(collectionId);
        if (collection && !collection.boardIds.includes(boardId)) {
            collection.boardIds.push(boardId);
            this.saveCollections();
            return true;
        }
        return false;
    }

    removeBoardFromCollection(collectionId, boardId) {
        const collection = this.getCollection(collectionId);
        if (collection) {
            const index = collection.boardIds.indexOf(boardId);
            if (index !== -1) {
                collection.boardIds.splice(index, 1);
                this.saveCollections();
                return true;
            }
        }
        return false;
    }

    getBoardCollections(boardId) {
        return this.collections.filter(c => c.boardIds.includes(boardId));
    }

    removeBoardFromAllCollections(boardId) {
        let modified = false;
        this.collections.forEach(collection => {
            const index = collection.boardIds.indexOf(boardId);
            if (index !== -1) {
                collection.boardIds.splice(index, 1);
                modified = true;
            }
        });
        if (modified) {
            this.saveCollections();
        }
    }
}

export default CollectionManager;
