import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';
import { showDeleteConfirm } from './modal.js';
import { HistoryManager } from './history-manager.js';
import { showInputModal, showChoiceModal, showToast, showConfirmModal } from './modal-utils.js';

let canvas;
let historyManager;
let currentBoardId;
let saveTimeout = null;
let pendingSave = false;
let dragSourceIndex = null;
let currentOrder = [];
let draggedImageId = null;
let draggedLayerId = null;
let draggedLayerType = null;
let allLayersOrder = [];
let syncChannel = null;
let showAllAssets = false;

function initTheme() {
    const THEME_KEY = 'app_theme';
    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
    
    const themes = {
        light: {
            '--bg-primary': '#ffffff',
            '--bg-secondary': '#f8f8f8',
            '--bg-tertiary': '#fafafa',
            '--bg-hover': 'rgba(0, 0, 0, 0.05)',
            '--bg-active': 'rgba(0, 0, 0, 0.08)',
            '--border-color': '#e0e0e0',
            '--border-color-hover': '#999',
            '--text-primary': '#1a1a1a',
            '--text-secondary': '#666',
            '--text-tertiary': '#888',
            '--text-disabled': '#999',
            '--shadow': 'rgba(0, 0, 0, 0.08)',
            '--modal-overlay': 'rgba(0, 0, 0, 0.5)'
        },
        dark: {
            '--bg-primary': '#3d3d3d',
            '--bg-secondary': '#2d2d2d',
            '--bg-tertiary': '#333333',
            '--bg-hover': 'rgba(255, 255, 255, 0.05)',
            '--bg-active': 'rgba(255, 255, 255, 0.08)',
            '--border-color': '#555555',
            '--border-color-hover': '#777777',
            '--text-primary': '#e8e8e8',
            '--text-secondary': '#b8b8b8',
            '--text-tertiary': '#999999',
            '--text-disabled': '#666666',
            '--shadow': 'rgba(0, 0, 0, 0.3)',
            '--modal-overlay': 'rgba(0, 0, 0, 0.7)'
        },
        midnight: {
            '--bg-primary': '#1a1a1a',
            '--bg-secondary': '#0f0f0f',
            '--bg-tertiary': '#151515',
            '--bg-hover': 'rgba(255, 255, 255, 0.03)',
            '--bg-active': 'rgba(255, 255, 255, 0.06)',
            '--border-color': '#2a2a2a',
            '--border-color-hover': '#444444',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#a0a0a0',
            '--text-tertiary': '#707070',
            '--text-disabled': '#505050',
            '--shadow': 'rgba(0, 0, 0, 0.5)',
            '--modal-overlay': 'rgba(0, 0, 0, 0.8)'
        }
    };
    
    const theme = themes[savedTheme] || themes.light;
    Object.entries(theme).forEach(([property, value]) => {
        document.documentElement.style.setProperty(property, value);
    });

    // Set theme attribute for icon filtering
    document.documentElement.setAttribute('data-theme', savedTheme);
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    if (!currentBoardId) {
        window.location.href = 'index.html';
        return;
    }
    
    syncChannel = new BroadcastChannel('board_sync_' + currentBoardId);

    // Handle sync requests from floating window
    syncChannel.onmessage = (event) => {
        if (event.data.type === 'sync_state_request') {
            // Send current layer order to requesting window
            const zIndexUpdates = [];

            // Add all images
            canvas.images.forEach(img => {
                zIndexUpdates.push({
                    type: 'image',
                    id: img.id,
                    zIndex: img.zIndex || 0
                });
            });

            // Add all objects
            canvas.objectsManager.objects.forEach(obj => {
                zIndexUpdates.push({
                    type: 'object',
                    id: obj.id,
                    zIndex: obj.zIndex || 0
                });
            });

            syncChannel.postMessage({
                type: 'sync_state_response',
                updates: zIndexUpdates
            });
        }
    };

    await initEditor();
    setupEventListeners();
});

async function initEditor() {
    await boardManager.loadBoards();
    const board = await boardManager.getBoard(currentBoardId);
    if (!board) {
        window.location.href = 'index.html';
        return;
    }

    console.log('Board loaded from database:', {
        hasStrokes: !!board.strokes,
        strokesCount: board.strokes?.length || 0,
        hasObjects: !!board.objects,
        objectsCount: board.objects?.length || 0
    });

    window.boardManagerInstance = boardManager;
    window.currentBoardId = currentBoardId;
    window.renderAssetsCallback = renderAssets;

    document.getElementById('board-name').textContent = board.name;
    
    const canvasElement = document.getElementById('main-canvas');
    canvas = new Canvas(canvasElement);
    canvas.setBackgroundColor(board.bgColor || board.bg_color);

    historyManager = new HistoryManager(50);
    historyManager.setCanvas(canvas);
    canvas.setHistoryManager(historyManager);

    const colorInput = document.getElementById('bg-color');
    colorInput.value = board.bgColor || board.bg_color;

    await loadLayers(board.layers, board.viewState);

    // Load strokes if they exist
    if (board.strokes && board.strokes.length > 0) {
        canvas.loadStrokes(board.strokes);
    }

    // Load text/shape objects if they exist
    if (board.objects && board.objects.length > 0) {
        console.log('Loading objects:', board.objects);
        canvas.objectsManager.loadObjects(board.objects);
    } else {
        console.log('No objects to load');
    }

    // Listen for canvas changes to trigger save
    canvasElement.addEventListener('canvasChanged', () => {
        scheduleSave();
    });
    canvasElement.addEventListener('viewChanged', () => {
        scheduleSave();
    });

    // Text/shape object events
    canvasElement.addEventListener('objectSelected', (e) => {
        showPropertiesPanel(e.detail);
    });
    canvasElement.addEventListener('objectDeselected', () => {
        hidePropertiesPanel();
    });
    canvasElement.addEventListener('objectDoubleClicked', (e) => {
        const obj = e.detail;
        if (obj.type === 'text') {
            // Focus the text content textarea
            setTimeout(() => {
                const textContent = document.getElementById('text-content');
                if (textContent) {
                    textContent.focus();
                    textContent.select();
                }
            }, 100);
        }
    });
    canvasElement.addEventListener('objectsChanged', () => {
        renderLayers();
        scheduleSave();
    });
    canvasElement.addEventListener('toolChanged', (e) => {
        // Update text tool button state when tool changes
        const textToolBtn = document.getElementById('text-tool-btn');
        if (textToolBtn) {
            if (e.detail.tool === 'text') {
                textToolBtn.classList.add('active');
            } else {
                textToolBtn.classList.remove('active');
            }
        }
    });

    renderLayers();
    renderAssets();
}

