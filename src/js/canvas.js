export class Canvas {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { 
            alpha: false,
            desynchronized: true, // Hint to browser for better performance
            willReadFrequently: false
        });
        this.images = [];
        this.selectedImage = null;
        this.isDragging = false;
        this.isResizing = false;
        this.isPanning = false;
        this.dragOffset = { x: 0, y: 0 };
        this.resizeHandle = null;
        this.resizeStartData = null;
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.lastPanPoint = { x: 0, y: 0 };
        this.needsRender = true;
        this.animationFrame = null;
        this.bgColor = '#ffffff';
        
        // Performance optimizations
        this.visibleImages = []; // Cache of visible images
        this.viewportBounds = { left: 0, right: 0, top: 0, bottom: 0 };
        this.lastCullZoom = 1;
        this.lastCullPan = { x: 0, y: 0 };
        this.cullThreshold = 10; // Recull if pan/zoom changed significantly
        
        // Grid settings for infinite canvas feel
        this.showGrid = false; // Hidden by default, toggle with canvas.showGrid = true
        this.gridSize = 50; // Grid cell size in world units
        this.gridColor = 'rgba(0, 0, 0, 0.05)';
        
        // Zoom warning
        this.hasShownZoomWarning = false;
        this.zoomWarningThreshold = 0.05; // Show warning below this zoom level
        
        // Snapping
        this.enableSnapping = true;
        this.snapThreshold = 3; // Snap within 3 pixels (reduced from 8)
        this.snapLines = []; // Active snap guide lines
        
        this.setupCanvas();
        this.setupEventListeners();
        this.startRenderLoop();
    }

    showToast(message, duration = 5000) {
        // Remove existing toast if any
        const existingToast = document.querySelector('.canvas-toast');
        if (existingToast) existingToast.remove();
        
        const toast = document.createElement('div');
        toast.className = 'canvas-toast';
        toast.textContent = message;
        
        // Inject styles if not already present
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
        
        // Fade out and remove
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
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
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
        this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        this.canvas.addEventListener('dragover', (e) => e.preventDefault());
        this.canvas.addEventListener('drop', this.onDrop.bind(this));
        
        // Spacebar panning
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

    // Calculate viewport bounds in world space for culling
    updateViewportBounds() {
        const margin = 100; // Extra margin to prevent pop-in
        this.viewportBounds = {
            left: (-this.pan.x - margin) / this.zoom,
            right: ((this.canvas.width - this.pan.x) + margin) / this.zoom,
            top: (-this.pan.y - margin) / this.zoom,
            bottom: ((this.canvas.height - this.pan.y) + margin) / this.zoom
        };
    }

    // Check if culling needs to be updated
    shouldRecull() {
        const panDelta = Math.abs(this.pan.x - this.lastCullPan.x) + Math.abs(this.pan.y - this.lastCullPan.y);
        const zoomDelta = Math.abs(this.zoom - this.lastCullZoom);
        return panDelta > this.cullThreshold || zoomDelta > 0.01;
    }

    // Perform viewport culling - only return visible images
    cullImages() {
        if (!this.shouldRecull()) {
            return this.visibleImages;
        }

        this.updateViewportBounds();
        const bounds = this.viewportBounds;
        
        this.visibleImages = this.images.filter(img => {
            if (img.visible === false) return false;
            
            // AABB intersection test
            return !(
                img.x + img.width < bounds.left ||
                img.x > bounds.right ||
                img.y + img.height < bounds.top ||
                img.y > bounds.bottom
            );
        });

        this.lastCullPan = { x: this.pan.x, y: this.pan.y };
        this.lastCullZoom = this.zoom;
        
        return this.visibleImages;
    }

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        
        // Middle mouse button or spacebar + left click = pan
        if (e.button === 1 || (e.button === 0 && e.key === ' ')) {
            e.preventDefault();
            this.isPanning = true;
            this.lastPanPoint = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
            return;
        }
        
        // Right click = pan
        if (e.button === 2) {
            e.preventDefault();
            this.isPanning = true;
            this.lastPanPoint = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
            return;
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
        
        const clickedImage = this.getImageAtPoint(x, y);
        
        if (clickedImage) {
            this.selectImage(clickedImage);
            this.isDragging = true;
            this.dragOffset = {
                x: x - clickedImage.x,
                y: y - clickedImage.y
            };
            this.canvas.style.cursor = 'grabbing';
        } else {
            this.selectImage(null);
            this.isPanning = true;
            this.lastPanPoint = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
        }
    }

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        
        if (this.isResizing && this.selectedImage) {
            this.resizeImage(x, y);
            this.needsRender = true;
        } else if (this.isDragging && this.selectedImage) {
            let newX = x - this.dragOffset.x;
            let newY = y - this.dragOffset.y;
            
            // Apply snapping if enabled
            if (this.enableSnapping) {
                const snapped = this.snapToImages(newX, newY, this.selectedImage);
                newX = snapped.x;
                newY = snapped.y;
                this.snapLines = snapped.guides;
            } else {
                this.snapLines = [];
            }
            
            this.selectedImage.x = newX;
            this.selectedImage.y = newY;
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
        const wasModifying = this.isDragging || this.isResizing;
        this.isDragging = false;
        this.isResizing = false;
        this.isPanning = false;
        this.resizeHandle = null;
        this.resizeStartData = null;
        this.snapLines = [];
        this.canvas.style.cursor = 'default';
        
        if (wasModifying) {
            this.notifyChange();
        }
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        // No zoom limits - true infinite canvas
        const newZoom = this.zoom * delta;
        
        // Show performance warning once when zooming out far
        if (!this.hasShownZoomWarning && newZoom < this.zoomWarningThreshold) {
            this.showToast('⚠️ Disclaimer: Extreme zoom levels may cause performance issues');
            this.hasShownZoomWarning = true;
        }
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Zoom towards mouse position
        this.pan.x = mouseX - (mouseX - this.pan.x) * (newZoom / this.zoom);
        this.pan.y = mouseY - (mouseY - this.pan.y) * (newZoom / this.zoom);
        this.zoom = newZoom;
        
        this.needsRender = true;
    }

    onDrop(e) {
        e.preventDefault();
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
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
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
        this.needsRender = true;
        this.notifyChange();
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

    selectImage(img) {
        this.selectedImage = img;
        this.needsRender = true;
        this.canvas.dispatchEvent(new CustomEvent('imageSelected', { detail: img }));
    }

    deleteImage(id) {
        this.images = this.images.filter(img => img.id !== id);
        if (this.selectedImage && this.selectedImage.id === id) {
            this.selectedImage = null;
        }
        this.needsRender = true;
        this.notifyChange();
    }

    toggleVisibility(id) {
        const img = this.images.find(img => img.id === id);
        if (img) {
            img.visible = !img.visible;
            if (this.selectedImage && this.selectedImage.id === id && !img.visible) {
                this.selectedImage = null;
            }
            // Force cache invalidation by changing lastCullZoom
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

    renameLayer(id, newName) {
        const img = this.images.find(img => img.id === id);
        if (img) {
            img.name = newName;
        }
    }

    snapToImages(x, y, draggedImage) {
        const threshold = this.snapThreshold / this.zoom;
        const guides = [];
        let snappedX = x;
        let snappedY = y;
        let snapDistX = Infinity;
        let snapDistY = Infinity;
        
        // Calculate dragged image bounds
        const draggedLeft = x;
        const draggedRight = x + draggedImage.width;
        const draggedTop = y;
        const draggedBottom = y + draggedImage.height;
        const draggedCenterX = x + draggedImage.width / 2;
        const draggedCenterY = y + draggedImage.height / 2;
        
        // Check against all other visible images
        for (const img of this.images) {
            if (img.id === draggedImage.id || img.visible === false) continue;
            
            const targetLeft = img.x;
            const targetRight = img.x + img.width;
            const targetTop = img.y;
            const targetBottom = img.y + img.height;
            const targetCenterX = img.x + img.width / 2;
            const targetCenterY = img.y + img.height / 2;
            
            // Check X-axis snapping
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
            
            // Check Y-axis snapping
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
        
        // Filter guides to only show active snaps
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

    getImageAtPoint(x, y) {
        // Only check visible images (already culled)
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

    // Draw infinite grid
    drawGrid() {
        if (!this.showGrid) return;
        
        const bounds = this.viewportBounds;
        
        // Calculate grid start/end aligned to grid size
        const startX = Math.floor(bounds.left / this.gridSize) * this.gridSize;
        const endX = Math.ceil(bounds.right / this.gridSize) * this.gridSize;
        const startY = Math.floor(bounds.top / this.gridSize) * this.gridSize;
        const endY = Math.ceil(bounds.bottom / this.gridSize) * this.gridSize;
        
        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 1 / this.zoom;
        
        this.ctx.beginPath();
        
        // Draw vertical lines
        for (let x = startX; x <= endX; x += this.gridSize) {
            this.ctx.moveTo(x, startY);
            this.ctx.lineTo(x, endY);
        }
        
        // Draw horizontal lines
        for (let y = startY; y <= endY; y += this.gridSize) {
            this.ctx.moveTo(startX, y);
            this.ctx.lineTo(endX, y);
        }
        
        this.ctx.stroke();
        
        // Draw thicker origin lines
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
        this.ctx.lineWidth = 2 / this.zoom;
        this.ctx.beginPath();
        
        // Vertical origin
        if (startX <= 0 && endX >= 0) {
            this.ctx.moveTo(0, startY);
            this.ctx.lineTo(0, endY);
        }
        
        // Horizontal origin
        if (startY <= 0 && endY >= 0) {
            this.ctx.moveTo(startX, 0);
            this.ctx.lineTo(endX, 0);
        }
        
        this.ctx.stroke();
    }

    render() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Clear with background color
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, w, h);
        
        this.ctx.save();
        this.ctx.translate(this.pan.x, this.pan.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        // Draw infinite grid
        this.drawGrid();
        
        // Only render visible images (culled)
        const visibleImages = this.cullImages();
        
        for (let i = 0; i < visibleImages.length; i++) {
            const img = visibleImages[i];
            try {
                this.ctx.drawImage(img.img, img.x, img.y, img.width, img.height);
            } catch (e) {
                // Skip broken images
            }
        }
        
        // Draw snap guide lines
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
        
        // Draw selection and handles
        if (this.selectedImage && this.selectedImage.visible !== false) {
            const img = this.selectedImage;
            this.ctx.strokeStyle = '#0066ff';
            this.ctx.lineWidth = 2 / this.zoom;
            this.ctx.strokeRect(img.x, img.y, img.width, img.height);
            
            const handleRadius = 4 / this.zoom;
            const midX = img.x + img.width / 2;
            const midY = img.y + img.height / 2;
            
            this.ctx.fillStyle = '#ffffff';
            this.ctx.strokeStyle = '#0066ff';
            this.ctx.lineWidth = 1.5 / this.zoom;
            
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
        
        this.ctx.restore();
    }

    notifyChange() {
        this.canvas.dispatchEvent(new CustomEvent('canvasChanged'));
    }

    setBackgroundColor(color) {
        this.bgColor = color;
        this.needsRender = true;
    }

    getImages() {
        return this.images;
    }

    clear() {
        this.images = [];
        this.selectedImage = null;
        this.visibleImages = [];
        this.needsRender = true;
    }

    destroy() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }

    // Zoom and pan to fit all images in view (like PureRef's "Fit All")
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
        
        if (minX === Infinity) return; // No visible images
        
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        
        if (contentWidth <= 0 || contentHeight <= 0) return;
        
        // Calculate zoom to fit content with padding
        const zoomX = (this.canvas.width - padding * 2) / contentWidth;
        const zoomY = (this.canvas.height - padding * 2) / contentHeight;
        this.zoom = Math.min(zoomX, zoomY);
        
        // Center the content
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        this.pan.x = this.canvas.width / 2 - centerX * this.zoom;
        this.pan.y = this.canvas.height / 2 - centerY * this.zoom;
        
        this.needsRender = true;
    }

    // Reset view to origin at 1:1 zoom
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
                return tempCanvas.toDataURL('image/jpeg', 0.6);
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
                return tempCanvas.toDataURL('image/jpeg', 0.6);
            }
            
            const contentW = maxX - minX;
            const contentH = maxY - minY;
            
            if (contentW <= 0 || contentH <= 0) {
                return tempCanvas.toDataURL('image/jpeg', 0.6);
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
                    // Skip broken images
                }
            }
            
            ctx.restore();
            return tempCanvas.toDataURL('image/jpeg', 0.6);
        } catch (e) {
            return null;
        }
    }
}