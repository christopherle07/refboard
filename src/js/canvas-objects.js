// Canvas Objects Manager - Handles shapes
export class CanvasObjectsManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.objects = [];
        this.selectedObject = null;
        this.selectedObjects = [];
        this.currentTool = null;
        this.isDrawing = false;
        this.startPoint = null;
        this.previewObject = null;
        this.isDragging = false;
        this.isResizing = false;
        this.resizeHandle = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragOffsets = [];
        this.resizeStart = { x: 0, y: 0, width: 0, height: 0 };
        this.isBoxSelecting = false;
        this.selectionBox = null;
    }

    setTool(tool) {
        this.currentTool = tool;
        if (tool) {
            this.deselectAll();
        }
    }

    handleMouseDown(e, worldPos) {
        // Rotation handle check is now done in canvas.js before this function is called

        // Check if clicking on a resize handle of selected object (single selection only)
        if (this.selectedObject && this.selectedObjects.length === 1 && !this.currentTool) {
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

            // Support both Shift and Ctrl/Cmd for multi-select
            const multiSelect = e.shiftKey || e.ctrlKey || e.metaKey;

            // Check if clicking an already selected object
            const isAlreadySelected = this.selectedObjects.some(obj => obj.id === clickedObject.id);

            // If a group is selected and clicking on a member of that group, keep group intact
            if (this.canvas.selectedGroup && isAlreadySelected) {
                // Just start dragging, don't change selection
                this.isDragging = true;

                // Calculate drag offsets for all selected objects
                this.dragOffsets = this.selectedObjects.map(obj => ({
                    x: worldPos.x - obj.x,
                    y: worldPos.y - obj.y
                }));

                // Also setup drag offsets for all selected images in the group
                this.canvas.dragOffsets.clear();
                for (const img of this.canvas.selectedImages) {
                    this.canvas.dragOffsets.set(img.id, {
                        x: worldPos.x - img.x,
                        y: worldPos.y - img.y
                    });
                }

                return true;
            }

            // If clicking an already selected object without modifier keys, keep all selections
            if (!isAlreadySelected || multiSelect) {
                this.selectObject(clickedObject, multiSelect);
            }

            // Clear image selection when selecting objects (but not if group is selected)
            if (this.canvas.selectedImages.length > 0 && !this.canvas.selectedGroup) {
                this.canvas.selectImage(null);
            }

            this.isDragging = true;

            // Calculate drag offsets for all selected objects
            this.dragOffsets = this.selectedObjects.map(obj => ({
                x: worldPos.x - obj.x,
                y: worldPos.y - obj.y
            }));

            return true;
        }

        // No object clicked - deselect and potentially start box selection if no tool active
        if (!this.currentTool) {
            // Deselect all objects if not holding shift/ctrl
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                this.deselectAll();
            }

            // Don't start box selection here - let canvas.js handle it
            // to allow unified box selection of both images and objects
            return false;
        }

        // Start drawing text or shape if tool is active
        if (this.currentTool === 'text' || this.currentTool === 'shape') {
            this.isDrawing = true;
            this.startPoint = { x: worldPos.x, y: worldPos.y };
            return true;
        }

        return false;
    }

    handleMouseMove(e, worldPos) {
        if (this.isResizing && this.selectedObject && this.resizeHandle) {
            // Resize the selected object
            this.resizeObject(this.selectedObject, this.resizeHandle, worldPos.x, worldPos.y);
            this.canvas.needsRender = true;
            this.dispatchObjectsChanged();
        } else if (this.isDragging && this.selectedObjects.length > 0) {
            // Drag all selected objects
            this.selectedObjects.forEach((obj, index) => {
                const offset = this.dragOffsets[index];
                const newX = worldPos.x - offset.x;
                const newY = worldPos.y - offset.y;

                // For lines/arrows, move both start and end points
                if (obj.type === 'shape' &&
                    (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
                    const deltaX = newX - obj.x;
                    const deltaY = newY - obj.y;

                    obj.x = newX;
                    obj.y = newY;
                    if (obj.x2 !== undefined) {
                        obj.x2 += deltaX;
                    }
                    if (obj.y2 !== undefined) {
                        obj.y2 += deltaY;
                    }
                } else {
                    // Normal objects just move x and y
                    obj.x = newX;
                    obj.y = newY;
                }
            });

            // If a group is selected, also move all selected images
            if (this.canvas.selectedGroup && this.canvas.selectedImages.length > 0) {
                // Move all images using their drag offsets
                this.canvas.selectedImages.forEach(img => {
                    if (!this.canvas.dragOffsets.has(img.id)) {
                        // Initialize drag offset if not already set
                        this.canvas.dragOffsets.set(img.id, {
                            x: worldPos.x - img.x,
                            y: worldPos.y - img.y
                        });
                    }
                    const imgOffset = this.canvas.dragOffsets.get(img.id);
                    img.x = worldPos.x - imgOffset.x;
                    img.y = worldPos.y - imgOffset.y;
                });
            }

            this.canvas.needsRender = true;
            this.dispatchObjectsChanged();
        } else if (this.isDrawing && this.currentTool === 'text' && this.startPoint) {
            // Preview text box as user drags
            const x = Math.min(this.startPoint.x, worldPos.x);
            const y = Math.min(this.startPoint.y, worldPos.y);
            const width = Math.abs(worldPos.x - this.startPoint.x);
            const height = Math.abs(worldPos.y - this.startPoint.y);

            this.previewObject = {
                type: 'text',
                x, y, width, height,
                text: 'Text',
                fontSize: 32,
                fontFamily: 'Arial',
                fontWeight: 'normal',
                color: '#000000',
                textAlign: 'left'
            };
            this.canvas.needsRender = true;
        } else if (this.isDrawing && this.currentTool === 'shape' && this.startPoint) {
            // Preview shape as user drags
            const shapeType = this.currentShapeSettings?.type || 'square';

            if (shapeType === 'line' || shapeType === 'arrow') {
                // For lines/arrows, use direct start and end points
                this.previewObject = {
                    type: 'shape',
                    shapeType: shapeType,
                    x: this.startPoint.x,
                    y: this.startPoint.y,
                    x2: worldPos.x,
                    y2: worldPos.y,
                    width: 0,
                    height: 0,
                    fillColor: this.currentShapeSettings?.fillColor || '#3b82f6',
                    hasStroke: this.currentShapeSettings?.hasStroke !== false,
                    strokeColor: this.currentShapeSettings?.strokeColor || '#000000',
                    strokeWidth: this.currentShapeSettings?.strokeWidth || 2
                };
            } else {
                // For other shapes, use bounding box
                const x = Math.min(this.startPoint.x, worldPos.x);
                const y = Math.min(this.startPoint.y, worldPos.y);
                const width = Math.abs(worldPos.x - this.startPoint.x);
                const height = Math.abs(worldPos.y - this.startPoint.y);

                this.previewObject = {
                    type: 'shape',
                    x, y, width, height,
                    shapeType: shapeType,
                    fillColor: this.currentShapeSettings?.fillColor || '#3b82f6',
                    hasStroke: this.currentShapeSettings?.hasStroke !== false,
                    strokeColor: this.currentShapeSettings?.strokeColor || '#000000',
                    strokeWidth: this.currentShapeSettings?.strokeWidth || 2
                };
            }
            this.canvas.needsRender = true;
        }
    }

    handleMouseUp(e, worldPos) {
        if (this.isResizing) {
            this.isResizing = false;
            this.resizeHandle = null;
            return true;
        }
        if (this.isDragging) {
            this.isDragging = false;
            return true;
        }
        if (this.isDrawing && this.currentTool === 'text' && this.startPoint) {
            // Create text object
            const x = Math.min(this.startPoint.x, worldPos.x);
            const y = Math.min(this.startPoint.y, worldPos.y);
            const width = Math.abs(worldPos.x - this.startPoint.x);
            const height = Math.abs(worldPos.y - this.startPoint.y);

            // Only create if dragged a reasonable size
            if (width > 30 && height > 20) {
                const textObj = {
                    id: this.generateId(),
                    type: 'text',
                    x, y, width, height,
                    text: 'Double-click to edit',
                    fontSize: 32,
                    fontFamily: 'Arial',
                    fontWeight: 'normal',
                    color: '#000000',
                    textAlign: 'left',
                    visible: true,
                    zIndex: this.getNextZIndex()
                };

                this.objects.push(textObj);
                this.selectObject(textObj);
                this.dispatchObjectsChanged();

                // Exit text tool mode after creating textbox
                this.setTool(null);
                // Dispatch event to update UI button state
                const event = new CustomEvent('toolChanged', { detail: { tool: null } });
                this.canvas.canvas.dispatchEvent(event);
            }

            this.isDrawing = false;
            this.startPoint = null;
            this.previewObject = null;
            this.canvas.needsRender = true;
            return true;
        }

        if (this.isDrawing && this.currentTool === 'shape' && this.startPoint) {
            // Create shape object
            const shapeType = this.currentShapeSettings?.type || 'square';

            // For lines and arrows, store start and end points directly
            // For other shapes, normalize to top-left corner with width/height
            let shapeObj;
            const distance = Math.sqrt(
                Math.pow(worldPos.x - this.startPoint.x, 2) +
                Math.pow(worldPos.y - this.startPoint.y, 2)
            );

            // Only create if dragged a reasonable distance
            if (distance > 10) {
                if (shapeType === 'line' || shapeType === 'arrow') {
                    // Store actual start/end for lines and arrows
                    shapeObj = {
                        id: this.generateId(),
                        type: 'shape',
                        shapeType: shapeType,
                        x: this.startPoint.x,
                        y: this.startPoint.y,
                        x2: worldPos.x,
                        y2: worldPos.y,
                        width: 0,  // Not used for lines
                        height: 0, // Not used for lines
                        fillColor: this.currentShapeSettings?.fillColor || '#3b82f6',
                        hasStroke: this.currentShapeSettings?.hasStroke !== false,
                        strokeColor: this.currentShapeSettings?.strokeColor || '#000000',
                        strokeWidth: this.currentShapeSettings?.strokeWidth || 2,
                        visible: true,
                        zIndex: this.getNextZIndex()
                    };
                } else {
                    // Normal shapes use bounding box
                    const x = Math.min(this.startPoint.x, worldPos.x);
                    const y = Math.min(this.startPoint.y, worldPos.y);
                    const width = Math.abs(worldPos.x - this.startPoint.x);
                    const height = Math.abs(worldPos.y - this.startPoint.y);

                    shapeObj = {
                        id: this.generateId(),
                        type: 'shape',
                        x, y, width, height,
                        shapeType: shapeType,
                        fillColor: this.currentShapeSettings?.fillColor || '#3b82f6',
                        hasStroke: this.currentShapeSettings?.hasStroke !== false,
                        strokeColor: this.currentShapeSettings?.strokeColor || '#000000',
                        strokeWidth: this.currentShapeSettings?.strokeWidth || 2,
                        visible: true,
                        zIndex: this.getNextZIndex()
                    };
                }

                this.objects.push(shapeObj);
                this.selectObject(shapeObj);
                this.dispatchObjectsChanged();

                // Exit shape tool mode after creating shape
                this.setTool(null);
                // Dispatch event to update UI button state
                const event = new CustomEvent('toolChanged', { detail: { tool: null } });
                this.canvas.canvas.dispatchEvent(event);
            }

            this.isDrawing = false;
            this.startPoint = null;
            this.previewObject = null;
            this.canvas.needsRender = true;
            return true;
        }
        return false;
    }

    handleDoubleClick(e, worldPos) {
        const clickedObject = this.getObjectAtPoint(worldPos.x, worldPos.y);
        if (clickedObject && clickedObject.type === 'text') {
            // Double-click on text opens inline edit mode
            this.selectObject(clickedObject, true);
            this.startInlineTextEdit(clickedObject);
            return true;
        }
        return false;
    }

    startInlineTextEdit(textObj) {
        // Set the text object to editing mode
        textObj.isEditing = true;

        // Store reference to editing object
        this.editingTextObject = textObj;

        // Create visible textarea for editing
        const textarea = document.createElement('textarea');
        textarea.className = 'inline-text-editor-visible';
        textarea.value = textObj.text || '';

        // Position the textarea at the text object's location
        const rect = this.canvas.canvas.getBoundingClientRect();
        const screenPos = this.canvas.worldToScreen(textObj.x, textObj.y);
        const scaledWidth = textObj.width * this.canvas.zoom;
        const scaledHeight = textObj.height * this.canvas.zoom;

        textarea.style.position = 'absolute';
        textarea.style.left = `${rect.left + screenPos.x}px`;
        textarea.style.top = `${rect.top + screenPos.y}px`;
        textarea.style.width = `${scaledWidth}px`;
        textarea.style.height = `${scaledHeight}px`;
        textarea.style.fontSize = `${(textObj.fontSize || 32) * this.canvas.zoom}px`;
        textarea.style.fontFamily = textObj.fontFamily || 'Arial';
        textarea.style.fontWeight = textObj.fontWeight || 'normal';
        textarea.style.color = textObj.color || '#000000';
        textarea.style.textAlign = textObj.textAlign || 'left';
        textarea.style.padding = `${10 * this.canvas.zoom}px`;
        textarea.style.lineHeight = '1.2';

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        // Update text as user types
        textarea.addEventListener('input', () => {
            textObj.text = textarea.value;
            this.canvas.needsRender = true;
        });

        // Finish editing
        const finishEditing = () => {
            textObj.isEditing = false;
            this.editingTextObject = null;
            textarea.remove();
            this.canvas.needsRender = true;
            this.dispatchObjectsChanged();
        };

        textarea.addEventListener('blur', finishEditing);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finishEditing();
            }
        });
    }

    getObjectAtPoint(x, y) {
        // Sort objects by zIndex (highest first = on top)
        const sortedObjects = [...this.objects].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

        // Check in zIndex order (highest zIndex = topmost)
        for (const obj of sortedObjects) {
            // Special handling for lines and arrows
            if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
                const x1 = obj.x;
                const y1 = obj.y;
                const x2 = obj.x2 !== undefined ? obj.x2 : obj.x + obj.width;
                const y2 = obj.y2 !== undefined ? obj.y2 : obj.y + obj.height;

                // Calculate distance from point to line
                const A = x - x1;
                const B = y - y1;
                const C = x2 - x1;
                const D = y2 - y1;

                const dot = A * C + B * D;
                const lenSq = C * C + D * D;
                let param = -1;
                if (lenSq !== 0) param = dot / lenSq;

                let xx, yy;
                if (param < 0) {
                    xx = x1;
                    yy = y1;
                } else if (param > 1) {
                    xx = x2;
                    yy = y2;
                } else {
                    xx = x1 + param * C;
                    yy = y1 + param * D;
                }

                const dx = x - xx;
                const dy = y - yy;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Click within 10 pixels of the line
                const threshold = Math.max(10, (obj.strokeWidth || 5) + 5);
                if (distance <= threshold) {
                    return obj;
                }
            } else {
                // Normal bounding box check for other shapes
                if (x >= obj.x && x <= obj.x + obj.width &&
                    y >= obj.y && y <= obj.y + obj.height) {
                    return obj;
                }
            }
        }
        return null;
    }

    getResizeHandleAtPoint(obj, x, y) {
        const handleRadius = 8 / this.canvas.zoom; // Slightly larger hit area

        // Special handling for lines and arrows - only start and end handles
        if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
            const x1 = obj.x;
            const y1 = obj.y;
            const x2 = obj.x2 !== undefined ? obj.x2 : obj.x + obj.width;
            const y2 = obj.y2 !== undefined ? obj.y2 : obj.y + obj.height;

            const handles = [
                { name: 'start', x: x1, y: y1 },
                { name: 'end', x: x2, y: y2 }
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

        // Normal shapes - 8 resize handles
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

    isPointOnObjectRotationHandle(obj, x, y) {
        // Check if point is on the rotation handle for an object
        const handleSize = 10 / this.canvas.zoom;
        const midX = obj.x + obj.width / 2;
        const midY = obj.y + obj.height / 2;
        const rotationHandleOffset = 30 / this.canvas.zoom;

        // The rotation handle is at the top center in unrotated space
        let handleX = midX;
        let handleY = obj.y - rotationHandleOffset;

        // If object is rotated, rotate the handle position around the object center
        if (obj.rotation && obj.rotation !== 0) {
            const angleRad = (obj.rotation * Math.PI) / 180;

            // Vector from center to handle
            const dx = handleX - midX;
            const dy = handleY - midY;

            // Rotate the vector
            const rotatedDx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
            const rotatedDy = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);

            // New handle position
            handleX = midX + rotatedDx;
            handleY = midY + rotatedDy;
        }

        const dx = x - handleX;
        const dy = y - handleY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        return distance < handleSize;
    }

    resizeObject(obj, handle, mouseX, mouseY) {
        // Special handling for lines and arrows
        if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
            if (handle === 'start') {
                // Move the start point
                obj.x = mouseX;
                obj.y = mouseY;
            } else if (handle === 'end') {
                // Move the end point
                obj.x2 = mouseX;
                obj.y2 = mouseY;
            }
            return;
        }

        // Special handling for color palettes - scale cellSize proportionally
        if (obj.type === 'colorPalette') {
            const originalWidth = obj.width;
            const originalHeight = obj.height;
            let newWidth = obj.width;
            let newHeight = obj.height;

            const minSize = 60; // Minimum cell size

            switch (handle) {
                case 'se': // Bottom-right
                    newWidth = Math.max(minSize, mouseX - obj.x);
                    newHeight = Math.max(minSize, mouseY - obj.y);
                    break;
                case 'sw': // Bottom-left
                    newWidth = Math.max(minSize, (obj.x + obj.width) - mouseX);
                    newHeight = Math.max(minSize, mouseY - obj.y);
                    obj.x = (obj.x + obj.width) - newWidth;
                    break;
                case 'ne': // Top-right
                    newWidth = Math.max(minSize, mouseX - obj.x);
                    newHeight = Math.max(minSize, (obj.y + obj.height) - mouseY);
                    obj.y = (obj.y + obj.height) - newHeight;
                    break;
                case 'nw': // Top-left
                    newWidth = Math.max(minSize, (obj.x + obj.width) - mouseX);
                    newHeight = Math.max(minSize, (obj.y + obj.height) - mouseY);
                    obj.x = (obj.x + obj.width) - newWidth;
                    obj.y = (obj.y + obj.height) - newHeight;
                    break;
                case 'e': // Right edge
                    newWidth = Math.max(minSize, mouseX - obj.x);
                    newHeight = obj.height; // Keep height
                    break;
                case 'w': // Left edge
                    newWidth = Math.max(minSize, (obj.x + obj.width) - mouseX);
                    newHeight = obj.height; // Keep height
                    obj.x = (obj.x + obj.width) - newWidth;
                    break;
                case 's': // Bottom edge
                    newWidth = obj.width; // Keep width
                    newHeight = Math.max(minSize, mouseY - obj.y);
                    break;
                case 'n': // Top edge
                    newWidth = obj.width; // Keep width
                    newHeight = Math.max(minSize, (obj.y + obj.height) - mouseY);
                    obj.y = (obj.y + obj.height) - newHeight;
                    break;
            }

            // Calculate scale factor based on width (maintain aspect ratio based on original grid)
            const scaleFactor = newWidth / originalWidth;

            // Update cellSize and dimensions
            obj.cellSize = Math.max(20, obj.cellSize * scaleFactor);
            obj.width = obj.gridCols * obj.cellSize;
            obj.height = obj.hasWideCell ? (obj.gridRows + 1) * obj.cellSize : obj.gridRows * obj.cellSize;

            return;
        }

        // Normal shapes - minimum size constraint
        const minSize = 50;

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

    selectObject(obj, multiSelect = false, isDoubleClick = false) {
        const wasAlreadySelected = this.selectedObject === obj;

        if (multiSelect) {
            // Toggle selection in multi-select mode
            const index = this.selectedObjects.findIndex(o => o.id === obj.id);
            if (index >= 0) {
                this.selectedObjects.splice(index, 1);
            } else {
                this.selectedObjects.push(obj);
            }
            this.selectedObject = this.selectedObjects.length > 0
                ? this.selectedObjects[this.selectedObjects.length - 1]
                : null;
        } else {
            // Single select mode - clear other selections
            this.selectedObjects = [obj];
            this.selectedObject = obj;
        }

        this.canvas.needsRender = true;

        // Dispatch event for UI to update
        if (!wasAlreadySelected) {
            const event = new CustomEvent('objectSelected', { detail: obj });
            this.canvas.canvas.dispatchEvent(event);
        } else if (isDoubleClick) {
            // If already selected and double-clicked, focus the text input
            const event = new CustomEvent('objectDoubleClicked', { detail: obj });
            this.canvas.canvas.dispatchEvent(event);
        }
    }

    deselectAll() {
        console.log('Deselecting all objects. Was selected:', this.selectedObjects.length);
        this.selectedObject = null;
        this.selectedObjects = [];
        this.canvas.needsRender = true;

        // Dispatch event for UI
        const event = new CustomEvent('objectDeselected');
        this.canvas.canvas.dispatchEvent(event);

        console.log('After deselect - selectedObjects:', this.selectedObjects.length, 'needsRender:', this.canvas.needsRender);
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
        if (this.selectedObjects.length > 0) {
            // Delete all selected objects
            const idsToDelete = this.selectedObjects.map(obj => obj.id);
            this.objects = this.objects.filter(obj => !idsToDelete.includes(obj.id));
            this.deselectAll();
            this.dispatchObjectsChanged();
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
        // Render all visible objects
        if (this.objects.length > 0) {
            console.log('Rendering', this.objects.length, 'objects');
        }
        for (const obj of this.objects) {
            if (obj.visible !== false) {
                this.renderObject(ctx, obj);
            }
        }

        // Render preview
        if (this.previewObject) {
            this.renderObject(ctx, this.previewObject, true);
        }

        // Selection rendering is now handled by renderPreviewAndSelection()
    }

    renderSingle(ctx, obj) {
        // Render a single object (used for zIndex ordering)
        this.renderObject(ctx, obj);
    }

    renderPreviewAndSelection(ctx) {
        // Render preview if applicable
        if (this.previewObject) {
            this.renderObject(ctx, this.previewObject, true);
        }

        // Always render selection for selected objects (even in groups)
        // Group bounding box is rendered separately in canvas.js
        console.log('renderPreviewAndSelection - selectedObjects count:', this.selectedObjects.length);
        for (const obj of this.selectedObjects) {
            if (obj.visible !== false) {
                this.renderSelection(ctx, obj);
            }
        }
    }

    renderObject(ctx, obj, isPreview = false) {
        ctx.save();

        // Apply rotation if present
        if (obj.rotation && obj.rotation !== 0) {
            const centerX = obj.x + (obj.width || 0) / 2;
            const centerY = obj.y + (obj.height || 0) / 2;

            // For lines/arrows, use midpoint
            if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
                const midX = (obj.x + obj.x2) / 2;
                const midY = (obj.y + obj.y2) / 2;
                ctx.translate(midX, midY);
            } else {
                ctx.translate(centerX, centerY);
            }

            ctx.rotate((obj.rotation * Math.PI) / 180);

            // Translate back
            if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
                const midX = (obj.x + obj.x2) / 2;
                const midY = (obj.y + obj.y2) / 2;
                ctx.translate(-midX, -midY);
            } else {
                ctx.translate(-centerX, -centerY);
            }
        }

        if (obj.type === 'shape') {
            this.renderShape(ctx, obj, isPreview);
        } else if (obj.type === 'text') {
            this.renderText(ctx, obj, isPreview);
        } else if (obj.type === 'colorPalette') {
            this.renderColorPalette(ctx, obj, isPreview);
        }

        ctx.restore();
    }

    renderShape(ctx, shape, isPreview) {
        const hasStroke = shape.hasStroke !== false;
        const strokeWidth = shape.strokeWidth || 2;

        ctx.fillStyle = shape.fillColor || '#3b82f6';
        ctx.strokeStyle = shape.strokeColor || '#000000';
        ctx.lineWidth = strokeWidth;

        if (isPreview) {
            ctx.globalAlpha = 0.7;
        }

        const centerX = shape.x + shape.width / 2;
        const centerY = shape.y + shape.height / 2;

        switch (shape.shapeType) {
            case 'square':
            case 'rectangle':
                ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                if (hasStroke && strokeWidth > 0) {
                    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                }
                break;

            case 'circle':
                const radius = Math.min(shape.width, shape.height) / 2;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.fill();
                if (hasStroke && strokeWidth > 0) {
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
                if (hasStroke && strokeWidth > 0) {
                    ctx.stroke();
                }
                break;

            case 'line':
                // Use x2/y2 if available, otherwise use x+width/y+height
                const lineEndX = shape.x2 !== undefined ? shape.x2 : shape.x + shape.width;
                const lineEndY = shape.y2 !== undefined ? shape.y2 : shape.y + shape.height;

                console.log('Rendering line with strokeWidth:', strokeWidth, 'from shape.strokeWidth:', shape.strokeWidth);
                ctx.beginPath();
                ctx.moveTo(shape.x, shape.y);
                ctx.lineTo(lineEndX, lineEndY);
                ctx.lineWidth = strokeWidth;
                ctx.strokeStyle = shape.strokeColor || '#000000';
                ctx.stroke();
                break;

            case 'arrow':
                // Use x2/y2 if available, otherwise use x+width/y+height
                const arrowEndX = shape.x2 !== undefined ? shape.x2 : shape.x + shape.width;
                const arrowEndY = shape.y2 !== undefined ? shape.y2 : shape.y + shape.height;

                // Draw arrow line
                ctx.beginPath();
                ctx.moveTo(shape.x, shape.y);
                ctx.lineTo(arrowEndX, arrowEndY);
                ctx.lineWidth = strokeWidth;
                ctx.strokeStyle = shape.strokeColor || '#000000';
                ctx.stroke();

                // Draw arrowhead
                const arrowSize = Math.max(10, strokeWidth * 3);
                const angle = Math.atan2(arrowEndY - shape.y, arrowEndX - shape.x);

                ctx.beginPath();
                ctx.moveTo(arrowEndX, arrowEndY);
                ctx.lineTo(
                    arrowEndX - arrowSize * Math.cos(angle - Math.PI / 6),
                    arrowEndY - arrowSize * Math.sin(angle - Math.PI / 6)
                );
                ctx.moveTo(arrowEndX, arrowEndY);
                ctx.lineTo(
                    arrowEndX - arrowSize * Math.cos(angle + Math.PI / 6),
                    arrowEndY - arrowSize * Math.sin(angle + Math.PI / 6)
                );
                ctx.stroke();
                break;
        }
    }

    renderText(ctx, textObj, isPreview) {
        if (isPreview) {
            // Draw textbox border preview when creating
            const zoom = this.canvas.zoom;
            ctx.strokeStyle = '#999999';
            ctx.lineWidth = 1 / zoom;
            ctx.strokeRect(textObj.x, textObj.y, textObj.width, textObj.height);
            ctx.globalAlpha = 0.7;
        }

        const text = textObj.text || '';
        const fontSize = textObj.fontSize || 32;
        const fontFamily = textObj.fontFamily || 'Arial';
        const fontWeight = textObj.fontWeight || 'normal';
        const color = textObj.color || '#000000';
        const textAlign = textObj.textAlign || 'left';

        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = color;
        ctx.textAlign = textAlign;
        ctx.textBaseline = 'top';

        const lineHeight = fontSize * 1.2;
        const padding = 10;
        const maxWidth = textObj.width - (padding * 2); // Padding from edges

        // Calculate text alignment offset
        let xOffset = padding; // Left padding
        if (textAlign === 'center') {
            xOffset = textObj.width / 2;
        } else if (textAlign === 'right') {
            xOffset = textObj.width - padding;
        }

        // Word wrap text to fit within textbox width
        const paragraphs = text.split('\n');
        const wrappedLines = [];

        for (const paragraph of paragraphs) {
            if (paragraph.trim() === '') {
                wrappedLines.push('');
                continue;
            }

            const words = paragraph.split(' ');
            let currentLine = '';

            for (let i = 0; i < words.length; i++) {
                const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
                const metrics = ctx.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    wrappedLines.push(currentLine);
                    currentLine = words[i];
                } else {
                    currentLine = testLine;
                }
            }

            if (currentLine) {
                wrappedLines.push(currentLine);
            }
        }

        // Clip to textbox boundaries to prevent overflow
        ctx.save();
        ctx.beginPath();
        ctx.rect(textObj.x, textObj.y, textObj.width, textObj.height);
        ctx.clip();

        // Draw each wrapped line (only if not editing - when editing, textarea shows the text)
        if (!textObj.isEditing) {
            wrappedLines.forEach((line, i) => {
                const y = textObj.y + padding + i * lineHeight; // Top padding
                ctx.fillText(line, textObj.x + xOffset, y);
            });
        }

        ctx.restore();
    }

    renderColorPalette(ctx, palette, isPreview) {
        if (isPreview) {
            ctx.globalAlpha = 0.7;
        }

        const cellSize = palette.cellSize || 60;
        const gridCols = palette.gridCols || 1;
        const gridRows = palette.gridRows || 1;
        const hasWideCell = palette.hasWideCell || false;
        const colors = palette.colors || [];

        let colorIndex = 0;

        // Draw regular grid cells (all colors except the last one if hasWideCell)
        const regularCellCount = hasWideCell ? colors.length - 1 : colors.length;

        for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
                if (colorIndex >= regularCellCount) break;

                const x = palette.x + col * cellSize;
                const y = palette.y + row * cellSize;
                const color = colors[colorIndex];

                ctx.fillStyle = color.hex;
                ctx.fillRect(x, y, cellSize, cellSize);

                colorIndex++;
            }
        }

        // Draw wide cell at the bottom if needed
        if (hasWideCell && colorIndex < colors.length) {
            const wideX = palette.x;
            const wideY = palette.y + gridRows * cellSize;
            const wideWidth = gridCols * cellSize;
            const color = colors[colorIndex];

            ctx.fillStyle = color.hex;
            ctx.fillRect(wideX, wideY, wideWidth, cellSize);
        }

        // Draw border around entire palette
        ctx.strokeStyle = '#999999';
        ctx.lineWidth = 1 / this.canvas.zoom;
        ctx.strokeRect(palette.x, palette.y, palette.width, palette.height);
    }

    renderPaletteSwatchBar(ctx, bar, isPreview) {
        if (isPreview) {
            ctx.globalAlpha = 0.7;
        }

        // Use stored sizes from the bar object
        const swatchWidth = bar.swatchWidth || 40;
        const swatchHeight = bar.swatchHeight || 40;
        const gap = bar.gap || 8;
        const padding = bar.padding || 12;
        const borderRadius = 6 * (swatchWidth / 40); // Scale border radius

        // Draw background
        ctx.fillStyle = '#2a2a2a';
        this.roundRect(ctx, bar.x, bar.y, bar.width, bar.height, 8 * (swatchWidth / 40));
        ctx.fill();

        // Draw border
        ctx.strokeStyle = '#404040';
        ctx.lineWidth = 1 / this.canvas.zoom;
        this.roundRect(ctx, bar.x, bar.y, bar.width, bar.height, 8 * (swatchWidth / 40));
        ctx.stroke();

        // Draw color swatches
        let xOffset = bar.x + padding;
        const yOffset = bar.y + padding;

        for (const color of bar.colors) {
            const hexColor = typeof color === 'string' ? color : color.hex;

            // Draw swatch background
            ctx.fillStyle = hexColor;
            this.roundRect(ctx, xOffset, yOffset, swatchWidth, swatchHeight, borderRadius);
            ctx.fill();

            // Draw swatch border
            ctx.strokeStyle = '#606060';
            ctx.lineWidth = 2 / this.canvas.zoom;
            this.roundRect(ctx, xOffset, yOffset, swatchWidth, swatchHeight, borderRadius);
            ctx.stroke();

            xOffset += swatchWidth + gap;
        }
    }

    roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }


    renderSelection(ctx, obj) {
        const zoom = this.canvas.zoom;

        ctx.save();

        // Apply rotation if present
        if (obj.rotation && obj.rotation !== 0) {
            const centerX = obj.x + (obj.width || 0) / 2;
            const centerY = obj.y + (obj.height || 0) / 2;

            // For lines/arrows, use midpoint
            if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
                const midX = (obj.x + obj.x2) / 2;
                const midY = (obj.y + obj.y2) / 2;
                ctx.translate(midX, midY);
            } else {
                ctx.translate(centerX, centerY);
            }

            ctx.rotate((obj.rotation * Math.PI) / 180);

            // Translate back
            if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
                const midX = (obj.x + obj.x2) / 2;
                const midY = (obj.y + obj.y2) / 2;
                ctx.translate(-midX, -midY);
            } else {
                ctx.translate(-centerX, -centerY);
            }
        }

        // Special handling for lines and arrows
        if (obj.type === 'shape' && (obj.shapeType === 'line' || obj.shapeType === 'arrow')) {
            const x1 = obj.x;
            const y1 = obj.y;
            const x2 = obj.x2 !== undefined ? obj.x2 : obj.x + obj.width;
            const y2 = obj.y2 !== undefined ? obj.y2 : obj.y + obj.height;

            // Calculate bounding box
            const minX = Math.min(x1, x2);
            const minY = Math.min(y1, y2);
            const maxX = Math.max(x1, x2);
            const maxY = Math.max(y1, y2);
            const width = maxX - minX;
            const height = maxY - minY;

            // Add padding for better visibility
            const padding = 10;
            const boxX = minX - padding;
            const boxY = minY - padding;
            const boxWidth = width + padding * 2;
            const boxHeight = height + padding * 2;

            // Selection box
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 2 / zoom;
            ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

            // Draw handles at the start and end points only
            const handleRadius = 4 / zoom;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 1.5 / zoom;

            const handles = [
                [x1, y1],  // Start point
                [x2, y2]   // End point
            ];

            for (let i = 0; i < handles.length; i++) {
                const [hx, hy] = handles[i];
                ctx.beginPath();
                ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            // Draw rotation handle for line/arrow
            const rotationHandleOffset = 30 / zoom;
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const rotationHandleY = boxY - rotationHandleOffset;

            // Draw connecting line
            ctx.beginPath();
            ctx.moveTo(centerX, boxY);
            ctx.lineTo(centerX, rotationHandleY);
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 2 / zoom;
            ctx.stroke();

            // Draw rotation handle circle
            ctx.beginPath();
            ctx.arc(centerX, rotationHandleY, handleRadius * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 1.5 / zoom;
            ctx.stroke();

            // Draw rotation icon (circular arrow)
            ctx.save();
            ctx.translate(centerX, rotationHandleY);
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 1 / zoom;
            ctx.beginPath();
            ctx.arc(0, 0, handleRadius * 0.6, -Math.PI * 0.3, Math.PI * 1.5);
            ctx.stroke();
            // Arrow head
            ctx.beginPath();
            ctx.moveTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5), handleRadius * 0.6 * Math.sin(Math.PI * 1.5));
            ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) - 2 / zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / zoom);
            ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) + 2 / zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / zoom);
            ctx.closePath();
            ctx.fillStyle = '#0066ff';
            ctx.fill();
            ctx.restore();
        } else {
            // Normal selection box for other shapes
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 2 / zoom;
            ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);

            // Resize handles
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

            // Draw rotation handle extending upward from top center
            const rotationHandleOffset = 30 / zoom;

            // If object is rotated, draw in rotated space; otherwise draw normally
            if (obj.rotation && obj.rotation !== 0) {
                // Already in rotated space from ctx.save() above
                // Draw at top center in local coordinates
                const localMidX = obj.x + obj.width / 2;
                const localTopY = obj.y;
                const localHandleY = localTopY - rotationHandleOffset;

                // Draw connecting line
                ctx.beginPath();
                ctx.moveTo(localMidX, localTopY);
                ctx.lineTo(localMidX, localHandleY);
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 2 / zoom;
                ctx.stroke();

                // Draw rotation handle circle
                ctx.beginPath();
                ctx.arc(localMidX, localHandleY, handleRadius * 1.2, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 1.5 / zoom;
                ctx.stroke();

                // Draw rotation icon (circular arrow)
                ctx.save();
                ctx.translate(localMidX, localHandleY);
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 1 / zoom;
                ctx.beginPath();
                ctx.arc(0, 0, handleRadius * 0.6, -Math.PI * 0.3, Math.PI * 1.5);
                ctx.stroke();
                // Arrow head
                ctx.beginPath();
                ctx.moveTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5), handleRadius * 0.6 * Math.sin(Math.PI * 1.5));
                ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) - 2 / zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / zoom);
                ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) + 2 / zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / zoom);
                ctx.closePath();
                ctx.fillStyle = '#0066ff';
                ctx.fill();
                ctx.restore();
            } else {
                const rotationHandleY = obj.y - rotationHandleOffset;

                // Draw connecting line
                ctx.beginPath();
                ctx.moveTo(midX, obj.y);
                ctx.lineTo(midX, rotationHandleY);
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 2 / zoom;
                ctx.stroke();

                // Draw rotation handle circle
                ctx.beginPath();
                ctx.arc(midX, rotationHandleY, handleRadius * 1.2, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 1.5 / zoom;
                ctx.stroke();

                // Draw rotation icon (circular arrow)
                ctx.save();
                ctx.translate(midX, rotationHandleY);
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 1 / zoom;
                ctx.beginPath();
                ctx.arc(0, 0, handleRadius * 0.6, -Math.PI * 0.3, Math.PI * 1.5);
                ctx.stroke();
                // Arrow head
                ctx.beginPath();
                ctx.moveTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5), handleRadius * 0.6 * Math.sin(Math.PI * 1.5));
                ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) - 2 / zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / zoom);
                ctx.lineTo(handleRadius * 0.6 * Math.cos(Math.PI * 1.5) + 2 / zoom, handleRadius * 0.6 * Math.sin(Math.PI * 1.5) - 2 / zoom);
                ctx.closePath();
                ctx.fillStyle = '#0066ff';
                ctx.fill();
                ctx.restore();
            }
        }

        ctx.restore();
    }

    generateId() {
        return 'obj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getNextZIndex() {
        // Get highest zIndex from all objects
        let maxZIndex = -1;
        this.objects.forEach(obj => {
            const z = obj.zIndex || 0;
            if (z > maxZIndex) maxZIndex = z;
        });
        // Also check images
        this.canvas.images.forEach(img => {
            const z = img.zIndex || 0;
            if (z > maxZIndex) maxZIndex = z;
        });
        return maxZIndex + 1;
    }

    getObjects() {
        return this.objects;
    }

    loadObjects(objects) {
        console.log('CanvasObjectsManager.loadObjects called with:', objects);
        this.objects = objects || [];
        console.log('Objects loaded, count:', this.objects.length);
        this.canvas.needsRender = true;
    }

    clear() {
        this.objects = [];
        this.selectedObject = null;
        this.canvas.needsRender = true;
    }

    addText(x, y) {
        const textObj = {
            id: this.generateId(),
            type: 'text',
            x: x,
            y: y,
            width: 300,
            height: 100,
            text: 'Double-click to edit',
            fontSize: 32,
            fontFamily: 'Arial',
            fontWeight: 'normal',
            color: '#000000',
            textAlign: 'left'
        };

        this.objects.push(textObj);
        this.selectObject(textObj);
        this.canvas.needsRender = true;
        this.dispatchObjectsChanged();

        return textObj;
    }

}
