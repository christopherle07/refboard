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
let selectedTagFilters = []; // Array of selected tags for filtering
let renderThrottle = null;
let draggedElement = null;
let ghostElement = null;
let lastDragOrderHash = null;
let isDragging = false;
let draggedFromGroup = null; // Track if dragged layer came from a group
let draggedFromGroupBounds = null; // Track the visual boundaries of the group being dragged from
let lastDragY = 0; // Track the last mouse Y position during drag

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
        },
        midnight: {
            '--bg-primary': '#0a0a0a',
            '--bg-secondary': '#050505',
            '--bg-tertiary': '#0d0d0d',
            '--bg-hover': 'rgba(255, 255, 255, 0.02)',
            '--bg-active': 'rgba(255, 255, 255, 0.04)',
            '--border-color': '#1a1a1a',
            '--border-color-hover': '#333333',
            '--text-primary': '#d0d0d0',
            '--text-secondary': '#909090',
            '--text-tertiary': '#606060',
            '--text-disabled': '#404040',
            '--shadow': 'rgba(0, 0, 0, 0.7)',
            '--modal-overlay': 'rgba(0, 0, 0, 0.9)'
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

    // Global dragover listener to track mouse position during drag (needed for dragging outside groups)
    document.addEventListener('dragover', (e) => {
        if (isDragging) {
            lastDragY = e.clientY;
        }
    });

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
        showFloatingToolbar(e.detail);
    });
    canvasElement.addEventListener('objectDeselected', () => {
        hidePropertiesPanel();
        hideFloatingToolbars();
    });
    canvasElement.addEventListener('showColorCopyMenu', (e) => {
        const { hex, rgb } = e.detail;
        showColorCopyOptions(hex, rgb);
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

    // Sync board assets with canvas images on initial load
    syncBoardAssetsWithCanvas();

    // Add dragover handler to layers list to allow drops in empty space
    const layersList = document.getElementById('layers-list');
    if (layersList) {
        layersList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
    }
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
                added.rotation = layer.rotation || 0;
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

    document.getElementById('open-floating-btn').addEventListener('click', openFloatingWindow);

    // Assets library event listeners
    document.getElementById('assets-library-import-btn').addEventListener('click', () => {
        importAssetsToLibrary();
    });

    // Assets view buttons
    document.getElementById('board-assets-btn').addEventListener('click', () => {
        showAllAssets = false;
        document.getElementById('board-assets-btn').classList.add('active');
        document.getElementById('all-assets-btn').classList.remove('active');
        loadAssetsLibrary();
    });

    document.getElementById('all-assets-btn').addEventListener('click', () => {
        showAllAssets = true;
        document.getElementById('all-assets-btn').classList.add('active');
        document.getElementById('board-assets-btn').classList.remove('active');
        loadAssetsLibrary();
    });

    document.getElementById('back-to-canvas-btn').addEventListener('click', () => {
        window.toggleAssetsLibrary();
    });

    // Assets search bar
    const assetsSearchBar = document.getElementById('assets-search-bar');

    assetsSearchBar.addEventListener('input', (e) => {
        loadAssetsLibrary(e.target.value);
    });

    // Tag filter clear button
    document.getElementById('assets-tag-clear-btn').addEventListener('click', () => {
        selectedTagFilters = [];
        loadAssetsLibrary(assetsSearchBar.value);
    });

    // Asset modal event listeners
    setupAssetSidebar();

    // Tab switching logic
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;

            // Update active tab button
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            if (tab === 'layers') {
                // Show canvas view
                document.getElementById('canvas-container').style.display = 'block';
                document.getElementById('assets-library-view').style.display = 'none';
                const drawingToolbar = document.getElementById('drawing-toolbar');
                const toolsSidebar = document.querySelector('.tools-sidebar');
                if (drawingToolbar) drawingToolbar.style.display = 'flex';
                if (toolsSidebar) toolsSidebar.style.display = 'flex';
            } else if (tab === 'assets') {
                // Show assets library view
                document.getElementById('canvas-container').style.display = 'none';
                document.getElementById('assets-library-view').style.display = 'flex';
                const drawingToolbar = document.getElementById('drawing-toolbar');
                const toolsSidebar = document.querySelector('.tools-sidebar');
                if (drawingToolbar) drawingToolbar.style.display = 'none';
                if (toolsSidebar) toolsSidebar.style.display = 'none';

                // Load assets into library view
                loadAssetsLibrary();
            }
        });
    });

    // Assets library toggle function
    window.toggleAssetsLibrary = function() {
        const canvasContainer = document.getElementById('canvas-container');
        const assetsLibraryView = document.getElementById('assets-library-view');
        const drawingToolbar = document.getElementById('drawing-toolbar');
        const toolsSidebar = document.querySelector('.tools-sidebar');

        const isLibraryVisible = assetsLibraryView.style.display === 'flex';

        if (isLibraryVisible) {
            // Show canvas, hide assets library
            canvasContainer.style.display = 'block';
            assetsLibraryView.style.display = 'none';
            if (drawingToolbar) drawingToolbar.style.display = 'flex';
            if (toolsSidebar) toolsSidebar.style.display = 'flex';

            // Switch to Layers tab
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('[data-tab="layers"]').classList.add('active');
        } else {
            // Show assets library, hide canvas
            canvasContainer.style.display = 'none';
            assetsLibraryView.style.display = 'flex';
            if (drawingToolbar) drawingToolbar.style.display = 'none';
            if (toolsSidebar) toolsSidebar.style.display = 'none';

            // Switch to Assets tab
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('[data-tab="assets"]').classList.add('active');

            // Load assets into library view
            loadAssetsLibrary();
        }
    };

    setupContextMenu();
    setupBoardDropdown();

    document.getElementById('back-home-btn').addEventListener('click', () => {
        saveNow();
        window.location.href = 'index.html';
    });
    
    document.getElementById('collapse-layers-btn').addEventListener('click', (e) => {
        const content = document.getElementById('layers-content');
        const btn = e.currentTarget;
        content.classList.toggle('collapsed');

        const isCollapsed = content.classList.contains('collapsed');
        btn.innerHTML = isCollapsed
            ? '<img src="assets/expand.svg" alt="Expand" class="collapse-icon" width="14" height="14"/>'
            : '<img src="assets/collapse.svg" alt="Collapse" class="collapse-icon" width="14" height="14"/>';
    });

    const assetsViewToggle = document.getElementById('assets-view-toggle');
    if (assetsViewToggle) {
        assetsViewToggle.addEventListener('change', (e) => {
            showAllAssets = e.target.checked;
            renderAssets();
        });
    }
    
    canvas.canvas.addEventListener('canvasChanged', () => {
        renderLayers();
        scheduleSave();
        syncBoardAssetsWithCanvas();
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
        zIndex: img.zIndex || 0,
        rotation: img.rotation || 0
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
    const layerIcon = document.createElement('img');
    layerIcon.className = 'layer-icon';
    layerIcon.src = 'assets/layericon.svg';

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

        // Capture the group's visual boundaries if dragging from a group
        if (draggedFromGroup) {
            const groupElement = document.querySelector(`[data-group-id="${draggedFromGroup.id}"]`);
            if (groupElement) {
                const rect = groupElement.getBoundingClientRect();
                draggedFromGroupBounds = {
                    top: rect.top,
                    bottom: rect.bottom
                };
            }
        }

        allLayersOrder = getAllLayersForDragging();
        dragSourceIndex = allLayersOrder.findIndex(l => l.type === 'image' && l.data.id === img.id);
        layerItem.classList.add('dragging');
        document.body.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        isDragging = false;
        document.body.classList.remove('dragging');
        applyLayerOrder();

        // Check if layer should be removed from its original group based on visual area
        if (draggedFromGroup && draggedFromGroupBounds && draggedLayerType === 'image') {
            // Check if the drag ended outside the group's visual boundaries
            const isOutsideGroup = lastDragY < draggedFromGroupBounds.top || lastDragY > draggedFromGroupBounds.bottom;

            if (isOutsideGroup) {
                // Remove layer from group
                draggedFromGroup.layerIds = draggedFromGroup.layerIds.filter(id => id !== draggedLayerId);
            }
        }

        draggedLayerId = null;
        draggedLayerType = null;
        dragSourceIndex = null;
        draggedFromGroup = null;
        draggedFromGroupBounds = null;
        lastDragY = 0;
        allLayersOrder = [];
        lastDragOrderHash = null;
        renderLayers();
        scheduleSave();
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Track the mouse Y position
        lastDragY = e.clientY;

        if (!draggedLayerId) return;

        const targetId = img.id;
        if (targetId === draggedLayerId && draggedLayerType === 'image') return;

        // Clear all drag-over indicators first
        document.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
            el.classList.remove('drag-over-above', 'drag-over-below');
        });

        if (allLayersOrder.length > 0) {
            // Edge detection: determine if hovering over top or bottom half
            const rect = layerItem.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midpoint;

            // Add visual indicator
            if (insertBefore) {
                layerItem.classList.add('drag-over-above');
            } else {
                layerItem.classList.add('drag-over-below');
            }

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

    layerItem.addEventListener('dragleave', (e) => {
        layerItem.classList.remove('drag-over-above', 'drag-over-below');
    });

    layerItem.addEventListener('drop', (e) => {
        layerItem.classList.remove('drag-over-above', 'drag-over-below');
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

    if (canvas.objectsManager.selectedObjects.some(o => o.id === obj.id)) {
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
    const layerIcon = document.createElement('img');
    layerIcon.className = 'layer-icon';
    if (obj.type === 'text') {
        layerIcon.src = 'assets/TextIcon.svg';
    } else if (obj.type === 'shape') {
        layerIcon.src = 'assets/ShapeIcon.svg';
    } else if (obj.type === 'colorPalette') {
        layerIcon.src = 'assets/ColorPalette.svg';
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

        // Capture the group's visual boundaries if dragging from a group
        if (draggedFromGroup) {
            const groupElement = document.querySelector(`[data-group-id="${draggedFromGroup.id}"]`);
            if (groupElement) {
                const rect = groupElement.getBoundingClientRect();
                draggedFromGroupBounds = {
                    top: rect.top,
                    bottom: rect.bottom
                };
            }
        }

        allLayersOrder = getAllLayersForDragging();
        dragSourceIndex = allLayersOrder.findIndex(l => l.type === 'object' && l.data.id === obj.id);
        layerItem.classList.add('dragging');
        document.body.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        isDragging = false;
        document.body.classList.remove('dragging');
        applyLayerOrder();

        // Check if object should be removed from its original group based on visual area
        if (draggedFromGroup && draggedFromGroupBounds && draggedLayerType === 'object') {
            // Check if the drag ended outside the group's visual boundaries
            const isOutsideGroup = lastDragY < draggedFromGroupBounds.top || lastDragY > draggedFromGroupBounds.bottom;

            if (isOutsideGroup && draggedFromGroup.objectIds) {
                // Remove object from group
                draggedFromGroup.objectIds = draggedFromGroup.objectIds.filter(id => id !== draggedLayerId);
            }
        }

        draggedLayerId = null;
        draggedLayerType = null;
        dragSourceIndex = null;
        draggedFromGroup = null;
        draggedFromGroupBounds = null;
        lastDragY = 0;
        allLayersOrder = [];
        lastDragOrderHash = null;
        renderLayers();
        scheduleSave();
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Track the mouse Y position
        lastDragY = e.clientY;

        if (!draggedLayerId) return;

        const targetId = obj.id;
        if (targetId === draggedLayerId && draggedLayerType === 'object') return;

        // Clear all drag-over indicators first
        document.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
            el.classList.remove('drag-over-above', 'drag-over-below');
        });

        if (allLayersOrder.length > 0) {
            // Edge detection: determine if hovering over top or bottom half
            const rect = layerItem.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midpoint;

            // Add visual indicator
            if (insertBefore) {
                layerItem.classList.add('drag-over-above');
            } else {
                layerItem.classList.add('drag-over-below');
            }

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

    layerItem.addEventListener('dragleave', () => {
        layerItem.classList.remove('drag-over-above', 'drag-over-below');
    });

    layerItem.addEventListener('drop', () => {
        layerItem.classList.remove('drag-over-above', 'drag-over-below');
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
    const selectedObjects = canvas.objectsManager.selectedObjects || [];

    // Need at least 2 layers to create a group
    const totalSelected = selectedImages.length + selectedObjects.length;

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
        objectIds: selectedObjects.map(obj => obj.id),
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

    // Collapse/expand toggle button
    const collapseToggle = document.createElement('button');
    collapseToggle.className = 'group-collapse-toggle';
    collapseToggle.type = 'button';

    // Create icon that toggles between collapse and expand
    const updateToggleIcon = (collapsed) => {
        collapseToggle.innerHTML = collapsed
            ? '<img src="assets/expand.svg" alt="Expand" class="group-toggle-icon" width="16" height="16"/>'
            : '<img src="assets/collapse.svg" alt="Collapse" class="group-toggle-icon" width="16" height="16"/>';
        collapseToggle.title = collapsed ? 'Expand group' : 'Collapse group';
    };

    updateToggleIcon(group.collapsed);

    collapseToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        group.collapsed = !group.collapsed;
        updateToggleIcon(group.collapsed);
        renderLayers();
        scheduleSave();
    });

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'layer-drag-handle';
    dragHandle.innerHTML = `
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
        <div class="drag-row"><span></span><span></span></div>
    `;

    // Group icon
    const groupIcon = document.createElement('img');
    groupIcon.className = 'layer-icon';
    groupIcon.src = 'assets/foldericon.svg';

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

    groupHeader.appendChild(collapseToggle);
    groupHeader.appendChild(dragHandle);
    groupHeader.appendChild(groupIcon);
    groupHeader.appendChild(groupContent);
    groupHeader.appendChild(groupControls);

    // Click to select all layers in group
    groupHeader.addEventListener('click', (e) => {
        // Don't trigger if clicking on buttons or during drag
        if (e.target.tagName === 'BUTTON') return;

        e.stopPropagation();

        // Get fresh list of images and objects from canvas
        const currentImages = canvas.getImages();
        const currentObjects = canvas.objectsManager.getObjects();
        const groupImageLayers = currentImages.filter(img => group.layerIds.includes(img.id));
        const groupObjectLayers = currentObjects.filter(obj => group.objectIds && group.objectIds.includes(obj.id));

        console.log('Group clicked:', group.name, 'Image IDs:', group.layerIds, 'Object IDs:', group.objectIds, 'Found images:', groupImageLayers.length, 'Found objects:', groupObjectLayers.length);

        // Clear current selection first
        canvas.selectedImage = null;
        canvas.selectedImages = [];
        canvas.objectsManager.selectedObject = null;
        canvas.objectsManager.selectedObjects = [];

        // Select all image layers in the group
        if (groupImageLayers.length > 0) {
            groupImageLayers.forEach((img, index) => {
                console.log('Selecting image layer:', img.name, 'multi:', index > 0);
                canvas.selectImage(img, index > 0);
            });
        }

        // Select all object layers in the group
        if (groupObjectLayers.length > 0) {
            groupObjectLayers.forEach((obj) => {
                console.log('Selecting object layer:', obj.id);
                canvas.objectsManager.selectedObjects.push(obj);
            });
            canvas.objectsManager.selectedObject = groupObjectLayers[groupObjectLayers.length - 1];
        }

        // Mark that a group is selected
        canvas.selectedGroup = group;

        canvas.needsRender = true;
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
        document.body.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    groupHeader.addEventListener('dragend', () => {
        isDragging = false;
        document.body.classList.remove('dragging');
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

        // Clear all drag-over indicators first
        document.querySelectorAll('.drag-over-above, .drag-over-below, .drag-over').forEach(el => {
            el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over');
        });

        // Edge detection: determine if hovering over top or bottom half
        const rect = groupHeader.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midpoint;

        // If dragging a layer and group is collapsed, allow inserting before/after
        if (draggedLayerType !== 'group' && group.collapsed) {
            // Show visual indicator for inserting before or after the group
            if (insertBefore) {
                groupHeader.classList.add('drag-over-above');
            } else {
                groupHeader.classList.add('drag-over-below');
            }

            // Handle reordering - insert before/after entire group
            if (allLayersOrder.length > 0) {
                // Find the first layer of this group
                const firstGroupLayerIdx = allLayersOrder.findIndex(layer => {
                    if (layer.type === 'image' && group.layerIds.includes(layer.data.id)) return true;
                    if (layer.type === 'object' && group.objectIds && group.objectIds.includes(layer.data.id)) return true;
                    return false;
                });

                if (firstGroupLayerIdx !== -1) {
                    const fromIdx = allLayersOrder.findIndex(l => {
                        if (draggedLayerType === 'image') {
                            return l.type === 'image' && l.data.id === draggedLayerId;
                        } else {
                            return l.type === 'object' && l.data.id === draggedLayerId;
                        }
                    });

                    if (fromIdx !== -1) {
                        const newOrder = [...allLayersOrder];
                        const [moved] = newOrder.splice(fromIdx, 1);

                        // Find new target position after removal
                        let newTargetIdx = newOrder.findIndex(layer => {
                            if (layer.type === 'image' && group.layerIds.includes(layer.data.id)) return true;
                            if (layer.type === 'object' && group.objectIds && group.objectIds.includes(layer.data.id)) return true;
                            return false;
                        });

                        if (newTargetIdx !== -1) {
                            // If inserting after (bottom half), move to after the last layer in the group
                            if (!insertBefore) {
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

                            newOrder.splice(newTargetIdx, 0, moved);
                            allLayersOrder = newOrder;
                            renderLayersThrottled();
                        }
                    }
                }
            }
        } else if (draggedLayerType !== 'group' && !group.collapsed) {
            // If group is expanded, show drop zone to add to group
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
        groupHeader.classList.remove('drag-over', 'drag-over-above', 'drag-over-below');
    });

    groupHeader.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if we were hovering to insert before/after (collapsed group)
        const wasInsertingBeforeAfter = group.collapsed && draggedLayerType !== 'group' &&
            (groupHeader.classList.contains('drag-over-above') || groupHeader.classList.contains('drag-over-below'));

        groupHeader.classList.remove('drag-over', 'drag-over-above', 'drag-over-below');

        // If group is collapsed and we're dropping before/after (not into), don't add to group
        if (wasInsertingBeforeAfter) {
            // The reordering was already handled in dragover
            // Just don't add to the group
            return;
        }

        // If dropping a layer onto an expanded group, add it to the group
        if (draggedLayerType === 'image' && !group.collapsed) {
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
        } else if (draggedLayerType === 'object' && !group.collapsed) {
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
    childrenContainer.className = group.collapsed ? 'group-children collapsed' : 'group-children';

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
    console.log('showGroupContextMenu called for group:', group.name);

    // Remove existing group context menus (but not the permanent layer-context-menu)
    const existingMenus = document.querySelectorAll('.group-context-menu');
    existingMenus.forEach(menu => menu.remove());

    // Also hide the layer context menu if visible
    const layerContextMenu = document.getElementById('layer-context-menu');
    if (layerContextMenu) {
        layerContextMenu.classList.remove('show');
    }

    const menu = document.createElement('div');
    menu.className = 'layer-context-menu group-context-menu show';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10000';

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

    const duplicateItem = document.createElement('div');
    duplicateItem.className = 'layer-context-menu-item';
    duplicateItem.textContent = 'Duplicate';
    duplicateItem.addEventListener('click', async () => {
        menu.remove();

        // Create new group with duplicated layers
        const newGroup = {
            id: Date.now() + Math.random(),
            name: group.name + ' Copy',
            layerIds: [],
            objectIds: [],
            collapsed: false
        };

        // Duplicate all image layers in the group
        const images = canvas.getImages();
        for (const imageId of group.layerIds) {
            const originalImage = images.find(img => img.id === imageId);
            if (originalImage) {
                const duplicatedImage = await canvas.duplicateImage(originalImage);
                if (duplicatedImage) {
                    newGroup.layerIds.push(duplicatedImage.id);
                }
            }
        }

        // Duplicate all object layers in the group
        if (group.objectIds) {
            const objects = canvas.objectsManager.getObjects();
            for (const objectId of group.objectIds) {
                const originalObject = objects.find(obj => obj.id === objectId);
                if (originalObject) {
                    const duplicatedObject = canvas.objectsManager.duplicateObject(originalObject);
                    if (duplicatedObject) {
                        newGroup.objectIds.push(duplicatedObject.id);
                    }
                }
            }
        }

        // Add new group to layerGroups
        layerGroups.push(newGroup);

        canvas.invalidateCullCache();
        canvas.render();
        renderLayers();
        scheduleSave();
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
    menu.appendChild(duplicateItem);
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

        // Also track layers within groups
        layersList.querySelectorAll('.group-children .layer-item').forEach(el => {
            const id = el.dataset.layerId;
            if (id && !elements.has(id)) {
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

        // Reorder layers within each group's children container
        layerGroups.forEach(group => {
            const groupEl = elements.get(String(group.id));
            if (!groupEl) return;

            const childrenContainer = groupEl.querySelector('.group-children');
            if (!childrenContainer) return;

            // Get the layers that belong to this group in the correct order
            const groupLayerOrder = reversedOrder.filter(layer =>
                group.layerIds.includes(layer.data.id) || (group.objectIds && group.objectIds.includes(layer.data.id))
            );

            // Reorder the children
            groupLayerOrder.forEach(layer => {
                const layerEl = childrenContainer.querySelector(`[data-layer-id="${layer.data.id}"]`);
                if (layerEl && layerEl.parentNode === childrenContainer) {
                    childrenContainer.appendChild(layerEl);
                }
            });
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
                // Animate out
                assetItem.style.opacity = '0';
                assetItem.style.transform = 'scale(0.8)';

                // Delete from backend
                if (showAllAssets) {
                    await boardManager.deleteFromAllAssets(asset.id);
                } else {
                    await boardManager.deleteBoardAsset(currentBoardId, asset.id);
                }

                // Remove from DOM after animation
                setTimeout(() => {
                    assetItem.remove();
                    // Check if grid is now empty
                    if (assetsGrid.children.length === 0) {
                        assetsGrid.innerHTML = showAllAssets
                            ? '<div class="empty-message">No assets yet</div>'
                            : '<div class="empty-message">No board assets yet</div>';
                    }
                }, 200);
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

    let contextMenuMousePos = { x: 0, y: 0 };

    canvasContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // Store mouse position in world coordinates for rotation
        const rect = canvas.canvas.getBoundingClientRect();
        const worldPos = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        contextMenuMousePos = worldPos;

        // Check if right-clicking on a color palette object
        const clickedObject = canvas.objectsManager.getObjectAtPoint(worldPos.x, worldPos.y);
        console.log('Right-clicked object:', clickedObject);
        if (clickedObject && clickedObject.type === 'colorPalette') {
            console.log('Opening palette modal for:', clickedObject);
            showPaletteModal(clickedObject);
            return;
        }

        // Show/hide multi-select options based on selection state
        const hasSelection = canvas.selectedImages.length > 0;
        const hasImageClick = canvas.contextMenuImage !== null && canvas.contextMenuImage !== undefined;

        deleteSelectedItem.style.display = hasSelection ? 'block' : 'none';
        deselectAllItem.style.display = hasSelection ? 'block' : 'none';
        enableRotateItem.style.display = hasImageClick ? 'block' : 'none';
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
        const assetsGrid = document.getElementById('assets-grid');

        // Remove empty message if it exists
        const emptyMessage = assetsGrid.querySelector('.empty-message');
        if (emptyMessage) {
            emptyMessage.remove();
        }

        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const board = boardManager.currentBoard;
                if (!board.assets) board.assets = [];

                const existsInBoard = board.assets.some(a => a.name === file.name);
                if (!existsInBoard) {
                    const newAsset = {
                        id: Date.now() + Math.random(),
                        src: event.target.result,
                        name: file.name
                    };
                    board.assets.push(newAsset);

                    // Update backend
                    await boardManager.updateBoard(currentBoardId, { assets: board.assets });
                    const allAsset = await boardManager.addToAllAssets(file.name, event.target.result);

                    // Add to DOM immediately - use the asset from "All Assets" if available
                    const assetToDisplay = (showAllAssets && allAsset) ? allAsset : newAsset;
                    appendAssetToDOM(assetToDisplay, assetsGrid);
                }
            };
            reader.readAsDataURL(file);
        });
    };

    input.click();
}

// Helper function to append a single asset to DOM
function appendAssetToDOM(asset, container) {
    const assetItem = document.createElement('div');
    assetItem.className = 'asset-item';
    assetItem.style.opacity = '0';
    assetItem.style.transform = 'scale(0.8)';

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
            assetItem.style.opacity = '0';
            assetItem.style.transform = 'scale(0.8)';

            if (showAllAssets) {
                await boardManager.deleteFromAllAssets(asset.id);
            } else {
                await boardManager.deleteBoardAsset(currentBoardId, asset.id);
            }

            setTimeout(() => {
                assetItem.remove();
                if (container.children.length === 0) {
                    container.innerHTML = showAllAssets
                        ? '<div class="empty-message">No assets yet</div>'
                        : '<div class="empty-message">No board assets yet</div>';
                }
            }, 200);
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
                const board = boardManager.currentBoard;
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

    container.appendChild(assetItem);

    // Animate in
    requestAnimationFrame(() => {
        assetItem.style.transition = 'opacity 0.2s, transform 0.2s';
        assetItem.style.opacity = '1';
        assetItem.style.transform = 'scale(1)';
    });
}

// Sync board assets with actual canvas images
async function syncBoardAssetsWithCanvas() {
    const board = boardManager.currentBoard;
    if (!board || !board.assets) return;

    // Get all image sources currently on the canvas
    const canvasImageSources = new Set(canvas.images.map(img => img.img.src));

    // Filter board assets to only include those that exist on the canvas
    const syncedAssets = board.assets.filter(asset => canvasImageSources.has(asset.src));

    // Only update if there's a difference
    if (syncedAssets.length !== board.assets.length) {
        board.assets = syncedAssets;
        await boardManager.updateBoard(currentBoardId, { assets: syncedAssets });

        // Refresh the assets library if we're showing board assets
        if (!showAllAssets) {
            loadAssetsLibrary();
        }
    }
}

// Update tag filter pills with available tags from all assets
function updateTagFilterPills(assets) {
    const filterBar = document.getElementById('assets-tag-filter-bar');
    const pillsContainer = document.getElementById('assets-tag-filter-pills');
    if (!filterBar || !pillsContainer) return;

    // Collect all unique tags from assets
    const allTags = new Set();
    assets.forEach(asset => {
        if (asset.tags && Array.isArray(asset.tags)) {
            asset.tags.forEach(tag => {
                if (tag && tag.trim()) {
                    allTags.add(tag.toLowerCase());
                }
            });
        }
    });

    // If no tags exist, hide the filter bar
    if (allTags.size === 0) {
        filterBar.style.display = 'none';
        return;
    }

    // Show filter bar if there are tags
    filterBar.style.display = 'flex';

    // Sort tags alphabetically
    const sortedTags = Array.from(allTags).sort();

    // Rebuild tag pills
    pillsContainer.innerHTML = '';
    pillsContainer.classList.remove('expanded');

    const tagPills = [];

    sortedTags.forEach((tag) => {
        const pill = document.createElement('button');
        pill.className = 'assets-tag-filter-pill';
        pill.textContent = tag;
        pill.dataset.tag = tag;

        // Mark as active if it's in the selected filters
        if (selectedTagFilters.includes(tag)) {
            pill.classList.add('active');
        }

        // Toggle tag on click
        pill.addEventListener('click', () => {
            const tagIndex = selectedTagFilters.indexOf(tag);
            if (tagIndex > -1) {
                // Remove tag from filters
                selectedTagFilters.splice(tagIndex, 1);
                pill.classList.remove('active');
            } else {
                // Add tag to filters
                selectedTagFilters.push(tag);
                pill.classList.add('active');
            }

            // Reload library with updated filters
            const searchBar = document.getElementById('assets-search-bar');
            loadAssetsLibrary(searchBar ? searchBar.value : '');
        });

        tagPills.push(pill);
        pillsContainer.appendChild(pill);
    });

    // Detect overflow dynamically after pills are rendered
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
        // Temporarily remove max-height to measure natural height
        const originalMaxHeight = pillsContainer.style.maxHeight;
        pillsContainer.style.maxHeight = 'none';

        const naturalHeight = pillsContainer.scrollHeight;

        // Restore max-height
        pillsContainer.style.maxHeight = originalMaxHeight;

        // Check if content overflows the max-height (40px)
        const maxHeight = 40;
        const hasOverflow = naturalHeight > maxHeight;

        if (hasOverflow) {
            // Determine which pills to hide by measuring height incrementally
            let lastVisibleIndex = -1;

            // Temporarily expand to measure each pill
            pillsContainer.style.maxHeight = 'none';

            for (let i = 0; i < tagPills.length; i++) {
                const pill = tagPills[i];
                const pillRect = pill.getBoundingClientRect();
                const pillTop = pillRect.top;
                const containerTop = pillsContainer.getBoundingClientRect().top;
                const relativeTop = pillTop - containerTop;

                // If this pill is on the second row or beyond
                if (relativeTop >= maxHeight) {
                    break;
                }
                lastVisibleIndex = i;
            }

            // Restore max-height
            pillsContainer.style.maxHeight = originalMaxHeight;

            // Hide pills that overflow (leave room for "..." button)
            // We need to hide one more pill to make room for the "..." button
            for (let i = lastVisibleIndex; i < tagPills.length; i++) {
                tagPills[i].classList.add('hidden');
            }

            // Add "..." button
            const showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'assets-tag-filter-pill show-more';
            showMoreBtn.textContent = '...';
            showMoreBtn.title = 'Show more tags';

            showMoreBtn.addEventListener('click', () => {
                const isExpanded = pillsContainer.classList.contains('expanded');
                const hiddenPills = pillsContainer.querySelectorAll('.assets-tag-filter-pill.hidden');

                if (isExpanded) {
                    // Collapse: hide pills again
                    pillsContainer.classList.remove('expanded');
                    hiddenPills.forEach(pill => pill.classList.add('hidden'));
                    showMoreBtn.textContent = '...';
                    showMoreBtn.title = 'Show more tags';
                } else {
                    // Expand: show all pills
                    pillsContainer.classList.add('expanded');
                    hiddenPills.forEach(pill => pill.classList.remove('hidden'));
                    showMoreBtn.textContent = 'Show less';
                    showMoreBtn.title = 'Show fewer tags';
                }
            });

            pillsContainer.appendChild(showMoreBtn);
        }
    });
}

// Assets Library View Functions
async function loadAssetsLibrary(searchQuery = '') {
    const libraryGrid = document.getElementById('assets-library-grid');
    const showAll = showAllAssets;

    libraryGrid.innerHTML = '';

    let allAssets = [];
    if (showAll) {
        allAssets = await boardManager.getAllAssets();
    } else {
        const board = boardManager.currentBoard;
        allAssets = board.assets || [];
    }

    // Update tag filter pills with ALL available tags (before filtering)
    updateTagFilterPills(allAssets);

    // Start with all assets, then filter
    let assets = [...allAssets];

    // Filter by selected tags (if any selected, asset must have ALL selected tags)
    if (selectedTagFilters.length > 0) {
        assets = assets.filter(asset => {
            if (!asset.tags || !Array.isArray(asset.tags)) return false;

            // Convert asset tags to lowercase for comparison
            const assetTagsLower = asset.tags.map(t => t.toLowerCase());

            // Asset must have ALL selected tags
            return selectedTagFilters.every(filterTag =>
                assetTagsLower.includes(filterTag.toLowerCase())
            );
        });
    }

    // Filter by search query (case-insensitive)
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        assets = assets.filter(asset => {
            const nameMatch = asset.name && asset.name.toLowerCase().includes(query);
            const tagsMatch = asset.tags && asset.tags.some(tag => tag.toLowerCase().includes(query));
            return nameMatch || tagsMatch;
        });
    }

    if (assets.length === 0) {
        libraryGrid.innerHTML = searchQuery.trim() || selectedTagFilters.length > 0
            ? '<div class="empty-message">No assets found matching your filters.</div>'
            : showAll
            ? '<div class="empty-message">No assets yet. Click "+ Import Images" to get started.</div>'
            : '<div class="empty-message">No board assets yet. Click "+ Import Images" to get started.</div>';
        return;
    }

    assets.forEach(asset => {
        appendAssetToLibrary(asset, libraryGrid, showAll);
    });
}

function appendAssetToLibrary(asset, container, isAllAssets) {
    const assetItem = document.createElement('div');
    assetItem.className = 'assets-library-item';

    const img = document.createElement('img');
    img.src = asset.src;
    img.draggable = false;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'assets-library-item-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = isAllAssets ? 'Delete from all assets' : 'Delete from board';
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        showDeleteConfirm(asset.name, async () => {
            if (isAllAssets) {
                await boardManager.deleteFromAllAssets(asset.id);
            } else {
                await boardManager.deleteBoardAsset(currentBoardId, asset.id);
            }
            loadAssetsLibrary();
        });
    });

    // Card info overlay
    const cardInfo = document.createElement('div');
    cardInfo.className = 'asset-card-info';

    const tags = asset.tags || [];
    const tagsHTML = tags.length > 0
        ? `<div class="asset-card-tags">
            ${tags.map(tag => `<span class="asset-card-tag">${tag}</span>`).join('')}
           </div>`
        : '';

    const created = asset.metadata?.created || asset.id || Date.now();
    const createdDate = new Date(created);

    cardInfo.innerHTML = `
        ${tagsHTML}
        <div class="asset-card-name">${asset.name || 'Untitled'}</div>
        <div class="asset-card-meta">${createdDate.toLocaleDateString()}</div>
    `;

    assetItem.appendChild(img);
    assetItem.appendChild(cardInfo);
    assetItem.appendChild(deleteBtn);

    // Click to open modal
    assetItem.addEventListener('click', (e) => {
        // Don't open modal if clicking delete button
        if (e.target === deleteBtn || deleteBtn.contains(e.target)) {
            return;
        }
        showAssetSidebar(asset, isAllAssets);
    });

    container.appendChild(assetItem);
}

function importAssetsToLibrary() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;

    input.onchange = async (e) => {
        const files = Array.from(e.target.files);

        for (const file of files) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const board = boardManager.currentBoard;
                if (!board.assets) board.assets = [];

                const existsInBoard = board.assets.some(a => a.name === file.name);
                if (!existsInBoard) {
                    const newAsset = {
                        id: Date.now() + Math.random(),
                        src: event.target.result,
                        name: file.name,
                        tags: [],
                        metadata: {
                            created: Date.now()
                        }
                    };
                    board.assets.push(newAsset);

                    // Update backend
                    await boardManager.updateBoard(currentBoardId, { assets: board.assets });

                    // Add to all assets with tags and metadata
                    let allAssets = await boardManager.getAllAssets();
                    const existsInAll = allAssets.some(a => a.name === file.name && a.src === event.target.result);
                    if (!existsInAll) {
                        allAssets.push(newAsset);
                        if (window.__TAURI__) {
                            await boardManager.invoke('add_to_all_assets', { name: file.name, src: event.target.result, tags: [], metadata: { created: Date.now() } });
                        } else {
                            localStorage.setItem(boardManager.ALL_ASSETS_KEY, JSON.stringify(allAssets));
                        }
                    }
                }
            };
            reader.readAsDataURL(file);
        }

        // Reload library after import
        setTimeout(() => {
            loadAssetsLibrary();
        }, 500);
    };

    input.click();
}

// Asset Sidebar Functions
let currentAssetInSidebar = null;
let currentAssetIsAllAssets = false;

function setupAssetSidebar() {
    const sidebar = document.getElementById('asset-sidebar');
    const closeBtn = document.getElementById('asset-sidebar-close');
    const addToCanvasBtn = document.getElementById('asset-sidebar-add-to-canvas');
    const deleteBtn = document.getElementById('asset-sidebar-delete');
    const tagInput = document.getElementById('asset-tag-input');
    const addTagBtn = document.getElementById('asset-tag-add-btn');
    const nameInput = document.getElementById('asset-sidebar-name');

    // Close sidebar
    closeBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
        currentAssetInSidebar = null;
    });

    // Add to canvas
    addToCanvasBtn.addEventListener('click', async () => {
        if (!currentAssetInSidebar) return;

        const imgElement = new Image();
        imgElement.onload = async () => {
            // Add image to canvas
            canvas.addImage(imgElement, 100, 100, currentAssetInSidebar.name);
            renderLayers();

            // If from "All Assets", add to board assets
            if (currentAssetIsAllAssets) {
                const board = boardManager.currentBoard;
                const boardAssets = board.assets || [];
                const existsInBoard = boardAssets.some(a => a.name === currentAssetInSidebar.name && a.src === currentAssetInSidebar.src);
                if (!existsInBoard) {
                    boardAssets.push({
                        id: currentAssetInSidebar.id,
                        name: currentAssetInSidebar.name,
                        src: currentAssetInSidebar.src,
                        tags: currentAssetInSidebar.tags || [],
                        metadata: currentAssetInSidebar.metadata || {}
                    });
                    await boardManager.updateBoard(currentBoardId, { assets: boardAssets });
                }
            }

            // Close sidebar (stay in assets view)
            sidebar.classList.remove('open');
            currentAssetInSidebar = null;
        };
        imgElement.src = currentAssetInSidebar.src;
    });

    // Delete asset
    deleteBtn.addEventListener('click', async () => {
        if (!currentAssetInSidebar) return;

        showDeleteConfirm(currentAssetInSidebar.name, async () => {
            if (currentAssetIsAllAssets) {
                await boardManager.deleteFromAllAssets(currentAssetInSidebar.id);
            } else {
                await boardManager.deleteBoardAsset(currentBoardId, currentAssetInSidebar.id);
            }
            sidebar.classList.remove('open');
            currentAssetInSidebar = null;
            loadAssetsLibrary();
        });
    });

    // Add tag
    const addTag = async () => {
        const tagText = tagInput.value.trim();
        if (!tagText || !currentAssetInSidebar) return;

        if (!currentAssetInSidebar.tags) {
            currentAssetInSidebar.tags = [];
        }

        if (!currentAssetInSidebar.tags.includes(tagText)) {
            currentAssetInSidebar.tags.push(tagText);
            await saveAssetChanges();
            await saveTagToPresets(tagText);
            renderAssetSidebarTags();
            await renderQuickTagPresets();
        }

        tagInput.value = '';
        hideTagPresets();
    };

    addTagBtn.addEventListener('click', addTag);
    tagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag();
        }
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdownContainer = document.getElementById('asset-tag-presets-dropdown');
        const quickPresets = document.getElementById('asset-tag-quick-presets');
        if (!tagInput.contains(e.target) &&
            !dropdownContainer.contains(e.target) &&
            !quickPresets.contains(e.target)) {
            hideTagPresets();
        }
    });

    // Save name on blur
    nameInput.addEventListener('blur', async () => {
        if (currentAssetInSidebar) {
            currentAssetInSidebar.name = nameInput.value;
            await saveAssetChanges();
        }
    });
}

