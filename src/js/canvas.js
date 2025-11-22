export class Canvas {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { alpha: false });
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
        
        this.setupCanvas();
        this.setupEventListeners();
        this.startRenderLoop();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
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
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && this.selectedImage) {
                this.deleteImage(this.selectedImage.id);
            }
        });
    }

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.pan.x) / this.zoom,
            y: (screenY - this.pan.y) / this.zoom
        };
    }

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        
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
            this.selectedImage.x = x - this.dragOffset.x;
            this.selectedImage.y = y - this.dragOffset.y;
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

    onMouseUp() {
        const wasModifying = this.isDragging || this.isResizing;
        this.isDragging = false;
        this.isResizing = false;
        this.isPanning = false;
        this.resizeHandle = null;
        this.resizeStartData = null;
        this.canvas.style.cursor = 'default';
        
        if (wasModifying) {
            this.notifyChange();
        }
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, this.zoom * delta));
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
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
        for (let i = this.images.length - 1; i >= 0; i--) {
            const img = this.images[i];
            if (img.visible === false) continue;
            if (x >= img.x && x <= img.x + img.width &&
                y >= img.y && y <= img.y + img.height) {
                return img;
            }
        }
        return null;
    }

    render() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, w, h);
        
        this.ctx.save();
        this.ctx.translate(this.pan.x, this.pan.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        for (let i = 0; i < this.images.length; i++) {
            const img = this.images[i];
            if (img.visible === false) continue;
            try {
                this.ctx.drawImage(img.img, img.x, img.y, img.width, img.height);
            } catch (e) {
                // Skip broken images
            }
        }
        
        if (this.selectedImage && this.selectedImage.visible !== false) {
            const img = this.selectedImage;
            this.ctx.strokeStyle = '#0066ff';
            this.ctx.lineWidth = 2 / this.zoom;
            this.ctx.strokeRect(img.x, img.y, img.width, img.height);
            
            const handleSize = 8 / this.zoom;
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
                this.ctx.fillRect(hx - handleSize/2, hy - handleSize/2, handleSize, handleSize);
                this.ctx.strokeRect(hx - handleSize/2, hy - handleSize/2, handleSize, handleSize);
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
        this.needsRender = true;
    }

    destroy() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
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
