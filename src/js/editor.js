import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';
import { showDeleteConfirm } from './modal.js';
import { HistoryManager } from './history-manager.js';
import { showInputModal, showChoiceModal, showToast, showConfirmModal, showColorExtractorModal } from './modal-utils.js';
import { updateTitlebarTitle } from './titlebar.js';

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
let renderThrottle = null;
let draggedElement = null;
let ghostElement = null;
let lastDragOrderHash = null;
let isDragging = false;
let draggedFromGroup = null; // Track if dragged layer came from a group

// Layer groups
let layerGroups = []; // Array of { id, name, layerIds: [], collapsed: false }
let nextGroupId = 1;

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
    updateTitlebarTitle(`EyeDea - ${board.name}`);
    
    const canvasElement = document.getElementById('main-canvas');
    canvas = new Canvas(canvasElement);
    canvas.setBackgroundColor(board.bgColor || board.bg_color);

    historyManager = new HistoryManager(50);
    historyManager.setCanvas(canvas);
    canvas.setHistoryManager(historyManager);

    const colorInput = document.getElementById('bg-color');
    colorInput.value = board.bgColor || board.bg_color;

    await loadLayers(board.layers, board.viewState);

    // Load groups if they exist
    if (board.groups && board.groups.length > 0) {
        console.log('Loading groups from board:', board.groups);
        layerGroups = board.groups.map(g => ({
            id: g.id,
            name: g.name,
            layerIds: g.layerIds || [],
            objectIds: g.objectIds || [],
            collapsed: g.collapsed || false
        }));
        nextGroupId = Math.max(...layerGroups.map(g => g.id), 0) + 1;
        console.log('Groups loaded, layerGroups:', layerGroups, 'nextGroupId:', nextGroupId);
    } else {
        console.log('No groups found in board data, board.groups:', board.groups);
    }

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
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !isTyping) {
            e.preventDefault();
            // Group selected layers
            groupSelectedLayers();
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
    setupColorExtractorTool();
    setupLayerContextMenu();
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

        // Make toolbar draggable
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX;
        let initialY;

        drawingToolbar.addEventListener('mousedown', (e) => {
            // Only drag if clicking on the toolbar background, not buttons/inputs
            if (e.target === drawingToolbar || e.target.classList.contains('toolbar-separator')) {
                const rect = drawingToolbar.getBoundingClientRect();
                initialX = e.clientX - rect.left;
                initialY = e.clientY - rect.top;
                isDragging = true;
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                // Remove centering and position absolutely
                drawingToolbar.style.left = currentX + 'px';
                drawingToolbar.style.top = currentY + 'px';
                drawingToolbar.style.bottom = 'auto';
                drawingToolbar.style.transform = 'none';
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
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
    const groups = layerGroups.map(g => ({
        id: g.id,
        name: g.name,
        layerIds: g.layerIds,
        objectIds: g.objectIds || [],
        collapsed: g.collapsed || false
    }));
    console.log('Saving board:', { layersCount: layers.length, strokesCount: strokes.length, objectsCount: objects.length, groupsCount: groups.length, objects, viewState });
    console.log('Layers zIndex:', layers.map(l => ({ id: l.id, name: l.name, zIndex: l.zIndex })));
    console.log('Objects zIndex:', objects.map(o => ({ id: o.id, type: o.type, zIndex: o.zIndex })));
    boardManager.updateBoard(currentBoardId, { layers, bgColor, viewState, strokes, objects, groups, thumbnail });
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

    // Layer icon (image icon)
    const layerIcon = document.createElement('div');
    layerIcon.className = 'layer-icon';
    layerIcon.textContent = 'I';

    const layerContent = document.createElement('div');
    layerContent.className = 'layer-content';

    const layerName = document.createElement('div');
    layerName.className = 'layer-name';
    layerName.textContent = img.name;
    layerName.title = img.name;

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
    layerItem.appendChild(layerIcon);
    layerItem.appendChild(layerContent);
    layerItem.appendChild(visibilityBtn);
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

    // Right-click context menu
    layerItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showLayerContextMenu(e.clientX, e.clientY, img, 'image');
    });

    layerItem.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'INPUT') {
            e.preventDefault();
            return;
        }
        isDragging = true;
        draggedLayerId = img.id;
        draggedLayerType = 'image';

        // Track which group this layer belongs to (if any)
        draggedFromGroup = layerGroups.find(g => g.layerIds.includes(img.id)) || null;

        allLayersOrder = getAllLayersForDragging();
        dragSourceIndex = allLayersOrder.findIndex(l => l.type === 'image' && l.data.id === img.id);
        layerItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        isDragging = false;
        applyLayerOrder();

        // Check if layer should be removed from its original group
        if (draggedFromGroup && draggedLayerType === 'image') {
            // Find where the layer ended up in the final order
            const finalIdx = allLayersOrder.findIndex(l => l.type === 'image' && l.data.id === draggedLayerId);

            if (finalIdx !== -1) {
                // Check if it's still adjacent to other group members
                const groupLayerIndices = [];
                allLayersOrder.forEach((layer, idx) => {
                    if (layer.type === 'image' && draggedFromGroup.layerIds.includes(layer.data.id)) {
                        groupLayerIndices.push(idx);
                    }
                });

                // If this layer is not consecutive with at least one other group member, remove it
                const isConsecutive = groupLayerIndices.some(idx =>
                    idx !== finalIdx && Math.abs(idx - finalIdx) === 1
                );

                if (!isConsecutive && groupLayerIndices.length > 1) {
                    // Remove from group
                    draggedFromGroup.layerIds = draggedFromGroup.layerIds.filter(id => id !== draggedLayerId);
                }
            }
        }

        draggedLayerId = null;
        draggedLayerType = null;
        dragSourceIndex = null;
        draggedFromGroup = null;
        allLayersOrder = [];
        lastDragOrderHash = null;
        renderLayers();
        scheduleSave();
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedLayerId) return;

        const targetId = img.id;
        if (targetId === draggedLayerId && draggedLayerType === 'image') return;

        if (allLayersOrder.length > 0) {
            // Edge detection: determine if hovering over top or bottom half
            const rect = layerItem.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midpoint;

            if (draggedLayerType === 'group') {
                // If dragging a group onto a regular layer, move all group layers together
                const draggedGroup = layerGroups.find(g => g.id === draggedLayerId);
                if (!draggedGroup) return;

                // Find all layers belonging to dragged group
                const draggedGroupLayerIndices = [];
                allLayersOrder.forEach((layer, idx) => {
                    if (layer.type === 'image' && draggedGroup.layerIds.includes(layer.data.id)) {
                        draggedGroupLayerIndices.push(idx);
                    } else if (layer.type === 'object' && draggedGroup.objectIds && draggedGroup.objectIds.includes(layer.data.id)) {
                        draggedGroupLayerIndices.push(idx);
                    }
                });

                const toIdx = allLayersOrder.findIndex(l => l.type === 'image' && l.data.id === targetId);

                if (draggedGroupLayerIndices.length > 0 && toIdx !== -1) {
                    // Extract dragged group layers
                    const newOrder = [...allLayersOrder];
                    const draggedLayers = draggedGroupLayerIndices.sort((a, b) => a - b).map(idx => newOrder[idx]);

                    // Remove from original positions (in reverse to maintain indices)
                    for (let i = draggedGroupLayerIndices.length - 1; i >= 0; i--) {
                        newOrder.splice(draggedGroupLayerIndices[i], 1);
                    }

                    // Find new insertion point after removal
                    let newToIdx = newOrder.findIndex(l => l.type === 'image' && l.data.id === targetId);

                    if (newToIdx !== -1) {
                        // If inserting after (bottom half), move index forward
                        if (!insertBefore) {
                            newToIdx++;
                        }
                        // Insert all dragged layers at target position
                        newOrder.splice(newToIdx, 0, ...draggedLayers);
                        allLayersOrder = newOrder;
                        renderLayersThrottled();
                    }
                }
            } else {
                // Regular layer or object drag
                const fromIdx = allLayersOrder.findIndex(l => {
                    if (draggedLayerType === 'image') {
                        return l.type === 'image' && l.data.id === draggedLayerId;
                    } else {
                        return l.type === 'object' && l.data.id === draggedLayerId;
                    }
                });
                let toIdx = allLayersOrder.findIndex(l => l.type === 'image' && l.data.id === targetId);

                if (fromIdx !== -1 && toIdx !== -1) {
                    const newOrder = [...allLayersOrder];
                    const [moved] = newOrder.splice(fromIdx, 1);

                    // Recalculate toIdx after removal
                    toIdx = newOrder.findIndex(l => l.type === 'image' && l.data.id === targetId);

                    if (toIdx !== -1) {
                        // If inserting after (bottom half), move index forward
                        if (!insertBefore) {
                            toIdx++;
                        }
                        newOrder.splice(toIdx, 0, moved);
                        allLayersOrder = newOrder;
                        renderLayersThrottled();
                    }
                }
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

    // Layer icon based on type
    const layerIcon = document.createElement('div');
    layerIcon.className = 'layer-icon';
    if (obj.type === 'text') {
        layerIcon.textContent = 'T';
    } else if (obj.type === 'shape') {
        layerIcon.textContent = 'S';
    } else if (obj.type === 'colorPalette') {
        layerIcon.textContent = 'P';
    }

    const layerContent = document.createElement('div');
    layerContent.className = 'layer-content';

    const layerName = document.createElement('div');
    layerName.className = 'layer-name';
    if (obj.type === 'text') {
        layerName.textContent = (obj.text || 'Text').substring(0, 30);
        layerName.title = obj.text || 'Text';
    } else if (obj.type === 'shape') {
        const shapeType = obj.shapeType || 'square';
        layerName.textContent = shapeType.charAt(0).toUpperCase() + shapeType.slice(1);
        layerName.title = layerName.textContent;
    } else if (obj.type === 'colorPalette') {
        layerName.textContent = obj.name || 'Palette';
        layerName.title = layerName.textContent;
    }

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
    layerItem.appendChild(layerIcon);
    layerItem.appendChild(layerContent);
    layerItem.appendChild(visibilityBtn);
    layerItem.appendChild(layerControls);

    layerItem.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (obj.visible !== false) {
            canvas.objectsManager.selectObject(obj);
            renderLayers();
        }
    });

    // Right-click context menu
    layerItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showLayerContextMenu(e.clientX, e.clientY, obj, 'object');
    });

    // Drag and drop for unified layer reordering
    layerItem.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'INPUT') {
            e.preventDefault();
            return;
        }
        isDragging = true;
        draggedLayerId = obj.id;
        draggedLayerType = 'object';

        // Track which group this object belongs to (if any)
        draggedFromGroup = layerGroups.find(g => g.objectIds && g.objectIds.includes(obj.id)) || null;

        allLayersOrder = getAllLayersForDragging();
        dragSourceIndex = allLayersOrder.findIndex(l => l.type === 'object' && l.data.id === obj.id);
        layerItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        isDragging = false;
        applyLayerOrder();

        // Check if object should be removed from its original group
        if (draggedFromGroup && draggedLayerType === 'object') {
            // Find where the object ended up in the final order
            const finalIdx = allLayersOrder.findIndex(l => l.type === 'object' && l.data.id === draggedLayerId);

            if (finalIdx !== -1 && draggedFromGroup.objectIds) {
                // Check if it's still adjacent to other group members
                const groupLayerIndices = [];
                allLayersOrder.forEach((layer, idx) => {
                    if (layer.type === 'object' && draggedFromGroup.objectIds.includes(layer.data.id)) {
                        groupLayerIndices.push(idx);
                    } else if (layer.type === 'image' && draggedFromGroup.layerIds.includes(layer.data.id)) {
                        groupLayerIndices.push(idx);
                    }
                });

                // If this object is not consecutive with at least one other group member, remove it
                const isConsecutive = groupLayerIndices.some(idx =>
                    idx !== finalIdx && Math.abs(idx - finalIdx) === 1
                );

                if (!isConsecutive && groupLayerIndices.length > 1) {
                    // Remove from group
                    draggedFromGroup.objectIds = draggedFromGroup.objectIds.filter(id => id !== draggedLayerId);
                }
            }
        }

        draggedLayerId = null;
        draggedLayerType = null;
        dragSourceIndex = null;
        draggedFromGroup = null;
        allLayersOrder = [];
        lastDragOrderHash = null;
        renderLayers();
        scheduleSave();
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedLayerId) return;

        const targetId = obj.id;
        if (targetId === draggedLayerId && draggedLayerType === 'object') return;

        if (allLayersOrder.length > 0) {
            // Edge detection: determine if hovering over top or bottom half
            const rect = layerItem.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midpoint;

            if (draggedLayerType === 'group') {
                // If dragging a group onto an object layer, move all group layers together
                const draggedGroup = layerGroups.find(g => g.id === draggedLayerId);
                if (!draggedGroup) return;

                // Find all layers belonging to dragged group
                const draggedGroupLayerIndices = [];
                allLayersOrder.forEach((layer, idx) => {
                    if (layer.type === 'image' && draggedGroup.layerIds.includes(layer.data.id)) {
                        draggedGroupLayerIndices.push(idx);
                    } else if (layer.type === 'object' && draggedGroup.objectIds && draggedGroup.objectIds.includes(layer.data.id)) {
                        draggedGroupLayerIndices.push(idx);
                    }
                });

                const toIdx = allLayersOrder.findIndex(l => l.type === 'object' && l.data.id === targetId);

                if (draggedGroupLayerIndices.length > 0 && toIdx !== -1) {
                    // Extract dragged group layers
                    const newOrder = [...allLayersOrder];
                    const draggedLayers = draggedGroupLayerIndices.sort((a, b) => a - b).map(idx => newOrder[idx]);

                    // Remove from original positions (in reverse to maintain indices)
                    for (let i = draggedGroupLayerIndices.length - 1; i >= 0; i--) {
                        newOrder.splice(draggedGroupLayerIndices[i], 1);
                    }

                    // Find new insertion point after removal
                    let newToIdx = newOrder.findIndex(l => l.type === 'object' && l.data.id === targetId);

                    if (newToIdx !== -1) {
                        // If inserting after (bottom half), move index forward
                        if (!insertBefore) {
                            newToIdx++;
                        }
                        // Insert all dragged layers at target position
                        newOrder.splice(newToIdx, 0, ...draggedLayers);
                        allLayersOrder = newOrder;
                        renderLayersThrottled();
                    }
                }
            } else {
                // Regular layer or object drag
                const fromIdx = allLayersOrder.findIndex(l => {
                    if (draggedLayerType === 'object') {
                        return l.type === 'object' && l.data.id === draggedLayerId;
                    } else {
                        return l.type === 'image' && l.data.id === draggedLayerId;
                    }
                });
                let toIdx = allLayersOrder.findIndex(l => l.type === 'object' && l.data.id === targetId);

                if (fromIdx !== -1 && toIdx !== -1) {
                    const newOrder = [...allLayersOrder];
                    const [moved] = newOrder.splice(fromIdx, 1);

                    // Recalculate toIdx after removal
                    toIdx = newOrder.findIndex(l => l.type === 'object' && l.data.id === targetId);

                    if (toIdx !== -1) {
                        // If inserting after (bottom half), move index forward
                        if (!insertBefore) {
                            toIdx++;
                        }
                        newOrder.splice(toIdx, 0, moved);
                        allLayersOrder = newOrder;
                        renderLayersThrottled();
                    }
                }
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

async function groupSelectedLayers() {
    // Get all selected layers (both images and objects)
    const selectedImages = canvas.selectedImages || [];
    const selectedObject = canvas.objectsManager.selectedObject;

    // Need at least 2 layers to create a group
    const totalSelected = selectedImages.length + (selectedObject ? 1 : 0);

    if (totalSelected < 2) {
        showToast('Select at least 2 layers to create a group');
        return;
    }

    // Ask for group name
    const groupName = await showInputModal('Create Group', 'Group name:', `Group ${nextGroupId}`);
    if (!groupName || groupName.trim() === '') {
        return;
    }

    // Create the group
    const newGroup = {
        id: nextGroupId++,
        name: groupName.trim(),
        layerIds: selectedImages.map(img => img.id),
        objectIds: selectedObject ? [selectedObject.id] : [],
        collapsed: false
    };

    layerGroups.push(newGroup);

    // Clear selection
    canvas.selectedImage = null;
    canvas.selectedImages = [];
    canvas.objectsManager.deselectAll();

    renderLayers();
    scheduleSave();

    showToast(`Group "${groupName}" created with ${totalSelected} layers`);
}

function createGroupElement(group, allLayers, images, objects) {
    const groupItem = document.createElement('div');
    groupItem.className = 'group-item';
    groupItem.dataset.groupId = group.id;

    // Create group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    groupHeader.draggable = true;

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'layer-drag-handle';
    dragHandle.innerHTML = `
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
    `;

    // Group icon
    const groupIcon = document.createElement('div');
    groupIcon.className = 'layer-icon';
    groupIcon.textContent = 'G';
    groupIcon.style.fontWeight = '600';

    // Group content (name wrapper)
    const groupContent = document.createElement('div');
    groupContent.className = 'layer-content';

    const groupName = document.createElement('div');
    groupName.className = 'layer-name';
    groupName.textContent = group.name;
    groupName.title = group.name;
    groupName.style.fontWeight = '600';

    groupContent.appendChild(groupName);

    // Group controls
    const groupControls = document.createElement('div');
    groupControls.className = 'layer-controls';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'layer-btn-delete';
    deleteBtn.type = 'button';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete group (keep layers)';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Remove the group but keep the layers
        const index = layerGroups.findIndex(g => g.id === group.id);
        if (index !== -1) {
            layerGroups.splice(index, 1);
            renderLayers();
            scheduleSave();
        }
    });

    groupControls.appendChild(deleteBtn);

    groupHeader.appendChild(dragHandle);
    groupHeader.appendChild(groupIcon);
    groupHeader.appendChild(groupContent);
    groupHeader.appendChild(groupControls);

    // Click to select all layers in group
    groupHeader.addEventListener('click', (e) => {
        // Don't trigger if clicking on buttons or during drag
        if (e.target.tagName === 'BUTTON') return;

        e.stopPropagation();

        // Get fresh list of images from canvas
        const currentImages = canvas.getImages();
        const groupImageLayers = currentImages.filter(img => group.layerIds.includes(img.id));

        console.log('Group clicked:', group.name, 'Layer IDs:', group.layerIds, 'Found layers:', groupImageLayers.length);

        // Clear current selection first
        canvas.selectedImage = null;
        canvas.selectedImages = [];
        canvas.objectsManager.deselectAll();

        if (groupImageLayers.length > 0) {
            // Select all layers in the group
            groupImageLayers.forEach((img, index) => {
                console.log('Selecting layer:', img.name, 'multi:', index > 0);
                canvas.selectImage(img, index > 0);
            });
        }

        canvas.render();
        renderLayers();
    });

    // Right-click context menu for group
    groupHeader.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGroupContextMenu(e.clientX, e.clientY, group);
    });

    // Drag and drop functionality for groups
    groupHeader.addEventListener('dragstart', (e) => {
        console.log('Group dragstart:', group.name);
        isDragging = true;
        draggedLayerId = group.id;
        draggedLayerType = 'group';
        allLayersOrder = getAllLayersForDragging();
        groupHeader.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    groupHeader.addEventListener('dragend', () => {
        isDragging = false;
        applyLayerOrder();
        groupHeader.classList.remove('dragging');
        draggedLayerId = null;
        draggedLayerType = null;
        dragSourceIndex = null;
        allLayersOrder = [];
        lastDragOrderHash = null;
        renderLayers();
        scheduleSave();
    });

    groupHeader.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedLayerId) return;

        // Edge detection: determine if hovering over top or bottom half
        const rect = groupHeader.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midpoint;

        // If dragging a layer, show drop zone to add to group
        if (draggedLayerType !== 'group') {
            groupHeader.classList.add('drag-over');
        } else if (draggedLayerType === 'group' && draggedLayerId !== group.id && allLayersOrder.length > 0) {
            // If dragging a group onto another group, reorder by moving all group layers together
            const draggedGroup = layerGroups.find(g => g.id === draggedLayerId);
            if (!draggedGroup) return;

            // Find all layers belonging to dragged group
            const draggedGroupLayerIndices = [];
            allLayersOrder.forEach((layer, idx) => {
                if (layer.type === 'image' && draggedGroup.layerIds.includes(layer.data.id)) {
                    draggedGroupLayerIndices.push(idx);
                } else if (layer.type === 'object' && draggedGroup.objectIds && draggedGroup.objectIds.includes(layer.data.id)) {
                    draggedGroupLayerIndices.push(idx);
                }
            });

            // Find first layer of target group to use as insertion point
            const firstTargetLayerIdx = allLayersOrder.findIndex(layer => {
                if (layer.type === 'image' && group.layerIds.includes(layer.data.id)) return true;
                if (layer.type === 'object' && group.objectIds && group.objectIds.includes(layer.data.id)) return true;
                return false;
            });

            if (draggedGroupLayerIndices.length > 0 && firstTargetLayerIdx !== -1) {
                // Extract dragged group layers
                const newOrder = [...allLayersOrder];
                const draggedLayers = draggedGroupLayerIndices.sort((a, b) => a - b).map(idx => newOrder[idx]);

                // Remove from original positions (in reverse to maintain indices)
                for (let i = draggedGroupLayerIndices.length - 1; i >= 0; i--) {
                    newOrder.splice(draggedGroupLayerIndices[i], 1);
                }

                // Find new insertion point after removal
                let newTargetIdx = newOrder.findIndex(layer => {
                    if (layer.type === 'image' && group.layerIds.includes(layer.data.id)) return true;
                    if (layer.type === 'object' && group.objectIds && group.objectIds.includes(layer.data.id)) return true;
                    return false;
                });

                if (newTargetIdx !== -1) {
                    // If inserting after (bottom half), move index to after the last layer in the group
                    if (!insertBefore) {
                        // Find the last layer of the target group
                        let lastIdx = newTargetIdx;
                        for (let i = newTargetIdx + 1; i < newOrder.length; i++) {
                            const layer = newOrder[i];
                            if ((layer.type === 'image' && group.layerIds.includes(layer.data.id)) ||
                                (layer.type === 'object' && group.objectIds && group.objectIds.includes(layer.data.id))) {
                                lastIdx = i;
                            } else {
                                break;
                            }
                        }
                        newTargetIdx = lastIdx + 1;
                    }

                    // Insert all dragged layers at target position
                    newOrder.splice(newTargetIdx, 0, ...draggedLayers);
                    allLayersOrder = newOrder;
                    renderLayersThrottled();
                }
            }
        }
    });

    groupHeader.addEventListener('dragleave', () => {
        groupHeader.classList.remove('drag-over');
    });

    groupHeader.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        groupHeader.classList.remove('drag-over');

        // If dropping a layer onto a group, add it to the group
        if (draggedLayerType === 'image') {
            // Remove from other groups first
            layerGroups.forEach(g => {
                const index = g.layerIds.indexOf(draggedLayerId);
                if (index !== -1) {
                    g.layerIds.splice(index, 1);
                }
            });
            // Add to this group
            if (!group.layerIds.includes(draggedLayerId)) {
                group.layerIds.push(draggedLayerId);
            }
            renderLayers();
            scheduleSave();
        } else if (draggedLayerType === 'object') {
            // Remove from other groups first
            layerGroups.forEach(g => {
                if (g.objectIds) {
                    const index = g.objectIds.indexOf(draggedLayerId);
                    if (index !== -1) {
                        g.objectIds.splice(index, 1);
                    }
                }
            });
            // Add to this group
            if (!group.objectIds) {
                group.objectIds = [];
            }
            if (!group.objectIds.includes(draggedLayerId)) {
                group.objectIds.push(draggedLayerId);
            }
            renderLayers();
            scheduleSave();
        } else if (draggedLayerType === 'group' && draggedLayerId !== group.id) {
            // Reorder groups
            const draggedGroup = layerGroups.find(g => g.id === draggedLayerId);
            const targetGroup = group;

            if (draggedGroup && targetGroup) {
                const fromIdx = layerGroups.findIndex(g => g.id === draggedGroup.id);
                const toIdx = layerGroups.findIndex(g => g.id === targetGroup.id);

                if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                    layerGroups.splice(fromIdx, 1);
                    const newToIdx = layerGroups.findIndex(g => g.id === targetGroup.id);
                    layerGroups.splice(newToIdx, 0, draggedGroup);
                }
            }

            renderLayers();
            scheduleSave();
        }
    });

    groupItem.appendChild(groupHeader);

    // Create children container
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'group-children';

    // Render child layers
    // Get layers that belong to this group
    const groupLayers = allLayers.filter(layer => {
        if (layer.type === 'image') {
            return group.layerIds.includes(layer.data.id);
        } else if (layer.type === 'object') {
            return group.objectIds && group.objectIds.includes(layer.data.id);
        }
        return false;
    });

    // Render in reverse order (front to back for display)
    const reversedGroupLayers = [...groupLayers].reverse();
    reversedGroupLayers.forEach(layer => {
        if (layer.type === 'image') {
            const layerItem = createLayerItem(layer.data, images);
            childrenContainer.appendChild(layerItem);
        } else if (layer.type === 'object') {
            const layerItem = createObjectLayerItem(layer.data, objects);
            childrenContainer.appendChild(layerItem);
        }
    });

    groupItem.appendChild(childrenContainer);

    return groupItem;
}

