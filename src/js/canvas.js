import { CanvasObjectsManager } from './canvas-objects.js';

export class Canvas {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', {
            alpha: false,
            desynchronized: true,
            willReadFrequently: false
        });
        this.images = [];
        this.selectedImage = null;
        this.selectedImages = [];
        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
        this.isPanning = false;
        this.isBoxSelecting = false;
        this.isCropping = false;
        this.rotationStartAngle = 0;
        this.rotationStartRotation = 0;
        this.selectionBox = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragOffsets = new Map();
        this.objectDragOffsets = [];
        this.resizeHandle = null;
        this.resizeStartData = null;
        this.selectedGroup = null; // Track when a group is selected
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.lastPanPoint = { x: 0, y: 0 };
        this.needsRender = true;
        this.animationFrame = null;
        this.bgColor = '#ffffff';

        this.visibleImages = [];
        this.viewportBounds = { left: 0, right: 0, top: 0, bottom: 0 };
        this.lastCullZoom = 1;
        this.lastCullPan = { x: 0, y: 0 };
        this.cullThreshold = 10;

        this.loadSettings();

        this.hasShownZoomWarning = false;
        this.zoomWarningThreshold = 0.05;

        this.snapLines = [];

        this.historyManager = null;
        this.dragStartPosition = null;

        // Drawing state
        this.strokes = [];
        this.currentStroke = null;
        this.isDrawing = false;
        this.drawingMode = null; // null, 'pen', 'highlighter', 'eraser'
        this.eraserMode = 'strokes'; // 'strokes' or 'pixels'
        this.drawingColor = '#000000';
        this.drawingOpacity = 1; // 0-1, affects pen/highlighter/eraser
        this.penSize = 2;
        this.highlighterSize = 20;
        this.eraserSize = 20;

        // Create offscreen canvas for drawing layer
        this.drawingCanvas = document.createElement('canvas');
        this.drawingCtx = this.drawingCanvas.getContext('2d');

        // Text and shapes manager
        this.objectsManager = new CanvasObjectsManager(this);

        this.setupCanvas();
        this.setupEventListeners();
        this.startRenderLoop();
    }

    loadSettings() {
        const SETTINGS_KEY = 'canvas_settings';
        const defaults = {
            showGrid: false,
            gridSize: 50,
            enableSnapping: true,
            snapThreshold: 3,
            thumbnailQuality: 1.0
        };
        
        let settings = defaults;
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            try {
                settings = { ...defaults, ...JSON.parse(saved) };
            } catch (e) {
                settings = defaults;
            }
        }
        
        this.showGrid = settings.showGrid;
        this.gridSize = settings.gridSize;
        this.enableSnapping = settings.enableSnapping;
        this.snapThreshold = settings.snapThreshold;
        this.thumbnailQuality = settings.thumbnailQuality;
        this.updateGridColor();
    }

    updateSettings(settings) {
        this.showGrid = settings.showGrid;
        this.gridSize = settings.gridSize;
        this.enableSnapping = settings.enableSnapping;
        this.snapThreshold = settings.snapThreshold;
        this.thumbnailQuality = settings.thumbnailQuality;
        this.updateGridColor();
        this.render(); // Re-render to show/hide grid
    }

    /**
     * Calculate adaptive grid color based on background brightness
     */
    updateGridColor() {
        const brightness = this.getColorBrightness(this.bgColor);
        // If background is dark (brightness < 128), use white grid lines
        // Otherwise use black grid lines
        if (brightness < 128) {
            this.gridColor = 'rgba(255, 255, 255, 0.15)';
        } else {
            this.gridColor = 'rgba(0, 0, 0, 0.08)';
        }
    }

    /**
     * Get brightness of a color (0-255)
     */
    getColorBrightness(color) {
        // Convert hex to RGB
        let r, g, b;

        if (color.startsWith('#')) {
            const hex = color.replace('#', '');
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else {
                r = parseInt(hex.substr(0, 2), 16);
                g = parseInt(hex.substr(2, 2), 16);
                b = parseInt(hex.substr(4, 2), 16);
            }
        } else if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            r = parseInt(matches[0]);
            g = parseInt(matches[1]);
            b = parseInt(matches[2]);
        } else {
            // Default to white if can't parse
            return 255;
        }

        // Calculate perceived brightness using standard formula
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    showToast(message, duration = 5000) {
        const existingToast = document.querySelector('.canvas-toast');
        if (existingToast) existingToast.remove();
        
        const toast = document.createElement('div');
        toast.className = 'canvas-toast';
        toast.textContent = message;
        
        if (!document.querySelector('#canvas-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'canvas-toast-styles';
            style.textContent = `
                .canvas-toast {
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #ffffff;
                    color: #1a1a1a;
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    z-index: 10000;
                    pointer-events: none;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    border: 1px solid #e0e0e0;
                    animation: toastSlideDown 0.3s ease;
                }
                
                @keyframes toastSlideDown {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
                
                .canvas-toast.fade-out {
                    animation: toastFadeOut 0.3s ease forwards;
                }
                
                @keyframes toastFadeOut {
                    to {
                        opacity: 0;
                        transform: translateX(-50%) translateY(-20px);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.canvas.width = width;
        this.canvas.height = height;

        // Resize drawing canvas to match and redraw strokes
        this.drawingCanvas.width = width;
        this.drawingCanvas.height = height;

        // Redraw all strokes on the new drawing canvas
        if (this.strokes.length > 0) {
            this.redrawDrawingLayer();
        }

        this.updateViewportBounds();
        this.needsRender = true;
    }

    startRenderLoop() {
        const render = () => {
            if (this.needsRender) {
                this.render();
                this.needsRender = false;
            }
            this.animationFrame = requestAnimationFrame(render);
        };
        render();
    }

    setupEventListeners() {
        // Use pointer events (supports both mouse and pen/touch)
        // Pointer events are more modern and handle all input types
        this.canvas.addEventListener('pointerdown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('pointermove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('pointerup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('pointerleave', this.onMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
        // Add window pointerup to catch cases where pointer is released outside canvas
        window.addEventListener('pointerup', this.onMouseUp.bind(this));

        this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        this.canvas.addEventListener('contextmenu', this.onContextMenu.bind(this));
        
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        this.canvas.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes('Files')) {
                this.showDragOverlay();
            }
        });

        this.canvas.addEventListener('dragleave', (e) => {
            if (e.target === this.canvas) {
                this.hideDragOverlay();
            }
        });

        this.canvas.addEventListener('drop', this.onDrop.bind(this));
        
        document.addEventListener('keydown', (e) => {
            // Handle crop mode keys
            if (this.isCropping) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.cancelCrop();
                    return;
                }
            }

            // Don't prevent spacebar if editing text
            const isEditingText = this.objectsManager.editingTextObject !== null;
            if (e.key === ' ' && !this.isPanning && !e.repeat && !isEditingText) {
                e.preventDefault();
                this.canvas.style.cursor = 'grab';
            }
            if (e.key === 'Delete') {
                // Delete selected images
                if (this.selectedImages.length > 0) {
                    this.deleteSelectedImages();
                }
                // Delete selected objects
                if (this.objectsManager.selectedObjects.length > 0) {
                    this.objectsManager.deleteSelectedObject();
                }
            }
            // Reset rotation with 'R' key
            if (e.key === 'r' || e.key === 'R') {
                let hasRotation = false;

                // Reset rotation for all selected images
                for (const img of this.selectedImages) {
                    if (img.rotation && img.rotation !== 0) {
                        img.rotation = 0;
                        hasRotation = true;
                    }
                }

                // Reset rotation for all selected objects
                for (const obj of this.objectsManager.selectedObjects) {
                    if (obj.rotation && obj.rotation !== 0) {
                        obj.rotation = 0;
                        hasRotation = true;
                    }
                }

                if (hasRotation) {
                    this.needsRender = true;
                    this.notifyChange();
                }
            }
        });
        
        document.addEventListener('keyup', (e) => {
            if (e.key === ' ') {
                this.canvas.style.cursor = 'default';
            }
        });
    }

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.pan.x) / this.zoom,
            y: (screenY - this.pan.y) / this.zoom
        };
    }

    worldToScreen(worldX, worldY) {
        return {
            x: worldX * this.zoom + this.pan.x,
            y: worldY * this.zoom + this.pan.y
        };
    }

    updateViewportBounds() {
        const margin = 100;
        this.viewportBounds = {
            left: (-this.pan.x - margin) / this.zoom,
            right: ((this.canvas.width - this.pan.x) + margin) / this.zoom,
            top: (-this.pan.y - margin) / this.zoom,
            bottom: ((this.canvas.height - this.pan.y) + margin) / this.zoom
        };
    }

    shouldRecull() {
        const panDelta = Math.abs(this.pan.x - this.lastCullPan.x) + Math.abs(this.pan.y - this.lastCullPan.y);
        const zoomDelta = Math.abs(this.zoom - this.lastCullZoom);
        return panDelta > this.cullThreshold || zoomDelta > 0.01;
    }

    invalidateCullCache() {
        // Force a recull on next render by setting cache values to extreme values
        this.lastCullPan = { x: Infinity, y: Infinity };
        this.lastCullZoom = -1;
        this.needsRender = true;
    }

    cullImages() {
        if (!this.shouldRecull()) {
            return this.visibleImages;
        }

        this.updateViewportBounds();
        const bounds = this.viewportBounds;

        let filteredImages = this.images.filter(img => {
            if (img.visible === false) return false;
            return !(
                img.x + img.width < bounds.left ||
                img.x > bounds.right ||
                img.y + img.height < bounds.top ||
                img.y > bounds.bottom
            );
        });

        this.visibleImages = filteredImages;
        this.lastCullPan = { x: this.pan.x, y: this.pan.y };
        this.lastCullZoom = this.zoom;

        return this.visibleImages;
    }


    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

        // Handle crop mode
        if (this.isCropping && e.button === 0) {
            const handle = this.getCropHandle(x, y);

            if (handle) {
                // Clicked on a resize handle
                this.cropHandle = handle;
                this.dragStartPoint = { x, y };
                this.cropStartRect = { ...this.cropRect };
                return;
            } else if (this.isPointInRect(x, y, this.cropRect)) {
                // Clicked inside crop rect to move it
                this.cropHandle = 'move';
                this.dragStartPoint = { x, y };
                this.cropStartRect = { ...this.cropRect };
                return;
            } else {
                // Clicked outside crop rect, apply crop
                this.applyCrop();
                return;
            }
        }

        // Check if a tool is active (text or shape tool)
        if (this.objectsManager.currentTool) {
            if (this.objectsManager.handleMouseDown(e, { x, y })) {
                return;
            }
        }

        // Check for object rotation handles FIRST (before checking for clicked objects)
        if (this.objectsManager.selectedObjects.length > 0) {
            for (const obj of this.objectsManager.selectedObjects) {
                if (this.objectsManager.isPointOnObjectRotationHandle(obj, x, y)) {
                    this.enableRotationMode(obj, x, y);
                    return;
                }
            }
        }

        // Check what's at this point - objects or images
        const clickedObject = this.objectsManager.getObjectAtPoint(x, y);
        const clickedImage = this.getImageAtPoint(x, y);

        // If both exist, check which has higher zIndex
        let shouldHandleObject = false;
        if (clickedObject && clickedImage) {
            const objectZ = clickedObject.zIndex || 0;
            const imageZ = clickedImage.zIndex || 0;
            shouldHandleObject = objectZ > imageZ;
        } else if (clickedObject) {
            shouldHandleObject = true;
        }

        // Handle text/shape objects if they're on top
        if (shouldHandleObject && this.objectsManager.handleMouseDown(e, { x, y })) {
            return;
        }

        // Handle drawing mode (support both mouse and pointer events)
        const isPrimaryButton = e.button === 0 || (e.pointerType && e.buttons === 1);
        if (this.drawingMode && isPrimaryButton) {
            this.startDrawing(x, y);
            return;
        }

        if (e.button === 1 || (e.button === 0 && e.key === ' ')) {
            e.preventDefault();
            this.isPanning = true;
            this.lastPanPoint = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (e.button === 2) {
            // Don't pan if shift is held (for multi-select)
            if (!e.shiftKey) {
                e.preventDefault();
                this.isPanning = true;
                this.lastPanPoint = { x: e.clientX, y: e.clientY };
                this.canvas.style.cursor = 'grabbing';
                return;
            }
        }
        
        // Check for group rotation handle first
        if (this.selectedGroup) {
            const bounds = this.getGroupBounds();
            if (bounds) {
                // Check rotation handle
                if (this.isPointOnRotationHandle(x, y, bounds)) {
                    this.enableRotationMode(this.selectedImages[0] || this.objectsManager.selectedObjects[0], x, y);
                    return;
                }

                // Check resize handles
                const handle = this.getResizeHandleForBounds(x, y, bounds);
                if (handle) {
                    this.isResizing = true;
                    this.resizeHandle = handle;
                    this.resizeStartData = {
                        ...bounds,
                        mouseX: x,
                        mouseY: y,
                        aspectRatio: bounds.width / bounds.height,
                        // Store initial positions of all items for scaling
                        itemStates: [
                            ...this.selectedImages.map(img => ({
                                type: 'image',
                                item: img,
                                x: img.x,
                                y: img.y,
                                width: img.width,
                                height: img.height
                            })),
                            ...this.objectsManager.selectedObjects.map(obj => ({
                                type: 'object',
                                item: obj,
                                x: obj.x,
                                y: obj.y,
                                x2: obj.x2,
                                y2: obj.y2,
                                width: obj.width,
                                height: obj.height
                            }))
                        ]
                    };
                    return;
                }

                // Check if clicking anywhere within bounds to drag
                if (this.isPointInBounds(x, y, bounds)) {
                    // Start dragging all selected items
                    this.isDragging = true;
                    this.dragOffsets.clear();
                    this.dragStartPositions = new Map();
                    for (const img of this.selectedImages) {
                        this.dragOffsets.set(img.id, { x: x - img.x, y: y - img.y });
                        this.dragStartPositions.set(img.id, { x: img.x, y: img.y });
                    }

                    this.objectDragOffsets = [];
                    this.objectDragStartPositions = [];
                    for (const obj of this.objectsManager.selectedObjects) {
                        this.objectDragOffsets.push({ x: x - obj.x, y: y - obj.y });
                        this.objectDragStartPositions.push({
                            id: obj.id,
                            x: obj.x,
                            y: obj.y,
                            x2: obj.x2,
                            y2: obj.y2
                        });
                    }

                    this.canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        }

        if (this.selectedImage && this.selectedImage.visible !== false && !this.selectedGroup) {
            // Check rotation handle for single image
            const imgBounds = {
                x: this.selectedImage.x,
                y: this.selectedImage.y,
                width: this.selectedImage.width,
                height: this.selectedImage.height,
                rotation: this.selectedImage.rotation || 0
            };
            if (this.isPointOnRotationHandle(x, y, imgBounds)) {
                this.enableRotationMode(this.selectedImage, x, y);
                return;
            }

            // Check resize handles
            const handle = this.getResizeHandle(x, y, this.selectedImage);
            if (handle) {
                this.isResizing = true;
                this.resizeHandle = handle;
                this.resizeStartData = {
                    x: this.selectedImage.x,
                    y: this.selectedImage.y,
                    width: this.selectedImage.width,
                    height: this.selectedImage.height,
                    mouseX: x,
                    mouseY: y,
                    aspectRatio: this.selectedImage.width / this.selectedImage.height
                };
                return;
            }
        }

        // clickedImage already declared above, reuse it
        if (clickedImage) {
            // Handle rotation with Alt key
            if (e.altKey && e.button === 0) {
                this.enableRotationMode(clickedImage, x, y);
                return;
            }

            // Handle multi-select with Ctrl/Cmd
            if (e.ctrlKey || e.metaKey) {
                this.selectImage(clickedImage, true);
                // Also clear object selection when multi-selecting images
                if (!clickedObject) {
                    this.objectsManager.deselectAll();
                }
                return;
            }

            // Handle range select with Shift
            if (e.shiftKey && this.selectedImage) {
                this.selectImagesInRange(this.selectedImage, clickedImage);
                return;
            }

            // If a group is selected and clicking on a member of that group, keep group intact
            if (this.selectedGroup && this.isImageSelected(clickedImage)) {
                // Just start dragging, don't change selection
                this.isDragging = true;
                this.dragOffsets.clear();
                this.dragStartPositions = new Map();
                for (const img of this.selectedImages) {
                    this.dragOffsets.set(img.id, { x: x - img.x, y: y - img.y });
                    this.dragStartPositions.set(img.id, { x: img.x, y: img.y });
                }

                this.objectDragOffsets = [];
                this.objectDragStartPositions = [];
                for (const obj of this.objectsManager.selectedObjects) {
                    this.objectDragOffsets.push({ x: x - obj.x, y: y - obj.y });
                    this.objectDragStartPositions.push({
                        id: obj.id,
                        x: obj.x,
                        y: obj.y,
                        x2: obj.x2,
                        y2: obj.y2
                    });
                }

                this.canvas.style.cursor = 'grabbing';
                return;
            }

            // If clicking an already selected image in multi-select, don't deselect
            if (!this.isImageSelected(clickedImage)) {
                this.selectImage(clickedImage);
                // Clear object selection when selecting a single image
                this.objectsManager.deselectAll();
            }

            // Clear group selection when clicking individual items
            this.selectedGroup = null;

            // Setup dragging for all selected images
            this.isDragging = true;
            this.dragOffsets.clear();
            this.dragStartPositions = new Map();
            for (const img of this.selectedImages) {
                this.dragOffsets.set(img.id, { x: x - img.x, y: y - img.y });
                this.dragStartPositions.set(img.id, { x: img.x, y: img.y });
            }

            // Also setup drag offsets for any selected objects
            this.objectDragOffsets = [];
            this.objectDragStartPositions = [];
            for (const obj of this.objectsManager.selectedObjects) {
                this.objectDragOffsets.push({ x: x - obj.x, y: y - obj.y });
                this.objectDragStartPositions.push({
                    id: obj.id,
                    x: obj.x,
                    y: obj.y,
                    x2: obj.x2,
                    y2: obj.y2
                });
            }

            this.dragStartPosition = { x: clickedImage.x, y: clickedImage.y };
            this.canvas.style.cursor = 'grabbing';
        } else {
            // Start box selection
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                this.selectImage(null);
                this.objectsManager.deselectAll();
                this.isBoxSelecting = true;
                this.selectionBox = { startX: x, startY: y, endX: x, endY: y };
                this.needsRender = true;
            } else {
                this.isPanning = true;
                this.lastPanPoint = { x: e.clientX, y: e.clientY };
                this.canvas.style.cursor = 'grabbing';
            }
        }
    }

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

        // Handle crop mode
        if (this.isCropping) {
            if (this.cropHandle) {
                this.updateCrop(this.cropHandle, x, y);
                return;
            } else {
                // Update cursor based on hover position
                const handle = this.getCropHandle(x, y);
                if (handle) {
                    this.canvas.style.cursor = this.getCursorForHandle(handle);
                } else if (this.isPointInRect(x, y, this.cropRect)) {
                    this.canvas.style.cursor = 'move';
                } else {
                    this.canvas.style.cursor = 'crosshair';
                }
                return;
            }
        }

        // Handle text/shape object dragging
        this.objectsManager.handleMouseMove(e, { x, y });

        // Handle drawing mode
        if (this.isDrawing) {
            this.continueDrawing(x, y);
            return;
        }

        if (this.isBoxSelecting) {
            this.selectionBox.endX = x;
            this.selectionBox.endY = y;
            this.needsRender = true;
        } else if (this.isRotating && this.rotatingImage) {
            this.rotateImage(x, y);
            this.canvas.style.cursor = 'grabbing';
            this.needsRender = true;
        } else if (this.isResizing) {
            if (this.selectedGroup) {
                this.resizeGroup(x, y);
            } else if (this.selectedImage) {
                this.resizeImage(x, y);
            }
            this.needsRender = true;
        } else if (this.isDragging && this.selectedImages.length > 0) {
            // Move all selected images
            let finalX = x;
            let finalY = y;

            // Apply snapping if enabled
            if (this.enableSnapping && this.selectedImages.length === 1) {
                const primaryImg = this.selectedImages[0];
                const offset = this.dragOffsets.get(primaryImg.id);
                if (offset) {
                    const tentativeX = x - offset.x;
                    const tentativeY = y - offset.y;
                    const snapResult = this.snapToImages(tentativeX, tentativeY, primaryImg);
                    finalX = snapResult.x + offset.x;
                    finalY = snapResult.y + offset.y;
                    this.snapLines = snapResult.guides;
                }
            } else {
                this.snapLines = [];
            }

            // Apply movement to all selected images
            for (const img of this.selectedImages) {
                const offset = this.dragOffsets.get(img.id);
                if (offset) {
                    img.x = finalX - offset.x;
                    img.y = finalY - offset.y;
                }
            }

            // Also move all selected objects
            this.objectsManager.selectedObjects.forEach((obj, index) => {
                const offset = this.objectDragOffsets[index];
                if (offset) {
                    const newX = finalX - offset.x;
                    const newY = finalY - offset.y;

                    // For lines/arrows, move both start and end points
                    if (obj.type === 'shape' &&
                        (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
                        const deltaX = newX - obj.x;
                        const deltaY = newY - obj.y;

                        if (obj.x2 !== undefined) {
                            obj.x2 += deltaX;
                        }
                        if (obj.y2 !== undefined) {
                            obj.y2 += deltaY;
                        }
                        obj.x = newX;
                        obj.y = newY;
                    } else {
                        // Normal objects just move x and y
                        obj.x = newX;
                        obj.y = newY;
                    }
                }
            });

            this.needsRender = true;
        } else if (this.isPanning) {
            const dx = e.clientX - this.lastPanPoint.x;
            const dy = e.clientY - this.lastPanPoint.y;
            this.pan.x += dx;
            this.pan.y += dy;
            this.lastPanPoint = { x: e.clientX, y: e.clientY };
            this.needsRender = true;
        } else if (this.selectedGroup) {
            const bounds = this.getGroupBounds();
            if (bounds) {
                const handle = this.getResizeHandleForBounds(x, y, bounds);
                this.canvas.style.cursor = handle ? this.getResizeCursor(handle) : 'default';
            }
        } else if (this.selectedImage && this.selectedImage.visible !== false) {
            const handle = this.getResizeHandle(x, y, this.selectedImage);
            this.canvas.style.cursor = handle ? this.getResizeCursor(handle) : 'default';
        } else if (this.objectsManager.selectedObject && this.objectsManager.selectedObjects.length === 1) {
            // Check for object resize handles
            const handle = this.objectsManager.getResizeHandleAtPoint(this.objectsManager.selectedObject, x, y);
            this.canvas.style.cursor = handle ? this.getResizeCursor(handle) : 'default';
        }
    }

    onMouseUp(e) {
        // Handle crop mode
        if (this.isCropping && this.cropHandle) {
            this.cropHandle = null;
            return;
        }

        // Handle text/shape objects
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.objectsManager.handleMouseUp(e, { x, y });

        // Handle drawing mode
        if (this.isDrawing) {
            this.endDrawing();
            return;
        }

        const wasModifying = this.isDragging || this.isResizing || this.isRotating;
        const wasDragging = this.isDragging;
        const wasResizing = this.isResizing;
        const wasRotating = this.isRotating;

        if (wasDragging && this.historyManager) {
            const moveActions = [];

            // Save history for all moved images using tracked start positions
            if (this.dragStartPositions && this.dragStartPositions.size > 0) {
                for (const img of this.selectedImages) {
                    const startPos = this.dragStartPositions.get(img.id);
                    if (startPos && (startPos.x !== img.x || startPos.y !== img.y)) {
                        moveActions.push({
                            type: 'image',
                            id: img.id,
                            oldX: startPos.x,
                            oldY: startPos.y,
                            newX: img.x,
                            newY: img.y
                        });
                    }
                }
            }

            // Save history for all moved objects using tracked start positions
            if (this.objectDragStartPositions && this.objectDragStartPositions.length > 0) {
                for (const objStart of this.objectDragStartPositions) {
                    const obj = this.objectsManager.objects.find(o => o.id === objStart.id);
                    if (obj) {
                        const hasChanged = objStart.x !== obj.x || objStart.y !== obj.y ||
                                         objStart.x2 !== obj.x2 || objStart.y2 !== obj.y2;

                        if (hasChanged) {
                            moveActions.push({
                                type: 'object',
                                id: obj.id,
                                oldX: objStart.x,
                                oldY: objStart.y,
                                oldX2: objStart.x2,
                                oldY2: objStart.y2,
                                newX: obj.x,
                                newY: obj.y,
                                newX2: obj.x2,
                                newY2: obj.y2
                            });
                        }
                    }
                }
            }

            if (moveActions.length > 0) {
                this.historyManager.pushAction({
                    type: 'move_multiple',
                    data: moveActions
                });
            }
        }

        if (wasResizing && this.selectedImage && this.resizeStartData && this.historyManager) {
            if (this.resizeStartData.width !== this.selectedImage.width || this.resizeStartData.height !== this.selectedImage.height) {
                this.historyManager.pushAction({
                    type: 'resize',
                    data: {
                        id: this.selectedImage.id,
                        oldWidth: this.resizeStartData.width,
                        oldHeight: this.resizeStartData.height,
                        newWidth: this.selectedImage.width,
                        newHeight: this.selectedImage.height
                    }
                });
            }
        }

        if (this.isBoxSelecting && this.selectionBox) {
            const box = this.selectionBox;
            const boxX = Math.min(box.startX, box.endX);
            const boxY = Math.min(box.startY, box.endY);
            const boxWidth = Math.abs(box.endX - box.startX);
            const boxHeight = Math.abs(box.endY - box.startY);

            if (boxWidth > 5 && boxHeight > 5) {
                this.selectImagesInBox(boxX, boxY, boxWidth, boxHeight);
            }
        }

        const wasPanning = this.isPanning;

        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
        this.rotatingImage = null;
        this.isPanning = false;
        this.isBoxSelecting = false;
        this.selectionBox = null;
        this.resizeHandle = null;
        this.resizeStartData = null;
        this.dragStartPosition = null;
        this.objectDragOffsets = [];
        this.snapLines = [];
        this.canvas.style.cursor = 'default';

        if (wasModifying) {
            this.needsRender = true;
            this.notifyChange();
        }

        if (wasPanning) {
            this.canvas.dispatchEvent(new CustomEvent('viewChanged'));
        }
    }

    onDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.objectsManager.handleDoubleClick(e, { x, y });
    }

    onContextMenu(e) {
        e.preventDefault();
        // Don't stopPropagation - let it bubble to editor.js handler
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

        // Check if right-clicking on an image
        const clickedImage = this.getImageAtPoint(x, y);

        // Store the clicked image for the context menu to use
        this.contextMenuImage = clickedImage;

        // Let the regular context menu handler in editor.js handle this
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = this.zoom * delta;
        
        
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        this.pan.x = mouseX - (mouseX - this.pan.x) * (newZoom / this.zoom);
        this.pan.y = mouseY - (mouseY - this.pan.y) * (newZoom / this.zoom);
        this.zoom = newZoom;

        this.needsRender = true;
        this.canvas.dispatchEvent(new CustomEvent('viewChanged'));
    }

    onDrop(e) {
        e.preventDefault();
        this.hideDragOverlay();

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(f => f.type.startsWith('image/'));

        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

        imageFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    this.addImage(img, x, y, file.name);
                    this.addToAssets(img, event.target.result, file.name);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    addToAssets(img, src, name) {
        const board = window.boardManagerInstance?.currentBoard;
        if (!board) return;

        const currentAssets = board.assets || [];

        const assetExists = currentAssets.some(a => a.name === name);
        if (assetExists) return;

        const updatedAssets = [...currentAssets, {
            id: Date.now() + Math.random(),
            src: src,
            name: name
        }];

        if (window.boardManagerInstance && window.currentBoardId) {
            window.boardManagerInstance.updateBoard(window.currentBoardId, { assets: updatedAssets });
        }
        
        if (window.renderAssetsCallback) {
            window.renderAssetsCallback();
        }
    }

    showDragOverlay() {
        let overlay = document.getElementById('drop-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'drop-overlay';
            overlay.innerHTML = '<div class="drop-message">Release to Drop Image onto Board</div>';
            
            if (!document.querySelector('#drop-overlay-styles')) {
                const style = document.createElement('style');
                style.id = 'drop-overlay-styles';
                style.textContent = `
                    #drop-overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.6);
                        backdrop-filter: blur(2px);
                        z-index: 9999;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        pointer-events: none;
                        animation: dropOverlayFadeIn 0.2s ease;
                    }
                    
                    @keyframes dropOverlayFadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    
                    .drop-message {
                        background: white;
                        color: #1a1a1a;
                        padding: 24px 40px;
                        border-radius: 12px;
                        font-size: 18px;
                        font-weight: 600;
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                        border: 2px solid #0066ff;
                    }
                `;
                document.head.appendChild(style);
            }
            
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    }

    hideDragOverlay() {
        const overlay = document.getElementById('drop-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    addImage(img, x, y, name = 'Layer', width = null, height = null) {
        const imageData = {
            id: Date.now() + Math.random(),
            name: name || `Layer ${this.images.length + 1}`,
            img,
            x,
            y,
            width: width || img.width,
            height: height || img.height,
            rotation: 0,
            visible: true
        };
        this.images.push(imageData);
        this.selectImage(imageData);
        this.invalidateCullCache();
        this.needsRender = true;
        this.render();
        this.notifyChange();

        if (this.historyManager) {
            this.historyManager.pushAction({
                type: 'add_image',
                data: {
                    id: imageData.id,
                    name: imageData.name,
                    src: img.src,
                    x: imageData.x,
                    y: imageData.y,
                    width: imageData.width,
                    height: imageData.height,
                    visible: imageData.visible
                }
            });
        }

        return imageData;
    }

    addImageSilent(img, x, y, name = 'Layer', width = null, height = null, visible = true) {
        const imageData = {
            id: Date.now() + Math.random(),
            name: name || `Layer ${this.images.length + 1}`,
            img,
            x,
            y,
            width: width || img.width,
            height: height || img.height,
            rotation: 0,
            visible: visible
        };
        this.images.push(imageData);
        this.needsRender = true;
        return imageData;
    }

    selectImage(img, multiSelect = false) {
        if (!multiSelect) {
            this.selectedImage = img;
            this.selectedImages = img ? [img] : [];
        } else if (img) {
            const index = this.selectedImages.findIndex(i => i.id === img.id);
            if (index >= 0) {
                this.selectedImages.splice(index, 1);
                if (this.selectedImages.length === 0) {
                    this.selectedImage = null;
                } else {
                    this.selectedImage = this.selectedImages[this.selectedImages.length - 1];
                }
            } else {
                this.selectedImages.push(img);
                this.selectedImage = img;
            }
        }
        this.needsRender = true;
        this.canvas.dispatchEvent(new CustomEvent('imageSelected', { detail: img }));
    }

    selectImagesInRange(startImg, endImg) {
        const startIndex = this.images.indexOf(startImg);
        const endIndex = this.images.indexOf(endImg);
        if (startIndex === -1 || endIndex === -1) return;

        const min = Math.min(startIndex, endIndex);
        const max = Math.max(startIndex, endIndex);

        this.selectedImages = [];
        for (let i = min; i <= max; i++) {
            if (this.images[i].visible !== false) {
                this.selectedImages.push(this.images[i]);
            }
        }
        this.selectedImage = this.selectedImages[this.selectedImages.length - 1];
        this.needsRender = true;
        this.canvas.dispatchEvent(new CustomEvent('imageSelected', { detail: this.selectedImage }));
    }

    selectImagesInBox(boxX, boxY, boxWidth, boxHeight) {
        this.selectedImages = [];
        const boxRight = boxX + boxWidth;
        const boxBottom = boxY + boxHeight;

        // Select images in box
        for (const img of this.images) {
            if (img.visible === false) continue;

            const imgRight = img.x + img.width;
            const imgBottom = img.y + img.height;

            if (img.x < boxRight && imgRight > boxX && img.y < boxBottom && imgBottom > boxY) {
                this.selectedImages.push(img);
            }
        }

        // Also select objects in box
        const objectsInBox = [];
        for (const obj of this.objectsManager.objects) {
            if (obj.visible === false) continue;

            const objRight = obj.x + (obj.width || 0);
            const objBottom = obj.y + (obj.height || 0);

            if (obj.x < boxRight && objRight > boxX && obj.y < boxBottom && objBottom > boxY) {
                objectsInBox.push(obj);
            }
        }

        // Update objects manager selection
        if (objectsInBox.length > 0) {
            this.objectsManager.selectedObjects = objectsInBox;
            this.objectsManager.selectedObject = objectsInBox[objectsInBox.length - 1];
        } else {
            this.objectsManager.selectedObjects = [];
            this.objectsManager.selectedObject = null;
        }

        this.selectedImage = this.selectedImages.length > 0 ? this.selectedImages[this.selectedImages.length - 1] : null;
        this.needsRender = true;
    }

    deleteSelectedImages() {
        if (this.selectedImages.length === 0) return;

        const idsToDelete = this.selectedImages.map(img => img.id);
        for (const id of idsToDelete) {
            this.deleteImage(id);
        }
        this.selectedImages = [];
        this.selectedImage = null;
        this.invalidateCullCache();
        this.needsRender = true;
        this.render();
    }

    isImageSelected(img) {
        return this.selectedImages.some(i => i.id === img.id);
    }


    deleteImage(id, skipHistory = false) {
        const img = this.images.find(img => img.id === id);
        if (!img) return;

        if (this.historyManager && !skipHistory) {
            this.historyManager.pushAction({
                type: 'delete_image',
                data: {
                    id: img.id,
                    name: img.name,
                    src: img.img.src,
                    x: img.x,
                    y: img.y,
                    width: img.width,
                    height: img.height,
                    visible: img.visible
                }
            });
        }

        this.images = this.images.filter(img => img.id !== id);

        if (this.selectedImage && this.selectedImage.id === id) {
            this.selectedImage = null;
        }

        this.invalidateCullCache();
        this.needsRender = true;
        this.render();
        if (!skipHistory) {
            this.notifyChange();
        }
    }

    toggleVisibility(id) {
        const img = this.images.find(img => img.id === id);
        if (img) {
            const oldVisible = img.visible;
            img.visible = !img.visible;

            if (this.historyManager) {
                this.historyManager.pushAction({
                    type: 'visibility',
                    data: {
                        id: img.id,
                        oldVisible: oldVisible,
                        newVisible: img.visible
                    }
                });
            }

            if (this.selectedImage && this.selectedImage.id === id && !img.visible) {
                this.selectedImage = null;
            }
            this.lastCullZoom = -999;
            this.needsRender = true;
            this.notifyChange();
        }
    }

    reorderLayers(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const [item] = this.images.splice(fromIndex, 1);
        this.images.splice(toIndex, 0, item);
        this.needsRender = true;
        this.notifyChange();
    }

    moveLayer(id, direction) {
        const index = this.images.findIndex(img => img.id === id);
        if (index === -1) return;
        
        if (direction === 'up' && index < this.images.length - 1) {
            [this.images[index], this.images[index + 1]] = [this.images[index + 1], this.images[index]];
        } else if (direction === 'down' && index > 0) {
            [this.images[index], this.images[index - 1]] = [this.images[index - 1], this.images[index]];
        }
        
        this.needsRender = true;
        this.notifyChange();
    }

    renameLayer(id, newName, skipHistory = false) {
        const img = this.images.find(img => img.id === id);
        if (img) {
            const oldName = img.name;
            img.name = newName;

            if (this.historyManager && !skipHistory && oldName !== newName) {
                this.historyManager.pushAction({
                    type: 'rename',
                    data: {
                        id: img.id,
                        oldName: oldName,
                        newName: newName
                    }
                });
            }
        }
    }

    snapToObjects(x, y, draggedObject) {
        const threshold = this.snapThreshold / this.zoom;
        const guides = [];
        let snappedX = x;
        let snappedY = y;
        let snapDistX = Infinity;
        let snapDistY = Infinity;

        const draggedLeft = x;
        const draggedRight = x + draggedObject.width;
        const draggedTop = y;
        const draggedBottom = y + draggedObject.height;
        const draggedCenterX = x + draggedObject.width / 2;
        const draggedCenterY = y + draggedObject.height / 2;

        // Snap to images
        for (const img of this.images) {
            if (img.visible === false) continue;

            const targetLeft = img.x;
            const targetRight = img.x + img.width;
            const targetTop = img.y;
            const targetBottom = img.y + img.height;
            const targetCenterX = img.x + img.width / 2;
            const targetCenterY = img.y + img.height / 2;

            const xChecks = [
                { dragPos: draggedLeft, targetPos: targetLeft, offset: 0 },
                { dragPos: draggedLeft, targetPos: targetRight, offset: 0 },
                { dragPos: draggedRight, targetPos: targetLeft, offset: -draggedObject.width },
                { dragPos: draggedRight, targetPos: targetRight, offset: -draggedObject.width },
                { dragPos: draggedCenterX, targetPos: targetCenterX, offset: -draggedObject.width / 2 }
            ];

            for (const check of xChecks) {
                const dist = Math.abs(check.dragPos - check.targetPos);
                if (dist < threshold && dist < snapDistX) {
                    snappedX = check.targetPos + check.offset;
                    snapDistX = dist;
                    guides.push({
                        type: 'vertical',
                        pos: check.targetPos
                    });
                }
            }

            const yChecks = [
                { dragPos: draggedTop, targetPos: targetTop, offset: 0 },
                { dragPos: draggedTop, targetPos: targetBottom, offset: 0 },
                { dragPos: draggedBottom, targetPos: targetTop, offset: -draggedObject.height },
                { dragPos: draggedBottom, targetPos: targetBottom, offset: -draggedObject.height },
                { dragPos: draggedCenterY, targetPos: targetCenterY, offset: -draggedObject.height / 2 }
            ];

            for (const check of yChecks) {
                const dist = Math.abs(check.dragPos - check.targetPos);
                if (dist < threshold && dist < snapDistY) {
                    snappedY = check.targetPos + check.offset;
                    snapDistY = dist;
                    guides.push({
                        type: 'horizontal',
                        pos: check.targetPos
                    });
                }
            }
        }

        // Snap to other objects
        for (const obj of this.objectsManager.getObjects()) {
            if (obj.id === draggedObject.id || obj.visible === false) continue;

            const targetLeft = obj.x;
            const targetRight = obj.x + obj.width;
            const targetTop = obj.y;
            const targetBottom = obj.y + obj.height;
            const targetCenterX = obj.x + obj.width / 2;
            const targetCenterY = obj.y + obj.height / 2;

            const xChecks = [
                { dragPos: draggedLeft, targetPos: targetLeft, offset: 0 },
                { dragPos: draggedLeft, targetPos: targetRight, offset: 0 },
                { dragPos: draggedRight, targetPos: targetLeft, offset: -draggedObject.width },
                { dragPos: draggedRight, targetPos: targetRight, offset: -draggedObject.width },
                { dragPos: draggedCenterX, targetPos: targetCenterX, offset: -draggedObject.width / 2 }
            ];

            for (const check of xChecks) {
                const dist = Math.abs(check.dragPos - check.targetPos);
                if (dist < threshold && dist < snapDistX) {
                    snappedX = check.targetPos + check.offset;
                    snapDistX = dist;
                    guides.push({
                        type: 'vertical',
                        pos: check.targetPos
                    });
                }
            }

            const yChecks = [
                { dragPos: draggedTop, targetPos: targetTop, offset: 0 },
                { dragPos: draggedTop, targetPos: targetBottom, offset: 0 },
                { dragPos: draggedBottom, targetPos: targetTop, offset: -draggedObject.height },
                { dragPos: draggedBottom, targetPos: targetBottom, offset: -draggedObject.height },
                { dragPos: draggedCenterY, targetPos: targetCenterY, offset: -draggedObject.height / 2 }
            ];

            for (const check of yChecks) {
                const dist = Math.abs(check.dragPos - check.targetPos);
                if (dist < threshold && dist < snapDistY) {
                    snappedY = check.targetPos + check.offset;
                    snapDistY = dist;
                    guides.push({
                        type: 'horizontal',
                        pos: check.targetPos
                    });
                }
            }
        }

        const activeGuides = [];
        if (snapDistX < threshold) {
            activeGuides.push(...guides.filter(g => g.type === 'vertical'));
        }
        if (snapDistY < threshold) {
            activeGuides.push(...guides.filter(g => g.type === 'horizontal'));
        }

        return { x: snappedX, y: snappedY, guides: activeGuides };
    }

    snapToImages(x, y, draggedImage) {
        const threshold = this.snapThreshold / this.zoom;
        const guides = [];
        let snappedX = x;
        let snappedY = y;
        let snapDistX = Infinity;
        let snapDistY = Infinity;

        const draggedLeft = x;
        const draggedRight = x + draggedImage.width;
        const draggedTop = y;
        const draggedBottom = y + draggedImage.height;
        const draggedCenterX = x + draggedImage.width / 2;
        const draggedCenterY = y + draggedImage.height / 2;

        for (const img of this.images) {
            if (img.id === draggedImage.id || img.visible === false) continue;

            const targetLeft = img.x;
            const targetRight = img.x + img.width;
            const targetTop = img.y;
            const targetBottom = img.y + img.height;
            const targetCenterX = img.x + img.width / 2;
            const targetCenterY = img.y + img.height / 2;
            
            const xChecks = [
                { dragPos: draggedLeft, targetPos: targetLeft, offset: 0 },
                { dragPos: draggedLeft, targetPos: targetRight, offset: 0 },
                { dragPos: draggedRight, targetPos: targetLeft, offset: -draggedImage.width },
                { dragPos: draggedRight, targetPos: targetRight, offset: -draggedImage.width },
                { dragPos: draggedCenterX, targetPos: targetCenterX, offset: -draggedImage.width / 2 }
            ];
            
            for (const check of xChecks) {
                const dist = Math.abs(check.dragPos - check.targetPos);
                if (dist < threshold && dist < snapDistX) {
                    snappedX = check.targetPos + check.offset;
                    snapDistX = dist;
                    guides.push({
                        type: 'vertical',
                        pos: check.targetPos
                    });
                }
            }
            
            const yChecks = [
                { dragPos: draggedTop, targetPos: targetTop, offset: 0 },
                { dragPos: draggedTop, targetPos: targetBottom, offset: 0 },
                { dragPos: draggedBottom, targetPos: targetTop, offset: -draggedImage.height },
                { dragPos: draggedBottom, targetPos: targetBottom, offset: -draggedImage.height },
                { dragPos: draggedCenterY, targetPos: targetCenterY, offset: -draggedImage.height / 2 }
            ];
            
            for (const check of yChecks) {
                const dist = Math.abs(check.dragPos - check.targetPos);
                if (dist < threshold && dist < snapDistY) {
                    snappedY = check.targetPos + check.offset;
                    snapDistY = dist;
                    guides.push({
                        type: 'horizontal',
                        pos: check.targetPos
                    });
                }
            }
        }
        
        const activeGuides = [];
        if (snapDistX < threshold) {
            activeGuides.push(...guides.filter(g => g.type === 'vertical'));
        }
        if (snapDistY < threshold) {
            activeGuides.push(...guides.filter(g => g.type === 'horizontal'));
        }
        
        return { x: snappedX, y: snappedY, guides: activeGuides };
    }

    getResizeHandle(x, y, img) {
        if (!img || img.visible === false) return null;
        
        const handleSize = 10 / this.zoom;
        const midX = img.x + img.width / 2;
        const midY = img.y + img.height / 2;
        
        const handles = [
            { name: 'nw', x: img.x, y: img.y },
            { name: 'n', x: midX, y: img.y },
            { name: 'ne', x: img.x + img.width, y: img.y },
            { name: 'e', x: img.x + img.width, y: midY },
            { name: 'se', x: img.x + img.width, y: img.y + img.height },
            { name: 's', x: midX, y: img.y + img.height },
            { name: 'sw', x: img.x, y: img.y + img.height },
            { name: 'w', x: img.x, y: midY }
        ];
        
        for (const handle of handles) {
            if (Math.abs(x - handle.x) < handleSize && Math.abs(y - handle.y) < handleSize) {
                return handle.name;
            }
        }
        return null;
    }

    getResizeHandleForBounds(x, y, bounds) {
        if (!bounds) return null;

        const handleSize = 10 / this.zoom;
        const midX = bounds.x + bounds.width / 2;
        const midY = bounds.y + bounds.height / 2;

        const handles = [
            { name: 'nw', x: bounds.x, y: bounds.y },
            { name: 'n', x: midX, y: bounds.y },
            { name: 'ne', x: bounds.x + bounds.width, y: bounds.y },
            { name: 'e', x: bounds.x + bounds.width, y: midY },
            { name: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height },
            { name: 's', x: midX, y: bounds.y + bounds.height },
            { name: 'sw', x: bounds.x, y: bounds.y + bounds.height },
            { name: 'w', x: bounds.x, y: midY }
        ];

        for (const handle of handles) {
            if (Math.abs(x - handle.x) < handleSize && Math.abs(y - handle.y) < handleSize) {
                return handle.name;
            }
        }
        return null;
    }

    getResizeCursor(handle) {
        const cursors = {
            'nw': 'nw-resize', 'n': 'n-resize', 'ne': 'ne-resize',
            'e': 'e-resize', 'se': 'se-resize', 's': 's-resize',
            'sw': 'sw-resize', 'w': 'w-resize',
            'start': 'move', 'end': 'move' // For line/arrow endpoints
        };
        return cursors[handle] || 'default';
    }

    isPointOnRotationHandle(x, y, bounds) {
        if (!bounds) return false;

        const handleSize = 10 / this.zoom;
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const rotationHandleOffset = 30 / this.zoom;

        // Calculate handle position
        let handleX = centerX;
        let handleY = bounds.y - rotationHandleOffset;

        // If bounds has rotation, rotate the handle position around the center
        if (bounds.rotation && bounds.rotation !== 0) {
            const angleRad = (bounds.rotation * Math.PI) / 180;
            const dx = handleX - centerX;
            const dy = handleY - centerY;
            const rotatedDx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
            const rotatedDy = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
            handleX = centerX + rotatedDx;
            handleY = centerY + rotatedDy;
        }

        const dx = x - handleX;
        const dy = y - handleY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        return distance < handleSize;
    }

    isPointInBounds(x, y, bounds) {
        if (!bounds) return false;
        return x >= bounds.x && x <= bounds.x + bounds.width &&
               y >= bounds.y && y <= bounds.y + bounds.height;
    }

    resizeImage(x, y) {
        const img = this.selectedImage;
        if (!img || !this.resizeStartData) return;

        const start = this.resizeStartData;
        const minSize = 20;
        const isCorner = ['nw', 'ne', 'sw', 'se'].includes(this.resizeHandle);

        if (isCorner) {
            if (this.resizeHandle === 'se') {
                const newWidth = Math.max(minSize, x - start.x);
                const newHeight = newWidth / start.aspectRatio;
                img.width = newWidth;
                img.height = newHeight;
            } else if (this.resizeHandle === 'sw') {
                const newWidth = Math.max(minSize, start.x + start.width - x);
                const newHeight = newWidth / start.aspectRatio;
                img.x = start.x + start.width - newWidth;
                img.width = newWidth;
                img.height = newHeight;
            } else if (this.resizeHandle === 'ne') {
                const newWidth = Math.max(minSize, x - start.x);
                const newHeight = newWidth / start.aspectRatio;
                img.y = start.y + start.height - newHeight;
                img.width = newWidth;
                img.height = newHeight;
            } else if (this.resizeHandle === 'nw') {
                const newWidth = Math.max(minSize, start.x + start.width - x);
                const newHeight = newWidth / start.aspectRatio;
                img.x = start.x + start.width - newWidth;
                img.y = start.y + start.height - newHeight;
                img.width = newWidth;
                img.height = newHeight;
            }
        } else {
            if (this.resizeHandle === 'e') {
                img.width = Math.max(minSize, x - img.x);
            } else if (this.resizeHandle === 'w') {
                const newWidth = Math.max(minSize, img.x + img.width - x);
                img.x = img.x + img.width - newWidth;
                img.width = newWidth;
            } else if (this.resizeHandle === 's') {
                img.height = Math.max(minSize, y - img.y);
            } else if (this.resizeHandle === 'n') {
                const newHeight = Math.max(minSize, img.y + img.height - y);
                img.y = img.y + img.height - newHeight;
                img.height = newHeight;
            }
        }
    }

    resizeGroup(x, y) {
        if (!this.resizeStartData || !this.resizeStartData.itemStates) return;

        const start = this.resizeStartData;
        const handle = this.resizeHandle;

        // Calculate new bounds based on handle
        let newBounds = { ...start };

        // Use corner resize for proportional scaling
        const isCorner = ['nw', 'ne', 'sw', 'se'].includes(handle);

        if (isCorner) {
            // Proportional resize maintaining aspect ratio
            if (handle === 'se') {
                const newWidth = Math.max(20, x - start.x);
                const newHeight = newWidth / start.aspectRatio;
                newBounds.width = newWidth;
                newBounds.height = newHeight;
            } else if (handle === 'sw') {
                const newWidth = Math.max(20, start.x + start.width - x);
                const newHeight = newWidth / start.aspectRatio;
                newBounds.x = start.x + start.width - newWidth;
                newBounds.width = newWidth;
                newBounds.height = newHeight;
            } else if (handle === 'ne') {
                const newWidth = Math.max(20, x - start.x);
                const newHeight = newWidth / start.aspectRatio;
                newBounds.y = start.y + start.height - newHeight;
                newBounds.width = newWidth;
                newBounds.height = newHeight;
            } else if (handle === 'nw') {
                const newWidth = Math.max(20, start.x + start.width - x);
                const newHeight = newWidth / start.aspectRatio;
                newBounds.x = start.x + start.width - newWidth;
                newBounds.y = start.y + start.height - newHeight;
                newBounds.width = newWidth;
                newBounds.height = newHeight;
            }
        } else {
            // Edge resize (non-proportional)
            if (handle === 'e') {
                newBounds.width = Math.max(20, x - start.x);
            } else if (handle === 'w') {
                const newWidth = Math.max(20, start.x + start.width - x);
                newBounds.x = start.x + start.width - newWidth;
                newBounds.width = newWidth;
            } else if (handle === 's') {
                newBounds.height = Math.max(20, y - start.y);
            } else if (handle === 'n') {
                const newHeight = Math.max(20, start.y + start.height - y);
                newBounds.y = start.y + start.height - newHeight;
                newBounds.height = newHeight;
            }
        }

        // Calculate scale factors
        const scaleX = newBounds.width / start.width;
        const scaleY = newBounds.height / start.height;

        // Apply scaling to all items
        for (const state of start.itemStates) {
            const item = state.item;

            // Calculate relative position within original bounds
            const relX = (state.x - start.x) / start.width;
            const relY = (state.y - start.y) / start.height;
            const relWidth = state.width / start.width;
            const relHeight = state.height / start.height;

            // Apply to new bounds
            item.x = newBounds.x + relX * newBounds.width;
            item.y = newBounds.y + relY * newBounds.height;
            item.width = relWidth * newBounds.width;
            item.height = relHeight * newBounds.height;

            // For lines/arrows, also scale x2/y2
            if (state.type === 'object' && state.item.type === 'shape' &&
                (state.item.shapeType === 'line' || state.item.shapeType === 'arrow')) {
                if (state.x2 !== undefined) {
                    const relX2 = (state.x2 - start.x) / start.width;
                    item.x2 = newBounds.x + relX2 * newBounds.width;
                }
                if (state.y2 !== undefined) {
                    const relY2 = (state.y2 - start.y) / start.height;
                    item.y2 = newBounds.y + relY2 * newBounds.height;
                }
            }
        }
    }

    enableRotationMode(image, startMouseX, startMouseY) {
        this.isRotating = true;
        this.rotatingImage = image;
        this.canvas.style.cursor = 'grab';

        // Get all items to rotate (images and objects)
        const allItems = [...this.selectedImages, ...this.objectsManager.selectedObjects];

        // Calculate center of all selected items (or single item)
        let centerX, centerY;
        if (allItems.length > 1 || this.selectedGroup) {
            // Calculate center of bounding box for group/multi-select
            const bounds = this.getGroupBounds();
            if (bounds) {
                centerX = bounds.x + bounds.width / 2;
                centerY = bounds.y + bounds.height / 2;
            } else {
                centerX = image.x + image.width / 2;
                centerY = image.y + image.height / 2;
            }
        } else {
            // Single item rotation
            centerX = image.x + image.width / 2;
            centerY = image.y + image.height / 2;
        }

        // Store the starting rotation and starting mouse angle
        this.rotationCenter = { x: centerX, y: centerY };
        this.rotationStartAngle = Math.atan2(startMouseY - centerY, startMouseX - centerX);

        // Store initial rotation for all items
        this.rotationStartStates = [];
        for (const img of this.selectedImages) {
            this.rotationStartStates.push({
                item: img,
                type: 'image',
                rotation: img.rotation || 0,
                x: img.x,
                y: img.y,
                centerX: img.x + img.width / 2,
                centerY: img.y + img.height / 2
            });
        }
        for (const obj of this.objectsManager.selectedObjects) {
            this.rotationStartStates.push({
                item: obj,
                type: 'object',
                rotation: obj.rotation || 0,
                x: obj.x,
                y: obj.y,
                x2: obj.x2,
                y2: obj.y2,
                centerX: obj.x + (obj.width || 0) / 2,
                centerY: obj.y + (obj.height || 0) / 2
            });
        }
    }

    rotateImage(mouseX, mouseY) {
        if (!this.rotatingImage || !this.rotationStartStates) return;

        // Calculate current angle from rotation center
        const currentAngle = Math.atan2(mouseY - this.rotationCenter.y, mouseX - this.rotationCenter.x);

        // Calculate the delta from the starting angle
        const angleDelta = currentAngle - this.rotationStartAngle;
        const deltaDegrees = angleDelta * (180 / Math.PI);
        const angleRad = angleDelta;

        // Apply rotation to all items
        for (const state of this.rotationStartStates) {
            const item = state.item;

            // Update item rotation
            item.rotation = state.rotation + deltaDegrees;

            // If multiple items, rotate positions around common center
            if (this.rotationStartStates.length > 1 || this.selectedGroup) {
                // Calculate original offset from rotation center
                const dx = state.centerX - this.rotationCenter.x;
                const dy = state.centerY - this.rotationCenter.y;

                // Rotate the offset
                const rotatedDx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
                const rotatedDy = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);

                // Update position based on rotated offset
                if (state.type === 'image') {
                    item.x = this.rotationCenter.x + rotatedDx - item.width / 2;
                    item.y = this.rotationCenter.y + rotatedDy - item.height / 2;
                } else if (state.type === 'object') {
                    const newCenterX = this.rotationCenter.x + rotatedDx;
                    const newCenterY = this.rotationCenter.y + rotatedDy;

                    // Update position for shapes
                    if (item.type === 'shape' && (item.shapeType === 'line' || item.shapeType === 'arrow')) {
                        // For lines/arrows, rotate both endpoints around the rotation center
                        const dx1 = state.x - this.rotationCenter.x;
                        const dy1 = state.y - this.rotationCenter.y;
                        const dx2 = state.x2 - this.rotationCenter.x;
                        const dy2 = state.y2 - this.rotationCenter.y;

                        item.x = this.rotationCenter.x + dx1 * Math.cos(angleRad) - dy1 * Math.sin(angleRad);
                        item.y = this.rotationCenter.y + dx1 * Math.sin(angleRad) + dy1 * Math.cos(angleRad);
                        item.x2 = this.rotationCenter.x + dx2 * Math.cos(angleRad) - dy2 * Math.sin(angleRad);
                        item.y2 = this.rotationCenter.y + dx2 * Math.sin(angleRad) + dy2 * Math.cos(angleRad);
                    } else {
                        item.x = newCenterX - (item.width || 0) / 2;
                        item.y = newCenterY - (item.height || 0) / 2;
                    }
                }
            }
        }

        this.needsRender = true;
    }

    enableCropMode(image) {
        if (!image || image.type === 'drawing') return;

        this.isCropping = true;
        this.croppingImage = image;
        this.cropRect = {
            x: image.x,
            y: image.y,
            width: image.width,
            height: image.height
        };
        this.cropStartRect = { ...this.cropRect };
        this.canvas.style.cursor = 'crosshair';
        this.needsRender = true;
    }

    updateCrop(handle, mouseX, mouseY) {
        if (!this.isCropping || !this.croppingImage) return;

        const img = this.croppingImage;
        const rect = this.cropRect;

        if (handle === 'move') {
            // Move crop area
            const dx = mouseX - this.dragStartPoint.x;
            const dy = mouseY - this.dragStartPoint.y;
            rect.x = Math.max(img.x, Math.min(img.x + img.width - rect.width, this.cropStartRect.x + dx));
            rect.y = Math.max(img.y, Math.min(img.y + img.height - rect.height, this.cropStartRect.y + dy));
        } else {
            // Resize crop area
            const minSize = 20;

            if (handle.includes('n')) {
                const newY = Math.max(img.y, Math.min(mouseY, rect.y + rect.height - minSize));
                rect.height += rect.y - newY;
                rect.y = newY;
            }
            if (handle.includes('s')) {
                rect.height = Math.max(minSize, Math.min(mouseY - rect.y, img.y + img.height - rect.y));
            }
            if (handle.includes('w')) {
                const newX = Math.max(img.x, Math.min(mouseX, rect.x + rect.width - minSize));
                rect.width += rect.x - newX;
                rect.x = newX;
            }
            if (handle.includes('e')) {
                rect.width = Math.max(minSize, Math.min(mouseX - rect.x, img.x + img.width - rect.x));
            }
        }

        this.needsRender = true;
    }

    applyCrop() {
        if (!this.isCropping || !this.croppingImage) return;

        // Prevent multiple applications - save references then exit crop mode immediately
        const img = this.croppingImage;
        const rect = { ...this.cropRect };

        // Exit crop mode immediately to prevent multiple clicks
        this.cancelCrop();

        // Store original image data if this is the first crop
        if (!img.originalSrc) {
            img.originalSrc = img.src || img.img.src;
            img.originalWidth = img.width;
            img.originalHeight = img.height;
            img.originalNaturalWidth = img.img.naturalWidth;
            img.originalNaturalHeight = img.img.naturalHeight;
            img.originalImg = img.img;
        }

        // Calculate crop offsets relative to the CURRENT display dimensions
        const cropX = (rect.x - img.x) / img.width;
        const cropY = (rect.y - img.y) / img.height;
        const cropW = rect.width / img.width;
        const cropH = rect.height / img.height;

        // Save old crop data for history
        const oldCropData = img.cropData ? { ...img.cropData } : null;
        const oldX = img.x;
        const oldY = img.y;
        const oldWidth = img.width;
        const oldHeight = img.height;

        // If there's existing crop data, we need to combine it with the new crop
        if (img.cropData) {
            // Calculate new crop relative to original image
            const { offsetX, offsetY, cropWidth, cropHeight } = img.cropData;
            img.cropData = {
                offsetX: offsetX + cropX * cropWidth,
                offsetY: offsetY + cropY * cropHeight,
                cropWidth: cropW * cropWidth,
                cropHeight: cropH * cropHeight
            };
        } else {
            // First crop - store as ratios of original image
            img.cropData = {
                offsetX: cropX,
                offsetY: cropY,
                cropWidth: cropW,
                cropHeight: cropH
            };
        }

        // Update image display dimensions
        img.x = rect.x;
        img.y = rect.y;
        img.width = rect.width;
        img.height = rect.height;

        // Save to history for undo
        if (this.historyManager) {
            this.historyManager.pushAction({
                type: 'crop',
                data: {
                    id: img.id,
                    oldCropData: oldCropData,
                    newCropData: { ...img.cropData },
                    oldX: oldX,
                    oldY: oldY,
                    oldWidth: oldWidth,
                    oldHeight: oldHeight,
                    newX: rect.x,
                    newY: rect.y,
                    newWidth: rect.width,
                    newHeight: rect.height
                }
            });
        }

        this.needsRender = true;
        this.notifyChange();
    }

    uncropImage(img) {
        if (!img || !img.originalSrc) return; // No crop to revert

        // Save old state for history
        const oldCropData = img.cropData ? { ...img.cropData } : null;
        const oldX = img.x;
        const oldY = img.y;
        const oldWidth = img.width;
        const oldHeight = img.height;

        // Restore original image
        img.cropData = null;
        img.width = img.originalWidth;
        img.height = img.originalHeight;

        // Keep the current position, or could reset to original if desired
        // For now, keep current position for better UX

        // Save to history for undo
        if (this.historyManager) {
            this.historyManager.pushAction({
                type: 'uncrop',
                data: {
                    id: img.id,
                    oldCropData: oldCropData,
                    oldX: oldX,
                    oldY: oldY,
                    oldWidth: oldWidth,
                    oldHeight: oldHeight,
                    newX: img.x,
                    newY: img.y,
                    newWidth: img.width,
                    newHeight: img.height
                }
            });
        }

        this.needsRender = true;
        this.notifyChange();
    }

    cancelCrop() {
        this.isCropping = false;
        this.croppingImage = null;
        this.cropRect = null;
        this.cropStartRect = null;
        this.canvas.style.cursor = 'default';
        this.needsRender = true;
    }

    getCropHandle(x, y) {
        if (!this.cropRect) return null;

        const handleSize = 8 / this.zoom;
        const rect = this.cropRect;

        // Corner handles
        if (Math.abs(x - rect.x) < handleSize && Math.abs(y - rect.y) < handleSize) return 'nw';
        if (Math.abs(x - (rect.x + rect.width)) < handleSize && Math.abs(y - rect.y) < handleSize) return 'ne';
        if (Math.abs(x - rect.x) < handleSize && Math.abs(y - (rect.y + rect.height)) < handleSize) return 'sw';
        if (Math.abs(x - (rect.x + rect.width)) < handleSize && Math.abs(y - (rect.y + rect.height)) < handleSize) return 'se';

        // Edge handles
        if (Math.abs(x - rect.x) < handleSize && y >= rect.y && y <= rect.y + rect.height) return 'w';
        if (Math.abs(x - (rect.x + rect.width)) < handleSize && y >= rect.y && y <= rect.y + rect.height) return 'e';
        if (Math.abs(y - rect.y) < handleSize && x >= rect.x && x <= rect.x + rect.width) return 'n';
        if (Math.abs(y - (rect.y + rect.height)) < handleSize && x >= rect.x && x <= rect.x + rect.width) return 's';

        return null;
    }

    isPointInRect(x, y, rect) {
        return x >= rect.x && x <= rect.x + rect.width &&
               y >= rect.y && y <= rect.y + rect.height;
    }

    getCursorForHandle(handle) {
        const cursors = {
            'nw': 'nw-resize', 'ne': 'ne-resize',
            'sw': 'sw-resize', 'se': 'se-resize',
            'n': 'n-resize', 's': 's-resize',
            'w': 'w-resize', 'e': 'e-resize',
            'move': 'move'
        };
        return cursors[handle] || 'default';
    }

    getImageAtPoint(x, y) {
        const visibleImages = this.cullImages();

        // Sort by array index descending (later in array = on top = checked first)
        // Use the actual index from this.images array for proper layer order
        const sortedImages = [...visibleImages].sort((a, b) => {
            const indexA = this.images.indexOf(a);
            const indexB = this.images.indexOf(b);
            return indexB - indexA; // Higher index = on top
        });

        for (const img of sortedImages) {
            if (x >= img.x && x <= img.x + img.width &&
                y >= img.y && y <= img.y + img.height) {
                return img;
            }
        }
        return null;
    }

    drawGrid() {
        if (!this.showGrid) return;
        
        const bounds = this.viewportBounds;
        
        const startX = Math.floor(bounds.left / this.gridSize) * this.gridSize;
        const endX = Math.ceil(bounds.right / this.gridSize) * this.gridSize;
        const startY = Math.floor(bounds.top / this.gridSize) * this.gridSize;
        const endY = Math.ceil(bounds.bottom / this.gridSize) * this.gridSize;
        
        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 1 / this.zoom;
        
        this.ctx.beginPath();
        
        for (let x = startX; x <= endX; x += this.gridSize) {
            this.ctx.moveTo(x, startY);
            this.ctx.lineTo(x, endY);
        }
        
        for (let y = startY; y <= endY; y += this.gridSize) {
            this.ctx.moveTo(startX, y);
            this.ctx.lineTo(endX, y);
        }
        
        this.ctx.stroke();
    }

    render() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, w, h);
        
        this.ctx.save();
        this.ctx.translate(this.pan.x, this.pan.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        this.drawGrid();

        const visibleImages = this.cullImages();
        const visibleObjects = this.objectsManager.getObjects().filter(obj => obj.visible !== false);

        // Combine images and objects, sort by zIndex
        const allRenderables = [
            ...visibleImages.map(img => ({ type: 'image', data: img, zIndex: img.zIndex || 0 })),
            ...visibleObjects.map(obj => ({ type: 'object', data: obj, zIndex: obj.zIndex || 0 }))
        ];
        allRenderables.sort((a, b) => a.zIndex - b.zIndex);

        // Render in zIndex order
        for (const item of allRenderables) {
            if (item.type === 'image') {
                const img = item.data;
                try {
                    // Save context for filters and rotation
                    this.ctx.save();

                    // Apply opacity if set
                    if (img.opacity !== undefined && img.opacity !== 100) {
                        this.ctx.globalAlpha = img.opacity / 100;
                    }

                    // Apply filters if they exist
                    let filters = [];
                    if (img.brightness && img.brightness !== 100) {
                        filters.push(`brightness(${img.brightness}%)`);
                    }
                    if (img.contrast && img.contrast !== 100) {
                        filters.push(`contrast(${img.contrast}%)`);
                    }
                    if (img.saturation && img.saturation !== 100) {
                        filters.push(`saturate(${img.saturation}%)`);
                    }
                    if (img.hue && img.hue !== 0) {
                        filters.push(`hue-rotate(${img.hue}deg)`);
                    }
                    if (img.blur && img.blur > 0) {
                        filters.push(`blur(${img.blur}px)`);
                    }
                    if (img.grayscale) {
                        filters.push('grayscale(100%)');
                    }
                    if (img.invert) {
                        filters.push('invert(100%)');
                    }
                    if (filters.length > 0) {
                        this.ctx.filter = filters.join(' ');
                    }

                    // Apply mirror transformation
                    if (img.mirror) {
                        this.ctx.translate(img.x + img.width, img.y);
                        this.ctx.scale(-1, 1);
                        this.ctx.translate(-img.x, -img.y);
                    }

                    // Determine source image and crop parameters
                    const sourceImg = img.originalImg || img.img;
                    let sx = 0, sy = 0, sWidth = sourceImg.naturalWidth, sHeight = sourceImg.naturalHeight;

                    if (img.cropData) {
                        // Apply crop from original image
                        sx = img.cropData.offsetX * sourceImg.naturalWidth;
                        sy = img.cropData.offsetY * sourceImg.naturalHeight;
                        sWidth = img.cropData.cropWidth * sourceImg.naturalWidth;
                        sHeight = img.cropData.cropHeight * sourceImg.naturalHeight;
                    }

                    if (img.rotation && img.rotation !== 0) {
                        // Move to image center
                        const centerX = img.x + img.width / 2;
                        const centerY = img.y + img.height / 2;
                        this.ctx.translate(centerX, centerY);

                        // Rotate
                        this.ctx.rotate(img.rotation * Math.PI / 180);

                        // Draw image centered at origin (with crop if applicable)
                        this.ctx.drawImage(sourceImg, sx, sy, sWidth, sHeight, -img.width / 2, -img.height / 2, img.width, img.height);
                    } else {
                        // Draw image (with crop if applicable)
                        this.ctx.drawImage(sourceImg, sx, sy, sWidth, sHeight, img.x, img.y, img.width, img.height);
                    }

                    // Restore context state (removes filters and rotation)
                    this.ctx.restore();
                } catch (e) {
                }
            } else if (item.type === 'object') {
                this.objectsManager.renderSingle(this.ctx, item.data);
            }
        }

        // Render object preview and selection after all objects
        this.objectsManager.renderPreviewAndSelection(this.ctx);

        if (this.snapLines.length > 0) {
            this.ctx.strokeStyle = '#ff00ff';
            this.ctx.lineWidth = 1 / this.zoom;
            this.ctx.setLineDash([5 / this.zoom, 5 / this.zoom]);
            
            for (const guide of this.snapLines) {
                this.ctx.beginPath();
                if (guide.type === 'vertical') {
                    this.ctx.moveTo(guide.pos, this.viewportBounds.top);
                    this.ctx.lineTo(guide.pos, this.viewportBounds.bottom);
                } else {
                    this.ctx.moveTo(this.viewportBounds.left, guide.pos);
                    this.ctx.lineTo(this.viewportBounds.right, guide.pos);
                }
                this.ctx.stroke();
            }
            
            this.ctx.setLineDash([]);
        }
        
        // Draw selection boxes for all selected images
        if (this.selectedImages.length > 0 || this.objectsManager.selectedObjects.length > 0) {
            // If a group is selected, draw unified bounding box
            if (this.selectedGroup) {
                const bounds = this.getGroupBounds();
                if (bounds) {
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 2 / this.zoom;
                    this.ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
                }
            } else {
                // Draw individual selection boxes
                this.ctx.strokeStyle = '#0066ff';
                this.ctx.lineWidth = 2 / this.zoom;

                for (const img of this.selectedImages) {
                    if (img.visible === false) continue;

                    if (img.rotation && img.rotation !== 0) {
                        // Draw rotated selection box
                        this.ctx.save();
                        const centerX = img.x + img.width / 2;
                        const centerY = img.y + img.height / 2;
                        this.ctx.translate(centerX, centerY);
                        this.ctx.rotate(img.rotation * Math.PI / 180);
                        this.ctx.strokeRect(-img.width / 2, -img.height / 2, img.width, img.height);
                        this.ctx.restore();
                    } else {
                        this.ctx.strokeRect(img.x, img.y, img.width, img.height);
                    }
                }
            }

            // Draw resize handles for group or single selection (skip if rotating)
            if (this.selectedGroup && !this.isRotating) {
                // Draw resize handles on the group bounding box
                const bounds = this.getGroupBounds();
                if (bounds) {
                    const handleRadius = 4 / this.zoom;
                    const midX = bounds.x + bounds.width / 2;
                    const midY = bounds.y + bounds.height / 2;

                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 1.5 / this.zoom;

                    const handles = [
                        [bounds.x, bounds.y],
                        [midX, bounds.y],
                        [bounds.x + bounds.width, bounds.y],
                        [bounds.x + bounds.width, midY],
                        [bounds.x + bounds.width, bounds.y + bounds.height],
                        [midX, bounds.y + bounds.height],
                        [bounds.x, bounds.y + bounds.height],
                        [bounds.x, midY]
                    ];

                    for (let i = 0; i < handles.length; i++) {
                        const [hx, hy] = handles[i];
                        this.ctx.beginPath();
                        this.ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
                        this.ctx.fill();
                        this.ctx.stroke();
                    }

                    // Draw rotation handle extending upward from top center
                    const rotationHandleOffset = 30 / this.zoom;
                    const rotationHandleY = bounds.y - rotationHandleOffset;

                    // Draw connecting line
                    this.ctx.beginPath();
                    this.ctx.moveTo(midX, bounds.y);
                    this.ctx.lineTo(midX, rotationHandleY);
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 2 / this.zoom;
                    this.ctx.stroke();

                    // Draw rotation handle circle
                    this.ctx.beginPath();
                    this.ctx.arc(midX, rotationHandleY, handleRadius * 1.2, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 1.5 / this.zoom;
                    this.ctx.stroke();

                    // Draw rotation icon (circular arrow)
                    this.ctx.save();
                    this.ctx.translate(midX, rotationHandleY);
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 1 / this.zoom;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, handleRadius * 0.6, -Math.PI * 0.3, Math.PI * 1.5);
                    this.ctx.stroke();
                    // Arrow head
                    this.ctx.beginPath();
                    this.ctx.moveTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5), handleRadius * 0.6 * Math.sin(Math.PI * 1.5));
                    this.ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) - 2 / this.zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / this.zoom);
                    this.ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) + 2 / this.zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / this.zoom);
                    this.ctx.closePath();
                    this.ctx.fillStyle = '#0066ff';
                    this.ctx.fill();
                    this.ctx.restore();
                }
            } else if (this.selectedImages.length === 1 && this.selectedImage) {
                // Draw resize handles for single image selection
                const img = this.selectedImage;
                const handleRadius = 4 / this.zoom;
                const midX = img.x + img.width / 2;
                const midY = img.y + img.height / 2;

                this.ctx.fillStyle = '#ffffff';
                this.ctx.strokeStyle = '#0066ff';
                this.ctx.lineWidth = 1.5 / this.zoom;

                if (img.rotation && img.rotation !== 0) {
                    // Draw rotated handles
                    this.ctx.save();
                    const centerX = img.x + img.width / 2;
                    const centerY = img.y + img.height / 2;
                    this.ctx.translate(centerX, centerY);
                    this.ctx.rotate(img.rotation * Math.PI / 180);

                    const handles = [
                        [-img.width / 2, -img.height / 2],
                        [0, -img.height / 2],
                        [img.width / 2, -img.height / 2],
                        [img.width / 2, 0],
                        [img.width / 2, img.height / 2],
                        [0, img.height / 2],
                        [-img.width / 2, img.height / 2],
                        [-img.width / 2, 0]
                    ];

                    for (let i = 0; i < handles.length; i++) {
                        const [hx, hy] = handles[i];
                        this.ctx.beginPath();
                        this.ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
                        this.ctx.fill();
                        this.ctx.stroke();
                    }

                    // Draw rotation handle (in rotated coordinate space)
                    const rotationHandleOffset = 30 / this.zoom;
                    const rotationHandleY = -img.height / 2 - rotationHandleOffset;

                    // Draw connecting line
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, -img.height / 2);
                    this.ctx.lineTo(0, rotationHandleY);
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 2 / this.zoom;
                    this.ctx.stroke();

                    // Draw rotation handle circle
                    this.ctx.beginPath();
                    this.ctx.arc(0, rotationHandleY, handleRadius * 1.2, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 1.5 / this.zoom;
                    this.ctx.stroke();

                    // Draw rotation icon (circular arrow)
                    this.ctx.save();
                    this.ctx.translate(0, rotationHandleY);
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 1 / this.zoom;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, handleRadius * 0.6, -Math.PI * 0.3, Math.PI * 1.5);
                    this.ctx.stroke();
                    // Arrow head
                    this.ctx.beginPath();
                    this.ctx.moveTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5), handleRadius * 0.6 * Math.sin(Math.PI * 1.5));
                    this.ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) - 2 / this.zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / this.zoom);
                    this.ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) + 2 / this.zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / this.zoom);
                    this.ctx.closePath();
                    this.ctx.fillStyle = '#0066ff';
                    this.ctx.fill();
                    this.ctx.restore();

                    this.ctx.restore();
                } else {
                    const handles = [
                        [img.x, img.y],
                        [midX, img.y],
                        [img.x + img.width, img.y],
                        [img.x + img.width, midY],
                        [img.x + img.width, img.y + img.height],
                        [midX, img.y + img.height],
                        [img.x, img.y + img.height],
                        [img.x, midY]
                    ];

                    for (let i = 0; i < handles.length; i++) {
                        const [hx, hy] = handles[i];
                        this.ctx.beginPath();
                        this.ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
                        this.ctx.fill();
                        this.ctx.stroke();
                    }

                    // Draw rotation handle for single image
                    const rotationHandleOffset = 30 / this.zoom;
                    const rotationHandleY = img.y - rotationHandleOffset;

                    // Draw connecting line
                    this.ctx.beginPath();
                    this.ctx.moveTo(midX, img.y);
                    this.ctx.lineTo(midX, rotationHandleY);
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 2 / this.zoom;
                    this.ctx.stroke();

                    // Draw rotation handle circle
                    this.ctx.beginPath();
                    this.ctx.arc(midX, rotationHandleY, handleRadius * 1.2, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 1.5 / this.zoom;
                    this.ctx.stroke();

                    // Draw rotation icon (circular arrow)
                    this.ctx.save();
                    this.ctx.translate(midX, rotationHandleY);
                    this.ctx.strokeStyle = '#0066ff';
                    this.ctx.lineWidth = 1 / this.zoom;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, handleRadius * 0.6, -Math.PI * 0.3, Math.PI * 1.5);
                    this.ctx.stroke();
                    // Arrow head
                    this.ctx.beginPath();
                    this.ctx.moveTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5), handleRadius * 0.6 * Math.sin(Math.PI * 1.5));
                    this.ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) - 2 / this.zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / this.zoom);
                    this.ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) + 2 / this.zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / this.zoom);
                    this.ctx.closePath();
                    this.ctx.fillStyle = '#0066ff';
                    this.ctx.fill();
                    this.ctx.restore();
                }
            }
        }

        // Draw selection box during drag select
        if (this.isBoxSelecting && this.selectionBox) {
            const box = this.selectionBox;
            const boxX = Math.min(box.startX, box.endX);
            const boxY = Math.min(box.startY, box.endY);
            const boxWidth = Math.abs(box.endX - box.startX);
            const boxHeight = Math.abs(box.endY - box.startY);

            this.ctx.fillStyle = 'rgba(0, 102, 255, 0.1)';
            this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

            this.ctx.strokeStyle = '#0066ff';
            this.ctx.lineWidth = 1 / this.zoom;
            this.ctx.setLineDash([5 / this.zoom, 5 / this.zoom]);
            this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
            this.ctx.setLineDash([]);
        }

        // Draw crop overlay
        if (this.isCropping && this.cropRect && this.croppingImage) {
            const img = this.croppingImage;
            const rect = this.cropRect;

            // Darken area outside crop rect
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';

            // Top
            if (rect.y > img.y) {
                this.ctx.fillRect(img.x, img.y, img.width, rect.y - img.y);
            }
            // Bottom
            if (rect.y + rect.height < img.y + img.height) {
                this.ctx.fillRect(img.x, rect.y + rect.height, img.width, img.y + img.height - (rect.y + rect.height));
            }
            // Left
            if (rect.x > img.x) {
                this.ctx.fillRect(img.x, rect.y, rect.x - img.x, rect.height);
            }
            // Right
            if (rect.x + rect.width < img.x + img.width) {
                this.ctx.fillRect(rect.x + rect.width, rect.y, img.x + img.width - (rect.x + rect.width), rect.height);
            }

            // Draw crop rect border
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2 / this.zoom;
            this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

            // Draw resize handles
            const handleSize = 8 / this.zoom;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1 / this.zoom;

            const handles = [
                [rect.x, rect.y],
                [rect.x + rect.width / 2, rect.y],
                [rect.x + rect.width, rect.y],
                [rect.x + rect.width, rect.y + rect.height / 2],
                [rect.x + rect.width, rect.y + rect.height],
                [rect.x + rect.width / 2, rect.y + rect.height],
                [rect.x, rect.y + rect.height],
                [rect.x, rect.y + rect.height / 2]
            ];

            for (const [hx, hy] of handles) {
                this.ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
                this.ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
            }
        }

        // Redraw the offscreen drawing layer with current pan/zoom
        if (this.strokes.length > 0 || (this.currentStroke && this.currentStroke.points.length > 0)) {
            this.redrawDrawingLayer();

            // Also render current stroke to offscreen canvas if it's a pixel eraser
            if (this.currentStroke && this.currentStroke.points.length > 0) {
                const isPixelEraser = this.currentStroke.tool === 'eraser' && this.currentStroke.mode === 'pixels';
                if (isPixelEraser) {
                    this.drawingCtx.save();
                    this.drawingCtx.translate(this.pan.x, this.pan.y);
                    this.drawingCtx.scale(this.zoom, this.zoom);
                    this.drawStroke(this.drawingCtx, this.currentStroke);
                    this.drawingCtx.restore();
                }
            }
        }

        // Composite the drawing layer on top of images
        // Reset transform temporarily for 1:1 pixel composite
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.drawImage(this.drawingCanvas, 0, 0);

        // Reapply transform for current stroke preview
        this.ctx.translate(this.pan.x, this.pan.y);
        this.ctx.scale(this.zoom, this.zoom);

        // Draw current stroke being drawn (preview) - skip pixel eraser since it's on offscreen canvas
        if (this.currentStroke && this.currentStroke.points.length > 0) {
            const isPixelEraser = this.currentStroke.tool === 'eraser' && this.currentStroke.mode === 'pixels';
            if (!isPixelEraser) {
                this.drawStroke(this.ctx, this.currentStroke);
            }
        }

        // Text objects are now rendered in zIndex order above with images

        this.ctx.restore();
    }

    setHistoryManager(historyManager) {
        this.historyManager = historyManager;
    }

    updateImagePosition(id, x, y, skipHistory = false) {
        const img = this.images.find(img => img.id === id);
        if (img) {
            img.x = x;
            img.y = y;
            this.needsRender = true;
            if (!skipHistory) {
                this.notifyChange();
            }
        }
    }

    updateImageSize(id, width, height, skipHistory = false) {
        const img = this.images.find(img => img.id === id);
        if (img) {
            img.width = width;
            img.height = height;
            this.needsRender = true;
            if (!skipHistory) {
                this.notifyChange();
            }
        }
    }

    setVisibility(id, visible, skipHistory = false) {
        const img = this.images.find(img => img.id === id);
        if (img) {
            img.visible = visible;
            if (this.selectedImage && this.selectedImage.id === id && !visible) {
                this.selectedImage = null;
            }
            this.lastCullZoom = -999;
            this.needsRender = true;
            if (!skipHistory) {
                this.notifyChange();
            }
        }
    }

    getGroupBounds() {
        if (!this.selectedGroup) return null;

        const allItems = [
            ...this.selectedImages,
            ...this.objectsManager.selectedObjects
        ];

        if (allItems.length === 0) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const item of allItems) {
            if (item.visible === false) continue;

            const itemMinX = item.x;
            const itemMinY = item.y;
            const itemMaxX = item.x + (item.width || 0);
            const itemMaxY = item.y + (item.height || 0);

            // For lines/arrows, also check x2/y2
            if (item.type === 'shape' && (item.shapeType === 'line' || item.shapeType === 'arrow')) {
                if (item.x2 !== undefined) {
                    minX = Math.min(minX, item.x, item.x2);
                    maxX = Math.max(maxX, item.x, item.x2);
                }
                if (item.y2 !== undefined) {
                    minY = Math.min(minY, item.y, item.y2);
                    maxY = Math.max(maxY, item.y, item.y2);
                }
            } else {
                minX = Math.min(minX, itemMinX);
                minY = Math.min(minY, itemMinY);
                maxX = Math.max(maxX, itemMaxX);
                maxY = Math.max(maxY, itemMaxY);
            }
        }

        if (minX === Infinity) return null;

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    notifyChange() {
        this.canvas.dispatchEvent(new CustomEvent('canvasChanged'));
    }

    setBackgroundColor(color, skipHistory = false) {
        const oldColor = this.bgColor;
        this.bgColor = color;
        this.updateGridColor(); // Recalculate grid color for new background
        this.needsRender = true;

        if (this.historyManager && !skipHistory && oldColor !== color) {
            this.historyManager.pushAction({
                type: 'bg_color',
                data: {
                    oldColor: oldColor,
                    newColor: color
                }
            });
        }
    }

    getImages() {
        return this.images;
    }

    clear() {
        this.images = [];
        this.selectedImage = null;
        this.selectedImages = [];
        this.visibleImages = [];
        this.needsRender = true;
    }

    resetZoom() {
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.needsRender = true;
    }

    destroy() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }

    fitToContent(padding = 50) {
        if (this.images.length === 0) return;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const img of this.images) {
            if (img.visible === false) continue;
            minX = Math.min(minX, img.x);
            minY = Math.min(minY, img.y);
            maxX = Math.max(maxX, img.x + img.width);
            maxY = Math.max(maxY, img.y + img.height);
        }
        
        if (minX === Infinity) return;
        
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        
        if (contentWidth <= 0 || contentHeight <= 0) return;
        
        const zoomX = (this.canvas.width - padding * 2) / contentWidth;
        const zoomY = (this.canvas.height - padding * 2) / contentHeight;
        this.zoom = Math.min(zoomX, zoomY);
        
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        this.pan.x = this.canvas.width / 2 - centerX * this.zoom;
        this.pan.y = this.canvas.height / 2 - centerY * this.zoom;
        
        this.needsRender = true;
    }

    resetView() {
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.needsRender = true;
    }

    generateThumbnail(width = 200, height = 150) {
        try {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const ctx = tempCanvas.getContext('2d');
            
            ctx.fillStyle = this.bgColor;
            ctx.fillRect(0, 0, width, height);
            
            if (this.images.length === 0) {
                return tempCanvas.toDataURL('image/jpeg', this.thumbnailQuality);
            }
            
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const validImages = [];
            
            for (const img of this.images) {
                if (img.visible === false) continue;
                if (!img.img || !img.img.complete || img.img.naturalWidth === 0) {
                    continue;
                }
                validImages.push(img);
                minX = Math.min(minX, img.x);
                minY = Math.min(minY, img.y);
                maxX = Math.max(maxX, img.x + img.width);
                maxY = Math.max(maxY, img.y + img.height);
            }
            
            if (validImages.length === 0) {
                return tempCanvas.toDataURL('image/jpeg', this.thumbnailQuality);
            }
            
            const contentW = maxX - minX;
            const contentH = maxY - minY;
            
            if (contentW <= 0 || contentH <= 0) {
                return tempCanvas.toDataURL('image/jpeg', this.thumbnailQuality);
            }
            
            const scale = Math.min(width / contentW, height / contentH) * 0.9;
            const offsetX = (width - contentW * scale) / 2 - minX * scale;
            const offsetY = (height - contentH * scale) / 2 - minY * scale;
            
            ctx.save();
            ctx.translate(offsetX, offsetY);
            ctx.scale(scale, scale);
            
            for (const img of validImages) {
                try {
                    const sourceImg = img.originalImg || img.img;
                    let sx = 0, sy = 0, sWidth = sourceImg.naturalWidth, sHeight = sourceImg.naturalHeight;

                    if (img.cropData) {
                        sx = img.cropData.offsetX * sourceImg.naturalWidth;
                        sy = img.cropData.offsetY * sourceImg.naturalHeight;
                        sWidth = img.cropData.cropWidth * sourceImg.naturalWidth;
                        sHeight = img.cropData.cropHeight * sourceImg.naturalHeight;
                    }

                    ctx.drawImage(sourceImg, sx, sy, sWidth, sHeight, img.x, img.y, img.width, img.height);
                } catch (e) {
                }
            }
            
            ctx.restore();
            return tempCanvas.toDataURL('image/jpeg', this.thumbnailQuality);
        } catch (e) {
            return null;
        }
    }

    // Drawing methods
    setDrawingMode(mode) {
        this.drawingMode = mode;
        if (mode) {
            this.canvas.style.cursor = 'crosshair';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    setDrawingColor(color) {
        this.drawingColor = color;
    }

    setPenSize(size) {
        this.penSize = size;
    }

    setHighlighterSize(size) {
        this.highlighterSize = size;
    }

    setEraserSize(size) {
        this.eraserSize = size;
    }

    setEraserMode(mode) {
        this.eraserMode = mode; // 'strokes' or 'pixels'
    }

    redrawDrawingLayer() {
        // Clear the drawing canvas
        this.drawingCtx.clearRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);

        // Apply the same transform as the main canvas
        this.drawingCtx.save();
        this.drawingCtx.translate(this.pan.x, this.pan.y);
        this.drawingCtx.scale(this.zoom, this.zoom);

        // Redraw all strokes
        for (const stroke of this.strokes) {
            this.drawStroke(this.drawingCtx, stroke);
        }

        this.drawingCtx.restore();
    }

    drawStroke(ctx, stroke) {
        if (!stroke || stroke.points.length < 2) return;

        // Skip rendering stroke-based eraser strokes since they remove other strokes
        if (stroke.tool === 'eraser' && stroke.mode === 'strokes') return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const strokeOpacity = stroke.opacity !== undefined ? stroke.opacity : 1;

        if (stroke.tool === 'pen') {
            ctx.globalAlpha = strokeOpacity;
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size;
        } else if (stroke.tool === 'highlighter') {
            ctx.globalAlpha = 0.3 * strokeOpacity;
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size;
        } else if (stroke.tool === 'eraser' && stroke.mode === 'pixels') {
            // Pixel-based eraser uses destination-out
            ctx.globalCompositeOperation = 'destination-out';
            ctx.globalAlpha = strokeOpacity;
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            ctx.lineWidth = stroke.size;
        }

        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        // Draw smooth curves using quadratic curves
        for (let i = 1; i < stroke.points.length - 1; i++) {
            const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
            const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
            ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
        }

        // Draw the last point
        const lastPoint = stroke.points[stroke.points.length - 1];
        ctx.lineTo(lastPoint.x, lastPoint.y);
        ctx.stroke();

        ctx.restore();
    }

    startDrawing(worldX, worldY) {
        if (!this.drawingMode) return;

        this.isDrawing = true;
        this.currentStroke = {
            id: Date.now(),
            tool: this.drawingMode,
            mode: this.drawingMode === 'eraser' ? this.eraserMode : undefined,
            color: this.drawingColor,
            opacity: this.drawingOpacity,
            size: this.drawingMode === 'pen' ? this.penSize :
                  this.drawingMode === 'highlighter' ? this.highlighterSize :
                  this.eraserSize,
            points: [{ x: worldX, y: worldY }]
        };
        this.needsRender = true;
    }

    continueDrawing(worldX, worldY) {
        if (!this.isDrawing || !this.currentStroke) return;

        this.currentStroke.points.push({ x: worldX, y: worldY });
        this.needsRender = true;
    }

    endDrawing() {
        if (!this.isDrawing || !this.currentStroke) return;

        if (this.currentStroke.points.length > 1) {
            // If eraser tool in strokes mode, remove strokes that intersect with it
            if (this.currentStroke.tool === 'eraser' && this.currentStroke.mode === 'strokes') {
                const removedStrokes = [];
                const eraserPoints = this.currentStroke.points;
                const eraserRadius = this.currentStroke.size / 2;

                // Check each existing stroke for intersection with eraser path
                this.strokes = this.strokes.filter(stroke => {
                    if (stroke.tool === 'eraser') return true; // Keep other eraser strokes

                    // Check if any point in the stroke intersects with eraser path
                    for (const strokePoint of stroke.points) {
                        for (const eraserPoint of eraserPoints) {
                            const dx = strokePoint.x - eraserPoint.x;
                            const dy = strokePoint.y - eraserPoint.y;
                            const distance = Math.sqrt(dx * dx + dy * dy);

                            if (distance < eraserRadius + stroke.size / 2) {
                                removedStrokes.push(stroke);
                                return false; // Remove this stroke
                            }
                        }
                    }
                    return true; // Keep this stroke
                });

                // Add eraser action to history if strokes were removed
                if (removedStrokes.length > 0 && this.historyManager) {
                    this.historyManager.pushAction({
                        type: 'strokes_erase',
                        strokes: removedStrokes
                    });
                }
            } else {
                // For pen, highlighter, and pixel-based eraser, add the stroke normally
                this.strokes.push(this.currentStroke);

                // Add to history for undo/redo
                if (this.historyManager) {
                    this.historyManager.pushAction({
                        type: 'stroke_add',
                        stroke: JSON.parse(JSON.stringify(this.currentStroke))
                    });
                }
            }

            // Redraw the drawing layer
            this.redrawDrawingLayer();

            // Trigger canvas change event for autosave
            const event = new CustomEvent('canvasChanged');
            this.canvas.dispatchEvent(event);
        }

        this.currentStroke = null;
        this.isDrawing = false;
        this.needsRender = true;
    }

    clearStrokes() {
        if (this.strokes.length === 0) return;

        const oldStrokes = [...this.strokes];
        this.strokes = [];

        if (this.historyManager) {
            this.historyManager.pushAction({
                type: 'strokes_clear',
                strokes: oldStrokes
            });
        }

        this.redrawDrawingLayer();
        this.needsRender = true;
        const event = new CustomEvent('canvasChanged');
        this.canvas.dispatchEvent(event);
    }

    undoStroke() {
        if (this.strokes.length === 0) return;

        const removedStroke = this.strokes.pop();
        this.redrawDrawingLayer();
        this.needsRender = true;

        const event = new CustomEvent('canvasChanged');
        this.canvas.dispatchEvent(event);

        return removedStroke;
    }

    redoStroke(stroke) {
        this.strokes.push(stroke);
        this.redrawDrawingLayer();
        this.needsRender = true;

        const event = new CustomEvent('canvasChanged');
        this.canvas.dispatchEvent(event);
    }

    loadStrokes(strokes) {
        this.strokes = strokes || [];
        this.redrawDrawingLayer();
        this.needsRender = true;
    }

    getStrokes() {
        return this.strokes;
    }
}