function loadLayers(layers, viewState = null) {
    return new Promise(resolve => {
        canvas.clear();

        // Restore view state immediately after clear
        if (viewState) {
            if (viewState.pan) {
                canvas.pan.x = viewState.pan.x;
                canvas.pan.y = viewState.pan.y;
            }
            if (viewState.zoom) {
                canvas.zoom = viewState.zoom;
            }
        }

        if (!layers || !layers.length) {
            // Force initial render
            canvas.invalidateCullCache();
            canvas.needsRender = true;
            canvas.render();
            resolve();
            return;
        }

        let loaded = 0;
        const total = layers.length;

        layers.forEach(layer => {
            const img = new Image();
            img.onload = () => {
                const visible = layer.visible !== false;
                const added = canvas.addImageSilent(img, layer.x, layer.y, layer.name, layer.width, layer.height, visible);
                added.id = layer.id;
                added.zIndex = layer.zIndex || 0;
                loaded++;
                if (loaded >= total) {
                    canvas.selectImage(null);
                    // Force initial render with restored view
                    canvas.invalidateCullCache();
                    canvas.needsRender = true;
                    canvas.render();
                    resolve();
                }
            };
            img.onerror = () => {
                loaded++;
                if (loaded >= total) {
                    // Force initial render
                    canvas.invalidateCullCache();
                    canvas.needsRender = true;
                    canvas.render();
                    resolve();
                }
            };
            img.src = layer.src;
        });
    });
}


function setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.querySelector(`[data-panel="${tab}"]`).classList.add('active');
        });
    });
    
    document.getElementById('bg-color').addEventListener('change', (e) => {
        const color = e.target.value;
        canvas.setBackgroundColor(color);

        // Sync background color to floating window
        if (syncChannel) {
            syncChannel.postMessage({
                type: 'background_color_changed',
                color: color
            });
        }

        scheduleSave();
    });
    
    document.getElementById('import-assets-btn').addEventListener('click', importAssets);
    document.getElementById('open-floating-btn').addEventListener('click', openFloatingWindow);

    setupContextMenu();
    setupBoardDropdown();

    document.getElementById('back-home-btn').addEventListener('click', () => {
        saveNow();
        window.location.href = 'index.html';
    });
    
    document.getElementById('collapse-layers-btn').addEventListener('click', (e) => {
        const content = document.getElementById('layers-content');
        const btn = e.target;
        content.classList.toggle('collapsed');
        btn.textContent = content.classList.contains('collapsed') ? '+' : '−';
    });

    document.getElementById('assets-view-toggle').addEventListener('change', (e) => {
        showAllAssets = e.target.checked;
        renderAssets();
    });
    
    canvas.canvas.addEventListener('canvasChanged', () => {
        renderLayers();
        scheduleSave();
    });
    
    canvas.canvas.addEventListener('imageSelected', (e) => {
        highlightLayer(e.detail ? e.detail.id : null);
    });
    
    window.addEventListener('beforeunload', () => {
        if (pendingSave) {
            saveNow();
        }
    });

    document.addEventListener('keydown', (e) => {
        // Don't intercept keyboard events when typing in inputs or textareas
        const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (historyManager.undo()) {
                renderLayers();
                scheduleSave();
            }
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            if (historyManager.redo()) {
                renderLayers();
                scheduleSave();
            }
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
            e.preventDefault();
            if (canvas.selectedImages.length > 0) {
                canvas.deleteSelectedImages();
                renderLayers();
                scheduleSave();
            } else if (canvas.objectsManager.selectedObject) {
                canvas.objectsManager.deleteSelectedObject();
                renderLayers();
                scheduleSave();
            }
        }
    });

    // Drawing toolbar event listeners
    setupDrawingToolbar();

    // Text tool button
    setupTextTool();
    setupShapeTool();
}

