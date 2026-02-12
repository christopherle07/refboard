import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';
import { showDeleteConfirm } from './modal.js';
import { HistoryManager } from './history-manager.js';
import { showInputModal, showChoiceModal, showToast, showConfirmModal, showColorExtractorModal, extractColorsFromImage } from './modal-utils.js';
import { updateTitlebarTitle } from './titlebar.js';
import { FontDropdown } from './font-dropdown.js';
import { MediaControls } from './media-controls.js';
import { hijackColorInput } from './color-picker.js';

// Apply theme on page load
const savedSettings = JSON.parse(localStorage.getItem('canvas_settings') || '{}');
const theme = savedSettings.theme || 'light';
document.documentElement.setAttribute('data-theme', theme);
document.body.setAttribute('data-theme', theme);
console.log('Applied theme on load:', theme);

// Editor instance manager - stores separate state for each board container
const editorInstances = new Map(); // Map<container, editorState>
let activeContainer = null; // Currently active editor container
let sidebarToggleListenerAttached = false; // Prevent duplicate listeners on titlebar button
let undoRedoListenerAttached = false; // Prevent duplicate listeners on undo/redo buttons

// Helper to get element from active container
function getElement(id) {
    if (!activeContainer) {
        console.error('[getElement] No active container');
        return null;
    }
    return activeContainer.querySelector('#' + id);
}

// Update undo/redo button disabled state
function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = !historyManager || !historyManager.canUndo();
    if (redoBtn) redoBtn.disabled = !historyManager || !historyManager.canRedo();
}

// Get or create editor instance for a container
function getEditorInstance(container) {
    if (!editorInstances.has(container)) {
        editorInstances.set(container, {
            canvas: null,
            historyManager: null,
            currentBoardId: null,
            saveTimeout: null,
            pendingSave: false,
            dragSourceIndex: null,
            currentOrder: [],
            draggedImageId: null,
            draggedLayerId: null,
            draggedLayerType: null,
            allLayersOrder: [],
            syncChannel: null,
            showAllAssets: false,
            selectedTagFilters: [],
            renderThrottle: null,
            draggedElement: null,
            ghostElement: null,
            lastDragOrderHash: null,
            isDragging: false,
            draggedFromGroup: null,
            draggedFromGroupBounds: null,
            lastDragY: 0,
            layerGroups: [],
            nextGroupId: 1,
            sidebarFontDropdown: null,
            floatingFontDropdown: null
        });
    }
    return editorInstances.get(container);
}

// Legacy global variables that point to the active instance
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

// Track keyboard event handler to prevent duplicates
let keyboardHandler = null;

// Save current global state back to the instance
function saveInstanceState() {
    if (activeContainer && editorInstances.has(activeContainer)) {
        const instance = editorInstances.get(activeContainer);
        instance.canvas = canvas;
        instance.historyManager = historyManager;
        instance.currentBoardId = currentBoardId;
        instance.saveTimeout = saveTimeout;
        instance.pendingSave = pendingSave;
        instance.dragSourceIndex = dragSourceIndex;
        instance.currentOrder = currentOrder;
    }
}

// Update global references to point to the active instance
function setActiveInstance(container) {
    // Save current instance state before switching
    saveInstanceState();

    activeContainer = container;
    const instance = getEditorInstance(container);

    canvas = instance.canvas;
    historyManager = instance.historyManager;
    currentBoardId = instance.currentBoardId;
    saveTimeout = instance.saveTimeout;
    pendingSave = instance.pendingSave;
    dragSourceIndex = instance.dragSourceIndex;
    currentOrder = instance.currentOrder;
    draggedImageId = instance.draggedImageId;
    draggedLayerId = instance.draggedLayerId;
    draggedLayerType = instance.draggedLayerType;
    allLayersOrder = instance.allLayersOrder;
    syncChannel = instance.syncChannel;
    showAllAssets = instance.showAllAssets;
    selectedTagFilters = instance.selectedTagFilters;
    renderThrottle = instance.renderThrottle;
    draggedElement = instance.draggedElement;
    ghostElement = instance.ghostElement;
    lastDragOrderHash = instance.lastDragOrderHash;
    isDragging = instance.isDragging;
    draggedFromGroup = instance.draggedFromGroup;
    draggedFromGroupBounds = instance.draggedFromGroupBounds;
    lastDragY = instance.lastDragY;
    layerGroups = instance.layerGroups;
    nextGroupId = instance.nextGroupId;
}

// Save current global state back to the active instance
function saveActiveInstance() {
    if (!activeContainer) return;
    const instance = getEditorInstance(activeContainer);

    instance.canvas = canvas;
    instance.historyManager = historyManager;
    instance.currentBoardId = currentBoardId;
    instance.saveTimeout = saveTimeout;
    instance.pendingSave = pendingSave;
    instance.dragSourceIndex = dragSourceIndex;
    instance.currentOrder = currentOrder;
    instance.draggedImageId = draggedImageId;
    instance.draggedLayerId = draggedLayerId;
    instance.draggedLayerType = draggedLayerType;
    instance.allLayersOrder = allLayersOrder;
    instance.syncChannel = syncChannel;
    instance.showAllAssets = showAllAssets;
    instance.selectedTagFilters = selectedTagFilters;
    instance.renderThrottle = renderThrottle;
    instance.draggedElement = draggedElement;
    instance.ghostElement = ghostElement;
    instance.lastDragOrderHash = lastDragOrderHash;
    instance.isDragging = isDragging;
    instance.draggedFromGroup = draggedFromGroup;
    instance.draggedFromGroupBounds = draggedFromGroupBounds;
    instance.lastDragY = lastDragY;
    instance.layerGroups = layerGroups;
    instance.nextGroupId = nextGroupId;
}