async function showAssetSidebar(asset, isAllAssets) {
    // Load fresh asset data from storage to ensure we have the latest tags
    let freshAsset = asset;

    if (isAllAssets) {
        const allAssets = await boardManager.getAllAssets();
        const found = allAssets.find(a => a.id === asset.id);
        if (found) freshAsset = found;
    } else {
        const board = boardManager.currentBoard;
        if (board.assets) {
            const found = board.assets.find(a => a.id === asset.id);
            if (found) freshAsset = found;
        }
    }

    currentAssetInSidebar = freshAsset;
    currentAssetIsAllAssets = isAllAssets;

    const sidebar = document.getElementById('asset-sidebar');
    const preview = document.getElementById('asset-sidebar-preview');
    const nameInput = document.getElementById('asset-sidebar-name');

    // Set preview image
    preview.src = freshAsset.src;

    // Set name
    nameInput.value = freshAsset.name || '';

    // Render tags
    renderAssetSidebarTags();

    // Render quick tag presets
    await renderQuickTagPresets();

    // Render metadata
    renderAssetSidebarMetadata();

    // Show sidebar
    sidebar.classList.add('open');
}

function renderAssetSidebarTags() {
    const tagsContainer = document.getElementById('asset-sidebar-tags');
    tagsContainer.innerHTML = '';

    if (!currentAssetInSidebar || !currentAssetInSidebar.tags || currentAssetInSidebar.tags.length === 0) {
        return;
    }

    currentAssetInSidebar.tags.forEach(tag => {
        const tagElement = document.createElement('div');
        tagElement.className = 'asset-tag';
        tagElement.innerHTML = `
            ${tag}
            <button class="asset-tag-remove">×</button>
        `;

        const removeBtn = tagElement.querySelector('.asset-tag-remove');
        removeBtn.addEventListener('click', async () => {
            currentAssetInSidebar.tags = currentAssetInSidebar.tags.filter(t => t !== tag);
            await saveAssetChanges();
            renderAssetSidebarTags();
        });

        tagsContainer.appendChild(tagElement);
    });
}