function showGroupContextMenu(x, y, group) {
    // Remove existing context menu
    const existingMenu = document.querySelector('.layer-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'layer-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const renameItem = document.createElement('div');
    renameItem.className = 'layer-context-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', async () => {
        menu.remove();
        const newName = await showInputModal('Rename Group', 'Group name:', group.name);
        if (newName && newName.trim() !== '') {
            group.name = newName.trim();
            renderLayers();
            scheduleSave();
        }
    });

    const separator = document.createElement('div');
    separator.className = 'layer-context-menu-separator';

    const ungroupItem = document.createElement('div');
    ungroupItem.className = 'layer-context-menu-item';
    ungroupItem.textContent = 'Ungroup';
    ungroupItem.addEventListener('click', () => {
        menu.remove();
        const index = layerGroups.findIndex(g => g.id === group.id);
        if (index !== -1) {
            layerGroups.splice(index, 1);
            renderLayers();
            scheduleSave();
        }
    });

    const deleteItem = document.createElement('div');
    deleteItem.className = 'layer-context-menu-item';
    deleteItem.textContent = 'Delete Group and Layers';
    deleteItem.addEventListener('click', () => {
        menu.remove();
        showConfirmModal(
            'Delete Group',
            `Delete group "${group.name}" and all its layers?`,
            async (confirmed) => {
                if (confirmed) {
                    // Delete all layers in the group
                    group.layerIds.forEach(id => {
                        canvas.deleteImage(id);
                    });
                    if (group.objectIds) {
                        group.objectIds.forEach(id => {
                            canvas.objectsManager.deleteObject(id);
                        });
                    }
                    // Remove the group
                    const index = layerGroups.findIndex(g => g.id === group.id);
                    if (index !== -1) {
                        layerGroups.splice(index, 1);
                    }
                    canvas.invalidateCullCache();
                    canvas.render();
                    renderLayers();
                    scheduleSave();
                }
            }
        );
    });

    menu.appendChild(renameItem);
    menu.appendChild(separator);
    menu.appendChild(ungroupItem);
    menu.appendChild(deleteItem);

    document.body.appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 0);
}