function setupDrawingToolbar() {
    const penBtn = document.getElementById('draw-pen-btn');
    const highlighterBtn = document.getElementById('draw-highlighter-btn');
    const eraserBtn = document.getElementById('draw-eraser-btn');
    const colorPicker = document.getElementById('draw-color-picker');
    const sizeSlider = document.getElementById('draw-size-slider');
    const sizeInput = document.getElementById('draw-size-input');
    const clearBtn = document.getElementById('draw-clear-btn');
    const eraserModeToggle = document.getElementById('eraser-mode-toggle');

    let currentTool = null;

    function updateSizeControls(size) {
        sizeInput.value = size;
        sizeSlider.value = Math.min(size, 100);
        sizeSlider.max = size > 100 ? size : 100;
    }

    function setActiveTool(tool) {
        // Remove active class from all tool buttons
        penBtn.classList.remove('active');
        highlighterBtn.classList.remove('active');
        eraserBtn.classList.remove('active');

        // Hide/show eraser mode toggle
        if (tool === 'eraser') {
            eraserModeToggle.style.display = 'flex';
        } else {
            eraserModeToggle.style.display = 'none';
        }

        // Set the drawing mode
        if (tool === currentTool) {
            // Toggle off if clicking the same tool
            currentTool = null;
            canvas.setDrawingMode(null);
            eraserModeToggle.style.display = 'none';
        } else {
            currentTool = tool;
            canvas.setDrawingMode(tool);

            // Add active class to the clicked button
            if (tool === 'pen') penBtn.classList.add('active');
            else if (tool === 'highlighter') highlighterBtn.classList.add('active');
            else if (tool === 'eraser') eraserBtn.classList.add('active');

            // Update size controls based on tool
            if (tool === 'pen') {
                updateSizeControls(canvas.penSize);
            } else if (tool === 'highlighter') {
                updateSizeControls(canvas.highlighterSize);
            } else if (tool === 'eraser') {
                updateSizeControls(canvas.eraserSize);
            }
        }
    }

    penBtn.addEventListener('click', () => setActiveTool('pen'));
    highlighterBtn.addEventListener('click', () => setActiveTool('highlighter'));
    eraserBtn.addEventListener('click', () => setActiveTool('eraser'));

    colorPicker.addEventListener('input', (e) => {
        canvas.setDrawingColor(e.target.value);
    });

    // Size slider handler
    sizeSlider.addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        sizeInput.value = size;

        if (currentTool === 'pen') {
            canvas.setPenSize(size);
        } else if (currentTool === 'highlighter') {
            canvas.setHighlighterSize(size);
        } else if (currentTool === 'eraser') {
            canvas.setEraserSize(size);
        }
    });

    // Size input handler
    sizeInput.addEventListener('input', (e) => {
        let size = parseInt(e.target.value) || 1;
        size = Math.max(1, Math.min(500, size));

        sizeSlider.value = Math.min(size, 100);
        if (size > 100) {
            sizeSlider.max = size;
        }

        if (currentTool === 'pen') {
            canvas.setPenSize(size);
        } else if (currentTool === 'highlighter') {
            canvas.setHighlighterSize(size);
        } else if (currentTool === 'eraser') {
            canvas.setEraserSize(size);
        }
    });

    // Eraser mode toggle
    eraserModeToggle.querySelectorAll('.toggle-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;

            // Update active state
            eraserModeToggle.querySelectorAll('.toggle-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Set eraser mode
            canvas.setEraserMode(mode);
        });
    });

    // Drawing mode button (in sidebar tools section)
    const drawingModeBtn = document.getElementById('drawing-mode-btn');
    const drawingToolbar = document.getElementById('drawing-toolbar');

    if (drawingModeBtn && drawingToolbar) {
        // Load saved state from localStorage
        const toolbarVisible = localStorage.getItem('editor_toolbar_visible') !== 'false';

        if (!toolbarVisible) {
            drawingToolbar.style.display = 'none';
            drawingModeBtn.classList.remove('active');
        } else {
            drawingModeBtn.classList.add('active');
        }

        drawingModeBtn.addEventListener('click', () => {
            const isVisible = drawingToolbar.style.display !== 'none';

            if (isVisible) {
                // Hide toolbar and disable all drawing tools
                drawingToolbar.style.display = 'none';
                drawingModeBtn.classList.remove('active');
                localStorage.setItem('editor_toolbar_visible', 'false');

                // Disable current tool
                currentTool = null;
                canvas.setDrawingMode(null);
                penBtn.classList.remove('active');
                highlighterBtn.classList.remove('active');
                eraserBtn.classList.remove('active');
                eraserModeToggle.style.display = 'none';
            } else {
                // Show toolbar and enable pen tool by default
                drawingToolbar.style.display = 'flex';
                drawingModeBtn.classList.add('active');
                localStorage.setItem('editor_toolbar_visible', 'true');
                setActiveTool('pen');
            }
        });

        // Sync button state when tools are clicked
        const syncDrawingModeBtn = () => {
            if (currentTool !== null) {
                drawingModeBtn.classList.add('active');
            }
        };

        // Add sync to tool button clicks
        const originalSetActiveTool = setActiveTool;
        setActiveTool = (tool) => {
            originalSetActiveTool(tool);
            syncDrawingModeBtn();
        };
    }


    clearBtn.addEventListener('click', async () => {
        if (canvas.strokes.length === 0) return;

        const confirmed = await showConfirmModal(
            'Clear All Strokes',
            'Are you sure you want to clear all drawing strokes? This action can be undone.'
        );

        if (confirmed) {
            canvas.clearStrokes();
            scheduleSave();
        }
    });
}

function scheduleSave() {
    pendingSave = true;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveNow();
    }, 2000);
}

function saveNow() {
    if (!pendingSave) return;
    pendingSave = false;
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }

    const images = canvas.getImages();
    const layers = images.map(img => ({
        id: img.id,
        name: img.name,
        src: img.img.src,
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height,
        visible: img.visible !== false,
        zIndex: img.zIndex || 0
    }));
    const bgColor = canvas.bgColor;
    const viewState = {
        pan: { x: canvas.pan.x, y: canvas.pan.y },
        zoom: canvas.zoom
    };
    const strokes = canvas.getStrokes();
    const objects = canvas.objectsManager.getObjects();
    const thumbnail = canvas.generateThumbnail(200, 150);
    console.log('Saving board:', { layersCount: layers.length, strokesCount: strokes.length, objectsCount: objects.length, objects, viewState });
    console.log('Layers zIndex:', layers.map(l => ({ id: l.id, name: l.name, zIndex: l.zIndex })));
    console.log('Objects zIndex:', objects.map(o => ({ id: o.id, type: o.type, zIndex: o.zIndex })));
    boardManager.updateBoard(currentBoardId, { layers, bgColor, viewState, strokes, objects, thumbnail });
}