function renderAssetSidebarMetadata() {
    const metadataContainer = document.getElementById('asset-sidebar-metadata');

    if (!currentAssetInSidebar) return;

    // Create metadata if it doesn't exist
    if (!currentAssetInSidebar.metadata) {
        currentAssetInSidebar.metadata = {};
    }

    // Add created date if not exists
    if (!currentAssetInSidebar.metadata.created) {
        currentAssetInSidebar.metadata.created = currentAssetInSidebar.id || Date.now();
    }

    const metadata = currentAssetInSidebar.metadata;
    const created = new Date(metadata.created);

    metadataContainer.innerHTML = `
        <div class="asset-sidebar-metadata-item">
            <span class="asset-sidebar-metadata-label">Created</span>
            <span class="asset-sidebar-metadata-value">${created.toLocaleDateString()}</span>
        </div>
        <div class="asset-sidebar-metadata-item">
            <span class="asset-sidebar-metadata-label">ID</span>
            <span class="asset-sidebar-metadata-value">${currentAssetInSidebar.id}</span>
        </div>
    `;

    // Add size if available
    const img = new Image();
    img.onload = () => {
        const sizeItem = document.createElement('div');
        sizeItem.className = 'asset-sidebar-metadata-item';
        sizeItem.innerHTML = `
            <span class="asset-sidebar-metadata-label">Dimensions</span>
            <span class="asset-sidebar-metadata-value">${img.width} × ${img.height}</span>
        `;
        metadataContainer.appendChild(sizeItem);
    };
    img.src = currentAssetInSidebar.src;
}

