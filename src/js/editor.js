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
    canvasElement.addEventListener('objectsChanged', () => {
        renderLayers();
        scheduleSave();
    });
    canvasElement.addEventListener('toolDeactivated', () => {
        const textToolBtn = document.getElementById('text-tool-btn');
        if (textToolBtn) {
            textToolBtn.classList.remove('active');
        }
    });
    canvasElement.addEventListener('textEditStart', (e) => {
        showTextEditOverlay(e.detail);
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
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (canvas.selectedImages.length > 0) {
                canvas.deleteSelectedImages();
                renderLayers();
                scheduleSave();
            }
        }
    });

    // Drawing toolbar event listeners
    setupDrawingToolbar();
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

    // Text tool button
    const textToolBtn = document.getElementById('text-tool-btn');
    if (textToolBtn) {
        textToolBtn.addEventListener('click', () => {
            const isActive = textToolBtn.classList.contains('active');

            // Deactivate all other tools
            if (drawingModeBtn) {
                const drawingToolbar = document.getElementById('drawing-toolbar');
                if (drawingToolbar) {
                    drawingToolbar.style.display = 'none';
                    drawingModeBtn.classList.remove('active');
                    canvas.setDrawingMode(null);
                }
            }

            if (isActive) {
                // Deactivate text tool
                textToolBtn.classList.remove('active');
                canvas.objectsManager.setTool(null);
            } else {
                // Activate text tool
                textToolBtn.classList.add('active');
                canvas.objectsManager.setTool('text');
            }
        });
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
        visible: img.visible !== false
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
        dragSourceIndex = realIndex;
        currentOrder = [...images].reverse();
        draggedImageId = img.id;
        layerItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        if (currentOrder.length > 0) {
            const newCanvasOrder = [...currentOrder].reverse();
            canvas.images = newCanvasOrder;
            canvas.invalidateCullCache();
            canvas.needsRender = true;
            canvas.render();
            canvas.notifyChange();
        }

        dragSourceIndex = null;
        currentOrder = [];
        draggedImageId = null;
        renderLayers();
        scheduleSave();
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedImageId) return;

        const targetId = img.id;
        if (targetId === draggedImageId) return;

        if (dragSourceIndex !== null) {
            const fromIdx = currentOrder.findIndex(i => i.id === draggedImageId);
            const toIdx = currentOrder.findIndex(i => i.id === targetId);

            if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                const newOrder = [...currentOrder];
                const [moved] = newOrder.splice(fromIdx, 1);
                newOrder.splice(toIdx, 0, moved);
                currentOrder = newOrder;

                // Update canvas preview in real-time
                const newCanvasOrder = [...currentOrder].reverse();
                canvas.images = newCanvasOrder;
                canvas.invalidateCullCache();
                canvas.needsRender = true;
                canvas.render();

                renderLayers();
            }
        }
    });

    return layerItem;
}

function createObjectLayerItem(obj) {
    const layerItem = document.createElement('div');
    layerItem.className = 'layer-item';
    layerItem.dataset.objectId = obj.id;

    if (canvas.objectsManager.selectedObject && canvas.objectsManager.selectedObject.id === obj.id) {
        layerItem.classList.add('selected');
    }

    const icon = document.createElement('div');
    icon.className = 'layer-icon';
    icon.textContent = obj.type === 'text' ? 'T' : '▢';
    icon.style.fontSize = '14px';
    icon.style.fontWeight = 'bold';
    icon.style.width = '24px';
    icon.style.textAlign = 'center';

    const layerContent = document.createElement('div');
    layerContent.className = 'layer-content';

    const layerName = document.createElement('span');
    layerName.className = 'layer-name';
    layerName.textContent = obj.name;
    layerName.style.cursor = 'pointer';

    const layerControls = document.createElement('div');
    layerControls.className = 'layer-controls';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '×';
    deleteBtn.className = 'layer-btn-delete';
    deleteBtn.title = 'Delete object';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        canvas.objectsManager.deleteObject(obj.id);
        renderLayers();
    });

    layerControls.appendChild(deleteBtn);
    layerContent.appendChild(layerName);

    layerItem.appendChild(icon);
    layerItem.appendChild(layerContent);
    layerItem.appendChild(layerControls);

    layerItem.addEventListener('click', () => {
        canvas.objectsManager.selectObject(obj);
        renderLayers();
    });

    return layerItem;
}