function createLayerItem(img, images) {
    const realIndex = images.findIndex(i => i.id === img.id);

    const layerItem = document.createElement('div');
    layerItem.className = 'layer-item';
    layerItem.dataset.layerId = img.id;
    layerItem.draggable = true;

    if (dragSourceIndex !== null && realIndex === dragSourceIndex) {
        layerItem.classList.add('dragging');
    }

    if (img.visible === false) {
        layerItem.classList.add('layer-hidden');
    }

    if (canvas.isImageSelected(img)) {
        layerItem.classList.add('selected');
    }

    const dragHandle = document.createElement('div');
    dragHandle.className = 'layer-drag-handle';
    dragHandle.innerHTML = `
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
    `;

    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'layer-visibility-btn';
    visibilityBtn.type = 'button';
    if (img.visible === false) {
        visibilityBtn.classList.add('hidden');
        visibilityBtn.innerHTML = '◯';
        visibilityBtn.title = 'Show layer';
    } else {
        visibilityBtn.innerHTML = '●';
        visibilityBtn.title = 'Hide layer';
    }
    visibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        canvas.toggleVisibility(img.id);

        if (syncChannel) {
            syncChannel.postMessage({
                type: 'layer_visibility_changed',
                layerId: img.id,
                visible: !img.visible
            });
        }

        renderLayers();
    });

    const layerContent = document.createElement('div');
    layerContent.className = 'layer-content';

    const layerName = document.createElement('input');
    layerName.type = 'text';
    layerName.className = 'layer-name-input';
    layerName.value = img.name;
    layerName.draggable = false;
    layerName.addEventListener('change', (e) => {
        canvas.renameLayer(img.id, e.target.value);
        scheduleSave();
    });
    layerName.addEventListener('click', (e) => e.stopPropagation());
    layerName.addEventListener('mousedown', (e) => e.stopPropagation());
    layerName.addEventListener('dragstart', (e) => e.preventDefault());

    const layerControls = document.createElement('div');
    layerControls.className = 'layer-controls';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '×';
    deleteBtn.className = 'layer-btn-delete';
    deleteBtn.title = 'Delete layer';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (canvas.selectedImages.length > 1 && canvas.isImageSelected(img)) {
            showDeleteConfirm(`${canvas.selectedImages.length} layers`, () => {
                canvas.deleteSelectedImages();
                canvas.invalidateCullCache();
                canvas.render();
                renderLayers();
            });
        } else {
            showDeleteConfirm(img.name, () => {
                canvas.deleteImage(img.id);
                canvas.invalidateCullCache();
                canvas.render();
                renderLayers();
            });
        }
    });

    layerControls.appendChild(deleteBtn);
    layerContent.appendChild(layerName);

    layerItem.appendChild(dragHandle);
    layerItem.appendChild(visibilityBtn);
    layerItem.appendChild(layerContent);
    layerItem.appendChild(layerControls);

    layerItem.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (img.visible !== false) {
            if (e.ctrlKey || e.metaKey) {
                canvas.selectImage(img, true);
            } else if (e.shiftKey && canvas.selectedImage) {
                canvas.selectImagesInRange(canvas.selectedImage, img);
            } else {
                canvas.selectImage(img);
            }
            renderLayers();
        }
    });

    layerItem.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'INPUT') {
            e.preventDefault();
            return;
        }
        draggedLayerId = img.id;
        draggedLayerType = 'image';
        allLayersOrder = getAllLayersForDragging();
        dragSourceIndex = allLayersOrder.findIndex(l => l.type === 'image' && l.data.id === img.id);
        layerItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        applyLayerOrder();
        draggedLayerId = null;
        draggedLayerType = null;
        dragSourceIndex = null;
        allLayersOrder = [];
        renderLayers();
        scheduleSave();
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedLayerId) return;

        const targetId = img.id;
        if (targetId === draggedLayerId && draggedLayerType === 'image') return;

        if (dragSourceIndex !== null) {
            const fromIdx = allLayersOrder.findIndex(l => {
                if (draggedLayerType === 'image') {
                    return l.type === 'image' && l.data.id === draggedLayerId;
                } else {
                    return l.type === 'object' && l.data.id === draggedLayerId;
                }
            });
            const toIdx = allLayersOrder.findIndex(l => l.type === 'image' && l.data.id === targetId);

            if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                const newOrder = [...allLayersOrder];
                const [moved] = newOrder.splice(fromIdx, 1);
                newOrder.splice(toIdx, 0, moved);
                allLayersOrder = newOrder;
                renderLayers();
            }
        }
    });

    return layerItem;
}

function createObjectLayerItem(obj, objects) {
    const layerItem = document.createElement('div');
    layerItem.className = 'layer-item';
    layerItem.dataset.layerId = obj.id;
    layerItem.draggable = true;

    if (obj.visible === false) {
        layerItem.classList.add('layer-hidden');
    }

    if (canvas.objectsManager.selectedObject === obj) {
        layerItem.classList.add('selected');
    }

    const dragHandle = document.createElement('div');
    dragHandle.className = 'layer-drag-handle';
    dragHandle.innerHTML = `
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
    `;

    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'layer-visibility-btn';
    visibilityBtn.type = 'button';
    if (obj.visible === false) {
        visibilityBtn.classList.add('hidden');
        visibilityBtn.innerHTML = '◯';
        visibilityBtn.title = 'Show layer';
    } else {
        visibilityBtn.innerHTML = '●';
        visibilityBtn.title = 'Hide layer';
    }
    visibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        obj.visible = obj.visible === false ? true : false;
        canvas.needsRender = true;
        renderLayers();
        scheduleSave();
    });

    const layerContent = document.createElement('div');
    layerContent.className = 'layer-content';

    const layerName = document.createElement('input');
    layerName.type = 'text';
    layerName.className = 'layer-name-input';
    if (obj.type === 'text') {
        layerName.value = (obj.text || 'Text').substring(0, 20);
    } else if (obj.type === 'shape') {
        const shapeType = obj.shapeType || 'square';
        layerName.value = shapeType.charAt(0).toUpperCase() + shapeType.slice(1);
    }
    layerName.draggable = false;
    layerName.addEventListener('change', (e) => {
        if (obj.type === 'text') {
            canvas.objectsManager.updateSelectedObject({ text: e.target.value });
        }
        scheduleSave();
    });
    layerName.addEventListener('click', (e) => e.stopPropagation());
    layerName.addEventListener('mousedown', (e) => e.stopPropagation());
    layerName.addEventListener('dragstart', (e) => e.preventDefault());

    const layerControls = document.createElement('div');
    layerControls.className = 'layer-controls';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '×';
    deleteBtn.className = 'layer-btn-delete';
    deleteBtn.title = 'Delete layer';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const objectName = obj.type === 'text' ? (obj.text || 'Text').substring(0, 20) : 'Shape';
        showDeleteConfirm(objectName, () => {
            canvas.objectsManager.deleteObject(obj.id);
            renderLayers();
            scheduleSave();
        });
    });

    layerControls.appendChild(deleteBtn);
    layerContent.appendChild(layerName);

    layerItem.appendChild(dragHandle);
    layerItem.appendChild(visibilityBtn);
    layerItem.appendChild(layerContent);
    layerItem.appendChild(layerControls);

    layerItem.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (obj.visible !== false) {
            canvas.objectsManager.selectObject(obj);
            renderLayers();
        }
    });

    // Drag and drop for unified layer reordering
    layerItem.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'INPUT') {
            e.preventDefault();
            return;
        }
        draggedLayerId = obj.id;
        draggedLayerType = 'object';
        allLayersOrder = getAllLayersForDragging();
        dragSourceIndex = allLayersOrder.findIndex(l => l.type === 'object' && l.data.id === obj.id);
        layerItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        applyLayerOrder();
        draggedLayerId = null;
        draggedLayerType = null;
        dragSourceIndex = null;
        allLayersOrder = [];
        renderLayers();
        scheduleSave();
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedLayerId) return;

        const targetId = obj.id;
        if (targetId === draggedLayerId && draggedLayerType === 'object') return;

        if (dragSourceIndex !== null) {
            const fromIdx = allLayersOrder.findIndex(l => {
                if (draggedLayerType === 'object') {
                    return l.type === 'object' && l.data.id === draggedLayerId;
                } else {
                    return l.type === 'image' && l.data.id === draggedLayerId;
                }
            });
            const toIdx = allLayersOrder.findIndex(l => l.type === 'object' && l.data.id === targetId);

            if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                const newOrder = [...allLayersOrder];
                const [moved] = newOrder.splice(fromIdx, 1);
                newOrder.splice(toIdx, 0, moved);
                allLayersOrder = newOrder;
                renderLayers();
            }
        }
    });

    return layerItem;
}