async function saveAssetChanges() {
    if (!currentAssetInSidebar) return;

    console.log('Saving asset changes:', currentAssetInSidebar);

    // Always update in board assets if it exists there
    const board = boardManager.currentBoard;
    if (board.assets) {
        const boardIndex = board.assets.findIndex(a => a.id === currentAssetInSidebar.id);
        if (boardIndex !== -1) {
            board.assets[boardIndex] = { ...currentAssetInSidebar };
            console.log('Updated in board assets:', board.assets[boardIndex]);
            await boardManager.updateBoard(currentBoardId, { assets: board.assets });
        }
    }

    // Also update in all assets
    let allAssets = await boardManager.getAllAssets();
    const allIndex = allAssets.findIndex(a => a.id === currentAssetInSidebar.id);
    if (allIndex !== -1) {
        allAssets[allIndex] = { ...currentAssetInSidebar };
        console.log('Updated in all assets:', allAssets[allIndex]);

        if (window.__TAURI__) {
            // Update via Tauri backend
            try {
                await boardManager.invoke('update_asset', { asset: currentAssetInSidebar });
            } catch (e) {
                console.error('Failed to update asset:', e);
            }
        } else {
            localStorage.setItem(boardManager.ALL_ASSETS_KEY, JSON.stringify(allAssets));
        }
    }

    // Reload library to reflect changes
    const searchBar = document.getElementById('assets-search-bar');
    if (searchBar) {
        loadAssetsLibrary(searchBar.value);
    }
}

