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
        this.rotationStartAngle = 0;
        this.rotationStartRotation = 0;
        this.selectionBox = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragOffsets = new Map();
        this.resizeHandle = null;
        this.resizeStartData = null;
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
        this.gridColor = 'rgba(0, 0, 0, 0.05)';
        this.enableSnapping = settings.enableSnapping;
        this.snapThreshold = settings.snapThreshold;
        this.thumbnailQuality = settings.thumbnailQuality;
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
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.onMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
        // Add window mouseup to catch cases where mouse is released outside canvas
        window.addEventListener('mouseup', this.onMouseUp.bind(this));
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
            if (e.key === ' ' && !this.isPanning && !e.repeat) {
                e.preventDefault();
                this.canvas.style.cursor = 'grab';
            }
            if (e.key === 'Delete' && this.selectedImage) {
                this.deleteImage(this.selectedImage.id);
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

        // Check if a tool is active (text or shape tool)
        if (this.objectsManager.currentTool) {
            if (this.objectsManager.handleMouseDown(e, { x, y })) {
                return;
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

        // Handle drawing mode
        if (this.drawingMode && e.button === 0) {
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
        
        if (this.selectedImage && this.selectedImage.visible !== false) {
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
                return;
            }

            // Handle range select with Shift
            if (e.shiftKey && this.selectedImage) {
                this.selectImagesInRange(this.selectedImage, clickedImage);
                return;
            }

            // If clicking an already selected image in multi-select, don't deselect
            if (!this.isImageSelected(clickedImage)) {
                this.selectImage(clickedImage);
            }

            // Setup dragging for all selected images
            this.isDragging = true;
            this.dragOffsets.clear();
            for (const img of this.selectedImages) {
                this.dragOffsets.set(img.id, { x: x - img.x, y: y - img.y });
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
        } else if (this.isResizing && this.selectedImage) {
            this.resizeImage(x, y);
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
            this.needsRender = true;
        } else if (this.isPanning) {
            const dx = e.clientX - this.lastPanPoint.x;
            const dy = e.clientY - this.lastPanPoint.y;
            this.pan.x += dx;
            this.pan.y += dy;
            this.lastPanPoint = { x: e.clientX, y: e.clientY };
            this.needsRender = true;
        } else if (this.selectedImage && this.selectedImage.visible !== false) {
            const handle = this.getResizeHandle(x, y, this.selectedImage);
            this.canvas.style.cursor = handle ? this.getResizeCursor(handle) : 'default';
        }
    }

    onMouseUp(e) {
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

        if (wasDragging && this.selectedImage && this.dragStartPosition && this.historyManager) {
            if (this.dragStartPosition.x !== this.selectedImage.x || this.dragStartPosition.y !== this.selectedImage.y) {
                this.historyManager.pushAction({
                    type: 'move',
                    data: {
                        id: this.selectedImage.id,
                        oldX: this.dragStartPosition.x,
                        oldY: this.dragStartPosition.y,
                        newX: this.selectedImage.x,
                        newY: this.selectedImage.y
                    }
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
        this.snapLines = [];
        this.canvas.style.cursor = 'default';

        if (wasModifying) {
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
        
        if (!this.hasShownZoomWarning && newZoom < this.zoomWarningThreshold) {
            this.showToast('⚠️ Disclaimer: Extreme zoom levels may cause performance issues');
            this.hasShownZoomWarning = true;
        }
        
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
        
        if (!board.assets) board.assets = [];
        
        const assetExists = board.assets.some(a => a.name === name);
        if (assetExists) return;
        
        board.assets.push({
            id: Date.now() + Math.random(),
            src: src,
            name: name
        });
        
        if (window.boardManagerInstance && window.currentBoardId) {
            window.boardManagerInstance.updateBoard(window.currentBoardId, { assets: board.assets });
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
        for (const img of this.images) {
            if (img.visible === false) continue;

            const imgRight = img.x + img.width;
            const imgBottom = img.y + img.height;
            const boxRight = boxX + boxWidth;
            const boxBottom = boxY + boxHeight;

            if (img.x < boxRight && imgRight > boxX && img.y < boxBottom && imgBottom > boxY) {
                this.selectedImages.push(img);
            }
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

    getResizeCursor(handle) {
        const cursors = {
            'nw': 'nw-resize', 'n': 'n-resize', 'ne': 'ne-resize',
            'e': 'e-resize', 'se': 'se-resize', 's': 's-resize',
            'sw': 'sw-resize', 'w': 'w-resize'
        };
        return cursors[handle] || 'default';
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

    enableRotationMode(image, startMouseX, startMouseY) {
        this.isRotating = true;
        this.rotatingImage = image;
        this.selectImage(image);
        this.canvas.style.cursor = 'grab';

        // Store the starting rotation and starting mouse angle
        const centerX = image.x + image.width / 2;
        const centerY = image.y + image.height / 2;
        this.rotationStartAngle = Math.atan2(startMouseY - centerY, startMouseX - centerX);
        this.rotationStartRotation = image.rotation || 0;
    }

    rotateImage(mouseX, mouseY) {
        if (!this.rotatingImage) return;

        const img = this.rotatingImage;
        const centerX = img.x + img.width / 2;
        const centerY = img.y + img.height / 2;

        // Calculate current angle
        const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX);

        // Calculate the delta from the starting angle
        const angleDelta = currentAngle - this.rotationStartAngle;
        const deltaDegrees = angleDelta * (180 / Math.PI);

        // Apply delta to the starting rotation
        img.rotation = this.rotationStartRotation + deltaDegrees;
    }

    getImageAtPoint(x, y) {
        const visibleImages = this.cullImages();
        
        for (let i = visibleImages.length - 1; i >= 0; i--) {
            const img = visibleImages[i];
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
        
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
        this.ctx.lineWidth = 2 / this.zoom;
        this.ctx.beginPath();
        
        if (startX <= 0 && endX >= 0) {
            this.ctx.moveTo(0, startY);
            this.ctx.lineTo(0, endY);
        }
        
        if (startY <= 0 && endY >= 0) {
            this.ctx.moveTo(startX, 0);
            this.ctx.lineTo(endX, 0);
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
                    if (img.rotation && img.rotation !== 0) {
                        // Save context state
                        this.ctx.save();

                        // Move to image center
                        const centerX = img.x + img.width / 2;
                        const centerY = img.y + img.height / 2;
                        this.ctx.translate(centerX, centerY);

                        // Rotate
                        this.ctx.rotate(img.rotation * Math.PI / 180);

                        // Draw image centered at origin
                        this.ctx.drawImage(img.img, -img.width / 2, -img.height / 2, img.width, img.height);

                        // Restore context state
                        this.ctx.restore();
                    } else {
                        this.ctx.drawImage(img.img, img.x, img.y, img.width, img.height);
                    }
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
        if (this.selectedImages.length > 0) {
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

            // Only draw resize handles for single selection (skip if rotating)
            if (this.selectedImages.length === 1 && this.selectedImage && !this.isRotating) {
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

    notifyChange() {
        this.canvas.dispatchEvent(new CustomEvent('canvasChanged'));
    }

    setBackgroundColor(color, skipHistory = false) {
        const oldColor = this.bgColor;
        this.bgColor = color;
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
                    ctx.drawImage(img.img, img.x, img.y, img.width, img.height);
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

        if (stroke.tool === 'pen') {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size;
        } else if (stroke.tool === 'highlighter') {
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size;
        } else if (stroke.tool === 'eraser' && stroke.mode === 'pixels') {
            // Pixel-based eraser uses destination-out
            ctx.globalCompositeOperation = 'destination-out';
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