function getAllLayersForDragging() {
    const images = canvas.getImages();
    const objects = canvas.objectsManager.getObjects();

    const allLayers = [
        ...images.map(img => ({ type: 'image', data: img, zIndex: img.zIndex || 0 })),
        ...objects.map(obj => ({ type: 'object', data: obj, zIndex: obj.zIndex || 0 }))
    ];

    // Sort by zIndex (lower zIndex = back, higher = front)
    allLayers.sort((a, b) => a.zIndex - b.zIndex);

    return allLayers;
}

function applyLayerOrder() {
    if (allLayersOrder.length === 0) return;

    // Assign zIndex based on position in array (0 = back, higher = front)
    const zIndexUpdates = [];
    allLayersOrder.forEach((layer, index) => {
        console.log(`Setting ${layer.type} ${layer.data.id} zIndex from ${layer.data.zIndex} to ${index}`);
        layer.data.zIndex = index;
        zIndexUpdates.push({
            type: layer.type,
            id: layer.data.id,
            zIndex: index
        });
    });

    // Sync to floating window
    if (syncChannel) {
        syncChannel.postMessage({
            type: 'layer_order_changed',
            updates: zIndexUpdates
        });
    }

    canvas.invalidateCullCache();
    canvas.needsRender = true;
    canvas.render();
    canvas.notifyChange();
}

function renderLayers() {
    const layersList = document.getElementById('layers-list');
    const images = canvas.getImages();
    const objects = canvas.objectsManager.getObjects();

    // Combine images and objects into a unified layer list
    let allLayers;
    if (allLayersOrder.length > 0) {
        // Use the current drag order if dragging
        allLayers = allLayersOrder;
    } else {
        // Normal rendering - combine and sort by zIndex
        allLayers = [
            ...images.map(img => ({ type: 'image', data: img, zIndex: img.zIndex || 0 })),
            ...objects.map(obj => ({ type: 'object', data: obj, zIndex: obj.zIndex || 0 }))
        ];
        // Sort by zIndex (lower zIndex = back, higher = front)
        allLayers.sort((a, b) => a.zIndex - b.zIndex);
    }

    if (allLayers.length === 0) {
        layersList.innerHTML = '<div class="empty-message">No layers yet</div>';
        return;
    }

    layersList.innerHTML = '';

    // Render layers in reverse order (top = front, bottom = back)
    [...allLayers].reverse().forEach(layer => {
        if (layer.type === 'image') {
            const layerItem = createLayerItem(layer.data, images);
            layersList.appendChild(layerItem);
        } else if (layer.type === 'object') {
            const layerItem = createObjectLayerItem(layer.data, objects);
            layersList.appendChild(layerItem);
        }
    });
}

function highlightLayer(imageId) {
    document.querySelectorAll('.layer-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    if (imageId) {
        const layerItem = document.querySelector(`.layer-item[data-layer-id="${imageId}"]`);
        if (layerItem) {
            layerItem.classList.add('selected');
        }
    }
}

async function renderAssets() {
    const assetsGrid = document.getElementById('assets-grid');
    const board = boardManager.currentBoard;
    
    let assets = [];
    
    if (showAllAssets) {
        assets = await boardManager.getAllAssets();
        if (!assets || assets.length === 0) {
            assetsGrid.innerHTML = '<div class="empty-message">No assets yet</div>';
            return;
        }
    } else {
        if (!board || !board.assets || board.assets.length === 0) {
            assetsGrid.innerHTML = '<div class="empty-message">No board assets yet</div>';
            return;
        }
        assets = board.assets;
    }
    
    assetsGrid.innerHTML = '';
    assets.forEach(asset => {
        const assetItem = document.createElement('div');
        assetItem.className = 'asset-item';
        const img = document.createElement('img');
        img.src = asset.src;
        img.draggable = false;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'asset-delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = showAllAssets ? 'Delete from all assets' : 'Delete from board';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            showDeleteConfirm(asset.name, async () => {
                if (showAllAssets) {
                    await boardManager.deleteFromAllAssets(asset.id);
                } else {
                    await boardManager.deleteBoardAsset(currentBoardId, asset.id);
                }
                renderAssets();
            });
        });
        
        assetItem.appendChild(img);
        assetItem.appendChild(deleteBtn);
        
        assetItem.addEventListener('click', async () => {
            const imgElement = new Image();
            imgElement.onload = async () => {
                canvas.addImage(imgElement, 100, 100, asset.name);
                renderLayers();
                
                if (showAllAssets) {
                    const boardAssets = board.assets || [];
                    const existsInBoard = boardAssets.some(a => a.name === asset.name && a.src === asset.src);
                    if (!existsInBoard) {
                        boardAssets.push({
                            id: asset.id,
                            name: asset.name,
                            src: asset.src
                        });
                        await boardManager.updateBoard(currentBoardId, { assets: boardAssets });
                    }
                }
            };
            imgElement.src = asset.src;
        });
        
        assetsGrid.appendChild(assetItem);
    });
}

