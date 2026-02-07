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
        this.onChanged = null; // Callback when history state changes
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

        if (this.onChanged) this.onChanged();
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

        if (this.onChanged) this.onChanged();
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

        if (this.onChanged) this.onChanged();

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

            case 'move_multiple':
                // Undo multiple moves (images and objects)
                if (action.data && Array.isArray(action.data)) {
                    for (const item of action.data) {
                        if (item.type === 'image') {
                            this.canvas.updateImagePosition(item.id, item.oldX, item.oldY, true);
                        } else if (item.type === 'object') {
                            const obj = this.canvas.objectsManager.objects.find(o => o.id === item.id);
                            if (obj) {
                                obj.x = item.oldX;
                                obj.y = item.oldY;
                                if (item.oldX2 !== undefined) obj.x2 = item.oldX2;
                                if (item.oldY2 !== undefined) obj.y2 = item.oldY2;
                            }
                        }
                    }
                }
                break;

            case 'crop':
                // Undo crop - restore previous crop state
                const img = this.canvas.images.find(i => i.id === action.data.id);
                if (img) {
                    img.cropData = action.data.oldCropData;
                    img.x = action.data.oldX;
                    img.y = action.data.oldY;
                    img.width = action.data.oldWidth;
                    img.height = action.data.oldHeight;
                    this.canvas.needsRender = true;
                }
                break;

            case 'uncrop':
                // Undo uncrop - restore crop state
                const uncropImg = this.canvas.images.find(i => i.id === action.data.id);
                if (uncropImg) {
                    uncropImg.cropData = action.data.oldCropData;
                    uncropImg.x = action.data.oldX;
                    uncropImg.y = action.data.oldY;
                    uncropImg.width = action.data.oldWidth;
                    uncropImg.height = action.data.oldHeight;
                    this.canvas.needsRender = true;
                }
                break;

            case 'add_object':
                // Undo add = delete the object
                this.canvas.objectsManager.deleteObject(action.data.id, true);
                break;

            case 'delete_objects':
                // Undo delete = restore all deleted objects
                for (const objData of action.data) {
                    this.canvas.objectsManager.objects.push({ ...objData });
                }
                this.canvas.objectsManager.dispatchObjectsChanged();
                break;

            case 'update_object': {
                const obj = this.canvas.objectsManager.objects.find(o => o.id === action.data.id);
                if (obj) {
                    Object.assign(obj, action.data.oldProps);
                    this.canvas.objectsManager.dispatchObjectsChanged();
                }
                break;
            }

            case 'object_visibility': {
                const obj = this.canvas.objectsManager.objects.find(o => o.id === action.data.id);
                if (obj) obj.visible = action.data.oldVisible;
                break;
            }

            case 'reorder_layers':
                this.applyZIndexes(action.data.oldOrder);
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

            case 'move_multiple':
                // Redo multiple moves (images and objects)
                if (action.data && Array.isArray(action.data)) {
                    for (const item of action.data) {
                        if (item.type === 'image') {
                            this.canvas.updateImagePosition(item.id, item.newX, item.newY, true);
                        } else if (item.type === 'object') {
                            const obj = this.canvas.objectsManager.objects.find(o => o.id === item.id);
                            if (obj) {
                                obj.x = item.newX;
                                obj.y = item.newY;
                                if (item.newX2 !== undefined) obj.x2 = item.newX2;
                                if (item.newY2 !== undefined) obj.y2 = item.newY2;
                            }
                        }
                    }
                }
                break;

            case 'crop':
                // Redo crop - apply crop state
                const img = this.canvas.images.find(i => i.id === action.data.id);
                if (img) {
                    img.cropData = action.data.newCropData;
                    img.x = action.data.newX;
                    img.y = action.data.newY;
                    img.width = action.data.newWidth;
                    img.height = action.data.newHeight;
                    this.canvas.needsRender = true;
                }
                break;

            case 'uncrop':
                // Redo uncrop - remove crop
                const uncropImg = this.canvas.images.find(i => i.id === action.data.id);
                if (uncropImg) {
                    uncropImg.cropData = null;
                    uncropImg.x = action.data.newX;
                    uncropImg.y = action.data.newY;
                    uncropImg.width = action.data.newWidth;
                    uncropImg.height = action.data.newHeight;
                    this.canvas.needsRender = true;
                }
                break;

            case 'add_object':
                // Redo add = restore the object
                this.canvas.objectsManager.objects.push({ ...action.data });
                this.canvas.objectsManager.dispatchObjectsChanged();
                break;

            case 'delete_objects':
                // Redo delete = remove the objects again
                const idsToDelete = action.data.map(o => o.id);
                this.canvas.objectsManager.objects = this.canvas.objectsManager.objects.filter(
                    o => !idsToDelete.includes(o.id)
                );
                this.canvas.objectsManager.deselectAll();
                this.canvas.objectsManager.dispatchObjectsChanged();
                break;

            case 'update_object': {
                const obj = this.canvas.objectsManager.objects.find(o => o.id === action.data.id);
                if (obj) {
                    Object.assign(obj, action.data.newProps);
                    this.canvas.objectsManager.dispatchObjectsChanged();
                }
                break;
            }

            case 'object_visibility': {
                const obj = this.canvas.objectsManager.objects.find(o => o.id === action.data.id);
                if (obj) obj.visible = action.data.newVisible;
                break;
            }

            case 'reorder_layers':
                this.applyZIndexes(action.data.newOrder);
                break;
        }

        this.canvas.needsRender = true;
    }

    /**
     * Apply zIndex values from an order array to images and objects
     */
    applyZIndexes(order) {
        for (const item of order) {
            if (item.type === 'image') {
                const img = this.canvas.images.find(i => i.id === item.id);
                if (img) img.zIndex = item.zIndex;
            } else if (item.type === 'object') {
                const obj = this.canvas.objectsManager.objects.find(o => o.id === item.id);
                if (obj) obj.zIndex = item.zIndex;
            }
        }
    }

    /**
     * Restore a deleted image (or video/gif)
     */
    restoreImage(imageData) {
        if (imageData.mediaType === 'video') {
            const video = document.createElement('video');
            video.preload = 'auto';
            video.muted = true;
            video.onloadedmetadata = () => {
                const restored = this.canvas.addVideoSilent(
                    video, imageData.x, imageData.y, imageData.name,
                    imageData.width, imageData.height, imageData.visible
                );
                restored.id = imageData.id;
                this.canvas.needsRender = true;
            };
            video.onerror = () => console.error('Failed to restore video:', imageData.name);
            // Resolve src through board manager if available
            if (window.boardManagerInstance) {
                window.boardManagerInstance.resolveImageSrc(imageData.src).then(resolved => {
                    video.src = resolved;
                });
            } else {
                video.src = imageData.src;
            }
        } else if (imageData.mediaType === 'gif') {
            const loadGif = async () => {
                try {
                    let src = imageData.src;
                    if (window.boardManagerInstance) {
                        src = await window.boardManagerInstance.resolveImageSrc(imageData.src);
                    }
                    const response = await fetch(src);
                    const buffer = await response.arrayBuffer();
                    const restored = this.canvas.addGifSilent(
                        buffer, imageData.x, imageData.y, imageData.name, src
                    );
                    if (restored) {
                        restored.id = imageData.id;
                        this.canvas.needsRender = true;
                    }
                } catch (e) {
                    console.error('Failed to restore GIF:', imageData.name, e);
                }
            };
            loadGif();
        } else {
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