function renderLayers() {
    const layersList = document.getElementById('layers-list');
    const images = canvas.getImages();
    const objects = canvas.objectsManager.getObjects();

    if (images.length === 0 && objects.length === 0) {
        layersList.innerHTML = '<div class="empty-message">No layers yet</div>';
        return;
    }

    layersList.innerHTML = '';

    // Render text/shape objects first (they appear on top)
    [...objects].reverse().forEach(obj => {
        const layerItem = createObjectLayerItem(obj);
        layersList.appendChild(layerItem);
    });

    // Render image layers in reverse order (top = front, bottom = back)
    [...images].reverse().forEach(img => {
        const layerItem = createLayerItem(img, images);
        layersList.appendChild(layerItem);
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
            const confirmMsg = showAllAssets 
                ? `Delete "${asset.name}" from all assets? This will remove it everywhere.`
                : `Remove "${asset.name}" from this board?`;
            
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
    saveNow();
    const board = boardManager.currentBoard;
    const exportData = {
        version: 1,
        name: board.name,
        bgColor: board.bgColor || board.bg_color,
        layers: canvas.getImages().map(img => ({
            id: img.id,
            name: img.name,
            src: img.img.src,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            visible: img.visible
        })),
        groups: canvas.groups || [],
        assets: board.assets || [],
        exportedAt: Date.now()
    };

    const json = JSON.stringify(exportData, null, 2);
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
                    showToast(`Merged ${importData.layers.length} layer(s)`, 'success');
                } else {
                    canvas.clear();
                    for (const layer of importData.layers) {
                        const img = new Image();
                        await new Promise((resolve) => {
                            img.onload = () => {
                                const added = canvas.addImageSilent(img, layer.x, layer.y, layer.name, layer.width, layer.height, layer.visible);
                                added.id = layer.id;
                                resolve();
                            };
                            img.onerror = resolve;
                            img.src = layer.src;
                        });
                    }
                    // Replace groups
                    canvas.groups = importData.groups || [];
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

// Text edit overlay function (Konva-style implementation)
function showTextEditOverlay(textObject) {
    const canvasRect = canvas.canvas.getBoundingClientRect();

    // Convert world coordinates to screen coordinates
    const screenX = (textObject.x * canvas.zoom) + canvas.pan.x;
    const screenY = (textObject.y * canvas.zoom) + canvas.pan.y;

    const overlayPos = {
        x: canvasRect.left + screenX,
        y: canvasRect.top + screenY
    };

    // Create textarea overlay
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    textarea.value = textObject.text || '';
    textarea.style.position = 'absolute';
    textarea.style.top = overlayPos.y + 'px';
    textarea.style.left = overlayPos.x + 'px';
    textarea.style.width = (textObject.width * canvas.zoom) + 'px';
    textarea.style.height = (textObject.height * canvas.zoom) + 'px';
    textarea.style.fontSize = (textObject.fontSize * canvas.zoom) + 'px';
    textarea.style.fontFamily = textObject.font || 'Arial';
    textarea.style.color = textObject.color || '#000000';
    textarea.style.backgroundColor = textObject.backgroundColor || '#ffffff';
    textarea.style.textAlign = textObject.align || 'left';
    textarea.style.padding = ((textObject.padding || 10) * canvas.zoom) + 'px';
    textarea.style.border = '2px solid #0066ff';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.overflow = 'hidden';
    textarea.style.lineHeight = '1.2';
    textarea.style.zIndex = '10000';
    textarea.focus();
    textarea.select();

    // Update textarea position and size when view changes
    function updateTextareaTransform() {
        const canvasRect = canvas.canvas.getBoundingClientRect();
        const screenX = (textObject.x * canvas.zoom) + canvas.pan.x;
        const screenY = (textObject.y * canvas.zoom) + canvas.pan.y;

        textarea.style.top = (canvasRect.top + screenY) + 'px';
        textarea.style.left = (canvasRect.left + screenX) + 'px';
        textarea.style.width = (textObject.width * canvas.zoom) + 'px';
        textarea.style.height = (textObject.height * canvas.zoom) + 'px';
        textarea.style.fontSize = (textObject.fontSize * canvas.zoom) + 'px';
        textarea.style.padding = ((textObject.padding || 10) * canvas.zoom) + 'px';
    }

    function removeTextarea() {
        if (textarea.parentNode) {
            textarea.parentNode.removeChild(textarea);
        }
        window.removeEventListener('click', handleOutsideClick);
        canvas.canvas.removeEventListener('viewChanged', updateTextareaTransform);
        canvas.objectsManager.stopTextEdit();
        canvas.needsRender = true;
    }

    function saveText() {
        const newText = textarea.value;
        console.log('Saving text:', newText);
        canvas.objectsManager.updateSelectedObject({ text: newText });
        removeTextarea();
    }

    // Listen for view changes (zoom/pan)
    canvas.canvas.addEventListener('viewChanged', updateTextareaTransform);

    // Save on Enter (without Shift)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            saveText();
        }
        if (e.key === 'Escape') {
            removeTextarea();
        }
    });

    // Save on outside click
    function handleOutsideClick(e) {
        if (e.target !== textarea) {
            saveText();
        }
    }
    setTimeout(() => {
        window.addEventListener('click', handleOutsideClick);
    }, 10);
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

    if (obj.type === 'text') {
        propertiesTitle.textContent = 'Text Properties';
        textProperties.style.display = 'block';
        shapeProperties.style.display = 'none';

        // Populate text properties
        document.getElementById('text-content').value = obj.text || '';
        document.getElementById('text-font').value = obj.font || 'Arial';
        document.getElementById('text-size').value = obj.fontSize || 16;
        document.getElementById('text-color').value = obj.color || '#000000';
        document.getElementById('text-bg-color').value = obj.backgroundColor || '#ffffff';

        // Set alignment buttons
        document.querySelectorAll('.alignment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.align === obj.align);
        });

        // Add event listeners for text properties
        setupTextPropertyListeners();
    } else if (obj.type === 'shape') {
        propertiesTitle.textContent = 'Shape Properties';
        textProperties.style.display = 'none';
        shapeProperties.style.display = 'block';

        // Populate shape properties
        document.getElementById('shape-type').value = obj.shapeType || 'rectangle';
        document.getElementById('shape-fill-color').value = obj.fillColor || '#3b82f6';
        document.getElementById('shape-stroke-color').value = obj.strokeColor || '#000000';
        document.getElementById('shape-stroke-width').value = obj.strokeWidth || 2;

        if (obj.shapeType === 'polygon') {
            document.getElementById('polygon-sides-row').style.display = 'flex';
            document.getElementById('polygon-sides').value = obj.sides || 6;
        } else {
            document.getElementById('polygon-sides-row').style.display = 'none';
        }

        // Add event listeners for shape properties
        setupShapePropertyListeners();
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
    removeTextPropertyListeners();
    removeShapePropertyListeners();
}