function setupContextMenu() {
    const contextMenu = document.getElementById('canvas-context-menu');
    const canvasContainer = document.getElementById('canvas-container');
    const deleteSelectedItem = document.getElementById('context-delete-selected');
    const deselectAllItem = document.getElementById('context-deselect-all');
    const separator = document.getElementById('context-separator');

    canvasContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // Show/hide multi-select options based on selection state
        const hasSelection = canvas.selectedImages.length > 0;

        deleteSelectedItem.style.display = hasSelection ? 'block' : 'none';
        deselectAllItem.style.display = hasSelection ? 'block' : 'none';
        separator.style.display = hasSelection ? 'block' : 'none';

        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.classList.add('show');
    });

    document.addEventListener('click', () => {
        contextMenu.classList.remove('show');
    });

    deleteSelectedItem.addEventListener('click', () => {
        if (canvas.selectedImages.length > 0) {
            canvas.deleteSelectedImages();
            canvas.invalidateCullCache();
            canvas.render();
            renderLayers();
            scheduleSave();
        }
        contextMenu.classList.remove('show');
    });

    deselectAllItem.addEventListener('click', () => {
        canvas.selectImage(null);
        renderLayers();
        contextMenu.classList.remove('show');
    });

    document.getElementById('context-recenter').addEventListener('click', () => {
        canvas.fitToContent();
        contextMenu.classList.remove('show');
    });

    document.getElementById('context-reset-zoom').addEventListener('click', () => {
        canvas.resetZoom();
        contextMenu.classList.remove('show');
    });
}

function setupBoardDropdown() {
    const dropdownBtn = document.getElementById('board-dropdown-btn');
    const dropdownMenu = document.getElementById('board-dropdown-menu');
    const boardName = document.getElementById('board-name');

    const toggleDropdown = (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('show');
    };

    dropdownBtn.addEventListener('click', toggleDropdown);
    boardName.addEventListener('click', toggleDropdown);

    document.addEventListener('click', () => {
        dropdownMenu.classList.remove('show');
    });

    document.getElementById('dropdown-rename').addEventListener('click', async () => {
        dropdownMenu.classList.remove('show');
        const currentName = boardName.textContent;
        const newName = await showInputModal('Rename Board', 'Enter a new name for this board:', currentName, 'Board name');
        if (newName && newName !== currentName) {
            await boardManager.updateBoard(currentBoardId, { name: newName });
            boardName.textContent = newName;
            showToast('Board renamed successfully', 'success');
        }
    });

    document.getElementById('dropdown-export').addEventListener('click', () => {
        dropdownMenu.classList.remove('show');
        exportBoard();
    });

    document.getElementById('dropdown-import').addEventListener('click', () => {
        dropdownMenu.classList.remove('show');
        importBoard();
    });
}

function importAssets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    
    input.onchange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const board = boardManager.currentBoard;
                if (!board.assets) board.assets = [];
                
                const existsInBoard = board.assets.some(a => a.name === file.name);
                if (!existsInBoard) {
                    board.assets.push({
                        id: Date.now() + Math.random(),
                        src: event.target.result,
                        name: file.name
                    });
                }
                
                await boardManager.updateBoard(currentBoardId, { assets: board.assets });
                await boardManager.addToAllAssets(file.name, event.target.result);
                renderAssets();
            };
            reader.readAsDataURL(file);
        });
    };
    
    input.click();
}

async function exportBoard() {
    // Get EVERYTHING from canvas
    const images = canvas.getImages();
    const strokes = canvas.getStrokes() || [];
    const objects = canvas.objectsManager.getObjects() || [];
    const board = boardManager.currentBoard;

    const exportData = {
        version: 1,
        name: board.name,
        bgColor: canvas.bgColor,
        layers: images.map(img => ({
            id: img.id,
            name: img.name,
            src: img.img.src,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            visible: img.visible !== false,
            zIndex: img.zIndex || 0
        })),
        groups: canvas.groups || [],
        assets: board.assets || [],
        strokes: strokes,
        objects: objects,
        exportedAt: Date.now()
    };

    const json = JSON.stringify(exportData, null, 2);

    console.log('[EXPORT] Images:', images.length, 'Strokes:', strokes.length, 'Objects:', objects.length);

    console.log('JSON contains strokes:', json.includes('"strokes"'));
    console.log('JSON contains objects:', json.includes('"objects"'));

    const filename = `${board.name.replace(/[^a-z0-9]/gi, '_')}.aref`;

    // Try to use File System Access API (modern browsers)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'AniRef Board',
                    accept: { 'application/json': ['.aref'] }
                }]
            });

            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();

            showToast(`Board exported as ${handle.name}`, 'success', 4000);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Export error:', err);
                showToast('Failed to export board', 'error');
            }
        }
    } else {
        // Fallback for browsers without File System Access API
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        showToast(`Board exported as ${filename}`, 'success', 4000);
    }
}

