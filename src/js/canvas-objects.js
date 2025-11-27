// Canvas Objects Manager - Handles text boxes
// Uses overlay HTML elements for editing (best practice per W3C and modern libraries like Konva)

export class CanvasObjectsManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.objects = [];
        this.selectedObject = null;
        this.currentTool = null;
        this.isDrawing = false;
        this.startPoint = null;
        this.previewObject = null;
        this.isDragging = false;
        this.isResizing = false;
        this.resizeHandle = null;
        this.dragOffset = { x: 0, y: 0 };
        this.resizeStart = { x: 0, y: 0, width: 0, height: 0 };
        this.editingTextId = null;
    }

    setTool(tool) {
        this.currentTool = tool;
        if (tool) {
            this.deselectAll();
        }
    }

    handleMouseDown(e, worldPos) {
        // Check if clicking on a resize handle of selected object
        if (this.selectedObject && !this.currentTool) {
            const handle = this.getResizeHandleAtPoint(this.selectedObject, worldPos.x, worldPos.y);
            if (handle) {
                this.isResizing = true;
                this.resizeHandle = handle;
                this.resizeStart = {
                    x: this.selectedObject.x,
                    y: this.selectedObject.y,
                    width: this.selectedObject.width,
                    height: this.selectedObject.height
                };
                return true;
            }
        }

        // Check if clicking on an existing object (selection/drag)
        const clickedObject = this.getObjectAtPoint(worldPos.x, worldPos.y);

        if (clickedObject) {
            if (this.currentTool) {
                // If a tool is active, don't select
                return false;
            }

            this.selectObject(clickedObject);
            this.isDragging = true;
            this.dragOffset = {
                x: worldPos.x - clickedObject.x,
                y: worldPos.y - clickedObject.y
            };
            return true;
        }

        // No object clicked - check if creating new object
        if (!this.currentTool) {
            this.deselectAll();
            return false;
        }

        // Creating new text object - start drag-to-create
        if (this.currentTool === 'text') {
            this.isDrawing = true;
            this.startPoint = { x: worldPos.x, y: worldPos.y };

            // Create preview object
            this.previewObject = this.createTextObject(worldPos.x, worldPos.y);
            this.previewObject.width = 0;
            this.previewObject.height = 0;

            this.canvas.needsRender = true;
            return true;
        }

        return false;
    }

    handleMouseMove(e, worldPos) {
        if (this.isDrawing && this.currentTool === 'text' && this.startPoint && this.previewObject) {
            // Update preview object size while dragging
            const minSize = 50;
            const width = worldPos.x - this.startPoint.x;
            const height = worldPos.y - this.startPoint.y;

            // Support dragging in any direction
            if (width < 0) {
                this.previewObject.x = worldPos.x;
                this.previewObject.width = Math.max(minSize, Math.abs(width));
            } else {
                this.previewObject.x = this.startPoint.x;
                this.previewObject.width = Math.max(minSize, width);
            }

            if (height < 0) {
                this.previewObject.y = worldPos.y;
                this.previewObject.height = Math.max(minSize, Math.abs(height));
            } else {
                this.previewObject.y = this.startPoint.y;
                this.previewObject.height = Math.max(minSize, height);
            }

            this.canvas.needsRender = true;
        } else if (this.isResizing && this.selectedObject && this.resizeHandle) {
            // Resize the selected object
            this.resizeObject(this.selectedObject, this.resizeHandle, worldPos.x, worldPos.y);
            this.canvas.needsRender = true;
            this.dispatchObjectsChanged();
        } else if (this.isDragging && this.selectedObject) {
            // Drag the selected object
            this.selectedObject.x = worldPos.x - this.dragOffset.x;
            this.selectedObject.y = worldPos.y - this.dragOffset.y;
            this.canvas.needsRender = true;
            this.dispatchObjectsChanged();
        }
    }

    handleMouseUp(e, worldPos) {
        if (this.isDrawing && this.currentTool === 'text' && this.previewObject) {
            // Finalize the text object creation
            const minSize = 50;

            // If the dragged size is too small, use default size
            if (this.previewObject.width < minSize || this.previewObject.height < minSize) {
                this.previewObject.width = 200;
                this.previewObject.height = 80;
                // Recalculate font size for default dimensions
                this.previewObject.fontSize = 16;
            } else {
                // Recalculate font size based on final dimensions
                const baseDimension = Math.min(this.previewObject.width, this.previewObject.height);
                this.previewObject.fontSize = Math.max(12, Math.floor(baseDimension / 5));
            }

            // Add the textbox to objects
            this.objects.push(this.previewObject);
            this.selectObject(this.previewObject);

            // Clean up
            this.isDrawing = false;
            this.startPoint = null;
            this.previewObject = null;

            // Deactivate tool and notify UI
            this.currentTool = null;
            const toolEvent = new CustomEvent('toolDeactivated');
            this.canvas.canvas.dispatchEvent(toolEvent);

            // Dispatch event to show in layers
            this.dispatchObjectsChanged();
            this.canvas.needsRender = true;
            return true;
        }

        if (this.isResizing) {
            this.isResizing = false;
            this.resizeHandle = null;
            return true;
        }
        if (this.isDragging) {
            this.isDragging = false;
            return true;
        }
        return false;
    }

    handleDoubleClick(e, worldPos) {
        const clickedObject = this.getObjectAtPoint(worldPos.x, worldPos.y);
        if (clickedObject && clickedObject.type === 'text') {
            this.startTextEdit(clickedObject);
            return true;
        }
        return false;
    }

    createTextObject(x, y, width = 200, height = 80) {
        // Calculate font size based on textbox dimensions
        // Use the smaller dimension (width or height) as the basis
        // Scale: roughly 1px font size per 12-15 pixels of textbox dimension
        const baseDimension = Math.min(width, height);
        const fontSize = Math.max(12, Math.floor(baseDimension / 5));

        return {
            type: 'text',
            id: this.generateId(),
            name: 'Text Box',
            x,
            y,
            width,
            height,
            text: 'Double-click to edit',
            font: 'Arial',
            fontSize: fontSize,
            color: '#000000',
            backgroundColor: '#ffffff',
            align: 'left',
            padding: 10
        };
    }

    startTextEdit(textObject) {
        this.editingTextId = textObject.id;

        // Dispatch event for UI to handle text editing
        const event = new CustomEvent('textEditStart', { detail: textObject });
        this.canvas.canvas.dispatchEvent(event);
    }

    stopTextEdit() {
        if (this.editingTextId) {
            this.editingTextId = null;
            const event = new CustomEvent('textEditStop');
            this.canvas.canvas.dispatchEvent(event);
        }
    }

    getObjectAtPoint(x, y) {
        // Check in reverse order (top to bottom)
        for (let i = this.objects.length - 1; i >= 0; i--) {
            const obj = this.objects[i];
            if (x >= obj.x && x <= obj.x + obj.width &&
                y >= obj.y && y <= obj.y + obj.height) {
                return obj;
            }
        }
        return null;
    }

    getResizeHandleAtPoint(obj, x, y) {
        const handleRadius = 8 / this.canvas.zoom; // Slightly larger hit area
        const midX = obj.x + obj.width / 2;
        const midY = obj.y + obj.height / 2;

        const handles = [
            { name: 'nw', x: obj.x, y: obj.y },
            { name: 'n', x: midX, y: obj.y },
            { name: 'ne', x: obj.x + obj.width, y: obj.y },
            { name: 'e', x: obj.x + obj.width, y: midY },
            { name: 'se', x: obj.x + obj.width, y: obj.y + obj.height },
            { name: 's', x: midX, y: obj.y + obj.height },
            { name: 'sw', x: obj.x, y: obj.y + obj.height },
            { name: 'w', x: obj.x, y: midY }
        ];

        for (const handle of handles) {
            const dx = x - handle.x;
            const dy = y - handle.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= handleRadius) {
                return handle.name;
            }
        }
        return null;
    }

    resizeObject(obj, handle, mouseX, mouseY) {
        const minSize = 50; // Minimum width/height

        switch (handle) {
            case 'se': // Bottom-right
                obj.width = Math.max(minSize, mouseX - obj.x);
                obj.height = Math.max(minSize, mouseY - obj.y);
                break;
            case 'sw': // Bottom-left
                const newWidth = Math.max(minSize, (obj.x + obj.width) - mouseX);
                const oldX = obj.x;
                obj.x = (obj.x + obj.width) - newWidth;
                obj.width = newWidth;
                obj.height = Math.max(minSize, mouseY - obj.y);
                break;
            case 'ne': // Top-right
                const newHeight = Math.max(minSize, (obj.y + obj.height) - mouseY);
                obj.y = (obj.y + obj.height) - newHeight;
                obj.width = Math.max(minSize, mouseX - obj.x);
                obj.height = newHeight;
                break;
            case 'nw': // Top-left
                const newW = Math.max(minSize, (obj.x + obj.width) - mouseX);
                const newH = Math.max(minSize, (obj.y + obj.height) - mouseY);
                obj.x = (obj.x + obj.width) - newW;
                obj.y = (obj.y + obj.height) - newH;
                obj.width = newW;
                obj.height = newH;
                break;
            case 'e': // Right edge
                obj.width = Math.max(minSize, mouseX - obj.x);
                break;
            case 'w': // Left edge
                const w = Math.max(minSize, (obj.x + obj.width) - mouseX);
                obj.x = (obj.x + obj.width) - w;
                obj.width = w;
                break;
            case 's': // Bottom edge
                obj.height = Math.max(minSize, mouseY - obj.y);
                break;
            case 'n': // Top edge
                const h = Math.max(minSize, (obj.y + obj.height) - mouseY);
                obj.y = (obj.y + obj.height) - h;
                obj.height = h;
                break;
        }
    }

    selectObject(obj) {
        if (this.selectedObject === obj) return;

        this.selectedObject = obj;
        this.canvas.needsRender = true;

        // Dispatch event for UI to update
        const event = new CustomEvent('objectSelected', { detail: obj });
        this.canvas.canvas.dispatchEvent(event);
    }

    deselectAll() {
        if (this.selectedObject) {
            this.selectedObject = null;
            this.canvas.needsRender = true;
            this.stopTextEdit();

            // Dispatch event for UI
            const event = new CustomEvent('objectDeselected');
            this.canvas.canvas.dispatchEvent(event);
        }
    }

    updateSelectedObject(properties) {
        if (this.selectedObject) {
            console.log('Updating object:', this.selectedObject.id, 'with properties:', properties);
            Object.assign(this.selectedObject, properties);
            this.canvas.needsRender = true;
            this.dispatchObjectsChanged();
        }
    }

    deleteSelectedObject() {
        if (this.selectedObject) {
            const index = this.objects.indexOf(this.selectedObject);
            if (index > -1) {
                this.objects.splice(index, 1);
                this.deselectAll();
                this.dispatchObjectsChanged();
            }
        }
    }

    deleteObject(id) {
        const index = this.objects.findIndex(obj => obj.id === id);
        if (index > -1) {
            if (this.selectedObject && this.selectedObject.id === id) {
                this.deselectAll();
            }
            this.objects.splice(index, 1);
            this.dispatchObjectsChanged();
        }
    }

    dispatchObjectsChanged() {
        const event = new CustomEvent('objectsChanged', {
            detail: { objects: this.objects }
        });
        this.canvas.canvas.dispatchEvent(event);
    }

    render(ctx) {
        // Render all objects
        for (const obj of this.objects) {
            this.renderObject(ctx, obj);
        }

        // Render preview
        if (this.previewObject) {
            this.renderObject(ctx, this.previewObject, true);
        }

        // Render selection
        if (this.selectedObject) {
            this.renderSelection(ctx, this.selectedObject);
        }
    }

    renderObject(ctx, obj, isPreview = false) {
        ctx.save();

        if (obj.type === 'shape') {
            this.renderShape(ctx, obj, isPreview);
        } else if (obj.type === 'text') {
            this.renderText(ctx, obj, isPreview);
        }

        ctx.restore();
    }

    renderShape(ctx, shape, isPreview) {
        ctx.fillStyle = shape.fillColor;
        ctx.strokeStyle = shape.strokeColor;
        ctx.lineWidth = shape.strokeWidth;

        if (isPreview) {
            ctx.globalAlpha = 0.7;
        }

        const centerX = shape.x + shape.width / 2;
        const centerY = shape.y + shape.height / 2;

        switch (shape.shapeType) {
            case 'rectangle':
                ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                if (shape.strokeWidth > 0) {
                    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                }
                break;

            case 'circle':
                const radius = Math.min(shape.width, shape.height) / 2;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.fill();
                if (shape.strokeWidth > 0) {
                    ctx.stroke();
                }
                break;

            case 'triangle':
                ctx.beginPath();
                ctx.moveTo(centerX, shape.y);
                ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
                ctx.lineTo(shape.x, shape.y + shape.height);
                ctx.closePath();
                ctx.fill();
                if (shape.strokeWidth > 0) {
                    ctx.stroke();
                }
                break;

            case 'polygon':
                const sides = shape.sides || 6;
                const polygonRadius = Math.min(shape.width, shape.height) / 2;
                ctx.beginPath();
                for (let i = 0; i < sides; i++) {
                    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
                    const x = centerX + polygonRadius * Math.cos(angle);
                    const y = centerY + polygonRadius * Math.sin(angle);
                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.closePath();
                ctx.fill();
                if (shape.strokeWidth > 0) {
                    ctx.stroke();
                }
                break;
        }
    }

    renderText(ctx, textObj, isPreview) {
        const padding = textObj.padding || 10;
        const zoom = this.canvas.zoom;

        // Background - always render to prevent disappearing
        ctx.fillStyle = textObj.backgroundColor || '#ffffff';
        ctx.fillRect(textObj.x, textObj.y, textObj.width, textObj.height);

        // Border - always render to prevent disappearing
        ctx.strokeStyle = '#d0d0d0';
        ctx.lineWidth = 1 / zoom;
        ctx.strokeRect(textObj.x, textObj.y, textObj.width, textObj.height);

        // Skip rendering text if currently editing (will be handled by HTML overlay)
        if (this.editingTextId === textObj.id) {
            return;
        }

        // Text - use defaults if properties are missing
        ctx.fillStyle = textObj.color || '#000000';
        ctx.font = `${textObj.fontSize || 16}px ${textObj.font || 'Arial'}`;
        ctx.textAlign = textObj.align || 'left';
        ctx.textBaseline = 'top';

        const text = textObj.text !== undefined ? textObj.text : 'Double-click to edit';
        const lines = this.wrapText(ctx, text, textObj.width - padding * 2);
        const lineHeight = (textObj.fontSize || 16) * 1.2;

        let textX = textObj.x + padding;
        if (textObj.align === 'center') {
            textX = textObj.x + textObj.width / 2;
        } else if (textObj.align === 'right') {
            textX = textObj.x + textObj.width - padding;
        }

        for (let i = 0; i < lines.length; i++) {
            const y = textObj.y + padding + i * lineHeight;
            if (y + lineHeight <= textObj.y + textObj.height - padding) {
                ctx.fillText(lines[i], textX, y);
            }
        }
    }

    wrapText(ctx, text, maxWidth) {
        // Always return at least an empty string to avoid disappearing text
        if (text === null || text === undefined) {
            return [''];
        }

        // Convert to string if not already
        text = String(text);

        // If completely empty, return empty string array to show the box
        if (text === '') {
            return [''];
        }

        const lines = [];
        const paragraphs = text.split('\n');

        for (const paragraph of paragraphs) {
            // Preserve empty lines for spacing
            if (paragraph === '') {
                lines.push('');
                continue;
            }

            const words = paragraph.split(' ');
            let currentLine = '';

            for (const word of words) {
                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }

            // Always push the current line, even if empty
            lines.push(currentLine);
        }

        return lines.length > 0 ? lines : [''];
    }

    renderSelection(ctx, obj) {
        const zoom = this.canvas.zoom;

        // Selection box - same style as images
        ctx.strokeStyle = '#0066ff';
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);

        // Resize handles - same style as images
        const handleRadius = 4 / zoom;
        const midX = obj.x + obj.width / 2;
        const midY = obj.y + obj.height / 2;

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0066ff';
        ctx.lineWidth = 1.5 / zoom;

        const handles = [
            [obj.x, obj.y],
            [midX, obj.y],
            [obj.x + obj.width, obj.y],
            [obj.x + obj.width, midY],
            [obj.x + obj.width, obj.y + obj.height],
            [midX, obj.y + obj.height],
            [obj.x, obj.y + obj.height],
            [obj.x, midY]
        ];

        for (let i = 0; i < handles.length; i++) {
            const [hx, hy] = handles[i];
            ctx.beginPath();
            ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }

    generateId() {
        return 'obj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getObjects() {
        return this.objects;
    }

    loadObjects(objects) {
        this.objects = objects || [];
        this.canvas.needsRender = true;
    }

    clear() {
        this.objects = [];
        this.selectedObject = null;
        this.canvas.needsRender = true;
    }
}