// Export init function for ViewManager
export async function initEditor(boardId, container) {
    console.log('[initEditor] Starting editor initialization for board:', boardId, 'container:', container);

    // Set this container as the active instance and load its state
    setActiveInstance(container);

    currentBoardId = boardId;

    if (!currentBoardId) {
        console.error('[initEditor] No board ID provided to initEditor');
        return;
    }

    console.log('[initEditor] Current board ID set to:', currentBoardId);
    syncChannel = new BroadcastChannel('board_sync_' + currentBoardId);

    // Handle sync requests from floating window
    syncChannel.onmessage = async (event) => {
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
        } else if (event.data.type === 'image_added') {
            // Image added in floating window — add it here too
            const data = event.data.image;
            const resolvedSrc = await boardManager.resolveImageSrc(data.src);
            const img = new Image();
            img.onload = () => {
                const added = canvas.addImageSilent(img, data.x, data.y, data.name, data.width, data.height);
                added.id = data.id;
                if (data.src && !data.src.startsWith('data:')) added.filePath = data.src;
                canvas.invalidateCullCache();
                canvas.needsRender = true;
                canvas.render();
                canvas.canvas.dispatchEvent(new CustomEvent('canvasChanged'));
            };
            img.src = resolvedSrc;
        } else if (event.data.type === 'image_filters_changed') {
            // Apply filter changes from floating window
            const img = canvas.images.find(i => i.id === event.data.imageId);
            if (img && event.data.filters) {
                const f = event.data.filters;
                img.brightness = f.brightness;
                img.contrast = f.contrast;
                img.saturation = f.saturation;
                img.hue = f.hue;
                img.blur = f.blur;
                img.opacity = f.opacity;
                img.grayscale = f.grayscale;
                img.invert = f.invert;
                img.mirror = f.mirror;
                // Rebuild filter cache with new values
                canvas.clearFilterCache(img);
                canvas.applyFilters(img);
                canvas.needsRender = true;
                scheduleSave();
            }
        }
    };

    // Prevent default drag/drop behavior on document to avoid browser navigation
    const preventDefaultDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    document.addEventListener('dragover', preventDefaultDrag);
    document.addEventListener('drop', preventDefaultDrag);

    // Global dragover listener to track mouse position during drag (needed for dragging outside groups)
    document.addEventListener('dragover', (e) => {
        if (isDragging) {
            lastDragY = e.clientY;
        }
    });

    // Load and initialize board
    console.log('[initEditor] Loading boards...');
    await boardManager.loadBoards();

    console.log('[initEditor] Getting board data for ID:', currentBoardId);
    const board = await boardManager.getBoard(currentBoardId);

    if (!board) {
        console.error('[initEditor] Board not found:', currentBoardId);
        return;
    }

    console.log('[initEditor] Board loaded successfully:', {
        id: board.id,
        name: board.name,
        hasStrokes: !!board.strokes,
        strokesCount: board.strokes?.length || 0,
        hasObjects: !!board.objects,
        objectsCount: board.objects?.length || 0
    });

    window.boardManagerInstance = boardManager;
    window.currentBoardId = currentBoardId;
    window.renderAssetsCallback = renderAssets;

    const boardNameEl = container.querySelector('#board-name');
    if (!boardNameEl) {
        throw new Error('Board name element not found - container may be corrupted');
    }
    boardNameEl.textContent = board.name;
    updateTitlebarTitle(`EyeDea - ${board.name}`);

    // Apply sidebar collapsed state BEFORE creating canvas so it gets correct dimensions
    const sidebar = container.querySelector('#sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const savedCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (sidebar && savedCollapsed) {
        sidebar.classList.add('collapsed');
        if (sidebarToggleBtn) {
            sidebarToggleBtn.classList.add('active');
        }
    }

    const canvasElement = container.querySelector('#main-canvas');
    if (!canvasElement) {
        throw new Error('Canvas element not found - container may be corrupted');
    }
    canvas = new Canvas(canvasElement);
    canvas.setBackgroundColor(board.bgColor || board.bg_color);

    // Initialize media controls (video/GIF hover bars)
    const canvasContainer = canvasElement.parentElement;
    const mediaControls = new MediaControls(canvas, canvasContainer);
    canvas.mediaControls = mediaControls;

    // 2K video resolution warning
    canvasElement.addEventListener('videoResolutionWarning', (e) => {
        const { width, height, name } = e.detail;
        showToast(`Warning: "${name}" is ${width}x${height}. High-resolution videos may affect performance.`, 'warning');
    });

    historyManager = new HistoryManager(50);
    historyManager.setCanvas(canvas);
    historyManager.onChanged = updateUndoRedoButtons;
    canvas.setHistoryManager(historyManager);

    const colorInput = container.querySelector('#bg-color');
    if (colorInput) {
        colorInput.value = board.bgColor || board.bg_color;
    }

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
        if (e.detail.type === 'colorPalette') {
            showPaletteSidebar(e.detail);
        } else {
            hidePaletteSidebar();
        }
    });
    canvasElement.addEventListener('objectDeselected', () => {
        hidePropertiesPanel();
        hideFloatingToolbars();
        hidePaletteSidebar();
    });
    canvasElement.addEventListener('objectDoubleClicked', (e) => {
        const obj = e.detail;
        if (obj.type === 'text') {
            // Focus the text content textarea
            setTimeout(() => {
                const textContent = getElement('text-content');
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
        const textToolBtn = getElement('text-tool-btn');
        if (textToolBtn) {
            if (e.detail.tool === 'text') {
                textToolBtn.classList.add('active');
            } else {
                textToolBtn.classList.remove('active');
            }
        }
    });

    renderLayers();

    // Build board assets from canvas images on load
    await buildBoardAssetsFromCanvas();

    renderAssets();

    // Add dragover handler to layers list to allow drops in empty space
    const layersList = getElement('layers-list');
    if (layersList) {
        layersList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
    }

    // Setup event listeners
    console.log('[initEditor] Setting up event listeners...');
    setupEventListeners(container);

    // Replace native color inputs with custom color picker (once per container)
    if (!container._colorPickerHijacked) {
        container.querySelectorAll('input[type="color"]').forEach(hijackColorInput);
        container._colorPickerHijacked = true;
    }

    // Save the instance state after initialization
    saveActiveInstance();

    // Make save function globally accessible for app.js
    window.editorSaveNow = saveNow;
    window.editorForceSave = async () => {
        pendingSave = true;
        await saveNow();
    };

    // Ensure canvas gets correct dimensions after initialization
    if (canvas) {
        canvas.resizeCanvas();
        canvas.needsRender = true;
    }

    console.log('[initEditor] Editor initialization complete!');
}

async function loadLayers(layers, viewState = null) {
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
        return;
    }

    // Resolve all image sources (file refs → asset URLs) up front
    const resolvedLayers = await Promise.all(layers.map(async (layer) => {
        const rawSrc = layer.cropData && layer.originalSrc ? layer.originalSrc : layer.src;
        const resolvedSrc = await boardManager.resolveImageSrc(rawSrc);
        // Track whether this layer uses file-based storage
        const filePath = (layer.src && !layer.src.startsWith('data:')) ? layer.src : null;
        return { layer, resolvedSrc, filePath };
    }));

    return new Promise(resolve => {
        let loaded = 0;
        const total = resolvedLayers.length;

        const finishIfDone = () => {
            loaded++;
            if (loaded >= total) {
                canvas.selectImage(null);
                canvas.invalidateCullCache();
                canvas.updatePlayingMediaState();
                canvas.needsRender = true;
                canvas.render();
                resolve();
            }
        };

        resolvedLayers.forEach(({ layer, resolvedSrc, filePath }) => {
            // Detect media type from metadata or file extension fallback
            const nameLC = (layer.name || '').toLowerCase();
            const srcLC = (layer.src || '').toLowerCase();
            const mediaType = layer.mediaType
                || (/\.(mp4|mov|webm)$/i.test(nameLC) || /\.(mp4|mov|webm)$/i.test(srcLC) ? 'video' : null)
                || (/\.gif$/i.test(nameLC) || /\.gif$/i.test(srcLC) ? 'gif' : null);

            if (mediaType === 'video') {
                // Restore video layer
                const video = document.createElement('video');
                video.preload = 'auto';
                video.muted = layer.muted !== false;
                video.onloadedmetadata = () => {
                    const added = canvas.addVideoSilent(video, layer.x, layer.y, layer.name, layer.width, layer.height, layer.visible !== false);
                    added.id = layer.id;
                    added.zIndex = layer.zIndex || 0;
                    added.rotation = layer.rotation || 0;
                    added.currentTime = layer.currentTime || 0;
                    added.volume = layer.volume != null ? layer.volume : 1;
                    added.muted = layer.muted !== false;
                    if (filePath) added.filePath = filePath;
                    if (layer.opacity != null) added.opacity = layer.opacity;
                    video.currentTime = added.currentTime;
                    finishIfDone();
                };
                video.onerror = () => finishIfDone();
                video.src = resolvedSrc;
            } else if (mediaType === 'gif') {
                // Restore GIF layer
                fetch(resolvedSrc)
                    .then(r => r.arrayBuffer())
                    .then(buffer => {
                        const added = canvas.addGifSilent(buffer, layer.x, layer.y, layer.name, resolvedSrc);
                        if (added) {
                            added.id = layer.id;
                            added.zIndex = layer.zIndex || 0;
                            added.rotation = layer.rotation || 0;
                            if (layer.width != null) added.width = layer.width;
                            if (layer.height != null) added.height = layer.height;
                            added.gifCurrentFrame = layer.gifCurrentFrame || 0;
                            added.gifPlaying = false;
                            if (filePath) added.filePath = filePath;
                            if (layer.opacity != null) added.opacity = layer.opacity;
                        }
                        finishIfDone();
                    })
                    .catch(() => finishIfDone());
            } else {
                // Restore regular image layer
                const img = new Image();
                img.onload = () => {
                    const visible = layer.visible !== false;
                    const added = canvas.addImageSilent(img, layer.x, layer.y, layer.name, layer.width, layer.height, visible);
                    added.id = layer.id;
                    added.zIndex = layer.zIndex || 0;
                    added.rotation = layer.rotation || 0;
                    if (filePath) added.filePath = filePath;
                    if (layer.brightness != null) added.brightness = layer.brightness;
                    if (layer.contrast != null) added.contrast = layer.contrast;
                    if (layer.saturation != null) added.saturation = layer.saturation;
                    if (layer.hue != null) added.hue = layer.hue;
                    if (layer.blur != null) added.blur = layer.blur;
                    if (layer.opacity != null) added.opacity = layer.opacity;
                    if (layer.grayscale === true) added.grayscale = true;
                    if (layer.invert === true) added.invert = true;
                    if (layer.mirror === true) added.mirror = true;

                    if (layer.cropData) {
                        added.cropData = layer.cropData;
                        added.originalSrc = layer.originalSrc || layer.src;
                        added.originalWidth = layer.originalWidth || img.naturalWidth;
                        added.originalHeight = layer.originalHeight || img.naturalHeight;
                        added.originalImg = img;
                    }

                    if (canvas.buildFilterString(added)) {
                        canvas.applyFilters(added);
                    }

                    finishIfDone();
                };
                img.onerror = () => finishIfDone();
                img.src = resolvedSrc;
            }
        });
    });
}


function setupEventListeners(container) {
    // Helper function to get element scoped to this container
    const $ = (id) => container.querySelector('#' + id);

    // Sidebar collapse toggle - use titlebar button
    // Note: Collapsed state is applied in initEditor BEFORE canvas creation
    // Only attach listener once since the button is in the titlebar (persists across boards)
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    if (sidebarToggleBtn && !sidebarToggleListenerAttached) {
        console.log('[setupEventListeners] Setting up sidebar toggle (one-time)...');
        sidebarToggleListenerAttached = true;

        sidebarToggleBtn.addEventListener('click', () => {
            const sidebar = activeContainer?.querySelector('#sidebar');
            if (!sidebar) return;

            sidebar.classList.toggle('collapsed');
            sidebarToggleBtn.classList.toggle('active');
            localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
        });
    }

    // Undo/Redo buttons - attach once since they're in the titlebar
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn && redoBtn && !undoRedoListenerAttached) {
        undoRedoListenerAttached = true;

        undoBtn.addEventListener('click', () => {
            if (historyManager && historyManager.undo()) {
                renderLayers();
                scheduleSave();
                updateUndoRedoButtons();
            }
        });

        redoBtn.addEventListener('click', () => {
            if (historyManager && historyManager.redo()) {
                renderLayers();
                scheduleSave();
                updateUndoRedoButtons();
            }
        });
    }

    const bgColorInput = $('bg-color');
    if (bgColorInput) {
        bgColorInput.addEventListener('change', (e) => {
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
    }

    // Assets library event listeners
    const assetsLibraryImportBtn = $('assets-library-import-btn');
    if (assetsLibraryImportBtn) {
        assetsLibraryImportBtn.addEventListener('click', () => {
            importAssetsToLibrary();
        });
    }

    // Assets view buttons - clone to remove old event listeners
    let boardAssetsBtn = $('board-assets-btn');
    let allAssetsBtn = $('all-assets-btn');

    if (boardAssetsBtn) {
        const newBoardAssetsBtn = boardAssetsBtn.cloneNode(true);
        boardAssetsBtn.parentNode.replaceChild(newBoardAssetsBtn, boardAssetsBtn);
        boardAssetsBtn = newBoardAssetsBtn;

        boardAssetsBtn.addEventListener('click', () => {
            showAllAssets = false;
            boardAssetsBtn.classList.add('active');
            if (allAssetsBtn) allAssetsBtn.classList.remove('active');
            loadAssetsLibrary();
        });
    }

    if (allAssetsBtn) {
        const newAllAssetsBtn = allAssetsBtn.cloneNode(true);
        allAssetsBtn.parentNode.replaceChild(newAllAssetsBtn, allAssetsBtn);
        allAssetsBtn = newAllAssetsBtn;

        allAssetsBtn.addEventListener('click', () => {
            showAllAssets = true;
            allAssetsBtn.classList.add('active');
            if (boardAssetsBtn) boardAssetsBtn.classList.remove('active');
            loadAssetsLibrary();
        });
    }

    // Assets search bar
    const assetsSearchBar = $('assets-search-bar');
    if (assetsSearchBar) {
        assetsSearchBar.addEventListener('input', (e) => {
            loadAssetsLibrary(e.target.value);
        });
    }

    // Tag filter clear button
    const assetsTagClearBtn = $('assets-tag-clear-btn');
    if (assetsTagClearBtn && assetsSearchBar) {
        assetsTagClearBtn.addEventListener('click', () => {
            selectedTagFilters = [];
            loadAssetsLibrary(assetsSearchBar.value);
        });
    }

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
                showCanvasView();
            } else if (tab === 'assets') {
                showAssetsView();
            }
        });
    });

    // Shared functions for switching between canvas and assets views
    function showCanvasView() {
        // Show canvas view
        const assetsView = $('assets-library-view');
        assetsView.classList.remove('fade-in');
        $('canvas-container').style.display = 'block';
        assetsView.style.display = 'none';
        const drawingToolbar = $('drawing-toolbar');
        const toolsSidebar = document.querySelector('.tools-sidebar');
        const sizeSlider = $('draw-size-slider-container');
        const opacitySlider = $('draw-opacity-slider-container');
        // Restore display but keep visibility controlled by drawing mode
        if (drawingToolbar) drawingToolbar.style.display = '';
        if (toolsSidebar) toolsSidebar.style.display = 'flex';
        if (sizeSlider) sizeSlider.style.display = '';
        if (opacitySlider) opacitySlider.style.display = '';

        // Show sidebar again
        const sidebar = $('sidebar');
        if (sidebar) sidebar.style.display = '';

        // Switch to Layers tab
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        const layersTab = document.querySelector('[data-tab="layers"]');
        if (layersTab) layersTab.classList.add('active');

        // Update breadcrumb to remove Assets segment
        if (window.appInstance && window.appInstance._currentBoardName) {
            window.appInstance.updateBreadcrumb(`All Boards > ${window.appInstance._currentBoardName}`);
        }
    }

    function showAssetsView() {
        // Show assets view on top while canvas is still visible underneath (crossfade)
        const canvasContainer = $('canvas-container');
        const assetsView = $('assets-library-view');
        assetsView.classList.remove('fade-in');
        assetsView.style.display = 'flex';
        // Force reflow so the animation replays
        void assetsView.offsetWidth;
        assetsView.classList.add('fade-in');

        // After fade completes: hide canvas, remove absolute positioning
        const onFadeDone = () => {
            canvasContainer.style.display = 'none';
            assetsView.classList.remove('fade-in');
            assetsView.removeEventListener('animationend', onFadeDone);
        };
        assetsView.addEventListener('animationend', onFadeDone);

        const drawingToolbar = $('drawing-toolbar');
        const toolsSidebar = document.querySelector('.tools-sidebar');
        const sizeSlider = $('draw-size-slider-container');
        const opacitySlider = $('draw-opacity-slider-container');
        const drawingModeBtn = getElement('drawing-mode-btn');

        // Hide all drawing controls
        if (drawingToolbar) {
            drawingToolbar.style.display = 'none';
            drawingToolbar.classList.remove('visible');
        }
        if (toolsSidebar) toolsSidebar.style.display = 'none';
        if (sizeSlider) {
            sizeSlider.style.display = 'none';
            sizeSlider.classList.remove('visible');
        }
        if (opacitySlider) {
            opacitySlider.style.display = 'none';
            opacitySlider.classList.remove('visible');
        }

        // Disable all tools when switching to assets
        canvas.setDrawingMode(null);
        if (canvas.objectsManager) {
            canvas.objectsManager.setTool(null);
        }
        // Remove active state from all tool buttons
        const penBtn = document.querySelector('.draw-tool-option[data-tool="pen"]');
        const highlighterBtn = document.querySelector('.draw-tool-option[data-tool="highlighter"]');
        const eraserBtn = document.querySelector('.draw-tool-option[data-tool="eraser"]');
        const textToolBtn = getElement('text-tool-btn');
        const shapeToolBtn = getElement('shape-tool-btn');
        penBtn?.classList.remove('active');
        highlighterBtn?.classList.remove('active');
        eraserBtn?.classList.remove('active');
        textToolBtn?.classList.remove('active');
        shapeToolBtn?.classList.remove('active');
        drawingModeBtn?.classList.remove('active');

        // Hide sidebar completely in assets view
        const sidebar = $('sidebar');
        if (sidebar) sidebar.style.display = 'none';

        // Update breadcrumb to show Assets segment
        if (window.appInstance && window.appInstance._currentBoardName) {
            window.appInstance.updateBreadcrumb(`All Boards > ${window.appInstance._currentBoardName} > Assets`);
        }

        // Load assets into library view
        loadAssetsLibrary();
    }

    // Expose for use by breadcrumb/back navigation
    window.showCanvasView = showCanvasView;
    window.showAssetsView = showAssetsView;

    // Assets library toggle function
    window.toggleAssetsLibrary = function() {
        const assetsLibraryView = $('assets-library-view');
        const isLibraryVisible = assetsLibraryView.style.display === 'flex';

        if (isLibraryVisible) {
            showCanvasView();
        } else {
            showAssetsView();
        }
    };

    setupContextMenu();
    setupBoardDropdown();

    // Setup collapse button for layers sidebar
    const collapseLayersBtn = container.querySelector('#collapse-layers-btn');
    if (collapseLayersBtn) {
        // Clone to remove old event listeners
        const newCollapseBtn = collapseLayersBtn.cloneNode(true);
        collapseLayersBtn.parentNode.replaceChild(newCollapseBtn, collapseLayersBtn);

        newCollapseBtn.addEventListener('click', (e) => {
            const content = container.querySelector('#layers-content');
            const btn = e.currentTarget;
            if (content) {
                content.classList.toggle('collapsed');

                const isCollapsed = content.classList.contains('collapsed');
                btn.innerHTML = isCollapsed
                    ? '<img src="/assets/expand.svg" alt="Expand" class="collapse-icon" width="14" height="14"/>'
                    : '<img src="/assets/collapse.svg" alt="Collapse" class="collapse-icon" width="14" height="14"/>';
            }
        });
    }

    const assetsViewToggle = $('assets-view-toggle');
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

    canvas.canvas.addEventListener('imageDropped', (e) => {
        // Broadcast to floating windows so they add the image too
        if (syncChannel) {
            syncChannel.postMessage({
                type: 'image_added',
                image: e.detail
            });
        }
    });

    canvas.canvas.addEventListener('imageSelected', (e) => {
        highlightLayer(e.detail ? e.detail.id : null);
    });
    
    window.addEventListener('beforeunload', () => {
        if (pendingSave) {
            saveNow();
        }
    });

    // Remove old keyboard handler if it exists
    if (keyboardHandler) {
        document.removeEventListener('keydown', keyboardHandler);
    }

    // Create new keyboard handler
    keyboardHandler = (e) => {
        // Don't intercept keyboard events when typing in inputs, textareas, or contenteditable
        const isTyping = e.target.tagName === 'INPUT' ||
                         e.target.tagName === 'TEXTAREA' ||
                         e.target.isContentEditable ||
                         e.target.closest('.floating-toolbar') !== null;

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (historyManager.undo()) {
                renderLayers();
                scheduleSave();
                updateUndoRedoButtons();
            }
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            if (historyManager.redo()) {
                renderLayers();
                scheduleSave();
                updateUndoRedoButtons();
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
    };

    document.addEventListener('keydown', keyboardHandler);

    // Drawing toolbar event listeners
    setupDrawingToolbar();

    // Text tool button
    setupTextTool();
    setupShapeTool();
    setupColorExtractorTool();
    setupLayerContextMenu();
}