function importBoard() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.aref,application/json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importData = JSON.parse(event.target.result);

                console.log('[IMPORT] File loaded:', {
                    layers: importData.layers?.length || 0,
                    strokes: importData.strokes?.length || 0,
                    objects: importData.objects?.length || 0
                });

                if (!importData.version || !importData.layers) {
                    showToast('Invalid .aref file format', 'error');
                    return;
                }

                const mode = await showChoiceModal(
                    'Import Board',
                    'Choose how to import this board:',
                    [
                        {
                            title: 'Merge',
                            subtitle: 'Add to existing layers',
                            value: 'merge',
                            className: 'modal-btn-merge'
                        },
                        {
                            title: 'Override',
                            subtitle: 'Replace all layers',
                            value: 'override',
                            className: 'modal-btn-override'
                        }
                    ]
                );

                if (!mode) return;

                if (mode === 'merge') {
                    for (const layer of importData.layers) {
                        const img = new Image();
                        await new Promise((resolve) => {
                            img.onload = () => {
                                canvas.addImage(img, layer.x, layer.y, layer.name, layer.width, layer.height);
                                resolve();
                            };
                            img.onerror = resolve;
                            img.src = layer.src;
                        });
                    }
                    // Merge groups
                    if (importData.groups && Array.isArray(importData.groups)) {
                        canvas.groups = [...(canvas.groups || []), ...importData.groups];
                    }
                    // Merge strokes
                    if (importData.strokes && Array.isArray(importData.strokes)) {
                        const currentStrokes = canvas.getStrokes();
                        canvas.loadStrokes([...currentStrokes, ...importData.strokes]);
                    }
                    // Merge objects
                    if (importData.objects && Array.isArray(importData.objects)) {
                        const currentObjects = canvas.objectsManager.getObjects();
                        canvas.objectsManager.loadObjects([...currentObjects, ...importData.objects]);
                    }
                    showToast(`Merged ${importData.layers.length} layer(s)`, 'success');
                } else {
                    // OVERRIDE MODE - Clear everything first
                    canvas.clear();

                    console.log('[IMPORT OVERRIDE] Clearing canvas and importing:', {
                        layers: importData.layers?.length || 0,
                        strokes: importData.strokes?.length || 0,
                        objects: importData.objects?.length || 0
                    });

                    // Load images
                    for (const layer of importData.layers) {
                        const img = new Image();
                        await new Promise((resolve) => {
                            img.onload = () => {
                                const added = canvas.addImageSilent(img, layer.x, layer.y, layer.name, layer.width, layer.height, layer.visible);
                                added.id = layer.id;
                                added.zIndex = layer.zIndex || 0;
                                resolve();
                            };
                            img.onerror = resolve;
                            img.src = layer.src;
                        });
                    }

                    // Load groups
                    canvas.groups = importData.groups || [];

                    // Load strokes
                    if (importData.strokes && importData.strokes.length > 0) {
                        console.log('[IMPORT] Loading', importData.strokes.length, 'strokes');
                        canvas.loadStrokes(importData.strokes);
                    }

                    // Load objects (text/shapes)
                    if (importData.objects && importData.objects.length > 0) {
                        console.log('[IMPORT] Loading', importData.objects.length, 'objects');
                        canvas.objectsManager.loadObjects(importData.objects);
                        console.log('[IMPORT] Loaded objects, count in manager:', canvas.objectsManager.getObjects().length);
                    }

                    // Force render
                    canvas.invalidateCullCache();
                    canvas.needsRender = true;
                    canvas.render();

                    showToast(`Imported ${importData.layers.length} layer(s)`, 'success');
                }

                renderLayers();
                scheduleSave();

            } catch (err) {
                console.error('Import error:', err);
                showToast('Failed to import board: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    };

    input.click();
}

async function openFloatingWindow() {
    saveNow();

    if (!window.__TAURI__) {
        window.open('floating.html?id=' + currentBoardId, '_blank', 'width=800,height=600');
        return;
    }

    try {
        const { WebviewWindow } = window.__TAURI__.webviewWindow;
        const windowLabel = 'floating_' + currentBoardId + '_' + Date.now();
        const currentUrl = window.location.href.split('?')[0];
        const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/'));
        const floatingUrl = `${baseUrl}/floating.html?id=${currentBoardId}`;

        const floatingWindow = new WebviewWindow(windowLabel, {
            url: floatingUrl,
            title: boardManager.currentBoard.name,
            width: 800,
            height: 600,
            alwaysOnTop: false,
            decorations: false,
            resizable: true,
            center: true
        });

        floatingWindow.once('tauri://error', (e) => {
            console.error('Error creating floating window:', e);
        });
    } catch (err) {
        console.error('Error opening floating window:', err);
    }
}


// Property panel functions
function showPropertiesPanel(obj) {
    const propertiesPanel = document.getElementById('object-properties');
    const defaultProperties = document.getElementById('default-properties');
    const textProperties = document.getElementById('text-properties');
    const shapeProperties = document.getElementById('shape-properties');
    const propertiesTitle = document.getElementById('object-properties-title');

    if (!propertiesPanel) return;

    // Hide default properties
    if (defaultProperties) defaultProperties.style.display = 'none';

    // Show properties panel
    propertiesPanel.style.display = 'flex';

    if (obj.type === 'shape') {
        propertiesTitle.textContent = 'Shape Properties';
        textProperties.style.display = 'none';
        shapeProperties.style.display = 'block';

        // Populate shape properties
        document.getElementById('shape-type').value = obj.shapeType || 'square';
        document.getElementById('shape-fill-color').value = obj.fillColor || '#3b82f6';
        document.getElementById('shape-has-stroke').checked = obj.hasStroke !== false;
        document.getElementById('shape-stroke-color').value = obj.strokeColor || '#000000';
        document.getElementById('shape-stroke-width').value = obj.strokeWidth || 2;

        // Add event listeners for shape properties
        setupShapePropertyListeners();
    } else if (obj.type === 'text') {
        propertiesTitle.textContent = 'Text Properties';
        textProperties.style.display = 'block';
        shapeProperties.style.display = 'none';

        // Populate text properties
        document.getElementById('text-content').value = obj.text || '';
        document.getElementById('text-font-size').value = obj.fontSize || 32;
        document.getElementById('text-font-family').value = obj.fontFamily || 'Arial';
        document.getElementById('text-color').value = obj.color || '#000000';
        document.getElementById('text-font-weight').value = obj.fontWeight || 'normal';
        document.getElementById('text-align').value = obj.textAlign || 'left';

        // Add event listeners for text properties
        setupTextPropertyListeners();
    }

    // Close button
    const closeBtn = document.getElementById('close-properties-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            canvas.objectsManager.deselectAll();
        };
    }
}

function hidePropertiesPanel() {
    const propertiesPanel = document.getElementById('object-properties');
    const defaultProperties = document.getElementById('default-properties');

    if (propertiesPanel) propertiesPanel.style.display = 'none';
    if (defaultProperties) defaultProperties.style.display = 'block';

    // Remove event listeners
    removeShapePropertyListeners();
}