function reorderLayerElementsVisually() {
    // Create a hash of the current order to detect if it's changed
    const currentOrderHash = allLayersOrder.map(l => `${l.type}-${l.data.id}`).join(',');
    if (currentOrderHash === lastDragOrderHash) {
        return; // Order hasn't changed, skip reordering
    }
    lastDragOrderHash = currentOrderHash;

    if (renderThrottle) {
        cancelAnimationFrame(renderThrottle);
    }

    renderThrottle = requestAnimationFrame(() => {
        const layersList = document.getElementById('layers-list');
        if (!layersList || allLayersOrder.length === 0) {
            renderThrottle = null;
            return;
        }

        // Build a map of current elements and their positions
        const elements = new Map();
        const oldPositions = new Map();

        layersList.querySelectorAll('.layer-item, .group-item').forEach(el => {
            const id = el.dataset.layerId || el.dataset.groupId;
            if (id) {
                elements.set(id, el);
                oldPositions.set(id, el.getBoundingClientRect().top);
            }
        });

        // Get the correct order based on allLayersOrder (reversed for visual top-to-bottom)
        const reversedOrder = [...allLayersOrder].reverse();
        const renderedGroups = new Set();

        // Reorder DOM elements
        reversedOrder.forEach(layer => {
            const parentGroup = layerGroups.find(g =>
                g.layerIds.includes(layer.data.id) || (g.objectIds && g.objectIds.includes(layer.data.id))
            );

            if (parentGroup && !renderedGroups.has(parentGroup.id)) {
                renderedGroups.add(parentGroup.id);
                const groupEl = elements.get(String(parentGroup.id));
                if (groupEl && groupEl.parentNode === layersList) {
                    layersList.appendChild(groupEl);
                }
            } else if (!parentGroup) {
                const layerEl = elements.get(String(layer.data.id));
                if (layerEl && layerEl.parentNode === layersList) {
                    layersList.appendChild(layerEl);
                }
            }
        });

        // Only animate if NOT currently dragging (animate on drop only)
        if (!isDragging) {
            requestAnimationFrame(() => {
                elements.forEach((el, id) => {
                    const oldTop = oldPositions.get(id);
                    const newTop = el.getBoundingClientRect().top;
                    const deltaY = oldTop - newTop;

                    if (Math.abs(deltaY) > 0.5) {
                        // Clear any existing transform/transition
                        el.style.transition = 'none';
                        el.style.transform = `translateY(${deltaY}px)`;

                        // Force reflow
                        el.offsetHeight;

                        // Animate to final position - 100ms is the professional standard
                        el.style.transition = 'transform 0.1s ease-out';
                        el.style.transform = 'translateY(0)';

                        // Clean up after animation
                        const cleanup = () => {
                            el.style.transition = '';
                            el.style.transform = '';
                        };
                        el.addEventListener('transitionend', cleanup, { once: true });
                        setTimeout(cleanup, 150); // Fallback cleanup
                    }
                });
            });
        }

        renderThrottle = null;
    });
}