// Tag Presets Management
const TAG_PRESETS_KEY = 'asset_tag_presets';

async function getTagPresets() {
    if (window.__TAURI__) {
        try {
            return await boardManager.invoke('get_tag_presets') || [];
        } catch (e) {
            console.error('Failed to get tag presets:', e);
            return [];
        }
    }
    const stored = localStorage.getItem(TAG_PRESETS_KEY);
    return stored ? JSON.parse(stored) : [];
}

async function saveTagToPresets(tag) {
    let presets = await getTagPresets();
    if (!presets.includes(tag)) {
        presets.push(tag);
        if (window.__TAURI__) {
            try {
                await boardManager.invoke('save_tag_presets', { presets });
            } catch (e) {
                console.error('Failed to save tag presets:', e);
            }
        } else {
            localStorage.setItem(TAG_PRESETS_KEY, JSON.stringify(presets));
        }
    }
}

async function renderTagPresets(filter = '') {
    // This function is no longer used - keeping for backwards compatibility
    // Tags are now shown inline via renderQuickTagPresets()
}

function hideTagPresets() {
    const presetsContainer = document.getElementById('asset-tag-presets-dropdown');
    presetsContainer.classList.remove('show');
}

let tagsExpanded = false;

async function renderQuickTagPresets() {
    const quickPresetsContainer = document.getElementById('asset-tag-quick-presets');
    const presets = await getTagPresets();

    quickPresetsContainer.innerHTML = '';

    if (presets.length === 0) return;

    // Determine which tags to show based on expanded state
    const displayTags = tagsExpanded ? presets.slice().reverse() : presets.slice(-5).reverse();

    // Show tags
    displayTags.forEach(tag => {
        const pill = document.createElement('div');
        pill.className = 'asset-tag-preset-pill';
        pill.innerHTML = `
            <span>${tag}</span>
            <span class="asset-tag-preset-delete">×</span>
        `;

        // Click on entire pill to add tag
        pill.addEventListener('click', (e) => {
            // Don't add tag if clicking the delete button
            if (e.target.classList.contains('asset-tag-preset-delete')) {
                return;
            }
            e.stopPropagation();
            if (currentAssetInSidebar && !currentAssetInSidebar.tags?.includes(tag)) {
                if (!currentAssetInSidebar.tags) {
                    currentAssetInSidebar.tags = [];
                }
                currentAssetInSidebar.tags.push(tag);
                renderAssetSidebarTags();
                // Save in background without blocking UI
                saveAssetChanges();
            }
        });

        // Click on × to delete preset
        pill.querySelector('.asset-tag-preset-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteTagPreset(tag);
            await renderQuickTagPresets();
        });

        quickPresetsContainer.appendChild(pill);
    });

    // Add "..." button if there are more presets and not expanded
    if (presets.length > 5) {
        const morePill = document.createElement('div');
        morePill.className = 'asset-tag-preset-pill more';
        morePill.textContent = tagsExpanded ? '−' : '...';
        morePill.addEventListener('click', () => {
            tagsExpanded = !tagsExpanded;
            renderQuickTagPresets();
        });
        quickPresetsContainer.appendChild(morePill);
    }
}