function setupShapePropertyListeners() {
    const shapeType = document.getElementById('shape-type');
    const shapeFillColor = document.getElementById('shape-fill-color');
    const shapeHasStroke = document.getElementById('shape-has-stroke');
    const shapeStrokeColor = document.getElementById('shape-stroke-color');
    const shapeStrokeWidth = document.getElementById('shape-stroke-width');

    shapeType.onchange = () => {
        canvas.objectsManager.updateSelectedObject({ shapeType: shapeType.value });
    };

    shapeFillColor.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ fillColor: shapeFillColor.value });
    };

    shapeHasStroke.onchange = () => {
        canvas.objectsManager.updateSelectedObject({ hasStroke: shapeHasStroke.checked });
    };

    shapeStrokeColor.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ strokeColor: shapeStrokeColor.value });
    };

    shapeStrokeWidth.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ strokeWidth: parseInt(shapeStrokeWidth.value) });
    };
}

function removeShapePropertyListeners() {
    // Event listeners are now managed per panel show, cleanup not strictly necessary
}

function setupTextPropertyListeners() {
    const textContent = document.getElementById('text-content');
    const textFontSize = document.getElementById('text-font-size');
    const textFontFamily = document.getElementById('text-font-family');
    const textColor = document.getElementById('text-color');
    const textFontWeight = document.getElementById('text-font-weight');
    const textAlign = document.getElementById('text-align');

    textContent.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ text: textContent.value });
    };

    textFontSize.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ fontSize: parseInt(textFontSize.value) });
    };

    textFontFamily.onchange = () => {
        canvas.objectsManager.updateSelectedObject({ fontFamily: textFontFamily.value });
    };

    textColor.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ color: textColor.value });
    };

    textFontWeight.onchange = () => {
        canvas.objectsManager.updateSelectedObject({ fontWeight: textFontWeight.value });
    };

    textAlign.onchange = () => {
        canvas.objectsManager.updateSelectedObject({ textAlign: textAlign.value });
    };
}

function setupTextTool() {
    const textToolBtn = document.getElementById('text-tool-btn');
    if (!textToolBtn) return;

    textToolBtn.addEventListener('click', () => {
        // Toggle text tool mode
        if (canvas.objectsManager.currentTool === 'text') {
            canvas.objectsManager.setTool(null);
            textToolBtn.classList.remove('active');
        } else {
            canvas.objectsManager.setTool('text');
            textToolBtn.classList.add('active');
        }
    });
}

function setupShapeTool() {
    const shapeToolBtn = document.getElementById('shape-tool-btn');
    if (!shapeToolBtn) return;

    const shapeType = document.getElementById('shape-type');
    const shapeFillColor = document.getElementById('shape-fill-color');
    const shapeHasStroke = document.getElementById('shape-has-stroke');
    const shapeStrokeColor = document.getElementById('shape-stroke-color');
    const shapeStrokeWidth = document.getElementById('shape-stroke-width');
    const shapeLineColor = document.getElementById('shape-line-color');
    const shapeLineThickness = document.getElementById('shape-line-thickness');
    const lineColorRow = document.getElementById('shape-line-color-row');
    const lineThicknessRow = document.getElementById('shape-line-thickness-row');
    const fillColorRow = shapeFillColor.closest('.property-row');
    const strokeToggleRow = shapeHasStroke.closest('.property-row').parentElement;
    const strokeColorRow = document.getElementById('shape-stroke-color-row');
    const strokeWidthRow = document.getElementById('shape-stroke-width-row');

    // Show/hide properties based on shape type
    function updatePropertiesVisibility() {
        const type = shapeType.value;
        const isLineOrArrow = type === 'line' || type === 'arrow';

        // For lines/arrows: show line color and thickness, hide fill and stroke options
        lineColorRow.style.display = isLineOrArrow ? 'flex' : 'none';
        lineThicknessRow.style.display = isLineOrArrow ? 'flex' : 'none';
        fillColorRow.style.display = isLineOrArrow ? 'none' : 'flex';
        strokeToggleRow.style.display = isLineOrArrow ? 'none' : 'flex';
        strokeColorRow.style.display = isLineOrArrow ? 'none' : 'flex';
        strokeWidthRow.style.display = isLineOrArrow ? 'none' : 'flex';
    }

    // Update shape settings when properties change
    function updateShapeSettings() {
        const type = shapeType.value;
        const isLineOrArrow = type === 'line' || type === 'arrow';

        canvas.objectsManager.currentShapeSettings = {
            type: type,
            fillColor: shapeFillColor.value,
            hasStroke: shapeHasStroke.checked,
            strokeColor: isLineOrArrow ? shapeLineColor.value : shapeStrokeColor.value,
            strokeWidth: isLineOrArrow ? (parseInt(shapeLineThickness.value) || 5) : (parseInt(shapeStrokeWidth.value) || 2)
        };
    }

    shapeType.addEventListener('change', () => {
        updatePropertiesVisibility();
        updateShapeSettings();
    });
    shapeFillColor.addEventListener('change', updateShapeSettings);
    shapeHasStroke.addEventListener('change', updateShapeSettings);
    shapeStrokeColor.addEventListener('change', updateShapeSettings);
    shapeStrokeWidth.addEventListener('change', updateShapeSettings);
    shapeLineColor.addEventListener('change', updateShapeSettings);
    shapeLineThickness.addEventListener('change', updateShapeSettings);

    // Initialize settings
    updatePropertiesVisibility();
    updateShapeSettings();

    shapeToolBtn.addEventListener('click', () => {
        // Toggle shape tool mode
        if (canvas.objectsManager.currentTool === 'shape') {
            canvas.objectsManager.setTool(null);
            shapeToolBtn.classList.remove('active');
            hidePropertiesPanel();
        } else {
            canvas.objectsManager.setTool('shape');
            shapeToolBtn.classList.add('active');
            // Show shape properties panel
            showPropertiesPanel({ type: 'shape' });
        }
    });

    // Listen for tool changes to deactivate button and close properties
    canvas.canvas.addEventListener('toolChanged', (e) => {
        if (e.detail.tool !== 'shape') {
            shapeToolBtn.classList.remove('active');
            // Close properties panel when tool is deactivated (after creating shape)
            hidePropertiesPanel();
        }
    });
}