function renderLayersThrottled() {
    reorderLayerElementsVisually();
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

    if (allLayers.length === 0 && layerGroups.length === 0) {
        layersList.innerHTML = '<div class="empty-message">No layers yet</div>';
        return;
    }

    // FLIP animation: First - Record old positions
    const oldPositions = new Map();
    layersList.querySelectorAll('.layer-item, .group-item').forEach(el => {
        const rect = el.getBoundingClientRect();
        const id = el.dataset.layerId || el.dataset.groupId;
        if (id) {
            oldPositions.set(id, rect.top);
        }
    });

    layersList.innerHTML = '';

    // Add drop zone at top for moving layers to front
    if (allLayersOrder.length > 0 && draggedLayerId) {
        const dropZone = document.createElement('div');
        dropZone.className = 'layer-drop-zone-top';
        dropZone.style.height = '20px';
        dropZone.style.display = 'flex';
        dropZone.style.alignItems = 'center';
        dropZone.style.justifyContent = 'center';
        dropZone.style.color = 'var(--text-tertiary)';
        dropZone.style.fontSize = '11px';
        dropZone.style.transition = 'background 0.15s';
        dropZone.textContent = 'Move to front';

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            dropZone.style.background = 'rgba(13, 110, 253, 0.1)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.background = 'transparent';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.background = 'transparent';

            if (!draggedLayerId || !allLayersOrder.length) return;

            if (draggedLayerType === 'group') {
                // Move all group layers to the end (front)
                const draggedGroup = layerGroups.find(g => g.id === draggedLayerId);
                if (!draggedGroup) return;

                const draggedGroupLayerIndices = [];
                allLayersOrder.forEach((layer, idx) => {
                    if (layer.type === 'image' && draggedGroup.layerIds.includes(layer.data.id)) {
                        draggedGroupLayerIndices.push(idx);
                    } else if (layer.type === 'object' && draggedGroup.objectIds && draggedGroup.objectIds.includes(layer.data.id)) {
                        draggedGroupLayerIndices.push(idx);
                    }
                });

                if (draggedGroupLayerIndices.length > 0) {
                    const newOrder = [...allLayersOrder];
                    const draggedLayers = draggedGroupLayerIndices.sort((a, b) => a - b).map(idx => newOrder[idx]);

                    // Remove from original positions
                    for (let i = draggedGroupLayerIndices.length - 1; i >= 0; i--) {
                        newOrder.splice(draggedGroupLayerIndices[i], 1);
                    }

                    // Add to end (front)
                    newOrder.push(...draggedLayers);
                    allLayersOrder = newOrder;
                    renderLayersThrottled();
                }
            } else {
                // Move single layer to end (front)
                const fromIdx = allLayersOrder.findIndex(l => {
                    if (draggedLayerType === 'image') {
                        return l.type === 'image' && l.data.id === draggedLayerId;
                    } else {
                        return l.type === 'object' && l.data.id === draggedLayerId;
                    }
                });

                if (fromIdx !== -1 && fromIdx !== allLayersOrder.length - 1) {
                    const newOrder = [...allLayersOrder];
                    const [moved] = newOrder.splice(fromIdx, 1);
                    newOrder.push(moved); // Add to end (front)
                    allLayersOrder = newOrder;
                    renderLayersThrottled();
                }
            }
        });

        layersList.appendChild(dropZone);
    }

    // Build a set of grouped layer/object IDs for quick lookup
    const groupedIds = new Set();
    layerGroups.forEach(group => {
        group.layerIds.forEach(id => groupedIds.add(`image-${id}`));
        if (group.objectIds) {
            group.objectIds.forEach(id => groupedIds.add(`object-${id}`));
        }
    });

    // Render in reverse order (top = front, bottom = back)
    const reversedLayers = [...allLayers].reverse();

    // Track which groups we've rendered
    const renderedGroups = new Set();

    reversedLayers.forEach((layer, index) => {
        const layerId = layer.type === 'image' ? `image-${layer.data.id}` : `object-${layer.data.id}`;

        // Check if this layer belongs to a group
        const parentGroup = layerGroups.find(g =>
            g.layerIds.includes(layer.data.id) || (g.objectIds && g.objectIds.includes(layer.data.id))
        );

        if (parentGroup && !renderedGroups.has(parentGroup.id)) {
            // Render the entire group
            renderedGroups.add(parentGroup.id);
            const groupElement = createGroupElement(parentGroup, allLayers, images, objects);
            layersList.appendChild(groupElement);
        } else if (!parentGroup) {
            // Render ungrouped layer
            if (layer.type === 'image') {
                const layerItem = createLayerItem(layer.data, images);
                layersList.appendChild(layerItem);
            } else if (layer.type === 'object') {
                const layerItem = createObjectLayerItem(layer.data, objects);
                layersList.appendChild(layerItem);
            }
        }
    });

    // FLIP animation: Last, Invert, Play
    requestAnimationFrame(() => {
        layersList.querySelectorAll('.layer-item, .group-item').forEach(el => {
            const id = el.dataset.layerId || el.dataset.groupId;
            if (id && oldPositions.has(id)) {
                const oldTop = oldPositions.get(id);
                const newTop = el.getBoundingClientRect().top;
                const delta = oldTop - newTop;

                if (Math.abs(delta) > 1) {
                    // Invert: Apply negative transform
                    el.style.transform = `translateY(${delta}px)`;
                    el.style.transition = 'none';

                    // Play: Animate to 0
                    requestAnimationFrame(() => {
                        el.style.transition = 'transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                        el.style.transform = 'translateY(0)';

                        // Clean up after animation
                        setTimeout(() => {
                            el.style.transition = '';
                        }, 180);
                    });
                }
            }
        });
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
    const enableRotateItem = document.getElementById('context-enable-rotate');
    const separator = document.getElementById('context-separator');

    // Add Extract Palette option to the context menu HTML
    const extractPaletteItem = document.createElement('div');
    extractPaletteItem.className = 'context-menu-item';
    extractPaletteItem.id = 'context-extract-palette';
    extractPaletteItem.textContent = 'Extract Palette';
    extractPaletteItem.style.display = 'none';

    // Insert after deselect all, before separator
    separator.parentNode.insertBefore(extractPaletteItem, separator);

    let contextMenuMousePos = { x: 0, y: 0 };

    canvasContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // Store mouse position in world coordinates for rotation
        const rect = canvas.canvas.getBoundingClientRect();
        const worldPos = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        contextMenuMousePos = worldPos;

        // Show/hide multi-select options based on selection state
        const hasSelection = canvas.selectedImages.length > 0;
        const hasImageClick = canvas.contextMenuImage !== null && canvas.contextMenuImage !== undefined;

        deleteSelectedItem.style.display = hasSelection ? 'block' : 'none';
        deselectAllItem.style.display = hasSelection ? 'block' : 'none';
        enableRotateItem.style.display = hasImageClick ? 'block' : 'none';
        extractPaletteItem.style.display = hasImageClick ? 'block' : 'none';
        separator.style.display = (hasSelection || hasImageClick) ? 'block' : 'none';

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

    enableRotateItem.addEventListener('click', () => {
        if (canvas.contextMenuImage) {
            canvas.enableRotationMode(canvas.contextMenuImage, contextMenuMousePos.x, contextMenuMousePos.y);
        }
        contextMenu.classList.remove('show');
    });

    extractPaletteItem.addEventListener('click', async () => {
        contextMenu.classList.remove('show');

        if (!canvas.contextMenuImage) return;

        const image = canvas.contextMenuImage;
        const img = image.img;

        try {
            const { extractColorsFromImage } = await import('./modal-utils.js');
            const colors = await extractColorsFromImage(img);

            // Calculate grid layout
            const numColors = colors.length;
            let gridCols, gridRows, hasWideCell = false;

            if (numColors === 1) {
                gridCols = 1; gridRows = 1;
            } else if (numColors === 2) {
                gridCols = 2; gridRows = 1;
            } else if (numColors === 3) {
                gridCols = 2; gridRows = 1; hasWideCell = true;
            } else if (numColors === 4) {
                gridCols = 2; gridRows = 2;
            } else if (numColors === 5) {
                gridCols = 2; gridRows = 2; hasWideCell = true;
            } else if (numColors === 6) {
                gridCols = 3; gridRows = 2;
            } else if (numColors === 7) {
                gridCols = 3; gridRows = 2; hasWideCell = true;
            } else if (numColors === 8) {
                gridCols = 4; gridRows = 2;
            } else if (numColors === 9) {
                gridCols = 3; gridRows = 3;
            } else {
                gridCols = 5; gridRows = 2;
            }

            const baseCellSize = 60;
            const zoomFactor = 1 / canvas.zoom;
            const cellSize = baseCellSize * zoomFactor;

            const width = gridCols * cellSize;
            const height = hasWideCell ? (gridRows + 1) * cellSize : gridRows * cellSize;

            // Place near the image
            const paletteX = image.x + image.width + 20;
            const paletteY = image.y;

            // Create color palette object
            const paletteObject = {
                type: 'colorPalette',
                id: Date.now() + Math.random(),
                x: paletteX,
                y: paletteY,
                width: width,
                height: height,
                colors: colors,
                sourceImage: img, // Store source image for regeneration
                gridCols: gridCols,
                gridRows: gridRows,
                cellSize: cellSize,
                hasWideCell: hasWideCell,
                zIndex: canvas.objectsManager.objects.reduce((max, obj) => Math.max(max, obj.zIndex || 0), 0) + 1
            };

            canvas.objectsManager.objects.push(paletteObject);
            canvas.needsRender = true;
            canvas.objectsManager.dispatchObjectsChanged();

            showToast(`Extracted ${numColors} color${numColors > 1 ? 's' : ''} from image`, 'success', 3000);
        } catch (error) {
            console.error('Error extracting colors:', error);
            showToast('Error extracting colors from image', 'error');
        }
    });

    document.getElementById('context-recenter').addEventListener('click', () => {
        canvas.fitToContent();
        contextMenu.classList.remove('show');
    });

    document.getElementById('context-reset-zoom').addEventListener('click', () => {
        canvas.resetZoom();
        contextMenu.classList.remove('show');
    });

    document.getElementById('context-shortcuts').addEventListener('click', () => {
        contextMenu.classList.remove('show');
        showKeyboardShortcutsModal();
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

    const filename = `${board.name.replace(/[^a-z0-9]/gi, '_')}.eyed`;

    // Try to use File System Access API (modern browsers)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'EyeDea Board',
                    accept: { 'application/json': ['.eyed'] }
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
    input.accept = '.eyed,application/json';

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
                    showToast('Invalid .eyed file format', 'error');
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
        console.error('Tauri object structure:', window.__TAURI__);
    }
}


// Property panel functions
function showPropertiesPanel(obj) {
    const propertiesPanel = document.getElementById('object-properties');
    const defaultProperties = document.getElementById('default-properties');
    const textProperties = document.getElementById('text-properties');
    const shapeProperties = document.getElementById('shape-properties');
    const paletteProperties = document.getElementById('palette-properties');
    const propertiesTitle = document.getElementById('object-properties-title');

    if (!propertiesPanel) return;

    // Hide default properties
    if (defaultProperties) defaultProperties.style.display = 'none';

    // Show properties panel
    propertiesPanel.style.display = 'flex';

    if (obj.type === 'colorPalette') {
        propertiesTitle.textContent = 'Color Palette';
        textProperties.style.display = 'none';
        shapeProperties.style.display = 'none';
        paletteProperties.style.display = 'block';

        // Setup regenerate button
        const regenerateBtn = document.getElementById('palette-regenerate-btn');
        const newRegenerateBtn = regenerateBtn.cloneNode(true);
        regenerateBtn.parentNode.replaceChild(newRegenerateBtn, regenerateBtn);

        newRegenerateBtn.addEventListener('click', async () => {
            // Check if the palette has a sourceImage reference
            if (!obj.sourceImage) {
                showToast('Cannot regenerate - source image not found', 'error', 3000);
                return;
            }

            try {
                newRegenerateBtn.disabled = true;
                newRegenerateBtn.textContent = 'Regenerating...';

                // Extract colors from the source image
                const { extractColorsFromImage } = await import('./modal-utils.js');
                const colors = await extractColorsFromImage(obj.sourceImage);

                // Update the palette with new colors
                obj.colors = colors;

                // Update the color list in the properties panel
                const colorsList = document.getElementById('palette-colors-list');
                colorsList.innerHTML = '';

                obj.colors.forEach((color, index) => {
                    const colorItem = document.createElement('div');
                    colorItem.className = 'palette-color-item';
                    colorItem.innerHTML = `
                        <div class="palette-color-preview" style="background-color: ${color.hex};"></div>
                        <div class="palette-color-values">
                            <div class="palette-color-value" data-value="${color.hex}" title="Click to copy">${color.hex}</div>
                            <div class="palette-color-value" data-value="${color.rgb}" title="Click to copy">${color.rgb}</div>
                        </div>
                    `;

                    // Add click to copy functionality
                    colorItem.querySelectorAll('.palette-color-value').forEach(valueEl => {
                        valueEl.addEventListener('click', () => {
                            const value = valueEl.dataset.value;
                            navigator.clipboard.writeText(value).then(() => {
                                showToast(`Copied ${value}`, 'success', 2000);
                            });
                        });
                    });

                    colorsList.appendChild(colorItem);
                });

                canvas.needsRender = true;
                canvas.objectsManager.dispatchObjectsChanged();

                showToast('Colors regenerated', 'success', 2000);
            } catch (error) {
                console.error('Regenerate error:', error);
                showToast('Failed to regenerate colors', 'error', 3000);
            } finally {
                newRegenerateBtn.disabled = false;
                newRegenerateBtn.textContent = 'Regenerate Colors';
            }
        });

        // Populate color palette list
        const colorsList = document.getElementById('palette-colors-list');
        colorsList.innerHTML = '';

        obj.colors.forEach((color, index) => {
            const colorItem = document.createElement('div');
            colorItem.className = 'palette-color-item';
            colorItem.innerHTML = `
                <div class="palette-color-preview" style="background-color: ${color.hex};"></div>
                <div class="palette-color-values">
                    <div class="palette-color-value" data-value="${color.hex}" title="Click to copy">${color.hex}</div>
                    <div class="palette-color-value" data-value="${color.rgb}" title="Click to copy">${color.rgb}</div>
                </div>
            `;

            // Add click to copy functionality
            colorItem.querySelectorAll('.palette-color-value').forEach(valueEl => {
                valueEl.addEventListener('click', () => {
                    const value = valueEl.dataset.value;
                    navigator.clipboard.writeText(value).then(() => {
                        showToast(`Copied ${value}`, 'success', 2000);
                    });
                });
            });

            colorsList.appendChild(colorItem);
        });
    } else if (obj.type === 'shape') {
        propertiesTitle.textContent = 'Shape Properties';
        textProperties.style.display = 'none';
        shapeProperties.style.display = 'block';
        paletteProperties.style.display = 'none';

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
        paletteProperties.style.display = 'none';

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
            // Deactivate other tools first
            const shapeToolBtn = document.getElementById('shape-tool-btn');
            if (shapeToolBtn) {
                shapeToolBtn.classList.remove('active');
            }
            hidePropertiesPanel();

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
            // Deactivate other tools first
            const textToolBtn = document.getElementById('text-tool-btn');
            if (textToolBtn) {
                textToolBtn.classList.remove('active');
            }

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

// Layer context menu
let currentContextLayer = null;
let currentContextLayerType = null;

function showLayerContextMenu(x, y, layer, type) {
    const contextMenu = document.getElementById('layer-context-menu');
    currentContextLayer = layer;
    currentContextLayerType = type;

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('show');
}

function setupLayerContextMenu() {
    const contextMenu = document.getElementById('layer-context-menu');
    const renameItem = document.getElementById('layer-context-rename');
    const duplicateItem = document.getElementById('layer-context-duplicate');
    const deleteItem = document.getElementById('layer-context-delete');

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.classList.remove('show');
        }
    });

    // Rename layer
    renameItem.addEventListener('click', async () => {
        console.log('Rename clicked');
        contextMenu.classList.remove('show');
        if (!currentContextLayer) {
            console.error('No current context layer');
            return;
        }

        const currentName = currentContextLayerType === 'image'
            ? currentContextLayer.name
            : (currentContextLayer.type === 'text'
                ? currentContextLayer.text
                : (currentContextLayer.type === 'colorPalette'
                    ? currentContextLayer.name
                    : 'Shape'));

        console.log('Current name:', currentName);
        console.log('Calling showInputModal...');

        const newName = await showInputModal(
            'Rename Layer',
            'Enter a new name:',
            currentName,
            'Layer name'
        );

        console.log('New name:', newName);

        if (newName && newName !== currentName) {
            if (currentContextLayerType === 'image') {
                canvas.renameLayer(currentContextLayer.id, newName);
            } else if (currentContextLayer.type === 'text') {
                canvas.objectsManager.updateObject(currentContextLayer.id, { text: newName });
            } else if (currentContextLayer.type === 'colorPalette') {
                canvas.objectsManager.updateObject(currentContextLayer.id, { name: newName });
            }
            renderLayers();
            scheduleSave();
        }
    });

    // Duplicate layer
    duplicateItem.addEventListener('click', () => {
        contextMenu.classList.remove('show');
        if (!currentContextLayer) return;

        if (currentContextLayerType === 'image') {
            // Duplicate image
            const img = currentContextLayer;
            const newImg = new Image();
            newImg.onload = () => {
                canvas.addImage(newImg, img.x + 20, img.y + 20, img.name + ' Copy', img.width, img.height);
                renderLayers();
                scheduleSave();
            };
            newImg.src = img.img.src;
        } else {
            // Duplicate object
            const obj = currentContextLayer;
            const duplicate = JSON.parse(JSON.stringify(obj));
            duplicate.id = Date.now() + Math.random();
            duplicate.x += 20;
            duplicate.y += 20;
            duplicate.zIndex = canvas.objectsManager.objects.reduce((max, o) => Math.max(max, o.zIndex || 0), 0) + 1;

            if (obj.type === 'text' && obj.text) {
                duplicate.text = obj.text;
            }

            canvas.objectsManager.objects.push(duplicate);
            canvas.needsRender = true;
            canvas.objectsManager.dispatchObjectsChanged();
            renderLayers();
            scheduleSave();
        }
    });

    // Delete layer
    deleteItem.addEventListener('click', () => {
        contextMenu.classList.remove('show');
        if (!currentContextLayer) return;

        const layerName = currentContextLayerType === 'image'
            ? currentContextLayer.name
            : (currentContextLayer.type === 'text'
                ? (currentContextLayer.text || 'Text').substring(0, 20)
                : (currentContextLayer.type === 'colorPalette'
                    ? currentContextLayer.name || 'Palette'
                    : 'Shape'));

        showDeleteConfirm(layerName, () => {
            if (currentContextLayerType === 'image') {
                canvas.deleteImage(currentContextLayer.id);
            } else {
                canvas.objectsManager.deleteObject(currentContextLayer.id);
            }
            canvas.invalidateCullCache();
            canvas.render();
            renderLayers();
            scheduleSave();
        });
    });
}

function setupColorExtractorTool() {
    const colorExtractorBtn = document.getElementById('color-extractor-btn');
    if (!colorExtractorBtn) return;

    colorExtractorBtn.addEventListener('click', async () => {
        // Open color extractor modal
        const result = await showColorExtractorModal();

        if (!result || !result.colors || result.colors.length === 0) {
            return; // User cancelled or no colors extracted
        }

        const { colors, sourceImage } = result;

        // Calculate grid layout based on number of colors
        const numColors = colors.length;
        let gridCols, gridRows, hasWideCell = false;

        if (numColors === 1) {
            gridCols = 1; gridRows = 1;
        } else if (numColors === 2) {
            gridCols = 2; gridRows = 1;
        } else if (numColors === 3) {
            gridCols = 2; gridRows = 1; hasWideCell = true;
        } else if (numColors === 4) {
            gridCols = 2; gridRows = 2;
        } else if (numColors === 5) {
            gridCols = 2; gridRows = 2; hasWideCell = true;
        } else if (numColors === 6) {
            gridCols = 3; gridRows = 2;
        } else if (numColors === 7) {
            gridCols = 3; gridRows = 2; hasWideCell = true;
        } else if (numColors === 8) {
            gridCols = 4; gridRows = 2;
        } else if (numColors === 9) {
            gridCols = 3; gridRows = 3;
        } else { // 10
            gridCols = 5; gridRows = 2;
        }

        // Auto-scale based on zoom level
        // When zoomed out (zoom < 1), make palette bigger so it's visible
        // When zoomed in (zoom > 1), make it smaller so it's not huge
        const baseCellSize = 60;
        const zoomFactor = 1 / canvas.zoom; // Inverse of zoom
        const cellSize = baseCellSize * zoomFactor;

        const width = gridCols * cellSize;
        const height = hasWideCell ? (gridRows + 1) * cellSize : gridRows * cellSize;

        // Get canvas center position
        const canvasRect = canvas.canvas.getBoundingClientRect();
        const centerX = -canvas.pan.x + (canvasRect.width / 2 / canvas.zoom);
        const centerY = -canvas.pan.y + (canvasRect.height / 2 / canvas.zoom);

        // Generate default name for the palette
        const existingPalettes = canvas.objectsManager.objects.filter(obj => obj.type === 'colorPalette');
        const paletteNumber = existingPalettes.length + 1;
        const paletteName = `Palette ${paletteNumber}`;

        // Create color palette object
        const paletteObject = {
            type: 'colorPalette',
            id: Date.now() + Math.random(),
            name: paletteName,
            x: centerX - width / 2,
            y: centerY - height / 2,
            width: width,
            height: height,
            colors: colors,
            sourceImage: sourceImage, // Store source image for regeneration
            gridCols: gridCols,
            gridRows: gridRows,
            cellSize: cellSize,
            hasWideCell: hasWideCell,
            zIndex: canvas.objectsManager.objects.reduce((max, obj) => Math.max(max, obj.zIndex || 0), 0) + 1
        };

        // Add to canvas
        canvas.objectsManager.objects.push(paletteObject);
        canvas.needsRender = true;
        canvas.objectsManager.dispatchObjectsChanged();

        showToast(`Color palette created with ${numColors} color${numColors > 1 ? 's' : ''}`, 'success', 3000);
    });
}

// Keyboard Shortcuts Modal
function showKeyboardShortcutsModal() {
    const overlay = document.getElementById('shortcuts-modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';

    // Close button
    const closeBtn = document.getElementById('shortcuts-modal-close');
    closeBtn.onclick = () => closeShortcutsModal();

    // Close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeShortcutsModal();
        }
    };

    // Close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeShortcutsModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
}

function closeShortcutsModal() {
    const overlay = document.getElementById('shortcuts-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
}