async function deleteTagPreset(tag) {
    let presets = await getTagPresets();
    presets = presets.filter(t => t !== tag);

    if (window.__TAURI__) {
        try {
            await boardManager.invoke('save_tag_presets', { presets });
        } catch (e) {
            console.error('Failed to delete tag preset:', e);
        }
    } else {
        localStorage.setItem(TAG_PRESETS_KEY, JSON.stringify(presets));
    }
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
            zIndex: img.zIndex || 0,
            rotation: img.rotation || 0
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
                                added.rotation = layer.rotation || 0;
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

    if (!propertiesPanel) return;

    // Shape and text objects use floating toolbar, hide properties panel
    if (obj.type === 'shape' || obj.type === 'text') {
        if (defaultProperties) defaultProperties.style.display = 'block';
        propertiesPanel.style.display = 'none';
        return;
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

function showFloatingToolbar(obj) {
    const textToolbar = document.getElementById('floating-text-toolbar');
    const shapeToolbar = document.getElementById('floating-shape-toolbar');
    const palettePopup = document.getElementById('color-palette-popup');

    // Show floating toolbars based on object type
    if (obj.type === 'text') {
        hideFloatingToolbars();
        textToolbar.style.display = 'block';
        positionFloatingToolbar(textToolbar, obj);
        setupTextFloatingToolbar(obj);
    } else if (obj.type === 'shape') {
        hideFloatingToolbars();
        shapeToolbar.style.display = 'block';
        positionFloatingToolbar(shapeToolbar, obj);
        setupShapeFloatingToolbar(obj);
    }
}

function hideFloatingToolbars() {
    const textToolbar = document.getElementById('floating-text-toolbar');
    const shapeToolbar = document.getElementById('floating-shape-toolbar');

    if (textToolbar) textToolbar.style.display = 'none';
    if (shapeToolbar) shapeToolbar.style.display = 'none';
}

function positionFloatingToolbar(toolbar, obj) {
    const canvasRect = canvas.canvas.getBoundingClientRect();

    // Get object's screen position and size
    const objScreenPos = canvas.worldToScreen(obj.x, obj.y);
    const objWidth = (obj.width || 100) * canvas.zoom;
    const objHeight = (obj.height || 100) * canvas.zoom;

    // Position toolbar below the object
    const toolbarX = canvasRect.left + objScreenPos.x;
    const toolbarY = canvasRect.top + objScreenPos.y + objHeight + 10; // 10px below

    toolbar.style.left = `${toolbarX}px`;
    toolbar.style.top = `${toolbarY}px`;
}

function setupTextFloatingToolbar(obj) {
    const fontFamily = document.getElementById('floating-font-family');
    const fontSize = document.getElementById('floating-font-size');
    const boldBtn = document.getElementById('floating-text-bold');
    const colorInput = document.getElementById('floating-text-color');
    const alignLeft = document.getElementById('floating-text-align-left');
    const alignCenter = document.getElementById('floating-text-align-center');
    const alignRight = document.getElementById('floating-text-align-right');

    // Set current values
    fontFamily.value = obj.fontFamily || 'Arial';
    fontSize.value = obj.fontSize || 32;
    colorInput.value = obj.color || '#000000';

    // Update bold button state
    if (obj.fontWeight === 'bold') {
        boldBtn.classList.add('active');
    } else {
        boldBtn.classList.remove('active');
    }

    // Update alignment buttons
    alignLeft.classList.toggle('active', obj.textAlign === 'left' || !obj.textAlign);
    alignCenter.classList.toggle('active', obj.textAlign === 'center');
    alignRight.classList.toggle('active', obj.textAlign === 'right');

    // Event listeners
    fontFamily.onchange = () => canvas.objectsManager.updateSelectedObject({ fontFamily: fontFamily.value });
    fontSize.oninput = () => canvas.objectsManager.updateSelectedObject({ fontSize: parseInt(fontSize.value) });
    boldBtn.onclick = () => {
        const newWeight = obj.fontWeight === 'bold' ? 'normal' : 'bold';
        canvas.objectsManager.updateSelectedObject({ fontWeight: newWeight });
        boldBtn.classList.toggle('active');
    };
    colorInput.oninput = () => canvas.objectsManager.updateSelectedObject({ color: colorInput.value });

    alignLeft.onclick = () => {
        canvas.objectsManager.updateSelectedObject({ textAlign: 'left' });
        alignLeft.classList.add('active');
        alignCenter.classList.remove('active');
        alignRight.classList.remove('active');
    };
    alignCenter.onclick = () => {
        canvas.objectsManager.updateSelectedObject({ textAlign: 'center' });
        alignLeft.classList.remove('active');
        alignCenter.classList.add('active');
        alignRight.classList.remove('active');
    };
    alignRight.onclick = () => {
        canvas.objectsManager.updateSelectedObject({ textAlign: 'right' });
        alignLeft.classList.remove('active');
        alignCenter.classList.remove('active');
        alignRight.classList.add('active');
    };
}

function setupShapeFloatingToolbar(obj) {
    const shapeButtons = document.querySelectorAll('.shape-btn');
    const fillColor = document.getElementById('floating-shape-fill');
    const strokeToggle = document.getElementById('floating-shape-stroke-toggle');
    const strokeColor = document.getElementById('floating-shape-stroke-color');
    const strokeWidth = document.getElementById('floating-shape-stroke-width');

    // Set current values
    fillColor.value = obj.fillColor || '#3b82f6';
    strokeColor.value = obj.strokeColor || '#000000';
    strokeWidth.value = obj.strokeWidth || 2;

    // Update shape button states
    const currentShapeType = obj.shapeType || 'square';
    shapeButtons.forEach(btn => {
        if (btn.dataset.shape === currentShapeType) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update stroke toggle state
    strokeToggle.classList.toggle('active', obj.hasStroke !== false);

    // Event listeners for shape buttons
    shapeButtons.forEach(btn => {
        btn.onclick = () => {
            const newShapeType = btn.dataset.shape;
            canvas.objectsManager.updateSelectedObject({ shapeType: newShapeType });
            shapeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });

    fillColor.oninput = () => canvas.objectsManager.updateSelectedObject({ fillColor: fillColor.value });

    strokeToggle.onclick = () => {
        const newHasStroke = !obj.hasStroke;
        canvas.objectsManager.updateSelectedObject({ hasStroke: newHasStroke });
        strokeToggle.classList.toggle('active');
    };

    strokeColor.oninput = () => canvas.objectsManager.updateSelectedObject({ strokeColor: strokeColor.value });
    strokeWidth.oninput = () => canvas.objectsManager.updateSelectedObject({ strokeWidth: parseInt(strokeWidth.value) });
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
    // Close any open group context menus
    const existingGroupMenus = document.querySelectorAll('.group-context-menu');
    existingGroupMenus.forEach(menu => menu.remove());

    const contextMenu = document.getElementById('layer-context-menu');
    if (!contextMenu) {
        console.error('Layer context menu element not found!');
        return;
    }

    currentContextLayer = layer;
    currentContextLayerType = type;

    // Show/hide ungroup button based on whether the layer is in a group
    const ungroupButton = document.getElementById('layer-context-ungroup');
    const layerId = layer.id;
    let isInGroup = false;

    if (type === 'image') {
        isInGroup = layerGroups.some(g => g.layerIds.includes(layerId));
    } else if (type === 'object') {
        isInGroup = layerGroups.some(g => g.objectIds && g.objectIds.includes(layerId));
    }

    if (ungroupButton) {
        ungroupButton.style.display = isInGroup ? 'block' : 'none';
    }

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('show');
}

let layerContextMenuSetup = false;

function setupLayerContextMenu() {
    // Prevent duplicate setup
    if (layerContextMenuSetup) return;
    layerContextMenuSetup = true;

    const contextMenu = document.getElementById('layer-context-menu');
    const renameItem = document.getElementById('layer-context-rename');
    const ungroupItem = document.getElementById('layer-context-ungroup');
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

    // Remove from group
    ungroupItem.addEventListener('click', () => {
        contextMenu.classList.remove('show');
        if (!currentContextLayer) return;

        const layerId = currentContextLayer.id;
        let removed = false;

        // Find and remove the layer from its group
        layerGroups.forEach(group => {
            if (currentContextLayerType === 'image' && group.layerIds.includes(layerId)) {
                group.layerIds = group.layerIds.filter(id => id !== layerId);
                removed = true;
            } else if (currentContextLayerType === 'object' && group.objectIds && group.objectIds.includes(layerId)) {
                group.objectIds = group.objectIds.filter(id => id !== layerId);
                removed = true;
            }
        });

        // Clean up empty groups
        layerGroups = layerGroups.filter(group => {
            const hasLayers = group.layerIds && group.layerIds.length > 0;
            const hasObjects = group.objectIds && group.objectIds.length > 0;
            return hasLayers || hasObjects;
        });

        if (removed) {
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
        const baseCellSize = 60;
        const zoomFactor = 1 / canvas.zoom;
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

        // Create color palette object on canvas
        const paletteObject = {
            type: 'colorPalette',
            id: Date.now() + Math.random(),
            name: paletteName,
            x: centerX - width / 2,
            y: centerY - height / 2,
            width: width,
            height: height,
            colors: colors,
            sourceImage: sourceImage,
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

function populateColorPalette(colors) {
    const grid = document.getElementById('color-palette-grid');
    if (!grid) return;

    console.log('Populating palette with colors:', colors);

    // Create swatches in horizontal row
    grid.innerHTML = colors.map((color, index) => {
        // Handle both object format {hex, rgb} and string format
        const hexColor = typeof color === 'string' ? color : color.hex;
        const rgbColor = typeof color === 'string' ? null : color.rgb;

        return `
            <div class="color-palette-swatch"
                 style="background-color: ${hexColor};"
                 data-hex="${hexColor}"
                 data-rgb="${rgbColor || ''}"
                 data-index="${index}"
                 title="${hexColor.toUpperCase()}">
            </div>
        `;
    }).join('');

    // Add click handler to show copy options
    grid.querySelectorAll('.color-palette-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            const hex = swatch.dataset.hex;
            const rgb = swatch.dataset.rgb;
            showColorCopyOptions(hex, rgb, e.clientX, e.clientY);
        });
    });
}

function showColorCopyOptions(hexColor, rgbColor, x, y) {
    // Remove any existing copy menu
    const existingMenu = document.getElementById('color-copy-menu');
    if (existingMenu) existingMenu.remove();

    const hexText = hexColor.toUpperCase();
    const rgbText = rgbColor || (() => {
        const rgb = hexToRgb(hexColor);
        return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    })();

    // Create copy menu
    const menu = document.createElement('div');
    menu.id = 'color-copy-menu';
    menu.className = 'color-copy-menu';
    menu.innerHTML = `
        <div class="color-copy-option" data-value="${hexText}">
            <span class="copy-label">HEX</span>
            <span class="copy-value">${hexText}</span>
        </div>
        <div class="color-copy-option" data-value="${rgbText}">
            <span class="copy-label">RGB</span>
            <span class="copy-value">${rgbText}</span>
        </div>
    `;

    // Position at center of screen if no coordinates provided
    if (x === undefined || y === undefined) {
        x = window.innerWidth / 2;
        y = window.innerHeight / 2;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    // Position menu to not go off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${y - rect.height}px`;
    }

    // Add click handlers
    menu.querySelectorAll('.color-copy-option').forEach(option => {
        option.addEventListener('click', async () => {
            const value = option.dataset.value;
            try {
                await navigator.clipboard.writeText(value);
                showToast(`Copied ${value}`, 'success', 1500);
                menu.remove();
            } catch (err) {
                console.error('Failed to copy:', err);
                showToast('Failed to copy', 'error', 1500);
            }
        });
    });

    // Close menu on outside click - delay to prevent immediate close
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 200);
}

function showPaletteModal(paletteObj) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 90vw; width: auto;">
            <div class="modal-header">
                <h2>Color Palette</h2>
            </div>
            <div class="modal-body">
                <div id="palette-modal-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 12px; padding: 8px; max-width: 100%;">
                    <!-- Colors will be populated here -->
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-secondary" id="palette-modal-close">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'flex';

    // Populate colors
    const grid = modal.querySelector('#palette-modal-grid');
    paletteObj.colors.forEach(color => {
        const hexColor = typeof color === 'string' ? color : color.hex;
        const rgbColor = typeof color === 'string' ? null : color.rgb;

        const colorItem = document.createElement('div');
        colorItem.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 8px;';
        colorItem.innerHTML = `
            <div style="width: 100%; aspect-ratio: 1; background-color: ${hexColor}; border-radius: 8px; border: 2px solid var(--border-color); cursor: pointer;"></div>
            <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                <button class="copy-hex-btn" style="padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: 12px;">
                    Copy HEX
                </button>
                <button class="copy-rgb-btn" style="padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: 12px;">
                    Copy RGB
                </button>
            </div>
        `;

        const hexBtn = colorItem.querySelector('.copy-hex-btn');
        const rgbBtn = colorItem.querySelector('.copy-rgb-btn');

        hexBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(hexColor.toUpperCase());
                const originalText = hexBtn.textContent;
                hexBtn.textContent = 'Copied!';
                hexBtn.style.background = 'var(--accent-color)';
                hexBtn.style.color = 'white';
                setTimeout(() => {
                    hexBtn.textContent = originalText;
                    hexBtn.style.background = 'var(--bg-secondary)';
                    hexBtn.style.color = 'var(--text-primary)';
                }, 1000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });

        rgbBtn.addEventListener('click', async () => {
            const rgbText = rgbColor || (() => {
                const rgb = hexToRgb(hexColor);
                return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
            })();
            try {
                await navigator.clipboard.writeText(rgbText);
                const originalText = rgbBtn.textContent;
                rgbBtn.textContent = 'Copied!';
                rgbBtn.style.background = 'var(--accent-color)';
                rgbBtn.style.color = 'white';
                setTimeout(() => {
                    rgbBtn.textContent = originalText;
                    rgbBtn.style.background = 'var(--bg-secondary)';
                    rgbBtn.style.color = 'var(--text-primary)';
                }, 1000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });

        grid.appendChild(colorItem);
    });

    // Close button
    const closeBtn = modal.querySelector('#palette-modal-close');
    closeBtn.addEventListener('click', () => {
        modal.remove();
    });

    // Close modal on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
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

