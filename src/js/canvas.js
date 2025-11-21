// Canvas - optimized with proper resize handles

export class Canvas {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
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

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
        const y = (e.clientY - rect.top - this.pan.y) / this.zoom;
        
        if (this.selectedImage) {
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
        const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
        const y = (e.clientY - rect.top - this.pan.y) / this.zoom;
        
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
        } else if (this.selectedImage) {
            const handle = this.getResizeHandle(x, y, this.selectedImage);
            this.canvas.style.cursor = handle ? this.getResizeCursor(handle) : 'default';
        }
    }

    onMouseUp() {
        if (this.isDragging || this.isResizing) {
            this.notifyChange();
        }
        this.isDragging = false;
        this.isResizing = false;
        this.isPanning = false;
        this.resizeHandle = null;
        this.resizeStartData = null;
        this.canvas.style.cursor = 'default';
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
        
        imageFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const rect = this.canvas.getBoundingClientRect();
                    const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
                    const y = (e.clientY - rect.top - this.pan.y) / this.zoom;
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
            rotation: 0
        };
        this.images.push(imageData);
        this.selectImage(imageData);
        this.needsRender = true;
        this.notifyChange();
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
            this.notifyChange();
        }
    }

    getResizeHandle(x, y, img) {
        const handleSize = 10 / this.zoom;
        const midX = img.x + img.width / 2;
        const midY = img.y + img.height / 2;
        
        // 8 handles: 4 corners (scale) + 4 sides (dimension)
        const handles = [
            { name: 'nw', x: img.x, y: img.y, type: 'corner' },
            { name: 'n', x: midX, y: img.y, type: 'side' },
            { name: 'ne', x: img.x + img.width, y: img.y, type: 'corner' },
            { name: 'e', x: img.x + img.width, y: midY, type: 'side' },
            { name: 'se', x: img.x + img.width, y: img.y + img.height, type: 'corner' },
            { name: 's', x: midX, y: img.y + img.height, type: 'side' },
            { name: 'sw', x: img.x, y: img.y + img.height, type: 'corner' },
            { name: 'w', x: img.x, y: midY, type: 'side' }
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
            // Corner handles: scale proportionally
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
            // Side handles: change dimensions freely
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
            if (x >= img.x && x <= img.x + img.width &&
                y >= img.y && y <= img.y + img.height) {
                return img;
            }
        }
        return null;
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        
        this.ctx.translate(this.pan.x, this.pan.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        // Draw images
        this.images.forEach(img => {
            this.ctx.drawImage(img.img, img.x, img.y, img.width, img.height);
        });
        
        // Draw selection and handles
        if (this.selectedImage) {
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
            
            // 8 handles
            const handles = [
                [img.x, img.y], // nw
                [midX, img.y], // n
                [img.x + img.width, img.y], // ne
                [img.x + img.width, midY], // e
                [img.x + img.width, img.y + img.height], // se
                [midX, img.y + img.height], // s
                [img.x, img.y + img.height], // sw
                [img.x, midY] // w
            ];
            
            handles.forEach(([x, y]) => {
                this.ctx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
                this.ctx.strokeRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
            });
        }
        
        this.ctx.restore();
    }

    notifyChange() {
        this.canvas.dispatchEvent(new CustomEvent('canvasChanged'));
    }

    setBackgroundColor(color) {
        this.canvas.style.backgroundColor = color;
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
}