/**
 * History Manager - Handles undo/redo for canvas operations
 * Maintains a stack of actions with a 50-action limit
 */

export class HistoryManager {
    constructor(maxHistory = 50) {
        this.maxHistory = maxHistory;
        this.undoStack = [];
        this.redoStack = [];
        this.canvas = null;
    }

    /**
     * Set the canvas instance to manage
     */
    setCanvas(canvas) {
        this.canvas = canvas;
    }

    /**
     * Record a new action
     * @param {Object} action - Action object with type and data
     */
    pushAction(action) {
        // Add timestamp
        action.timestamp = Date.now();

        // Add to undo stack
        this.undoStack.push(action);

        // Clear redo stack when new action is performed
        this.redoStack = [];

        // Maintain max history limit
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
    }

    /**
     * Undo the last action
     */
    undo() {
        if (!this.canUndo() || !this.canvas) return false;

        const action = this.undoStack.pop();

        // Apply the undo
        this.applyUndo(action);

        // Move to redo stack
        this.redoStack.push(action);

        return true;
    }

    /**
     * Redo the last undone action
     */
    redo() {
        if (!this.canRedo() || !this.canvas) return false;

        const action = this.redoStack.pop();

        // Apply the redo
        this.applyRedo(action);

        // Move back to undo stack
        this.undoStack.push(action);

        return true;
    }

    /**
     * Check if undo is available
     */
    canUndo() {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo() {
        return this.redoStack.length > 0;
    }

    /**
     * Apply undo for different action types
     */
    applyUndo(action) {
        switch (action.type) {
            case 'add_image':
                this.canvas.deleteImage(action.data.id, true); // Skip history
                break;

            case 'delete_image':
                this.restoreImage(action.data);
                break;

            case 'move':
                this.canvas.updateImagePosition(action.data.id, action.data.oldX, action.data.oldY, true);
                break;

            case 'resize':
                this.canvas.updateImageSize(action.data.id, action.data.oldWidth, action.data.oldHeight, true);
                break;

            case 'rename':
                this.canvas.renameLayer(action.data.id, action.data.oldName, true);
                break;

            case 'visibility':
                this.canvas.setVisibility(action.data.id, action.data.oldVisible, true);
                break;

            case 'reorder':
                this.canvas.images = JSON.parse(action.data.oldOrder);
                this.canvas.needsRender = true;
                break;

            case 'bg_color':
                this.canvas.setBackgroundColor(action.data.oldColor, true);
                break;

            case 'stroke_add':
                // Remove the last added stroke
                this.canvas.undoStroke();
                break;

            case 'strokes_erase':
                // Restore erased strokes
                if (action.strokes && action.strokes.length > 0) {
                    this.canvas.strokes.push(...action.strokes);
                    this.canvas.redrawDrawingLayer();
                    this.canvas.needsRender = true;
                }
                break;

            case 'strokes_clear':
                // Restore all cleared strokes
                if (action.strokes) {
                    this.canvas.strokes = [...action.strokes];
                    this.canvas.redrawDrawingLayer();
                    this.canvas.needsRender = true;
                }
                break;
        }

        this.canvas.needsRender = true;
    }

    /**
     * Apply redo for different action types
     */
    applyRedo(action) {
        switch (action.type) {
            case 'add_image':
                this.restoreImage(action.data);
                break;

            case 'delete_image':
                this.canvas.deleteImage(action.data.id, true);
                break;

            case 'move':
                this.canvas.updateImagePosition(action.data.id, action.data.newX, action.data.newY, true);
                break;

            case 'resize':
                this.canvas.updateImageSize(action.data.id, action.data.newWidth, action.data.newHeight, true);
                break;

            case 'rename':
                this.canvas.renameLayer(action.data.id, action.data.newName, true);
                break;

            case 'visibility':
                this.canvas.setVisibility(action.data.id, action.data.newVisible, true);
                break;

            case 'reorder':
                this.canvas.images = JSON.parse(action.data.newOrder);
                this.canvas.needsRender = true;
                break;

            case 'bg_color':
                this.canvas.setBackgroundColor(action.data.newColor, true);
                break;

            case 'stroke_add':
                // Re-add the stroke
                if (action.stroke) {
                    this.canvas.redoStroke(action.stroke);
                }
                break;

            case 'strokes_erase':
                // Re-erase the strokes (remove them again)
                if (action.strokes && action.strokes.length > 0) {
                    const strokeIds = action.strokes.map(s => s.id);
                    this.canvas.strokes = this.canvas.strokes.filter(s => !strokeIds.includes(s.id));
                    this.canvas.redrawDrawingLayer();
                    this.canvas.needsRender = true;
                }
                break;

            case 'strokes_clear':
                // Clear strokes again
                this.canvas.strokes = [];
                this.canvas.redrawDrawingLayer();
                this.canvas.needsRender = true;
                break;
        }

        this.canvas.needsRender = true;
    }

    /**
     * Restore a deleted image
     */
    restoreImage(imageData) {
        const img = new Image();
        img.onload = () => {
            const restored = this.canvas.addImageSilent(
                img,
                imageData.x,
                imageData.y,
                imageData.name,
                imageData.width,
                imageData.height,
                imageData.visible
            );
            restored.id = imageData.id;
            this.canvas.needsRender = true;
        };
        img.src = imageData.src;
    }

    /**
     * Clear all history
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Get history stats
     */
    getStats() {
        return {
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length,
            maxHistory: this.maxHistory
        };
    }
}
