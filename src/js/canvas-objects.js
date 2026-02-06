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
        this.editingTextObject = null;
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
            let finalX = worldPos.x;
            let finalY = worldPos.y;

            // Apply snapping if enabled and only one object is selected
            if (this.canvas.enableSnapping && this.selectedObjects.length === 1) {
                const primaryObj = this.selectedObjects[0];
                const offset = this.dragOffsets[0];
                if (offset) {
                    const tentativeX = worldPos.x - offset.x;
                    const tentativeY = worldPos.y - offset.y;
                    const snapResult = this.canvas.snapToObjects(tentativeX, tentativeY, primaryObj);
                    finalX = snapResult.x + offset.x;
                    finalY = snapResult.y + offset.y;
                    this.canvas.snapLines = snapResult.guides;
                }
            } else {
                this.canvas.snapLines = [];
            }

            this.selectedObjects.forEach((obj, index) => {
                const offset = this.dragOffsets[index];
                const newX = finalX - offset.x;
                const newY = finalY - offset.y;

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
                const defaultStyle = this.getDefaultTextStyle();
                const textObj = {
                    id: this.generateId(),
                    type: 'text',
                    x, y, width, height,
                    content: [{ text: 'Double-click to edit', style: { ...defaultStyle } }],
                    defaultStyle: { ...defaultStyle },
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

        // Keep the object selected so properties panel stays visible
        this.selectedObject = textObj;
        this.selectedObjects = [textObj];

        // Dispatch event to show properties panel
        this.canvas.canvas.dispatchEvent(new CustomEvent('objectSelected', {
            detail: textObj
        }));

        // Migrate if needed
        this.migrateTextObject(textObj);

        // Create contenteditable div for rich text editing
        const editor = document.createElement('div');
        editor.className = 'rich-text-editor';
        editor.contentEditable = 'true';
        editor.spellcheck = false;

        // Function to position/size the editor based on current zoom/pan
        const updateEditorPosition = () => {
            const rect = this.canvas.canvas.getBoundingClientRect();
            const screenPos = this.canvas.worldToScreen(textObj.x, textObj.y);
            const zoom = this.canvas.zoom;
            const scaledWidth = textObj.width * zoom;
            const scaledHeight = textObj.height * zoom;

            editor.style.position = 'absolute';
            editor.style.left = `${rect.left + screenPos.x}px`;
            editor.style.top = `${rect.top + screenPos.y}px`;
            editor.style.width = `${scaledWidth}px`;
            editor.style.height = `${scaledHeight}px`;
            editor.style.padding = `${10 * zoom}px`;
            editor.style.textAlign = textObj.textAlign || 'left';

            // Update font sizes to match new zoom
            editor.innerHTML = this.contentToHTMLWithZoom(textObj.content, zoom);
        };

        // Initial positioning
        updateEditorPosition();

        document.body.appendChild(editor);
        this.activeEditor = editor;

        // Focus and select all
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // Sync changes back to content model
        const syncContent = () => {
            textObj.content = this.htmlToContent(editor, textObj.defaultStyle || this.getDefaultTextStyle());
            this.canvas.needsRender = true;
        };

        editor.addEventListener('input', syncContent);

        // Handle view changes (zoom/pan) - update editor position
        const handleViewChange = () => {
            if (this.activeEditor === editor) {
                // Save selection before updating
                const sel = window.getSelection();
                const hadFocus = document.activeElement === editor;

                // Sync content before repositioning
                syncContent();

                // Update position and content
                updateEditorPosition();

                // Restore focus
                if (hadFocus) {
                    editor.focus();
                    // Move cursor to end
                    if (sel && editor.lastChild) {
                        const newRange = document.createRange();
                        newRange.selectNodeContents(editor);
                        newRange.collapse(false);
                        sel.removeAllRanges();
                        sel.addRange(newRange);
                    }
                }
            }
        };

        this.canvas.canvas.addEventListener('viewChanged', handleViewChange);

        // Finish editing
        const finishEditing = () => {
            if (!textObj.isEditing) return; // Prevent double-finish
            textObj.isEditing = false;
            this.editingTextObject = null;
            this.activeEditor = null;
            this.canvas.canvas.removeEventListener('viewChanged', handleViewChange);
            editor.remove();
            this.canvas.needsRender = true;
            this.dispatchObjectsChanged();
        };

        // Handle blur - but ignore if clicking on toolbar
        editor.addEventListener('blur', (e) => {
            // Delay to check if focus moved to toolbar
            setTimeout(() => {
                const active = document.activeElement;
                const toolbar = document.getElementById('floating-text-toolbar');
                if (toolbar && (toolbar.contains(active) || toolbar.contains(e.relatedTarget))) {
                    // Focus moved to toolbar, don't finish editing
                    editor.focus();
                    return;
                }
                finishEditing();
            }, 100);
        });

        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finishEditing();
            }
        });

        // Store finish function for external access
        this.finishCurrentEdit = finishEditing;
    }

    // Convert content to HTML with zoom scaling applied to font sizes
    contentToHTMLWithZoom(content, zoom) {
        if (!Array.isArray(content)) return '';
        return content.map(span => {
            const style = span.style || {};
            const styleStr = [
                `font-size: ${(style.fontSize || 32) * zoom}px`,
                `font-family: ${style.fontFamily || 'Arial'}`,
                `font-weight: ${style.fontWeight || 'normal'}`,
                `font-style: ${style.fontStyle || 'normal'}`,
                `color: ${style.color || '#000000'}`,
                `text-decoration: ${style.textDecoration || 'none'}`
            ].join('; ');

            // Escape HTML and convert newlines to <br>
            const text = span.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');

            return `<span style="${styleStr}">${text}</span>`;
        }).join('');
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
            const originalX = obj.x;
            const originalY = obj.y;
            let newWidth = obj.width;
            let anchorX = obj.x; // Store anchor point (the corner that doesn't move)
            let anchorY = obj.y;

            const minSize = 60; // Minimum cell size

            switch (handle) {
                case 'se': // Bottom-right - anchor is top-left
                    newWidth = Math.max(minSize, mouseX - obj.x);
                    anchorX = obj.x;
                    anchorY = obj.y;
                    break;
                case 'sw': // Bottom-left - anchor is top-right
                    newWidth = Math.max(minSize, (obj.x + obj.width) - mouseX);
                    anchorX = obj.x + obj.width;
                    anchorY = obj.y;
                    break;
                case 'ne': // Top-right - anchor is bottom-left
                    newWidth = Math.max(minSize, mouseX - obj.x);
                    anchorX = obj.x;
                    anchorY = obj.y + obj.height;
                    break;
                case 'nw': // Top-left - anchor is bottom-right
                    newWidth = Math.max(minSize, (obj.x + obj.width) - mouseX);
                    anchorX = obj.x + obj.width;
                    anchorY = obj.y + obj.height;
                    break;
                case 'e': // Right edge - anchor is left edge
                    newWidth = Math.max(minSize, mouseX - obj.x);
                    anchorX = obj.x;
                    anchorY = obj.y;
                    break;
                case 'w': // Left edge - anchor is right edge
                    newWidth = Math.max(minSize, (obj.x + obj.width) - mouseX);
                    anchorX = obj.x + obj.width;
                    anchorY = obj.y;
                    break;
                case 's': // Bottom edge - anchor is top edge
                    newWidth = obj.width;
                    anchorX = obj.x;
                    anchorY = obj.y;
                    break;
                case 'n': // Top edge - anchor is bottom edge
                    newWidth = obj.width;
                    anchorX = obj.x;
                    anchorY = obj.y + obj.height;
                    break;
            }

            // Calculate scale factor based on width (maintain aspect ratio based on original grid)
            const scaleFactor = newWidth / originalWidth;

            // Update cellSize and dimensions
            obj.cellSize = Math.max(20, obj.cellSize * scaleFactor);
            obj.width = obj.gridCols * obj.cellSize;
            obj.height = obj.hasWideCell ? (obj.gridRows + 1) * obj.cellSize : obj.gridRows * obj.cellSize;

            // Recalculate position based on anchor point
            switch (handle) {
                case 'se': // Anchor at top-left
                    obj.x = anchorX;
                    obj.y = anchorY;
                    break;
                case 'sw': // Anchor at top-right
                    obj.x = anchorX - obj.width;
                    obj.y = anchorY;
                    break;
                case 'ne': // Anchor at bottom-left
                    obj.x = anchorX;
                    obj.y = anchorY - obj.height;
                    break;
                case 'nw': // Anchor at bottom-right
                    obj.x = anchorX - obj.width;
                    obj.y = anchorY - obj.height;
                    break;
                case 'e': // Anchor at left edge
                    obj.x = anchorX;
                    obj.y = anchorY;
                    break;
                case 'w': // Anchor at right edge
                    obj.x = anchorX - obj.width;
                    obj.y = anchorY;
                    break;
                case 's': // Anchor at top edge
                    obj.x = anchorX;
                    obj.y = anchorY;
                    break;
                case 'n': // Anchor at bottom edge
                    obj.x = anchorX;
                    obj.y = anchorY - obj.height;
                    break;
            }

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
        this.selectedObject = null;
        this.selectedObjects = [];
        this.canvas.needsRender = true;

        // Dispatch event for UI
        const event = new CustomEvent('objectDeselected');
        this.canvas.canvas.dispatchEvent(event);
    }

    updateSelectedObject(properties) {
        if (this.selectedObject) {
            Object.assign(this.selectedObject, properties);

            // If the object is currently being edited (textarea is visible), update textarea styling
            if (this.editingTextObject && this.editingTextObject.id === this.selectedObject.id) {
                const textarea = document.querySelector('.inline-text-editor-visible');
                if (textarea) {
                    if (properties.fontSize !== undefined) {
                        textarea.style.fontSize = `${properties.fontSize * this.canvas.zoom}px`;
                    }
                    if (properties.fontFamily !== undefined) {
                        textarea.style.fontFamily = properties.fontFamily;
                    }
                    if (properties.fontWeight !== undefined) {
                        textarea.style.fontWeight = properties.fontWeight;
                    }
                    if (properties.color !== undefined) {
                        textarea.style.color = properties.color;
                    }
                    if (properties.textAlign !== undefined) {
                        textarea.style.textAlign = properties.textAlign;
                    }
                }
            }

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
                const cornerRadius = shape.cornerRadius || 0;
                if (cornerRadius > 0) {
                    // Draw rounded rectangle
                    const x = shape.x;
                    const y = shape.y;
                    const width = shape.width;
                    const height = shape.height;
                    const radius = Math.min(cornerRadius, width / 2, height / 2);

                    ctx.beginPath();
                    ctx.moveTo(x + radius, y);
                    ctx.lineTo(x + width - radius, y);
                    ctx.arcTo(x + width, y, x + width, y + radius, radius);
                    ctx.lineTo(x + width, y + height - radius);
                    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
                    ctx.lineTo(x + radius, y + height);
                    ctx.arcTo(x, y + height, x, y + height - radius, radius);
                    ctx.lineTo(x, y + radius);
                    ctx.arcTo(x, y, x + radius, y, radius);
                    ctx.closePath();
                    ctx.fill();
                    if (hasStroke && strokeWidth > 0) {
                        ctx.stroke();
                    }
                } else {
                    // Draw regular rectangle
                    ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                    if (hasStroke && strokeWidth > 0) {
                        ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                    }
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

            case 'line':
                // Use x2/y2 if available, otherwise use x+width/y+height
                const lineEndX = shape.x2 !== undefined ? shape.x2 : shape.x + shape.width;
                const lineEndY = shape.y2 !== undefined ? shape.y2 : shape.y + shape.height;

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

        // Don't render text content while editing (contenteditable overlay shows it)
        if (textObj.isEditing) {
            return;
        }

        const textAlign = textObj.textAlign || 'left';
        const padding = 10;
        const maxWidth = textObj.width - (padding * 2);

        // Handle both legacy format and new rich text format
        const content = Array.isArray(textObj.content) ? textObj.content : [{
            text: textObj.text || '',
            style: {
                fontSize: textObj.fontSize || 32,
                fontFamily: textObj.fontFamily || 'Arial',
                fontWeight: textObj.fontWeight || 'normal',
                fontStyle: 'normal',
                color: textObj.color || '#000000',
                textDecoration: 'none'
            }
        }];

        // Get base font size for line height calculation
        const baseFontSize = content.length > 0 ? (content[0].style?.fontSize || 32) : 32;
        const lineHeight = baseFontSize * 1.2;

        // Convert content to styled segments (handling newlines)
        const segments = [];
        for (const span of content) {
            const parts = span.text.split('\n');
            parts.forEach((part, i) => {
                if (part || i < parts.length - 1) {
                    segments.push({
                        text: part,
                        style: span.style,
                        isLineBreak: i < parts.length - 1
                    });
                }
            });
        }

        // Word-wrap with style awareness
        const lines = this.wrapStyledText(ctx, segments, maxWidth);

        // Clip to textbox boundaries
        ctx.save();
        ctx.beginPath();
        ctx.rect(textObj.x, textObj.y, textObj.width, textObj.height);
        ctx.clip();

        // Draw each line
        ctx.textBaseline = 'top';
        let y = textObj.y + padding;

        for (const line of lines) {
            if (line.segments.length === 0) {
                y += lineHeight;
                continue;
            }

            // Calculate line width for alignment
            let lineWidth = 0;
            for (const seg of line.segments) {
                ctx.font = this.styleToFont(seg.style);
                lineWidth += ctx.measureText(seg.text).width;
            }

            // Calculate starting x position based on alignment
            let x = textObj.x + padding;
            if (textAlign === 'center') {
                x = textObj.x + (textObj.width - lineWidth) / 2;
            } else if (textAlign === 'right') {
                x = textObj.x + textObj.width - padding - lineWidth;
            }

            // Render each segment in the line
            for (const seg of line.segments) {
                const style = seg.style || {};
                ctx.font = this.styleToFont(style);
                ctx.fillStyle = style.color || '#000000';

                ctx.fillText(seg.text, x, y);

                const segWidth = ctx.measureText(seg.text).width;

                // Handle underline
                if (style.textDecoration === 'underline') {
                    ctx.strokeStyle = style.color || '#000000';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, y + (style.fontSize || 32) * 0.9);
                    ctx.lineTo(x + segWidth, y + (style.fontSize || 32) * 0.9);
                    ctx.stroke();
                }

                // Handle strikethrough
                if (style.textDecoration === 'line-through') {
                    ctx.strokeStyle = style.color || '#000000';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, y + (style.fontSize || 32) * 0.5);
                    ctx.lineTo(x + segWidth, y + (style.fontSize || 32) * 0.5);
                    ctx.stroke();
                }

                x += segWidth;
            }

            y += lineHeight;
        }

        ctx.restore();
    }

    // Convert style object to canvas font string
    styleToFont(style) {
        const fontStyle = style?.fontStyle || 'normal';
        const fontWeight = style?.fontWeight || 'normal';
        const fontSize = style?.fontSize || 32;
        const fontFamily = style?.fontFamily || 'Arial';
        return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    }

    // Word-wrap styled text segments
    wrapStyledText(ctx, segments, maxWidth) {
        const lines = [];
        let currentLine = { segments: [], width: 0 };

        for (const segment of segments) {
            if (segment.isLineBreak) {
                // Push current line and start new one
                lines.push(currentLine);
                currentLine = { segments: [], width: 0 };
                continue;
            }

            if (!segment.text) continue;

            ctx.font = this.styleToFont(segment.style);

            // Split into words
            const words = segment.text.split(/(\s+)/);

            for (const word of words) {
                if (!word) continue;

                const wordWidth = ctx.measureText(word).width;

                // Check if word fits on current line
                if (currentLine.width + wordWidth > maxWidth && currentLine.segments.length > 0) {
                    // Push current line and start new one
                    lines.push(currentLine);
                    currentLine = { segments: [], width: 0 };
                }

                // Add word to current line
                currentLine.segments.push({ text: word, style: segment.style });
                currentLine.width += wordWidth;
            }
        }

        // Don't forget the last line
        if (currentLine.segments.length > 0) {
            lines.push(currentLine);
        }

        return lines;
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
        this.objects = objects || [];
        // Migrate any legacy text objects to new rich text format
        this.objects.forEach(obj => this.migrateTextObject(obj));
        this.canvas.needsRender = true;
    }

    clear() {
        this.objects = [];
        this.selectedObject = null;
        this.canvas.needsRender = true;
    }

    addText(x, y) {
        const defaultStyle = this.getDefaultTextStyle();
        const textObj = {
            id: this.generateId(),
            type: 'text',
            x: x,
            y: y,
            width: 300,
            height: 100,
            content: [{ text: 'Double-click to edit', style: { ...defaultStyle } }],
            defaultStyle: { ...defaultStyle },
            textAlign: 'left',
            visible: true,
            zIndex: this.getNextZIndex()
        };

        this.objects.push(textObj);
        this.selectObject(textObj);
        this.canvas.needsRender = true;
        this.dispatchObjectsChanged();

        return textObj;
    }

    // Get default text style
    getDefaultTextStyle() {
        return {
            fontSize: 32,
            fontFamily: 'Arial',
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#000000',
            textDecoration: 'none'
        };
    }

    // Migrate legacy text object to new rich text format
    migrateTextObject(obj) {
        if (obj.type !== 'text') return obj;

        // Already migrated (has content array)
        if (Array.isArray(obj.content)) return obj;

        // Legacy format - convert
        const legacyText = obj.text || 'Double-click to edit';
        const legacyStyle = {
            fontSize: obj.fontSize || 32,
            fontFamily: obj.fontFamily || 'Arial',
            fontWeight: obj.fontWeight || 'normal',
            fontStyle: 'normal',
            color: obj.color || '#000000',
            textDecoration: 'none'
        };

        // Convert to new format
        obj.content = [{
            text: legacyText,
            style: { ...legacyStyle }
        }];
        obj.defaultStyle = { ...legacyStyle };

        // Remove legacy properties (keep textAlign as it's still used)
        delete obj.text;
        delete obj.fontSize;
        delete obj.fontFamily;
        delete obj.fontWeight;
        delete obj.color;

        return obj;
    }

    // Convert content array to plain text (for backwards compatibility)
    getPlainText(content) {
        if (!Array.isArray(content)) return content || '';
        return content.map(span => span.text).join('');
    }

    // Convert content array to HTML for contenteditable
    contentToHTML(content) {
        if (!Array.isArray(content)) return '';
        return content.map(span => {
            const style = span.style || {};
            const styleStr = [
                `font-size: ${style.fontSize || 32}px`,
                `font-family: ${style.fontFamily || 'Arial'}`,
                `font-weight: ${style.fontWeight || 'normal'}`,
                `font-style: ${style.fontStyle || 'normal'}`,
                `color: ${style.color || '#000000'}`,
                `text-decoration: ${style.textDecoration || 'none'}`
            ].join('; ');

            // Escape HTML and convert newlines to <br>
            const text = span.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');

            return `<span style="${styleStr}">${text}</span>`;
        }).join('');
    }

    // Convert HTML from contenteditable back to content array
    htmlToContent(editorElement, defaultStyle) {
        const content = [];

        const processNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent) {
                    // Get computed style from parent element
                    const parent = node.parentElement;
                    const style = parent ? this.extractStyleFromElement(parent, defaultStyle) : { ...defaultStyle };
                    content.push({ text: node.textContent, style });
                }
            } else if (node.nodeName === 'BR') {
                // Add newline
                if (content.length > 0) {
                    content[content.length - 1].text += '\n';
                } else {
                    content.push({ text: '\n', style: { ...defaultStyle } });
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Process children
                for (const child of node.childNodes) {
                    processNode(child);
                }
            }
        };

        for (const child of editorElement.childNodes) {
            processNode(child);
        }

        // Merge adjacent spans with same style
        return this.mergeAdjacentSpans(content);
    }

    // Extract style from DOM element
    extractStyleFromElement(element, defaultStyle) {
        const computed = window.getComputedStyle(element);
        // Font size in the editor is scaled by zoom, so we need to unscale it
        const zoom = this.canvas.zoom || 1;
        const rawFontSize = parseInt(computed.fontSize) || (defaultStyle.fontSize * zoom);
        const fontSize = Math.round(rawFontSize / zoom);

        return {
            fontSize: fontSize,
            fontFamily: computed.fontFamily || defaultStyle.fontFamily,
            fontWeight: computed.fontWeight === '700' || computed.fontWeight === 'bold' ? 'bold' : 'normal',
            fontStyle: computed.fontStyle || 'normal',
            color: this.rgbToHex(computed.color) || defaultStyle.color,
            textDecoration: computed.textDecorationLine || computed.textDecoration?.split(' ')[0] || 'none'
        };
    }

    // Merge adjacent spans with identical styles
    mergeAdjacentSpans(content) {
        if (content.length === 0) return content;

        const merged = [content[0]];
        for (let i = 1; i < content.length; i++) {
            const prev = merged[merged.length - 1];
            const curr = content[i];

            if (this.stylesEqual(prev.style, curr.style)) {
                prev.text += curr.text;
            } else {
                merged.push(curr);
            }
        }
        return merged;
    }

    // Check if two styles are equal
    stylesEqual(a, b) {
        return a.fontSize === b.fontSize &&
               a.fontFamily === b.fontFamily &&
               a.fontWeight === b.fontWeight &&
               a.fontStyle === b.fontStyle &&
               a.color === b.color &&
               a.textDecoration === b.textDecoration;
    }

    // Convert RGB color to hex
    rgbToHex(rgb) {
        if (!rgb || rgb.startsWith('#')) return rgb;
        const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const r = parseInt(match[1]).toString(16).padStart(2, '0');
            const g = parseInt(match[2]).toString(16).padStart(2, '0');
            const b = parseInt(match[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        return rgb;
    }

}