function setupDrawingToolbar() {
    // Procreate-style drawing controls
    let penBtn = getElement('draw-pen-btn');
    let highlighterBtn = getElement('draw-highlighter-btn');
    let eraserBtn = getElement('draw-eraser-btn');
    let colorPicker = getElement('draw-color-picker');
    let sizeSlider = getElement('draw-size-slider');
    let sizeInput = getElement('draw-size-input');
    let clearBtn = getElement('draw-clear-btn');
    const eraserModeToggle = getElement('eraser-mode-toggle');
    const toolCurrentBtn = getElement('draw-tool-current');
    const toolDropdown = getElement('draw-tool-dropdown');
    const sizeSliderContainer = getElement('draw-size-slider-container');
    const sizePreview = getElement('draw-size-preview');
    const drawingToolbar = getElement('drawing-toolbar');

    // Clone buttons and controls to remove old event listeners
    if (penBtn) {
        const newPenBtn = penBtn.cloneNode(true);
        penBtn.parentNode.replaceChild(newPenBtn, penBtn);
        penBtn = newPenBtn;
    }
    if (highlighterBtn) {
        const newHighlighterBtn = highlighterBtn.cloneNode(true);
        highlighterBtn.parentNode.replaceChild(newHighlighterBtn, highlighterBtn);
        highlighterBtn = newHighlighterBtn;
    }
    if (eraserBtn) {
        const newEraserBtn = eraserBtn.cloneNode(true);
        eraserBtn.parentNode.replaceChild(newEraserBtn, eraserBtn);
        eraserBtn = newEraserBtn;
    }
    if (colorPicker) {
        const newColorPicker = colorPicker.cloneNode(true);
        colorPicker.parentNode.replaceChild(newColorPicker, colorPicker);
        colorPicker = newColorPicker;
    }
    if (sizeSlider) {
        const newSizeSlider = sizeSlider.cloneNode(true);
        sizeSlider.parentNode.replaceChild(newSizeSlider, sizeSlider);
        sizeSlider = newSizeSlider;
    }
    if (sizeInput) {
        const newSizeInput = sizeInput.cloneNode(true);
        sizeInput.parentNode.replaceChild(newSizeInput, sizeInput);
        sizeInput = newSizeInput;
    }
    if (clearBtn) {
        const newClearBtn = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
        clearBtn = newClearBtn;
    }

    let currentTool = null;

    // SVG icons for each tool
    const toolIcons = {
        pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
        </svg>`,
        highlighter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l-6 6v3h9l3-3"/>
            <path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4"/>
        </svg>`,
        eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 20H7L3 16a1 1 0 010-1.4l9.9-9.9a1 1 0 011.4 0l5.3 5.3a1 1 0 010 1.4L11 20"/>
            <path d="M6 11l8 8"/>
        </svg>`
    };

    function updateSizeControls(size) {
        if (sizeInput) sizeInput.value = size;
        if (sizeSlider) {
            // Slider max is 800, clamp value to that
            sizeSlider.value = Math.min(size, 800);
        }
        updateSizePreview(size);
    }

    function updateSizePreview(size) {
        if (sizePreview) {
            const previewSize = Math.max(4, Math.min(36, size * 0.8));
            sizePreview.style.setProperty('--preview-size', previewSize + 'px');
            sizePreview.style.setProperty('--preview-color', colorPicker?.value || '#fff');
        }
    }

    function updateToolIcon(tool) {
        if (toolCurrentBtn && toolIcons[tool]) {
            toolCurrentBtn.innerHTML = toolIcons[tool];
        }
    }

    function setActiveTool(tool) {
        // Remove active class from all tool options
        penBtn?.classList.remove('active');
        highlighterBtn?.classList.remove('active');
        eraserBtn?.classList.remove('active');

        // Hide/show eraser mode toggle
        if (eraserModeToggle) {
            eraserModeToggle.style.display = tool === 'eraser' ? 'flex' : 'none';
        }

        // Set the drawing mode
        if (tool === currentTool) {
            // Toggle off if clicking the same tool
            currentTool = null;
            canvas.setDrawingMode(null);
            if (eraserModeToggle) eraserModeToggle.style.display = 'none';
        } else {
            currentTool = tool;
            canvas.setDrawingMode(tool);

            // Deactivate text and shape tools when activating a drawing tool
            const textToolBtn = getElement('text-tool-btn');
            const shapeToolBtn = getElement('shape-tool-btn');
            if (textToolBtn) textToolBtn.classList.remove('active');
            if (shapeToolBtn) shapeToolBtn.classList.remove('active');
            if (canvas.objectsManager) {
                canvas.objectsManager.setTool(null);
            }
            hidePropertiesPanel();

            // Add active class to the clicked button
            if (tool === 'pen') penBtn?.classList.add('active');
            else if (tool === 'highlighter') highlighterBtn?.classList.add('active');
            else if (tool === 'eraser') eraserBtn?.classList.add('active');

            // Update the current tool button icon
            updateToolIcon(tool);

            // Update size controls based on tool
            if (tool === 'pen') {
                updateSizeControls(canvas.penSize);
            } else if (tool === 'highlighter') {
                updateSizeControls(canvas.highlighterSize);
            } else if (tool === 'eraser') {
                updateSizeControls(canvas.eraserSize);
            }
        }

        // Close dropdown after selection
        if (toolDropdown) toolDropdown.classList.remove('show');
    }

    // Tool dropdown toggle
    if (toolCurrentBtn && toolDropdown) {
        toolCurrentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toolDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!toolDropdown.contains(e.target) && e.target !== toolCurrentBtn) {
                toolDropdown.classList.remove('show');
            }
        });
    }

    // Tool button click handlers
    penBtn?.addEventListener('click', () => setActiveTool('pen'));
    highlighterBtn?.addEventListener('click', () => setActiveTool('highlighter'));
    eraserBtn?.addEventListener('click', () => setActiveTool('eraser'));

    // Color picker - sync with canvas on init
    if (colorPicker) {
        // Set color picker to match canvas drawing color
        colorPicker.value = canvas.drawingColor || '#000000';

        colorPicker.addEventListener('input', (e) => {
            canvas.setDrawingColor(e.target.value);
        });
    }

    // Size slider handler
    sizeSlider?.addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        if (sizeInput) sizeInput.value = size;
        updateSizePreview(size);

        if (currentTool === 'pen') {
            canvas.setPenSize(size);
        } else if (currentTool === 'highlighter') {
            canvas.setHighlighterSize(size);
        } else if (currentTool === 'eraser') {
            canvas.setEraserSize(size);
        }
    });

    // Size input handler - uncapped for large boards
    sizeInput?.addEventListener('input', (e) => {
        let size = parseInt(e.target.value) || 1;
        size = Math.max(1, size); // No max cap - users can set any size

        // Sync slider (capped at 800)
        if (sizeSlider) {
            sizeSlider.value = Math.min(size, 800);
        }
        updateSizePreview(size);

        if (currentTool === 'pen') {
            canvas.setPenSize(size);
        } else if (currentTool === 'highlighter') {
            canvas.setHighlighterSize(size);
        } else if (currentTool === 'eraser') {
            canvas.setEraserSize(size);
        }
    });

    // Opacity slider handler
    const opacitySlider = getElement('draw-opacity-slider');
    const opacityLabel = document.querySelector('.draw-opacity-label');

    opacitySlider?.addEventListener('input', (e) => {
        const opacity = parseInt(e.target.value) / 100;
        canvas.drawingOpacity = opacity;
        if (opacityLabel) {
            opacityLabel.textContent = e.target.value + '%';
        }
    });

    // Eraser mode toggle
    eraserModeToggle?.querySelectorAll('.eraser-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;

            // Update active state
            eraserModeToggle.querySelectorAll('.eraser-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Set eraser mode
            canvas.setEraserMode(mode);
        });
    });

    // Clear all strokes button
    clearBtn?.addEventListener('click', () => {
        clearDrawingStrokes();
    });

    // Drawing mode button (in right tools sidebar)
    let drawingModeBtn = getElement('drawing-mode-btn');
    const opacitySliderContainer = getElement('draw-opacity-slider-container');

    // Clone to remove old event listeners
    if (drawingModeBtn) {
        const newDrawingModeBtn = drawingModeBtn.cloneNode(true);
        drawingModeBtn.parentNode.replaceChild(newDrawingModeBtn, drawingModeBtn);
        drawingModeBtn = newDrawingModeBtn;
    }

    if (drawingModeBtn) {
        function showDrawingControls() {
            if (drawingToolbar) drawingToolbar.classList.add('visible');
            if (sizeSliderContainer) sizeSliderContainer.classList.add('visible');
            if (opacitySliderContainer) opacitySliderContainer.classList.add('visible');
            drawingModeBtn.classList.add('active');
        }

        function hideDrawingControls() {
            if (drawingToolbar) drawingToolbar.classList.remove('visible');
            if (sizeSliderContainer) sizeSliderContainer.classList.remove('visible');
            if (opacitySliderContainer) opacitySliderContainer.classList.remove('visible');
            drawingModeBtn.classList.remove('active');
            if (toolDropdown) toolDropdown.classList.remove('show');
        }

        // Always start with toolbar hidden
        hideDrawingControls();
        canvas.setDrawingMode(null);

        drawingModeBtn.addEventListener('click', () => {
            const isVisible = drawingToolbar?.classList.contains('visible');

            if (isVisible) {
                // Hide toolbar and disable all drawing tools
                hideDrawingControls();

                // Disable current tool
                currentTool = null;
                canvas.setDrawingMode(null);
                penBtn?.classList.remove('active');
                highlighterBtn?.classList.remove('active');
                eraserBtn?.classList.remove('active');
                if (eraserModeToggle) eraserModeToggle.style.display = 'none';
            } else {
                // Show toolbar and enable pen tool by default
                showDrawingControls();
                setActiveTool('pen');
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

async function saveNow() {
    if (!pendingSave) return;
    pendingSave = false;
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }

    const images = canvas.getImages();
    const layers = images.map(img => {
        // Determine src: for video use videoSrc/filePath, for gif use gifSrc/filePath
        let src;
        if (img.mediaType === 'video') {
            src = img.filePath || img.videoSrc || img.videoElement?.src || '';
        } else if (img.mediaType === 'gif') {
            src = img.filePath || img.gifSrc || '';
        } else {
            src = img.filePath || img.img.src;
        }

        const layer = {
            id: img.id,
            name: img.name,
            src,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            visible: img.visible !== false,
            zIndex: img.zIndex || 0
        };

        // Media type
        if (img.mediaType && img.mediaType !== 'image') {
            layer.mediaType = img.mediaType;
        }

        // Video state
        if (img.mediaType === 'video') {
            layer.currentTime = img.videoElement?.currentTime || img.currentTime || 0;
            layer.volume = img.volume;
            layer.muted = img.muted;
        }

        // GIF state
        if (img.mediaType === 'gif') {
            layer.gifCurrentFrame = img.gifCurrentFrame;
            layer.gifPlaying = img.gifPlaying;
        }

        // Only include filter properties if they have non-default values
        if (img.rotation !== undefined && img.rotation !== 0) layer.rotation = img.rotation;
        if (img.brightness !== undefined && img.brightness !== 100) layer.brightness = img.brightness;
        if (img.contrast !== undefined && img.contrast !== 100) layer.contrast = img.contrast;
        if (img.saturation !== undefined && img.saturation !== 100) layer.saturation = img.saturation;
        if (img.hue !== undefined && img.hue !== 0) layer.hue = img.hue;
        if (img.blur !== undefined && img.blur !== 0) layer.blur = img.blur;
        if (img.opacity !== undefined && img.opacity !== 100) layer.opacity = img.opacity;
        if (img.grayscale === true) layer.grayscale = true;
        if (img.invert === true) layer.invert = true;
        if (img.mirror === true) layer.mirror = true;

        // Save crop data if image is cropped
        if (img.cropData) {
            layer.cropData = img.cropData;
            layer.originalSrc = img.originalSrc;
            layer.originalWidth = img.originalWidth;
            layer.originalHeight = img.originalHeight;
        }

        return layer;
    });
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
    await boardManager.updateBoard(currentBoardId, { layers, bgColor, viewState, strokes, objects, groups, thumbnail });
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

    // Eye icons for visibility
    const eyeOpen = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeClosed = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'layer-visibility-btn';
    visibilityBtn.type = 'button';
    if (img.visible === false) {
        visibilityBtn.classList.add('hidden');
        visibilityBtn.innerHTML = eyeClosed;
        visibilityBtn.title = 'Show layer';
    } else {
        visibilityBtn.innerHTML = eyeOpen;
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

    // Layer icon (image/video/gif icon)
    const layerIcon = document.createElement('img');
    layerIcon.className = 'layer-icon';
    if (img.mediaType === 'video') {
        layerIcon.src = '/assets/VideoIcon.svg';
    } else if (img.mediaType === 'gif') {
        layerIcon.src = '/assets/gif-svgrepo-com.svg';
    } else {
        layerIcon.src = '/assets/layericon.svg';
    }

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
                // Clear object selections when selecting an image
                canvas.objectsManager.selectedObjects = [];
                canvas.objectsManager.selectedObject = null;
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
        reorderLayerElementsVisually();
        allLayersOrder = [];
        lastDragOrderHash = null;
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
    layerItem.dataset.layerType = 'object';
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

    // Eye icons for visibility
    const eyeOpen = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeClosed = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'layer-visibility-btn';
    visibilityBtn.type = 'button';
    if (obj.visible === false) {
        visibilityBtn.classList.add('hidden');
        visibilityBtn.innerHTML = eyeClosed;
        visibilityBtn.title = 'Show layer';
    } else {
        visibilityBtn.innerHTML = eyeOpen;
        visibilityBtn.title = 'Hide layer';
    }
    visibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const oldVisible = obj.visible !== false;
        obj.visible = obj.visible === false ? true : false;
        canvas.needsRender = true;
        renderLayers();
        scheduleSave();
        if (historyManager) {
            historyManager.pushAction({
                type: 'object_visibility',
                data: { id: obj.id, oldVisible, newVisible: obj.visible }
            });
        }
    });

    // Layer icon based on type
    const layerIcon = document.createElement('img');
    layerIcon.className = 'layer-icon';
    if (obj.type === 'text') {
        layerIcon.src = '/assets/TextIcon.svg';
    } else if (obj.type === 'shape') {
        layerIcon.src = '/assets/ShapeIcon.svg';
    } else if (obj.type === 'colorPalette') {
        layerIcon.src = '/assets/ColorPalette.svg';
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
            if (e.ctrlKey || e.metaKey) {
                canvas.objectsManager.selectObject(obj, true);
            } else {
                // Clear both object and image selections first
                canvas.objectsManager.selectedObjects = [];
                canvas.objectsManager.selectedObject = null;
                canvas.selectImage(null);
                canvas.objectsManager.selectObject(obj, false);
            }
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
        reorderLayerElementsVisually();
        allLayersOrder = [];
        lastDragOrderHash = null;
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

    // Capture old zIndex values for undo
    const oldZIndexes = allLayersOrder.map(layer => ({
        type: layer.type,
        id: layer.data.id,
        zIndex: layer.data.zIndex || 0
    }));

    // Assign zIndex based on position in array (0 = back, higher = front)
    const zIndexUpdates = [];
    allLayersOrder.forEach((layer, index) => {
        layer.data.zIndex = index;
        zIndexUpdates.push({
            type: layer.type,
            id: layer.data.id,
            zIndex: index
        });
    });

    // Push to history if order actually changed
    const orderChanged = oldZIndexes.some((old, i) => old.zIndex !== zIndexUpdates[i].zIndex);
    if (orderChanged && historyManager) {
        historyManager.pushAction({
            type: 'reorder_layers',
            data: { oldOrder: oldZIndexes, newOrder: zIndexUpdates }
        });
    }

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
            ? '<img src="/assets/expand.svg" alt="Expand" class="group-toggle-icon" width="16" height="16"/>'
            : '<img src="/assets/collapse.svg" alt="Collapse" class="group-toggle-icon" width="16" height="16"/>';
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
    groupIcon.src = '/assets/foldericon.svg';

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

    // Eye icons for visibility
    const eyeOpenIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeClosedIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    // Check if group is currently hidden (all layers hidden)
    const checkGroupVisibility = () => {
        const imgs = canvas.getImages();
        const objs = canvas.objectsManager ? canvas.objectsManager.getObjects() : [];
        const grpImages = imgs.filter(img => group.layerIds.includes(img.id));
        const grpObjects = objs.filter(obj => group.objectIds && group.objectIds.includes(obj.id));
        const allItems = [...grpImages, ...grpObjects];
        return allItems.length > 0 && allItems.every(item => item.visible === false);
    };

    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'group-visibility-btn';
    visibilityBtn.type = 'button';
    const isGroupHidden = checkGroupVisibility();
    if (isGroupHidden) {
        visibilityBtn.classList.add('hidden');
        visibilityBtn.innerHTML = eyeClosedIcon;
        visibilityBtn.title = 'Show group';
    } else {
        visibilityBtn.innerHTML = eyeOpenIcon;
        visibilityBtn.title = 'Hide group';
    }
    visibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const imgs = canvas.getImages();
        const objs = canvas.objectsManager ? canvas.objectsManager.getObjects() : [];
        const grpImages = imgs.filter(img => group.layerIds.includes(img.id));
        const grpObjects = objs.filter(obj => group.objectIds && group.objectIds.includes(obj.id));
        const allItems = [...grpImages, ...grpObjects];
        const allHidden = allItems.length > 0 && allItems.every(item => item.visible === false);
        const newVisibility = allHidden ? true : false; // If all hidden, show them; otherwise hide them

        // Toggle visibility for all image layers in group
        grpImages.forEach(img => {
            img.visible = newVisibility;
        });

        // Toggle visibility for all object layers in group
        grpObjects.forEach(obj => {
            obj.visible = newVisibility;
        });

        canvas.invalidateCullCache();
        canvas.needsRender = true;
        canvas.render();
        renderLayers();
        scheduleSave();
    });

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

    groupControls.appendChild(visibilityBtn);
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

        // Edge detection: determine if hovering over top or bottom half
        const rect = groupHeader.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midpoint;

        // If dragging a layer and group is collapsed, allow inserting after
        if (draggedLayerType !== 'group' && group.collapsed) {

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
                        }
                    }
                }
            }
        } else if (draggedLayerType !== 'group' && !group.collapsed) {
            // If group is expanded, allow adding to group (no visual indicator needed)
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
                }
            }
        }
    });

    groupHeader.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if we were hovering to insert after (collapsed group)
        const wasInsertingBeforeAfter = group.collapsed && draggedLayerType !== 'group';

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
    const layerContextMenu = getElement('layer-context-menu');
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

    // Check if group is currently hidden (all layers hidden)
    const images = canvas.getImages();
    const objects = canvas.objectsManager ? canvas.objectsManager.getObjects() : [];
    const groupImages = images.filter(img => group.layerIds.includes(img.id));
    const groupObjects = objects.filter(obj => group.objectIds && group.objectIds.includes(obj.id));
    const allItems = [...groupImages, ...groupObjects];
    const allHidden = allItems.length > 0 && allItems.every(item => item.visible === false);

    const visibilityItem = document.createElement('div');
    visibilityItem.className = 'layer-context-menu-item';
    visibilityItem.textContent = allHidden ? 'Show Group' : 'Hide Group';
    visibilityItem.addEventListener('click', () => {
        menu.remove();
        const newVisibility = allHidden ? true : false; // If all hidden, show them; otherwise hide them

        // Toggle visibility for all image layers in group
        groupImages.forEach(img => {
            img.visible = newVisibility;
        });

        // Toggle visibility for all object layers in group
        groupObjects.forEach(obj => {
            obj.visible = newVisibility;
        });

        canvas.invalidateCullCache();
        canvas.needsRender = true;
        canvas.render();
        renderLayers();
        scheduleSave();
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
    menu.appendChild(visibilityItem);
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
        const layersList = getElement('layers-list');
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

        renderThrottle = null;
    });
}

const renderLayersThrottled = (() => {
    let timeout = null;
    return function() {
        if (timeout) return; // Skip if already scheduled
        timeout = setTimeout(() => {
            reorderLayerElementsVisually();
            timeout = null;
        }, 100); // 100ms throttle delay
    };
})();

function renderLayers() {
    const layersList = getElement('layers-list');
    if (!layersList) return;
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

    // Add a drop zone at the bottom for dropping below the last layer
    const bottomDropZone = document.createElement('div');
    bottomDropZone.className = 'bottom-drop-zone';
    bottomDropZone.style.cssText = 'height: 80px; width: 100%; min-height: 80px;';

    bottomDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedLayerId || allLayersOrder.length === 0) return;

        // Move dragged layer to the very beginning (back)
        const draggedIndex = allLayersOrder.findIndex(l =>
            (l.type === draggedLayerType && l.data.id === draggedLayerId)
        );

        if (draggedIndex !== -1) {
            const [draggedLayer] = allLayersOrder.splice(draggedIndex, 1);
            allLayersOrder.unshift(draggedLayer); // Add to beginning (back)
        }
    });

    layersList.appendChild(bottomDropZone);

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
    const assetsGrid = getElement('assets-grid');
    if (!assetsGrid) return;
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

    // Resolve file references for display
    const resolvedSrcs = await Promise.all(assets.map(a => boardManager.resolveImageSrc(a.src)));

    assets.forEach((asset, idx) => {
        const assetItem = document.createElement('div');
        assetItem.className = 'asset-item';
        const img = document.createElement('img');
        img.src = resolvedSrcs[idx];
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
            const resolvedAssetSrc = await boardManager.resolveImageSrc(asset.src);
            const nameLC = (asset.name || '').toLowerCase();
            const mediaType = asset.metadata?.mediaType
                || (/\.(mp4|mov|webm)$/i.test(nameLC) ? 'video' : null)
                || (/\.gif$/i.test(nameLC) ? 'gif' : null);

            const addToBoardIfNeeded = async () => {
                if (showAllAssets) {
                    const currentBoard = boardManager.currentBoard;
                    const boardAssets = currentBoard.assets || [];
                    const existsInBoard = boardAssets.some(a => a.name === asset.name && a.src === asset.src);
                    if (!existsInBoard) {
                        const updatedAssets = [...boardAssets, {
                            id: asset.id,
                            name: asset.name,
                            src: asset.src
                        }];
                        await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });
                    }
                }
            };

            if (mediaType === 'video') {
                const video = document.createElement('video');
                video.preload = 'auto';
                video.muted = true;
                video.onloadedmetadata = async () => {
                    const added = canvas.addVideo(video, 100, 100, asset.name);
                    if (asset.src && !asset.src.startsWith('data:')) added.filePath = asset.src;
                    renderLayers();
                    await addToBoardIfNeeded();
                };
                video.src = resolvedAssetSrc;
            } else if (mediaType === 'gif') {
                try {
                    const response = await fetch(resolvedAssetSrc);
                    const arrayBuffer = await response.arrayBuffer();
                    const added = canvas.addGif(arrayBuffer, 100, 100, asset.name, resolvedAssetSrc);
                    if (added && asset.src && !asset.src.startsWith('data:')) added.filePath = asset.src;
                    renderLayers();
                    await addToBoardIfNeeded();
                } catch (err) {
                    console.error('Failed to load GIF from assets:', err);
                }
            } else {
                const imgElement = new Image();
                imgElement.onload = async () => {
                    const added = canvas.addImage(imgElement, 100, 100, asset.name);
                    if (asset.src && !asset.src.startsWith('data:')) added.filePath = asset.src;
                    renderLayers();
                    await addToBoardIfNeeded();
                };
                imgElement.src = resolvedAssetSrc;
            }
        });
        
        assetsGrid.appendChild(assetItem);
    });
}

function setupContextMenu() {
    const contextMenu = getElement('canvas-context-menu');
    const canvasContainer = getElement('canvas-container');
    const deleteSelectedItem = getElement('context-delete-selected');
    const deselectAllItem = getElement('context-deselect-all');
    const cropImageItem = getElement('context-crop-image');
    const uncropImageItem = getElement('context-uncrop-image');
    const editImageItem = getElement('context-edit-image');
    const extractColorsItem = getElement('context-extract-colors');
    const separator = getElement('context-separator');

    let contextMenuMousePos = { x: 0, y: 0 };

    let contextMenuJustOpened = false;

    canvasContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // Store mouse position in world coordinates
        const rect = canvas.canvas.getBoundingClientRect();
        const worldPos = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        contextMenuMousePos = worldPos;

        // Show/hide multi-select options based on selection state
        const hasSelection = canvas.selectedImages.length > 0;
        const hasImageClick = canvas.contextMenuImage !== null && canvas.contextMenuImage !== undefined;
        const hasImageCrop = hasImageClick && canvas.contextMenuImage.cropData;

        deleteSelectedItem.style.display = hasSelection ? 'block' : 'none';
        deselectAllItem.style.display = hasSelection ? 'block' : 'none';
        cropImageItem.style.display = hasImageClick ? 'block' : 'none';
        uncropImageItem.style.display = hasImageCrop ? 'block' : 'none';
        editImageItem.style.display = hasImageClick ? 'block' : 'none';
        extractColorsItem.style.display = hasImageClick ? 'block' : 'none';
        separator.style.display = (hasSelection || hasImageClick) ? 'block' : 'none';

        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.classList.add('show');

        // Prevent click event from immediately closing the menu on macOS
        contextMenuJustOpened = true;
        setTimeout(() => {
            contextMenuJustOpened = false;
        }, 100);
    });

    document.addEventListener('click', (e) => {
        // Don't close if menu was just opened (macOS ctrl+click issue)
        if (contextMenuJustOpened) return;

        // Don't close if clicking inside the context menu itself
        if (!contextMenu.contains(e.target)) {
            contextMenu.classList.remove('show');
        }
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

    cropImageItem.addEventListener('click', () => {
        if (canvas.contextMenuImage) {
            canvas.enableCropMode(canvas.contextMenuImage);
        }
        contextMenu.classList.remove('show');
    });

    uncropImageItem.addEventListener('click', () => {
        if (canvas.contextMenuImage) {
            canvas.uncropImage(canvas.contextMenuImage);
            renderLayers();
            scheduleSave();
        }
        contextMenu.classList.remove('show');
    });

    extractColorsItem.addEventListener('click', async () => {
        if (canvas.contextMenuImage && canvas.contextMenuImage.img) {
            try {
                // Extract colors from the image
                const colors = await extractColorsFromImage(canvas.contextMenuImage.img);

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
                    sourceImage: canvas.contextMenuImage.img.src,
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
                if (historyManager) {
                    historyManager.pushAction({
                        type: 'add_object',
                        data: JSON.parse(JSON.stringify(paletteObject))
                    });
                }

                showToast(`Color palette created with ${numColors} color${numColors > 1 ? 's' : ''}`, 'success', 3000);
            } catch (err) {
                console.error('Failed to extract colors:', err);
                showToast('Failed to extract colors', 'error', 3000);
            }
        }
        contextMenu.classList.remove('show');
    });

    editImageItem.addEventListener('click', () => {
        if (canvas.contextMenuImage) {
            showImageEditPanel(canvas.contextMenuImage);
        }
        contextMenu.classList.remove('show');
    });

    getElement('context-recenter').addEventListener('click', () => {
        canvas.resetView();
        contextMenu.classList.remove('show');
    });

    getElement('context-shortcuts').addEventListener('click', () => {
        contextMenu.classList.remove('show');
        showKeyboardShortcutsModal();
    });
}

let boardDropdownSetup = false;

function setupBoardDropdown() {
    console.log('[setupBoardDropdown] Setting up, activeContainer:', !!activeContainer);

    const dropdownBtn = getElement('board-dropdown-btn');
    const dropdownMenu = getElement('board-dropdown-menu');
    const boardName = getElement('board-name');

    console.log('[setupBoardDropdown] Found elements:', {
        dropdownBtn: !!dropdownBtn,
        dropdownMenu: !!dropdownMenu,
        boardName: !!boardName
    });

    if (!dropdownBtn || !dropdownMenu || !boardName) {
        console.error('[setupBoardDropdown] Missing elements - aborting');
        return;
    }

    // Remove old listeners by cloning elements (if already set up)
    if (boardDropdownSetup) {
        const newDropdownBtn = dropdownBtn.cloneNode(true);
        dropdownBtn.parentNode.replaceChild(newDropdownBtn, dropdownBtn);
        const newBoardName = boardName.cloneNode(true);
        boardName.parentNode.replaceChild(newBoardName, boardName);

        // Update references
        const updatedBtn = getElement('board-dropdown-btn');
        const updatedName = getElement('board-name');

        if (!updatedBtn || !updatedName) return;
    }

    const toggleDropdown = (e) => {
        e.stopPropagation();
        console.log('[toggleDropdown] Toggling dropdown, currently has show:', dropdownMenu.classList.contains('show'));
        dropdownMenu.classList.toggle('show');
    };

    const currentBtn = getElement('board-dropdown-btn');
    const currentName = getElement('board-name');

    if (currentBtn) currentBtn.addEventListener('click', toggleDropdown);
    if (currentName) currentName.addEventListener('click', toggleDropdown);
    console.log('[setupBoardDropdown] Event listeners attached');

    boardDropdownSetup = true;

    document.addEventListener('click', () => {
        dropdownMenu.classList.remove('show');
    });

    // Clone menu items to remove old event listeners
    let renameItem = getElement('dropdown-rename');
    let exportItem = getElement('dropdown-export');
    let importItem = getElement('dropdown-import');

    if (renameItem) {
        const newRenameItem = renameItem.cloneNode(true);
        renameItem.parentNode.replaceChild(newRenameItem, renameItem);
        renameItem = newRenameItem;

        renameItem.addEventListener('click', async () => {
            dropdownMenu.classList.remove('show');
            const currentName = getElement('board-name').textContent;
            const newName = await showInputModal('Rename Board', 'Enter a new name for this board:', currentName, 'Board name');
            if (newName && newName !== currentName) {
                await boardManager.updateBoard(currentBoardId, { name: newName });
                getElement('board-name').textContent = newName;
                // Update home page board cards
                if (window.renderBoards) {
                    await boardManager.loadBoards();
                    window.renderBoards();
                }
                showToast('Board renamed successfully', 'success');
            }
        });
    }

    if (exportItem) {
        const newExportItem = exportItem.cloneNode(true);
        exportItem.parentNode.replaceChild(newExportItem, exportItem);
        exportItem = newExportItem;

        exportItem.addEventListener('click', () => {
            dropdownMenu.classList.remove('show');
            exportBoard();
        });
    }

    if (importItem) {
        const newImportItem = importItem.cloneNode(true);
        importItem.parentNode.replaceChild(newImportItem, importItem);
        importItem = newImportItem;

        importItem.addEventListener('click', () => {
            dropdownMenu.classList.remove('show');
            importBoard();
        });
    }

    let exportLinesItem = getElement('dropdown-export-lines');
    console.log('[setupBoardDropdown] exportLinesItem:', exportLinesItem);
    if (exportLinesItem) {
        const newExportLinesItem = exportLinesItem.cloneNode(true);
        exportLinesItem.parentNode.replaceChild(newExportLinesItem, exportLinesItem);
        exportLinesItem = newExportLinesItem;

        exportLinesItem.addEventListener('click', () => {
            console.log('[Export Lines] clicked');
            dropdownMenu.classList.remove('show');
            exportLines();
        });
    }
}

function importAssets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;

    input.onchange = (e) => {
        const files = Array.from(e.target.files);
        const assetsGrid = getElement('assets-grid');

        // Remove empty message if it exists
        const emptyMessage = assetsGrid.querySelector('.empty-message');
        if (emptyMessage) {
            emptyMessage.remove();
        }

        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const dataUrl = event.target.result;
                const board = boardManager.currentBoard;
                const currentAssets = board.assets || [];

                const existsInBoard = currentAssets.some(a => a.name === file.name);
                if (!existsInBoard) {
                    // Save image file to disk if possible
                    const filePath = await boardManager.saveImageFile(dataUrl, file.name);
                    const srcForStorage = filePath || dataUrl;

                    const newAsset = {
                        id: Date.now() + Math.random(),
                        src: srcForStorage,
                        name: file.name
                    };
                    const updatedAssets = [...currentAssets, newAsset];

                    // Update backend
                    await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });
                    const allAsset = await boardManager.addToAllAssets(file.name, srcForStorage);

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
async function appendAssetToDOM(asset, container) {
    const assetItem = document.createElement('div');
    assetItem.className = 'asset-item';
    assetItem.style.opacity = '0';
    assetItem.style.transform = 'scale(0.8)';

    const img = document.createElement('img');
    img.src = await boardManager.resolveImageSrc(asset.src);
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
        const resolvedAssetSrc = await boardManager.resolveImageSrc(asset.src);
        const imgElement = new Image();
        imgElement.onload = async () => {
            const added = canvas.addImage(imgElement, 100, 100, asset.name);
            if (asset.src && !asset.src.startsWith('data:')) added.filePath = asset.src;
            renderLayers();

            if (showAllAssets) {
                const board = boardManager.currentBoard;
                const boardAssets = board.assets || [];
                const existsInBoard = boardAssets.some(a => a.name === asset.name && a.src === asset.src);
                if (!existsInBoard) {
                    const updatedAssets = [...boardAssets, {
                        id: asset.id,
                        name: asset.name,
                        src: asset.src
                    }];
                    await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });
                }
            }
        };
        imgElement.src = resolvedAssetSrc;
    });

    container.appendChild(assetItem);

    // Animate in
    requestAnimationFrame(() => {
        assetItem.style.transition = 'opacity 0.2s, transform 0.2s';
        assetItem.style.opacity = '1';
        assetItem.style.transform = 'scale(1)';
    });
}

// Build board assets from canvas images (used on initial load)
async function buildBoardAssetsFromCanvas() {
    const board = boardManager.currentBoard;
    if (!board) return;

    // Get all assets from "All Assets"
    const allAssets = await boardManager.getAllAssets();
    const allAssetsMap = new Map(allAssets.map(a => [a.src, a]));

    // Build board assets from canvas images
    const boardAssets = canvas.images.map(img => {
        // Determine src based on media type
        let src;
        if (img.mediaType === 'video') {
            src = img.filePath || img.videoSrc || img.videoElement?.src || '';
        } else if (img.mediaType === 'gif') {
            src = img.filePath || img.gifSrc || '';
        } else {
            src = img.filePath || img.img.src;
        }

        // Try to find in all assets first
        const existing = allAssetsMap.get(src);
        if (existing) {
            return {
                id: existing.id,
                name: img.name,
                src
            };
        }
        // Create new asset entry
        return {
            id: Date.now() + Math.random(),
            name: img.name,
            src
        };
    });

    // Update board with these assets
    board.assets = boardAssets;
    await boardManager.updateBoard(currentBoardId, { assets: boardAssets });
}

// Sync board assets with actual canvas images
async function syncBoardAssetsWithCanvas() {
    const board = boardManager.currentBoard;
    if (!board) return;

    // Get all image sources currently on the canvas (use filePath for file-backed images)
    const canvasImageSources = new Set(canvas.images.map(img => img.filePath || img.img.src));

    // Filter board assets to only include those that exist on the canvas
    const syncedAssets = (board.assets || []).filter(asset => canvasImageSources.has(asset.src));

    // Only update if there's a difference
    if (syncedAssets.length !== (board.assets || []).length) {
        board.assets = syncedAssets;
        await boardManager.updateBoard(currentBoardId, { assets: syncedAssets });

        // Refresh the assets library if we're showing board assets
        if (!showAllAssets) {
            renderAssets();
        }
    }
}

// Update tag filter pills with available tags from all assets
function updateTagFilterPills(assets) {
    const filterBar = getElement('assets-tag-filter-bar');
    const pillsContainer = getElement('assets-tag-filter-pills');
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
            const searchBar = getElement('assets-search-bar');
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
    const libraryGrid = getElement('assets-library-grid');
    if (!libraryGrid) return;
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

    // Create masonry columns
    const COLUMN_WIDTH = 220;
    const GAP = 12;
    const containerWidth = libraryGrid.clientWidth || 800;
    const numColumns = Math.max(1, Math.floor((containerWidth + GAP) / (COLUMN_WIDTH + GAP)));

    // Show skeleton placeholders while loading
    const skeletonHeights = [180, 240, 160, 200, 260, 190, 220, 150];
    const columns = [];
    for (let i = 0; i < numColumns; i++) {
        const col = document.createElement('div');
        col.className = 'masonry-column';
        libraryGrid.appendChild(col);
        columns.push({ el: col, height: 0 });
    }

    // Add skeleton cards
    const skeletonCount = Math.min(assets.length, numColumns * 3);
    for (let i = 0; i < skeletonCount; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'assets-library-item skeleton';
        const skeletonImg = document.createElement('div');
        skeletonImg.className = 'skeleton-img';
        skeletonImg.style.height = skeletonHeights[i % skeletonHeights.length] + 'px';
        skeleton.appendChild(skeletonImg);
        const col = columns[i % numColumns];
        col.el.appendChild(skeleton);
    }

    // Load actual assets and replace skeletons
    const columnHeights = new Array(numColumns).fill(0);

    // Remove skeletons once first real item is ready
    let skeletonsCleared = false;
    const clearSkeletons = () => {
        if (skeletonsCleared) return;
        skeletonsCleared = true;
        columns.forEach(col => {
            col.el.querySelectorAll('.skeleton').forEach(s => s.remove());
        });
    };

    for (const asset of assets) {
        // Find shortest column
        let shortestIdx = 0;
        for (let i = 1; i < numColumns; i++) {
            if (columnHeights[i] < columnHeights[shortestIdx]) shortestIdx = i;
        }

        const item = await appendAssetToLibrary(asset, columns[shortestIdx].el, showAll);
        if (item) {
            clearSkeletons();
            // Estimate height from natural image dimensions or use a default
            const imgEl = item.querySelector('img');
            if (imgEl && imgEl.naturalHeight) {
                const aspectRatio = imgEl.naturalHeight / imgEl.naturalWidth;
                columnHeights[shortestIdx] += (COLUMN_WIDTH * aspectRatio) + GAP;
            } else {
                columnHeights[shortestIdx] += 200 + GAP;
            }
        }
    }
    clearSkeletons();
}

async function appendAssetToLibrary(asset, container, isAllAssets) {
    const assetItem = document.createElement('div');
    assetItem.className = 'assets-library-item';

    // Detect media type from metadata or file extension
    const nameLC = (asset.name || '').toLowerCase();
    const isVideo = asset.metadata?.mediaType === 'video' || /\.(mp4|mov|webm)$/i.test(nameLC);
    const isGif = asset.metadata?.mediaType === 'gif' || /\.gif$/i.test(nameLC);

    const resolvedSrc = await boardManager.resolveImageSrc(asset.src);

    const img = document.createElement('img');
    if (isVideo && asset.metadata?.thumbnailSrc) {
        img.src = asset.metadata.thumbnailSrc;
    } else if (isGif) {
        // Show static first frame only (playback in asset details sidebar)
        const tmpImg = new Image();
        tmpImg.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = tmpImg.naturalWidth;
                c.height = tmpImg.naturalHeight;
                c.getContext('2d').drawImage(tmpImg, 0, 0);
                img.src = c.toDataURL();
            } catch (e) {
                img.src = resolvedSrc;
            }
        };
        tmpImg.onerror = () => { img.src = resolvedSrc; };
        tmpImg.src = resolvedSrc;
    } else {
        img.src = resolvedSrc;
    }
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
    if (isVideo) {
        const playBadge = document.createElement('div');
        playBadge.className = 'asset-play-badge';
        playBadge.innerHTML = '&#9654;';
        assetItem.appendChild(playBadge);
    } else if (isGif) {
        const gifBadge = document.createElement('div');
        gifBadge.className = 'asset-gif-badge';
        gifBadge.textContent = 'GIF';
        assetItem.appendChild(gifBadge);
    }
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
    return assetItem;
}

function importAssetsToLibrary() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/mp4,video/quicktime,.mp4,.mov,.gif';
    input.multiple = true;

    input.onchange = async (e) => {
        const files = Array.from(e.target.files);

        // Process files sequentially to avoid race conditions with board asset list
        for (const file of files) {
            const isVideo = file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name);
            const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);

            try {
                // Re-read board each iteration to avoid stale asset lists
                const board = boardManager.currentBoard;
                const currentAssets = board.assets || [];
                if (currentAssets.some(a => a.name === file.name)) continue;

                // Read file as dataURL
                const dataUrl = await readFileAsDataURL(file);
                const filePath = await boardManager.saveImageFile(dataUrl, file.name);
                const srcForStorage = filePath || dataUrl;

                const metadata = { created: Date.now() };
                if (isVideo) {
                    metadata.mediaType = 'video';
                    try {
                        const blobUrl = URL.createObjectURL(file);
                        const thumbUrl = await generateVideoThumbnail(blobUrl);
                        URL.revokeObjectURL(blobUrl);
                        if (thumbUrl) metadata.thumbnailSrc = thumbUrl;
                    } catch (err) { console.warn('Failed to generate video thumbnail:', err); }
                } else if (isGif) {
                    metadata.mediaType = 'gif';
                }

                const newAsset = {
                    id: Date.now() + Math.random(),
                    src: srcForStorage,
                    name: file.name,
                    tags: [],
                    metadata
                };

                // Re-read fresh board assets before writing to avoid overwrite
                const freshBoard = boardManager.currentBoard;
                const freshAssets = freshBoard.assets || [];
                const updatedAssets = [...freshAssets, newAsset];
                await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });

                let allAssets = await boardManager.getAllAssets();
                const existsInAll = allAssets.some(a => a.name === file.name && a.src === srcForStorage);
                if (!existsInAll) {
                    if (window.__TAURI__) {
                        await boardManager.invoke('add_to_all_assets', { name: file.name, src: srcForStorage, tags: [], metadata });
                    } else {
                        allAssets.push(newAsset);
                        localStorage.setItem(boardManager.ALL_ASSETS_KEY, JSON.stringify(allAssets));
                    }
                }
            } catch (err) {
                console.error('Failed to import asset:', file.name, err);
            }
        }

        loadAssetsLibrary();
    };

    input.click();
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
    });
}

function generateVideoThumbnail(videoSrc) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        let resolved = false;
        const finish = (result) => {
            if (resolved) return;
            resolved = true;
            video.removeAttribute('src');
            video.load(); // Release video decoder
            resolve(result);
        };
        video.onloadeddata = () => {
            video.currentTime = 0.1;
        };
        video.onseeked = () => {
            try {
                const c = document.createElement('canvas');
                c.width = Math.min(video.videoWidth, 400);
                c.height = Math.round(c.width * (video.videoHeight / video.videoWidth));
                c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
                finish(c.toDataURL('image/jpeg', 0.7));
            } catch (e) { finish(null); }
        };
        video.onerror = () => finish(null);
        setTimeout(() => finish(null), 5000);
        video.src = videoSrc;
    });
}

// Asset Sidebar Functions
let currentAssetInSidebar = null;
let currentAssetIsAllAssets = false;

function setupAssetSidebar() {
    const sidebar = getElement('asset-sidebar');
    let closeBtn = getElement('asset-sidebar-close');
    let addToCanvasBtn = getElement('asset-sidebar-add-to-canvas');
    let deleteBtn = getElement('asset-sidebar-delete');
    const tagInput = getElement('asset-tag-input');
    let addTagBtn = getElement('asset-tag-add-btn');
    const nameInput = getElement('asset-sidebar-name');

    // Clone buttons to remove old event listeners
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        closeBtn = newCloseBtn;
    }

    if (addToCanvasBtn) {
        const newAddToCanvasBtn = addToCanvasBtn.cloneNode(true);
        addToCanvasBtn.parentNode.replaceChild(newAddToCanvasBtn, addToCanvasBtn);
        addToCanvasBtn = newAddToCanvasBtn;
    }

    if (deleteBtn) {
        const newDeleteBtn = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        deleteBtn = newDeleteBtn;
    }

    if (addTagBtn) {
        const newAddTagBtn = addTagBtn.cloneNode(true);
        addTagBtn.parentNode.replaceChild(newAddTagBtn, addTagBtn);
        addTagBtn = newAddTagBtn;
    }

    // Close sidebar
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
            currentAssetInSidebar = null;
        });
    }

    // Add to canvas
    if (addToCanvasBtn) {
        addToCanvasBtn.addEventListener('click', async () => {
            if (!currentAssetInSidebar) return;

            const nameLC = (currentAssetInSidebar.name || '').toLowerCase();
            const assetMediaType = currentAssetInSidebar.metadata?.mediaType
                || (/\.(mp4|mov|webm)$/i.test(nameLC) ? 'video' : null)
                || (/\.gif$/i.test(nameLC) ? 'gif' : null);
            const resolvedSrc = await boardManager.resolveImageSrc(currentAssetInSidebar.src);

            const addToBoardIfNeeded = async () => {
                if (currentAssetIsAllAssets) {
                    const board = boardManager.currentBoard;
                    const boardAssets = board.assets || [];
                    const existsInBoard = boardAssets.some(a => a.name === currentAssetInSidebar.name && a.src === currentAssetInSidebar.src);
                    if (!existsInBoard) {
                        const updatedAssets = [...boardAssets, {
                            id: currentAssetInSidebar.id,
                            name: currentAssetInSidebar.name,
                            src: currentAssetInSidebar.src,
                            tags: currentAssetInSidebar.tags || [],
                            metadata: currentAssetInSidebar.metadata || {}
                        }];
                        await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });
                    }
                }
                sidebar.classList.remove('open');
                currentAssetInSidebar = null;
            };

            if (assetMediaType === 'video') {
                const video = document.createElement('video');
                video.preload = 'auto';
                video.muted = true;
                video.onloadedmetadata = async () => {
                    canvas.addVideo(video, 100, 100, currentAssetInSidebar.name);
                    renderLayers();
                    await addToBoardIfNeeded();
                };
                video.src = resolvedSrc;
            } else if (assetMediaType === 'gif') {
                try {
                    const response = await fetch(resolvedSrc);
                    const arrayBuffer = await response.arrayBuffer();
                    canvas.addGif(arrayBuffer, 100, 100, currentAssetInSidebar.name, resolvedSrc);
                    renderLayers();
                    await addToBoardIfNeeded();
                } catch (err) {
                    console.error('Failed to load GIF:', err);
                }
            } else {
                const imgElement = new Image();
                imgElement.onload = async () => {
                    canvas.addImage(imgElement, 100, 100, currentAssetInSidebar.name);
                    renderLayers();
                    await addToBoardIfNeeded();
                };
                imgElement.src = resolvedSrc;
            }
        });
    }

    // Delete asset
    if (deleteBtn) {
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
    }

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

    if (addTagBtn) {
        addTagBtn.addEventListener('click', addTag);
    }

    if (tagInput) {
        tagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
            }
        });
    }

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!activeContainer) return;
        const dropdownContainer = getElement('asset-tag-presets-dropdown');
        const quickPresets = getElement('asset-tag-quick-presets');
        if (!dropdownContainer || !quickPresets) return;
        if (!tagInput.contains(e.target) &&
            !dropdownContainer.contains(e.target) &&
            !quickPresets.contains(e.target)) {
            hideTagPresets();
        }
    });

    // Save name on blur
    if (nameInput) {
        nameInput.addEventListener('blur', async () => {
            if (currentAssetInSidebar) {
                currentAssetInSidebar.name = nameInput.value;
                await saveAssetChanges();
            }
        });
    }
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

    const sidebar = getElement('asset-sidebar');
    const preview = getElement('asset-sidebar-preview');
    const nameInput = getElement('asset-sidebar-name');

    // Set preview — use video element for video assets
    const isVideoAsset = freshAsset.metadata?.mediaType === 'video';
    const previewParent = preview.parentNode;
    // Remove any previously inserted video preview
    const oldVideoPreview = previewParent.querySelector('.asset-sidebar-video-preview');
    if (oldVideoPreview) oldVideoPreview.remove();

    if (isVideoAsset) {
        preview.style.display = 'none';
        const videoPreview = document.createElement('video');
        videoPreview.className = 'asset-sidebar-preview asset-sidebar-video-preview';
        videoPreview.controls = true;
        videoPreview.muted = true;
        videoPreview.src = await boardManager.resolveImageSrc(freshAsset.src);
        previewParent.insertBefore(videoPreview, preview);
    } else {
        preview.style.display = '';
        preview.src = await boardManager.resolveImageSrc(freshAsset.src);
    }

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
    const tagsContainer = getElement('asset-sidebar-tags');
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
    const metadataContainer = getElement('asset-sidebar-metadata');

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
    const searchBar = getElement('assets-search-bar');
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
    const presetsContainer = getElement('asset-tag-presets-dropdown');
    presetsContainer.classList.remove('show');
}

let tagsExpanded = false;

async function renderQuickTagPresets() {
    const quickPresetsContainer = getElement('asset-tag-quick-presets');
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

async function exportLines() {
    console.log('[exportLines] Starting export...');
    const strokes = canvas.getStrokes() || [];
    console.log('[exportLines] Got strokes:', strokes.length);

    // Filter out eraser strokes - only export pen and highlighter
    const drawingStrokes = strokes.filter(s => s.tool === 'pen' || s.tool === 'highlighter');
    console.log('[exportLines] Drawing strokes (pen/highlighter):', drawingStrokes.length);

    if (drawingStrokes.length === 0) {
        showToast('No pen or highlighter lines to export', 'error');
        return;
    }

    // Calculate bounding box of all strokes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const stroke of drawingStrokes) {
        for (const point of stroke.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
    }

    const strokesWidth = maxX - minX;
    const strokesHeight = maxY - minY;
    console.log('[exportLines] Strokes bounding box:', { minX, minY, maxX, maxY, strokesWidth, strokesHeight });

    // Show modal to choose background type
    console.log('[exportLines] Showing modal...');
    const bgChoice = await showExportLinesModal();
    console.log('[exportLines] User chose:', bgChoice);
    if (!bgChoice) return; // User cancelled

    // Use screen resolution as target canvas size (with some margin)
    const maxCanvasWidth = Math.min(window.screen.width, 1920);
    const maxCanvasHeight = Math.min(window.screen.height, 1080);

    // Add padding around the strokes (10% of canvas size)
    const paddingX = maxCanvasWidth * 0.1;
    const paddingY = maxCanvasHeight * 0.1;
    const availableWidth = maxCanvasWidth - (paddingX * 2);
    const availableHeight = maxCanvasHeight - (paddingY * 2);

    // Calculate scale to fit strokes within available space
    const scaleX = strokesWidth > 0 ? availableWidth / strokesWidth : 1;
    const scaleY = strokesHeight > 0 ? availableHeight / strokesHeight : 1;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down if needed

    console.log('[exportLines] Canvas size:', maxCanvasWidth, 'x', maxCanvasHeight, 'scale:', scale);

    // Create export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = maxCanvasWidth;
    exportCanvas.height = maxCanvasHeight;
    const ctx = exportCanvas.getContext('2d');

    // Fill background if user chose board color
    if (bgChoice === 'board') {
        ctx.fillStyle = canvas.bgColor || '#1a1a2e';
        ctx.fillRect(0, 0, maxCanvasWidth, maxCanvasHeight);
    }
    // For transparent, we leave the canvas clear

    // Calculate offset to center the strokes
    const scaledWidth = strokesWidth * scale;
    const scaledHeight = strokesHeight * scale;
    const offsetX = (maxCanvasWidth - scaledWidth) / 2;
    const offsetY = (maxCanvasHeight - scaledHeight) / 2;

    // Apply transformations: translate to center, then scale, then offset for stroke positions
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-minX, -minY);

    // Draw all strokes
    for (const stroke of drawingStrokes) {
        drawStrokeToContext(ctx, stroke);
    }

    // Export as PNG
    const dataUrl = exportCanvas.toDataURL('image/png');
    const boardName = boardManager.currentBoard?.name || 'Untitled';
    const filename = `${boardName.replace(/[^a-z0-9]/gi, '_')}_lines.png`;

    // Try to use File System Access API
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'PNG Image',
                    accept: { 'image/png': ['.png'] }
                }]
            });

            // Convert data URL to blob
            const response = await fetch(dataUrl);
            const blob = await response.blob();

            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();

            showToast(`Lines exported as ${handle.name}`, 'success', 4000);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Export error:', err);
                showToast('Failed to export lines', 'error');
            }
        }
    } else {
        // Fallback download
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        a.click();

        showToast(`Lines exported as ${filename}`, 'success', 4000);
    }
}

function drawStrokeToContext(ctx, stroke) {
    if (!stroke || stroke.points.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'pen') {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
    } else if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
    }

    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

    // Draw smooth curves using quadratic curves
    for (let i = 1; i < stroke.points.length - 1; i++) {
        const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
    }

    // Draw the last point
    const lastPoint = stroke.points[stroke.points.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);
    ctx.stroke();

    ctx.restore();
}

function showExportLinesModal() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(4px);
        `;

        const bgColor = canvas.bgColor || '#1a1a2e';

        modal.innerHTML = `
            <div style="
                background: var(--bg-secondary, #2a2a3e);
                border-radius: 12px;
                padding: 24px;
                min-width: 300px;
                max-width: 340px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                border: 1px solid var(--border-color, #3a3a4e);
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary, #fff);">Export Lines</h3>
                    <button class="export-lines-close" style="
                        background: none;
                        border: none;
                        color: var(--text-secondary, #888);
                        font-size: 24px;
                        cursor: pointer;
                        padding: 0;
                        line-height: 1;
                        transition: color 0.2s;
                    ">&times;</button>
                </div>
                <p style="margin: 0 0 16px 0; font-size: 14px; color: var(--text-secondary, #888);">Choose background:</p>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <button class="export-lines-option" data-value="transparent" style="
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        padding: 12px 16px;
                        background: var(--bg-tertiary, #1a1a2e);
                        border: 1px solid var(--border-color, #3a3a4e);
                        border-radius: 8px;
                        color: var(--text-primary, #fff);
                        font-size: 14px;
                        cursor: pointer;
                        transition: all 0.2s;
                    ">
                        <span style="
                            width: 28px;
                            height: 28px;
                            background: repeating-conic-gradient(#606060 0% 25%, #404040 0% 50%) 50% / 8px 8px;
                            border-radius: 6px;
                            flex-shrink: 0;
                        "></span>
                        Transparent
                    </button>
                    <button class="export-lines-option" data-value="board" style="
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        padding: 12px 16px;
                        background: var(--bg-tertiary, #1a1a2e);
                        border: 1px solid var(--border-color, #3a3a4e);
                        border-radius: 8px;
                        color: var(--text-primary, #fff);
                        font-size: 14px;
                        cursor: pointer;
                        transition: all 0.2s;
                    ">
                        <span style="
                            width: 28px;
                            height: 28px;
                            background: ${bgColor};
                            border-radius: 6px;
                            flex-shrink: 0;
                            border: 1px solid rgba(255,255,255,0.1);
                        "></span>
                        Board Color
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add hover effects
        const buttons = modal.querySelectorAll('.export-lines-option');
        buttons.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'var(--bg-hover, #3a3a4e)';
                btn.style.borderColor = 'var(--accent-color, #6366f1)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'var(--bg-tertiary, #1a1a2e)';
                btn.style.borderColor = 'var(--border-color, #3a3a4e)';
            });
            btn.addEventListener('click', () => {
                modal.remove();
                resolve(btn.dataset.value);
            });
        });

        // Handle close button
        const closeBtn = modal.querySelector('.export-lines-close');
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = 'var(--text-primary, #fff)');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = 'var(--text-secondary, #888)');
        closeBtn.addEventListener('click', () => {
            modal.remove();
            resolve(null);
        });

        // Handle overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(null);
            }
        });
    });
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


// Property panel functions
function showPropertiesPanel(obj) {
    const propertiesPanel = getElement('object-properties');
    const defaultProperties = getElement('default-properties');

    if (!propertiesPanel) return;

    // Shape and text objects use floating toolbar, hide properties panel
    if (obj.type === 'shape' || obj.type === 'text') {
        if (defaultProperties) defaultProperties.style.display = 'block';
        propertiesPanel.style.display = 'none';
        return;
    }

    // Close button
    const closeBtn = getElement('close-properties-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            canvas.objectsManager.deselectAll();
        };
    }
}

function hidePropertiesPanel() {
    const propertiesPanel = getElement('object-properties');
    const defaultProperties = getElement('default-properties');

    if (propertiesPanel) propertiesPanel.style.display = 'none';
    if (defaultProperties) defaultProperties.style.display = 'block';

    // Remove event listeners
    removeShapePropertyListeners();
}

function showPaletteSidebar(paletteObj) {
    const section = getElement('palette-sidebar-section');
    const swatchesContainer = getElement('palette-swatches');
    if (!section || !swatchesContainer) return;

    section.style.display = 'block';
    swatchesContainer.innerHTML = '';

    const colors = paletteObj.colors || [];
    colors.forEach(color => {
        const hexColor = typeof color === 'string' ? color : color.hex;
        const swatch = document.createElement('div');
        swatch.className = 'palette-swatch';
        swatch.style.backgroundColor = hexColor;
        swatch.innerHTML = `
            <span class="palette-swatch-label">${hexColor.toUpperCase()}</span>
            <span class="palette-swatch-copied">Copied</span>
        `;
        swatch.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(hexColor.toUpperCase());
                const copied = swatch.querySelector('.palette-swatch-copied');
                copied.classList.add('show');
                setTimeout(() => copied.classList.remove('show'), 800);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });
        swatchesContainer.appendChild(swatch);
    });
}

function hidePaletteSidebar() {
    const section = getElement('palette-sidebar-section');
    if (section) section.style.display = 'none';
}

function showFloatingToolbar(obj) {
    const textToolbar = getElement('floating-text-toolbar');
    const shapeToolbar = getElement('floating-shape-toolbar');

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
    const textToolbar = getElement('floating-text-toolbar');
    const shapeToolbar = getElement('floating-shape-toolbar');

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
    const fontDropdownContainer = getElement('floating-font-dropdown-container');
    const fontSize = getElement('floating-font-size');
    const boldBtn = getElement('floating-text-bold');
    const italicBtn = getElement('floating-text-italic');
    const underlineBtn = getElement('floating-text-underline');
    const colorInput = getElement('floating-text-color');
    const alignLeft = getElement('floating-text-align-left');
    const alignCenter = getElement('floating-text-align-center');
    const alignRight = getElement('floating-text-align-right');

    // Prevent toolbar buttons from stealing focus/selection from the editor
    // This is crucial for applying formatting to selected text
    const toolbar = getElement('floating-text-toolbar');
    if (toolbar && !toolbar._selectionPreserveSetup) {
        toolbar.addEventListener('mousedown', (e) => {
            // For buttons, prevent default to keep selection in editor
            // For inputs (like font size), allow default so user can type
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                e.preventDefault();
            }
        });
        toolbar._selectionPreserveSetup = true;
    }

    // Get default style from object or create default
    const defaultStyle = obj.defaultStyle || canvas.objectsManager.getDefaultTextStyle();

    // Initialize or update floating font dropdown
    const instance = getEditorInstance(activeContainer);
    if (!instance.floatingFontDropdown && fontDropdownContainer) {
        instance.floatingFontDropdown = new FontDropdown(fontDropdownContainer, {
            initialValue: defaultStyle.fontFamily || "'Roboto', sans-serif",
            onChange: (value) => {
                applyFormatToSelection('fontFamily', value);
            }
        });
    } else if (instance.floatingFontDropdown) {
        instance.floatingFontDropdown.setValue(defaultStyle.fontFamily || "'Roboto', sans-serif", false);
    }

    // Set current values from default style
    fontSize.value = defaultStyle.fontSize || 32;
    colorInput.value = defaultStyle.color || '#000000';

    // Listen for selection style changes to update toolbar
    const handleSelectionStyleChange = (e) => {
        const style = e.detail;
        if (style) {
            // Update font size input
            if (style.fontSize) {
                fontSize.value = style.fontSize;
            }
            // Update color input
            if (style.color) {
                colorInput.value = style.color;
            }
            // Update bold button state
            boldBtn.classList.toggle('active', style.fontWeight === 'bold');
            // Update italic button state
            if (italicBtn) {
                italicBtn.classList.toggle('active', style.fontStyle === 'italic');
            }
            // Update underline button state
            if (underlineBtn) {
                underlineBtn.classList.toggle('active', style.textDecoration === 'underline');
            }
            // Update font dropdown
            const instance = getEditorInstance(activeContainer);
            if (instance.floatingFontDropdown && style.fontFamily) {
                instance.floatingFontDropdown.setValue(style.fontFamily, false);
            }
        }
    };

    // Remove previous listener if exists, add new one
    if (canvas.canvas._selectionStyleHandler) {
        canvas.canvas.removeEventListener('textSelectionStyleChanged', canvas.canvas._selectionStyleHandler);
    }
    canvas.canvas._selectionStyleHandler = handleSelectionStyleChange;
    canvas.canvas.addEventListener('textSelectionStyleChanged', handleSelectionStyleChange);

    // Update button states
    boldBtn.classList.toggle('active', defaultStyle.fontWeight === 'bold');
    if (italicBtn) italicBtn.classList.toggle('active', defaultStyle.fontStyle === 'italic');
    if (underlineBtn) underlineBtn.classList.toggle('active', defaultStyle.textDecoration === 'underline');

    // Update alignment buttons
    alignLeft.classList.toggle('active', obj.textAlign === 'left' || !obj.textAlign);
    alignCenter.classList.toggle('active', obj.textAlign === 'center');
    alignRight.classList.toggle('active', obj.textAlign === 'right');

    // Helper to apply formatting to selection in contenteditable
    function applyFormatToSelection(property, value) {
        const editor = document.querySelector('.rich-text-editor');
        if (!editor) {
            // Not editing - update default style AND apply to all existing text content
            // For toggle properties (bold, italic, underline), toggle instead of always applying
            let newValue = value;
            if (property === 'fontWeight') {
                // Toggle: if currently bold, set to normal; otherwise set to bold
                const currentValue = obj.defaultStyle?.fontWeight || 'normal';
                newValue = currentValue === 'bold' ? 'normal' : 'bold';
            } else if (property === 'fontStyle') {
                const currentValue = obj.defaultStyle?.fontStyle || 'normal';
                newValue = currentValue === 'italic' ? 'normal' : 'italic';
            } else if (property === 'textDecoration') {
                const currentValue = obj.defaultStyle?.textDecoration || 'none';
                newValue = currentValue === 'underline' ? 'none' : 'underline';
            }

            if (obj.defaultStyle) {
                obj.defaultStyle[property] = newValue;
            }
            // Also update all content spans with the new value
            if (obj.content && Array.isArray(obj.content)) {
                obj.content.forEach(span => {
                    if (span.style) {
                        span.style[property] = newValue;
                    }
                });
                canvas.needsRender = true;
                canvas.objectsManager.dispatchObjectsChanged();
            }
            return;
        }

        // Try to restore saved selection first (it may have been lost when clicking toolbar)
        if (canvas.objectsManager.restoreSelection) {
            canvas.objectsManager.restoreSelection();
        } else {
            editor.focus();
        }

        const selection = window.getSelection();
        const textObj = canvas.objectsManager.editingTextObject;

        // Check if there's an actual selection (not collapsed)
        const hasSelection = selection.rangeCount > 0 && !selection.isCollapsed;

        if (hasSelection) {
            // Apply to selection using execCommand or custom wrapping
            if (property === 'fontWeight') {
                document.execCommand('bold', false, null);
            } else if (property === 'fontStyle') {
                document.execCommand('italic', false, null);
            } else if (property === 'textDecoration' && value === 'underline') {
                document.execCommand('underline', false, null);
            } else if (property === 'color') {
                document.execCommand('foreColor', false, value);
            } else if (property === 'fontFamily') {
                document.execCommand('fontName', false, value);
            } else if (property === 'fontSize') {
                // execCommand fontSize is limited (1-7), so we wrap selection with span
                // Must scale by zoom since editor content is displayed at zoom scale
                const scaledSize = value * canvas.zoom;
                wrapSelectionWithStyle(selection, { fontSize: scaledSize + 'px' });
            }

            // Sync back to content model
            if (textObj) {
                textObj.content = canvas.objectsManager.htmlToContent(editor, textObj.defaultStyle || canvas.objectsManager.getDefaultTextStyle());
                canvas.needsRender = true;
            }

            // Save the selection again after formatting
            if (canvas.objectsManager.savedSelection !== undefined) {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    canvas.objectsManager.savedSelection = sel.getRangeAt(0).cloneRange();
                }
            }
        } else {
            // No selection - apply to all content
            if (textObj && textObj.content && Array.isArray(textObj.content)) {
                // For toggle properties, toggle instead of always applying
                let newValue = value;
                if (property === 'fontWeight') {
                    const currentValue = textObj.defaultStyle?.fontWeight || 'normal';
                    newValue = currentValue === 'bold' ? 'normal' : 'bold';
                } else if (property === 'fontStyle') {
                    const currentValue = textObj.defaultStyle?.fontStyle || 'normal';
                    newValue = currentValue === 'italic' ? 'normal' : 'italic';
                } else if (property === 'textDecoration') {
                    const currentValue = textObj.defaultStyle?.textDecoration || 'none';
                    newValue = currentValue === 'underline' ? 'none' : 'underline';
                }

                // Update default style
                if (textObj.defaultStyle) {
                    textObj.defaultStyle[property] = newValue;
                }
                // Update all content spans
                textObj.content.forEach(span => {
                    if (span.style) {
                        span.style[property] = newValue;
                    }
                });
                // Re-render the editor HTML with updated content
                const zoom = canvas.zoom;
                editor.innerHTML = canvas.objectsManager.contentToHTMLWithZoom(textObj.content, zoom, textObj.defaultStyle);
                canvas.needsRender = true;
            }
        }
    }

    // Helper to wrap selection with inline style
    function wrapSelectionWithStyle(selection, styles) {
        if (!selection.rangeCount || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        const span = document.createElement('span');

        for (const [key, value] of Object.entries(styles)) {
            span.style[key] = value;
        }

        try {
            range.surroundContents(span);
        } catch (e) {
            // If surroundContents fails (crosses element boundaries), use alternative
            const contents = range.extractContents();
            span.appendChild(contents);
            range.insertNode(span);
        }

        // Restore selection
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        selection.addRange(newRange);
    }

    // Event listeners for formatting buttons
    // Use onchange instead of oninput so user can finish typing the full number
    fontSize.onchange = () => {
        const size = parseInt(fontSize.value);
        if (!isNaN(size) && size > 0) {
            applyFormatToSelection('fontSize', size);
        }
    };
    // Also apply on Enter key
    fontSize.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const size = parseInt(fontSize.value);
            if (!isNaN(size) && size > 0) {
                applyFormatToSelection('fontSize', size);
            }
        }
    };

    boldBtn.onclick = () => {
        applyFormatToSelection('fontWeight', 'bold');
        boldBtn.classList.toggle('active');
    };

    if (italicBtn) {
        italicBtn.onclick = () => {
            applyFormatToSelection('fontStyle', 'italic');
            italicBtn.classList.toggle('active');
        };
    }

    if (underlineBtn) {
        underlineBtn.onclick = () => {
            applyFormatToSelection('textDecoration', 'underline');
            underlineBtn.classList.toggle('active');
        };
    }

    colorInput.oninput = () => applyFormatToSelection('color', colorInput.value);

    // Alignment applies to the whole text object (block-level)
    alignLeft.onclick = () => {
        canvas.objectsManager.updateSelectedObject({ textAlign: 'left' });
        // Also update editor if active
        const editor = document.querySelector('.rich-text-editor');
        if (editor) editor.style.textAlign = 'left';
        alignLeft.classList.add('active');
        alignCenter.classList.remove('active');
        alignRight.classList.remove('active');
    };
    alignCenter.onclick = () => {
        canvas.objectsManager.updateSelectedObject({ textAlign: 'center' });
        const editor = document.querySelector('.rich-text-editor');
        if (editor) editor.style.textAlign = 'center';
        alignLeft.classList.remove('active');
        alignCenter.classList.add('active');
        alignRight.classList.remove('active');
    };
    alignRight.onclick = () => {
        canvas.objectsManager.updateSelectedObject({ textAlign: 'right' });
        const editor = document.querySelector('.rich-text-editor');
        if (editor) editor.style.textAlign = 'right';
        alignLeft.classList.remove('active');
        alignCenter.classList.remove('active');
        alignRight.classList.add('active');
    };
}

function setupShapeFloatingToolbar(obj) {
    const shapeButtons = document.querySelectorAll('.shape-btn');
    const fillColor = getElement('floating-shape-fill');
    const strokeToggle = getElement('floating-shape-stroke-toggle');
    const strokeColor = getElement('floating-shape-stroke-color');
    const strokeWidth = getElement('floating-shape-stroke-width');
    const radiusToggle = getElement('floating-shape-radius-toggle');
    const cornerRadius = getElement('floating-shape-corner-radius');
    const radiusSeparator = getElement('corner-radius-separator');

    // Set current values
    fillColor.value = obj.fillColor || '#3b82f6';
    strokeColor.value = obj.strokeColor || '#000000';
    strokeWidth.value = obj.strokeWidth || 2;
    if (cornerRadius) {
        cornerRadius.value = obj.cornerRadius || 0;
    }

    // Update shape button states
    const currentShapeType = obj.shapeType || 'square';
    shapeButtons.forEach(btn => {
        if (btn.dataset.shape === currentShapeType) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Show/hide corner radius controls based on shape type
    const supportsCornerRadius = currentShapeType === 'square' || currentShapeType === 'rectangle';
    if (radiusToggle && radiusSeparator) {
        radiusToggle.style.display = supportsCornerRadius ? 'block' : 'none';
        radiusSeparator.style.display = supportsCornerRadius ? 'block' : 'none';
    }

    // Update radius toggle state and input visibility
    const hasRadius = obj.cornerRadius > 0;
    if (radiusToggle) {
        radiusToggle.classList.toggle('active', hasRadius);
    }
    if (cornerRadius) {
        cornerRadius.style.display = hasRadius ? 'block' : 'none';
    }

    // Update stroke toggle state
    strokeToggle.classList.toggle('active', obj.hasStroke !== false);

    // Event listeners for shape buttons
    shapeButtons.forEach(btn => {
        btn.onclick = () => {
            const newShapeType = btn.dataset.shape;
            canvas.objectsManager.updateSelectedObject({ shapeType: newShapeType });
            shapeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update corner radius visibility based on shape type
            const supportsRadius = newShapeType === 'square' || newShapeType === 'rectangle';
            if (radiusToggle && radiusSeparator) {
                radiusToggle.style.display = supportsRadius ? 'block' : 'none';
                radiusSeparator.style.display = supportsRadius ? 'block' : 'none';
            }
        };
    });

    fillColor.oninput = () => canvas.objectsManager.updateSelectedObject({ fillColor: fillColor.value });

    strokeToggle.onclick = () => {
        const newHasStroke = !obj.hasStroke;
        canvas.objectsManager.updateSelectedObject({ hasStroke: newHasStroke });
        strokeToggle.classList.toggle('active');
    };

    // Radius toggle button
    if (radiusToggle && cornerRadius) {
        radiusToggle.onclick = () => {
            const isActive = radiusToggle.classList.contains('active');
            if (isActive) {
                // Turning off - set radius to 0 and hide input
                canvas.objectsManager.updateSelectedObject({ cornerRadius: 0 });
                cornerRadius.value = 0;
                cornerRadius.style.display = 'none';
                radiusToggle.classList.remove('active');
            } else {
                // Turning on - set default radius and show input
                canvas.objectsManager.updateSelectedObject({ cornerRadius: 10 });
                cornerRadius.value = 10;
                cornerRadius.style.display = 'block';
                radiusToggle.classList.add('active');
            }
        };
    }

    strokeColor.oninput = () => canvas.objectsManager.updateSelectedObject({ strokeColor: strokeColor.value });
    strokeWidth.oninput = () => canvas.objectsManager.updateSelectedObject({ strokeWidth: parseInt(strokeWidth.value) });

    if (cornerRadius) {
        cornerRadius.oninput = () => canvas.objectsManager.updateSelectedObject({ cornerRadius: parseInt(cornerRadius.value) || 0 });
    }
}


function setupShapePropertyListeners() {
    const shapeType = getElement('shape-type');
    const shapeFillColor = getElement('shape-fill-color');
    const shapeHasStroke = getElement('shape-has-stroke');
    const shapeStrokeColor = getElement('shape-stroke-color');
    const shapeStrokeWidth = getElement('shape-stroke-width');

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

    const shapeCornerRadius = getElement('shape-corner-radius');
    if (shapeCornerRadius) {
        shapeCornerRadius.oninput = () => {
            canvas.objectsManager.updateSelectedObject({ cornerRadius: parseInt(shapeCornerRadius.value) || 0 });
        };
    }
}

function removeShapePropertyListeners() {
    // Event listeners are now managed per panel show, cleanup not strictly necessary
}

function setupTextPropertyListeners() {
    const textContent = getElement('text-content');
    const textFontSize = getElement('text-font-size');
    const fontDropdownContainer = getElement('font-dropdown-container');
    const textColor = getElement('text-color');
    const textFontWeight = getElement('text-font-weight');
    const textAlign = getElement('text-align');

    // Initialize sidebar font dropdown if not already done
    const instance = getEditorInstance(activeContainer);
    if (!instance.sidebarFontDropdown && fontDropdownContainer) {
        instance.sidebarFontDropdown = new FontDropdown(fontDropdownContainer, {
            initialValue: "'Roboto', sans-serif",
            onChange: (value) => {
                canvas.objectsManager.updateSelectedObject({ fontFamily: value });
            }
        });
    }

    textContent.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ text: textContent.value });
    };

    textFontSize.oninput = () => {
        canvas.objectsManager.updateSelectedObject({ fontSize: parseInt(textFontSize.value) });
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
    let textToolBtn = getElement('text-tool-btn');
    if (!textToolBtn) return;

    // Clone button to remove old event listeners
    const newTextToolBtn = textToolBtn.cloneNode(true);
    textToolBtn.parentNode.replaceChild(newTextToolBtn, textToolBtn);
    textToolBtn = newTextToolBtn;

    textToolBtn.addEventListener('click', () => {
        // Toggle text tool mode
        if (canvas.objectsManager.currentTool === 'text') {
            canvas.objectsManager.setTool(null);
            textToolBtn.classList.remove('active');
        } else {
            // Deactivate all other tools first
            const shapeToolBtn = getElement('shape-tool-btn');
            if (shapeToolBtn) {
                shapeToolBtn.classList.remove('active');
            }
            // Deactivate drawing tools
            canvas.setDrawingMode(null);
            const penBtn = document.querySelector('.draw-tool-option[data-tool="pen"]');
            const highlighterBtn = document.querySelector('.draw-tool-option[data-tool="highlighter"]');
            const eraserBtn = document.querySelector('.draw-tool-option[data-tool="eraser"]');
            penBtn?.classList.remove('active');
            highlighterBtn?.classList.remove('active');
            eraserBtn?.classList.remove('active');
            hidePropertiesPanel();

            canvas.objectsManager.setTool('text');
            textToolBtn.classList.add('active');
        }
    });
}

function setupShapeTool() {
    let shapeToolBtn = getElement('shape-tool-btn');
    if (!shapeToolBtn) return;

    // Clone button to remove old event listeners
    const newShapeToolBtn = shapeToolBtn.cloneNode(true);
    shapeToolBtn.parentNode.replaceChild(newShapeToolBtn, shapeToolBtn);
    shapeToolBtn = newShapeToolBtn;

    let shapeType = getElement('shape-type');
    let shapeFillColor = getElement('shape-fill-color');
    let shapeHasStroke = getElement('shape-has-stroke');
    let shapeStrokeColor = getElement('shape-stroke-color');
    let shapeStrokeWidth = getElement('shape-stroke-width');
    let shapeLineColor = getElement('shape-line-color');
    let shapeLineThickness = getElement('shape-line-thickness');
    const lineColorRow = getElement('shape-line-color-row');
    const lineThicknessRow = getElement('shape-line-thickness-row');
    const fillColorRow = shapeFillColor.closest('.property-row');
    const strokeToggleRow = shapeHasStroke.closest('.property-row').parentElement;
    const strokeColorRow = getElement('shape-stroke-color-row');
    const strokeWidthRow = getElement('shape-stroke-width-row');
    const cornerRadiusRow = getElement('shape-corner-radius-row');
    let shapeCornerRadius = getElement('shape-corner-radius');

    // Clone property controls to remove old event listeners
    if (shapeType) {
        const newShapeType = shapeType.cloneNode(true);
        shapeType.parentNode.replaceChild(newShapeType, shapeType);
        shapeType = newShapeType;
    }
    if (shapeFillColor) {
        const newShapeFillColor = shapeFillColor.cloneNode(true);
        shapeFillColor.parentNode.replaceChild(newShapeFillColor, shapeFillColor);
        shapeFillColor = newShapeFillColor;
    }
    if (shapeHasStroke) {
        const newShapeHasStroke = shapeHasStroke.cloneNode(true);
        shapeHasStroke.parentNode.replaceChild(newShapeHasStroke, shapeHasStroke);
        shapeHasStroke = newShapeHasStroke;
    }
    if (shapeStrokeColor) {
        const newShapeStrokeColor = shapeStrokeColor.cloneNode(true);
        shapeStrokeColor.parentNode.replaceChild(newShapeStrokeColor, shapeStrokeColor);
        shapeStrokeColor = newShapeStrokeColor;
    }
    if (shapeStrokeWidth) {
        const newShapeStrokeWidth = shapeStrokeWidth.cloneNode(true);
        shapeStrokeWidth.parentNode.replaceChild(newShapeStrokeWidth, shapeStrokeWidth);
        shapeStrokeWidth = newShapeStrokeWidth;
    }
    if (shapeLineColor) {
        const newShapeLineColor = shapeLineColor.cloneNode(true);
        shapeLineColor.parentNode.replaceChild(newShapeLineColor, shapeLineColor);
        shapeLineColor = newShapeLineColor;
    }
    if (shapeLineThickness) {
        const newShapeLineThickness = shapeLineThickness.cloneNode(true);
        shapeLineThickness.parentNode.replaceChild(newShapeLineThickness, shapeLineThickness);
        shapeLineThickness = newShapeLineThickness;
    }
    if (shapeCornerRadius) {
        const newShapeCornerRadius = shapeCornerRadius.cloneNode(true);
        shapeCornerRadius.parentNode.replaceChild(newShapeCornerRadius, shapeCornerRadius);
        shapeCornerRadius = newShapeCornerRadius;
    }

    // Show/hide properties based on shape type
    function updatePropertiesVisibility() {
        const type = shapeType.value;
        const isLineOrArrow = type === 'line' || type === 'arrow';
        const supportsCornerRadius = type === 'square' || type === 'rectangle' || type === 'triangle';

        // For lines/arrows: show line color and thickness, hide fill and stroke options
        lineColorRow.style.display = isLineOrArrow ? 'flex' : 'none';
        lineThicknessRow.style.display = isLineOrArrow ? 'flex' : 'none';
        fillColorRow.style.display = isLineOrArrow ? 'none' : 'flex';
        strokeToggleRow.style.display = isLineOrArrow ? 'none' : 'flex';
        strokeColorRow.style.display = isLineOrArrow ? 'none' : 'flex';
        strokeWidthRow.style.display = isLineOrArrow ? 'none' : 'flex';

        // Show corner radius for rectangle and triangle
        if (cornerRadiusRow) {
            cornerRadiusRow.style.display = supportsCornerRadius ? 'flex' : 'none';
        }
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
            strokeWidth: isLineOrArrow ? (parseInt(shapeLineThickness.value) || 5) : (parseInt(shapeStrokeWidth.value) || 2),
            cornerRadius: shapeCornerRadius ? (parseInt(shapeCornerRadius.value) || 0) : 0
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
    if (shapeCornerRadius) {
        shapeCornerRadius.addEventListener('input', updateShapeSettings);
    }

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
            // Deactivate all other tools first
            const textToolBtn = getElement('text-tool-btn');
            if (textToolBtn) {
                textToolBtn.classList.remove('active');
            }
            // Deactivate drawing tools
            canvas.setDrawingMode(null);
            const penBtn = document.querySelector('.draw-tool-option[data-tool="pen"]');
            const highlighterBtn = document.querySelector('.draw-tool-option[data-tool="highlighter"]');
            const eraserBtn = document.querySelector('.draw-tool-option[data-tool="eraser"]');
            penBtn?.classList.remove('active');
            highlighterBtn?.classList.remove('active');
            eraserBtn?.classList.remove('active');

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

    const contextMenu = getElement('layer-context-menu');
    if (!contextMenu) {
        console.error('Layer context menu element not found!');
        return;
    }

    currentContextLayer = layer;
    currentContextLayerType = type;

    // Show/hide ungroup button based on whether the layer is in a group
    const ungroupButton = getElement('layer-context-ungroup');
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

    const contextMenu = getElement('layer-context-menu');
    const renameItem = getElement('layer-context-rename');
    const ungroupItem = getElement('layer-context-ungroup');
    const duplicateItem = getElement('layer-context-duplicate');
    const deleteItem = getElement('layer-context-delete');

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
    let colorExtractorBtn = getElement('color-extractor-btn');
    if (!colorExtractorBtn) return;

    // Clone button to remove old event listeners
    const newColorExtractorBtn = colorExtractorBtn.cloneNode(true);
    colorExtractorBtn.parentNode.replaceChild(newColorExtractorBtn, colorExtractorBtn);
    colorExtractorBtn = newColorExtractorBtn;

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
        if (historyManager) {
            historyManager.pushAction({
                type: 'add_object',
                data: JSON.parse(JSON.stringify(paletteObject))
            });
        }

        showToast(`Color palette created with ${numColors} color${numColors > 1 ? 's' : ''}`, 'success', 3000);
    });

}

function showImageEditPanel(imageObj) {
    // Remove any existing edit panels
    const existingPanel = document.querySelector('.image-edit-panel');
    if (existingPanel) {
        existingPanel.remove();
    }

    // Store original values for cancel
    const originalValues = {
        brightness: imageObj.brightness || 100,
        contrast: imageObj.contrast || 100,
        saturation: imageObj.saturation || 100,
        hue: imageObj.hue || 0,
        blur: imageObj.blur || 0,
        opacity: imageObj.opacity !== undefined ? imageObj.opacity : 100,
        grayscale: imageObj.grayscale || false,
        invert: imageObj.invert || false,
        mirror: imageObj.mirror || false
    };

    const panel = document.createElement('div');
    panel.className = 'image-edit-panel';
    panel.innerHTML = `
        <div class="image-edit-panel-header">
            <span class="image-edit-panel-title">Edit Image</span>
            <button class="image-edit-panel-close">&times;</button>
        </div>
        <div class="image-edit-panel-body">
            <div class="edit-control">
                <label>Brightness <span class="edit-value" id="brightness-value">${originalValues.brightness}%</span></label>
                <input type="range" id="edit-brightness" min="0" max="200" value="${originalValues.brightness}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Contrast <span class="edit-value" id="contrast-value">${originalValues.contrast}%</span></label>
                <input type="range" id="edit-contrast" min="0" max="200" value="${originalValues.contrast}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Saturation <span class="edit-value" id="saturation-value">${originalValues.saturation}%</span></label>
                <input type="range" id="edit-saturation" min="0" max="200" value="${originalValues.saturation}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Hue <span class="edit-value" id="hue-value">${originalValues.hue}°</span></label>
                <input type="range" id="edit-hue" min="0" max="360" value="${originalValues.hue}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Blur <span class="edit-value" id="blur-value">${originalValues.blur}px</span></label>
                <input type="range" id="edit-blur" min="0" max="10" value="${originalValues.blur}" step="0.5" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Opacity <span class="edit-value" id="opacity-value">${originalValues.opacity}%</span></label>
                <input type="range" id="edit-opacity" min="0" max="100" value="${originalValues.opacity}" class="themed-slider">
            </div>
            <div class="edit-checkbox-row">
                <label><input type="checkbox" id="edit-grayscale" ${originalValues.grayscale ? 'checked' : ''}> Grayscale</label>
                <label><input type="checkbox" id="edit-invert" ${originalValues.invert ? 'checked' : ''}> Invert</label>
                <label><input type="checkbox" id="edit-mirror" ${originalValues.mirror ? 'checked' : ''}> Mirror</label>
            </div>
        </div>
        <div class="image-edit-panel-footer">
            <button class="edit-btn edit-btn-secondary" id="edit-reset">Reset</button>
            <button class="edit-btn edit-btn-secondary" id="edit-cancel">Cancel</button>
            <button class="edit-btn edit-btn-primary" id="edit-apply">Apply</button>
        </div>
    `;

    // Add panel styles if not already present
    if (!document.querySelector('#image-edit-panel-styles')) {
        const style = document.createElement('style');
        style.id = 'image-edit-panel-styles';
        style.textContent = `
            .image-edit-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 280px;
                background: var(--bg-primary, #ffffff);
                border: 1px solid var(--border-color, #e0e0e0);
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                user-select: none;
            }
            .image-edit-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid var(--border-color, #e0e0e0);
                cursor: move;
                background: var(--bg-secondary, #f5f5f5);
                border-radius: 8px 8px 0 0;
            }
            .image-edit-panel-title {
                font-weight: 600;
                font-size: 14px;
                color: var(--text-primary, #1a1a1a);
            }
            .image-edit-panel-close {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: var(--text-secondary, #666);
                padding: 0;
                line-height: 1;
            }
            .image-edit-panel-close:hover {
                color: var(--text-primary, #1a1a1a);
            }
            .image-edit-panel-body {
                padding: 16px;
            }
            .edit-control {
                margin-bottom: 14px;
            }
            .edit-control label {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                font-weight: 500;
                margin-bottom: 6px;
                color: var(--text-primary, #1a1a1a);
            }
            .edit-value {
                color: var(--text-secondary, #666);
                font-weight: 400;
            }
            .edit-control input[type="range"] {
                width: 100%;
            }
            .edit-checkbox-row {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                padding-top: 8px;
                border-top: 1px solid var(--border-color, #e0e0e0);
            }
            .edit-checkbox-row label {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: var(--text-primary, #1a1a1a);
                cursor: pointer;
                padding: 6px 10px;
                border-radius: 6px;
                background: var(--bg-secondary, #f5f5f5);
                border: 1px solid var(--border-color, #e0e0e0);
                transition: all 0.15s ease;
            }
            .edit-checkbox-row label:hover {
                background: var(--bg-hover, #e8e8e8);
            }
            .edit-checkbox-row label:has(input:checked) {
                background: var(--accent-color, #007AFF);
                color: white;
                border-color: var(--accent-color, #007AFF);
            }
            .edit-checkbox-row input[type="checkbox"] {
                display: none;
            }
            .image-edit-panel-footer {
                display: flex;
                gap: 8px;
                padding: 12px 16px;
                border-top: 1px solid var(--border-color, #e0e0e0);
                justify-content: flex-end;
            }
            .edit-btn {
                padding: 6px 12px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                border: 1px solid var(--border-color, #e0e0e0);
            }
            .edit-btn-primary {
                background: var(--accent-color, #007AFF);
                color: white;
                border-color: var(--accent-color, #007AFF);
            }
            .edit-btn-primary:hover {
                background: var(--accent-hover, #0056b3);
            }
            .edit-btn-secondary {
                background: var(--bg-primary, #ffffff);
                color: var(--text-primary, #1a1a1a);
            }
            .edit-btn-secondary:hover {
                background: var(--bg-secondary, #f5f5f5);
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(panel);

    // Make panel draggable
    const header = panel.querySelector('.image-edit-panel-header');
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('image-edit-panel-close')) return;
        isDragging = true;
        dragOffsetX = e.clientX - panel.offsetLeft;
        dragOffsetY = e.clientY - panel.offsetTop;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panel.style.left = (e.clientX - dragOffsetX) + 'px';
        panel.style.top = (e.clientY - dragOffsetY) + 'px';
        panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Get controls
    const brightnessSlider = panel.querySelector('#edit-brightness');
    const contrastSlider = panel.querySelector('#edit-contrast');
    const saturationSlider = panel.querySelector('#edit-saturation');
    const hueSlider = panel.querySelector('#edit-hue');
    const blurSlider = panel.querySelector('#edit-blur');
    const opacitySlider = panel.querySelector('#edit-opacity');
    const grayscaleCheckbox = panel.querySelector('#edit-grayscale');
    const invertCheckbox = panel.querySelector('#edit-invert');
    const mirrorCheckbox = panel.querySelector('#edit-mirror');
    const brightnessValue = panel.querySelector('#brightness-value');
    const contrastValue = panel.querySelector('#contrast-value');
    const saturationValue = panel.querySelector('#saturation-value');
    const hueValue = panel.querySelector('#hue-value');
    const blurValue = panel.querySelector('#blur-value');
    const opacityValue = panel.querySelector('#opacity-value');
    const resetBtn = panel.querySelector('#edit-reset');
    const applyBtn = panel.querySelector('#edit-apply');
    const cancelBtn = panel.querySelector('#edit-cancel');
    const closeBtn = panel.querySelector('.image-edit-panel-close');

    // Debounce timer for expensive filter operations
    let filterDebounceTimer = null;

    // Update values immediately for responsive UI, but debounce filter operations
    function updatePreview(immediate = false) {
        const brightness = parseInt(brightnessSlider.value);
        const contrast = parseInt(contrastSlider.value);
        const saturation = parseInt(saturationSlider.value);
        const hue = parseInt(hueSlider.value);
        const blur = parseFloat(blurSlider.value);
        const opacity = parseInt(opacitySlider.value);
        const grayscale = grayscaleCheckbox.checked;
        const invert = invertCheckbox.checked;
        const mirror = mirrorCheckbox.checked;

        // Update labels immediately for responsive feedback
        brightnessValue.textContent = `${brightness}%`;
        contrastValue.textContent = `${contrast}%`;
        saturationValue.textContent = `${saturation}%`;
        hueValue.textContent = `${hue}°`;
        blurValue.textContent = `${blur}px`;
        opacityValue.textContent = `${opacity}%`;

        // Apply to image object
        imageObj.brightness = brightness;
        imageObj.contrast = contrast;
        imageObj.saturation = saturation;
        imageObj.hue = hue;
        imageObj.blur = blur;
        imageObj.opacity = opacity;
        imageObj.grayscale = grayscale;
        imageObj.invert = invert;
        imageObj.mirror = mirror;

        // Debounce the expensive filter operations
        if (filterDebounceTimer) {
            clearTimeout(filterDebounceTimer);
        }

        const applyFilters = () => {
            canvas.clearFilterCache(imageObj);
            canvas.applyFilters(imageObj);
            canvas.needsRender = true;
        };

        if (immediate) {
            applyFilters();
        } else {
            filterDebounceTimer = setTimeout(applyFilters, 50);
        }
    }

    // Use 'input' for sliders (fires while dragging) with debounce
    brightnessSlider.addEventListener('input', () => updatePreview(false));
    contrastSlider.addEventListener('input', () => updatePreview(false));
    saturationSlider.addEventListener('input', () => updatePreview(false));
    hueSlider.addEventListener('input', () => updatePreview(false));
    blurSlider.addEventListener('input', () => updatePreview(false));
    opacitySlider.addEventListener('input', () => updatePreview(false));
    // Checkboxes apply immediately
    grayscaleCheckbox.addEventListener('change', () => updatePreview(true));
    invertCheckbox.addEventListener('change', () => updatePreview(true));
    mirrorCheckbox.addEventListener('change', () => updatePreview(true));

    // Reset to defaults
    resetBtn.addEventListener('click', () => {
        brightnessSlider.value = 100;
        contrastSlider.value = 100;
        saturationSlider.value = 100;
        hueSlider.value = 0;
        blurSlider.value = 0;
        opacitySlider.value = 100;
        grayscaleCheckbox.checked = false;
        invertCheckbox.checked = false;
        mirrorCheckbox.checked = false;
        updatePreview();
    });

    // Apply and close
    applyBtn.addEventListener('click', async () => {
        // Values already applied via updatePreview, just save
        canvas.clearFilterCache(imageObj);
        canvas.applyFilters(imageObj);
        canvas.needsRender = true;
        panel.remove();

        pendingSave = true;
        await saveNow();
        showToast('Image filters applied', 'success', 2000);
    });

    // Cancel - revert to original
    function cancelEdit() {
        imageObj.brightness = originalValues.brightness;
        imageObj.contrast = originalValues.contrast;
        imageObj.saturation = originalValues.saturation;
        imageObj.hue = originalValues.hue;
        imageObj.blur = originalValues.blur;
        imageObj.opacity = originalValues.opacity;
        imageObj.grayscale = originalValues.grayscale;
        imageObj.invert = originalValues.invert;
        imageObj.mirror = originalValues.mirror;

        canvas.clearFilterCache(imageObj);
        canvas.applyFilters(imageObj);
        canvas.needsRender = true;
        panel.remove();
    }

    cancelBtn.addEventListener('click', cancelEdit);
    closeBtn.addEventListener('click', cancelEdit);
}

// Keyboard Shortcuts Modal
function showKeyboardShortcutsModal() {
    const overlay = document.getElementById('shortcuts-modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';

    // Close button
    const closeBtn = document.getElementById('shortcuts-modal-close');
    if (closeBtn) {
        closeBtn.onclick = () => closeShortcutsModal();
    }

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

// Export setActiveInstance for ViewManager to use when switching tabs
export function setActiveEditorInstance(container) {
    if (container && editorInstances.has(container)) {
        setActiveInstance(container);
    }
}

export function getActiveCanvas() {
    return canvas;
}

// Export state management functions for ViewManager
export function saveBoardState() {
    if (!canvas) return {};

    return {
        zoom: canvas.zoom,
        pan: { ...canvas.pan },
        scrollPosition: {
            x: window.scrollX,
            y: window.scrollY
        }
    };
}

export function restoreBoardState(state) {
    if (!state || !canvas) return;

    if (state.zoom !== undefined) {
        canvas.zoom = state.zoom;
    }
    if (state.pan) {
        canvas.pan.x = state.pan.x;
        canvas.pan.y = state.pan.y;
    }

    // Re-render canvas
    canvas.render();

    // Restore scroll position
    if (state.scrollPosition) {
        window.scrollTo(state.scrollPosition.x, state.scrollPosition.y);
    }
}

export async function cleanupEditor(container) {
    // Set this as the active instance to cleanup
    if (container && editorInstances.has(container)) {
        // If this container is currently active, save its current state first
        if (activeContainer === container) {
            console.log('[cleanupEditor] Container is active, saving current state');
            saveInstanceState();
        }

        // Set as active to ensure we're working with the right instance
        setActiveInstance(container);

        console.log('[cleanupEditor] pendingSave:', pendingSave, 'saveTimeout:', saveTimeout);

        // Stop autosave timer
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
            // Update instance
            const instance = editorInstances.get(container);
            instance.saveTimeout = null;
        }

        // Save any pending changes
        if (pendingSave) {
            console.log('[cleanupEditor] Saving pending changes...');
            await saveNow();
            console.log('[cleanupEditor] Save complete');
        } else {
            console.log('[cleanupEditor] No pending changes to save');
        }

        // Close sync channels
        if (syncChannel) {
            syncChannel.close();
            syncChannel = null;
        }

        // Cleanup canvas
        if (canvas) {
            canvas.destroy();
            canvas = null;
        }

        // Clear history manager
        if (historyManager) {
            historyManager = null;
        }

        // Save the cleaned state back to instance
        saveActiveInstance();

        // Clear active container
        if (activeContainer === container) {
            activeContainer = null;
        }

        // DON'T delete from map - we need it for reinitialization
    }
}