function setupTextPropertyListeners() {
    const textContent = document.getElementById('text-content');
    const textFont = document.getElementById('text-font');
    const textSize = document.getElementById('text-size');
    const textColor = document.getElementById('text-color');
    const textBgColor = document.getElementById('text-bg-color');
    const alignmentBtns = document.querySelectorAll('.alignment-btn');

    textContent.oninput = () => {
        // Allow empty text during editing, but preserve the value
        const value = textContent.value;
        canvas.objectsManager.updateSelectedObject({ text: value || '' });
    };

    textFont.onchange = () => {
        canvas.objectsManager.updateSelectedObject({ font: textFont.value });
    };

    textSize.oninput = () => {
        const value = parseInt(textSize.value);
        // Allow any input during typing (including empty for backspace)
        // Only update if we have a valid number within range
        if (!isNaN(value) && value >= 8 && value <= 200) {
            canvas.objectsManager.updateSelectedObject({ fontSize: value });
        }
    };

    textColor.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ color: textColor.value });
    };

    textBgColor.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ backgroundColor: textBgColor.value });
    };

    alignmentBtns.forEach(btn => {
        btn.onclick = () => {
            alignmentBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            canvas.objectsManager.updateSelectedObject({ align: btn.dataset.align });
        };
    });
}

function removeTextPropertyListeners() {
    const textContent = document.getElementById('text-content');
    const textFont = document.getElementById('text-font');
    const textSize = document.getElementById('text-size');
    const textColor = document.getElementById('text-color');
    const textBgColor = document.getElementById('text-bg-color');
    const alignmentBtns = document.querySelectorAll('.alignment-btn');

    if (textContent) textContent.oninput = null;
    if (textFont) textFont.onchange = null;
    if (textSize) textSize.oninput = null;
    if (textColor) textColor.oninput = null;
    if (textBgColor) textBgColor.oninput = null;
    alignmentBtns.forEach(btn => btn.onclick = null);
}

function setupShapePropertyListeners() {
    const shapeType = document.getElementById('shape-type');
    const shapeFillColor = document.getElementById('shape-fill-color');
    const shapeStrokeColor = document.getElementById('shape-stroke-color');
    const shapeStrokeWidth = document.getElementById('shape-stroke-width');
    const polygonSides = document.getElementById('polygon-sides');

    shapeType.onchange = () => {
        const value = shapeType.value;
        canvas.objectsManager.updateSelectedObject({ shapeType: value });

        const polygonSidesRow = document.getElementById('polygon-sides-row');
        if (value === 'polygon') {
            polygonSidesRow.style.display = 'flex';
        } else {
            polygonSidesRow.style.display = 'none';
        }
    };

    shapeFillColor.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ fillColor: shapeFillColor.value });
    };

    shapeStrokeColor.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ strokeColor: shapeStrokeColor.value });
    };

    shapeStrokeWidth.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ strokeWidth: parseInt(shapeStrokeWidth.value) });
    };

    polygonSides.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ sides: parseInt(polygonSides.value) });
    };
}

function removeShapePropertyListeners() {
    const shapeType = document.getElementById('shape-type');
    const shapeFillColor = document.getElementById('shape-fill-color');
    const shapeStrokeColor = document.getElementById('shape-stroke-color');
    const shapeStrokeWidth = document.getElementById('shape-stroke-width');
    const polygonSides = document.getElementById('polygon-sides');

    if (shapeType) shapeType.onchange = null;
    if (shapeFillColor) shapeFillColor.oninput = null;
    if (shapeStrokeColor) shapeStrokeColor.oninput = null;
    if (shapeStrokeWidth) shapeStrokeWidth.oninput = null;
    if (polygonSides) polygonSides.oninput = null;
}