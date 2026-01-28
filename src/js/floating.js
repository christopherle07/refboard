import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';

let canvas;
let currentBoardId;
let isPinned = false;
let saveTimeout = null;
let pendingSave = false;

let syncChannel = null;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    if (!currentBoardId) return;
    
    syncChannel = new BroadcastChannel('board_sync_' + currentBoardId);
    
    syncChannel.onmessage = (event) => {
        if (event.data.type === 'layer_visibility_changed') {
            const img = canvas.images.find(i => i.id === event.data.layerId);
            if (img) {
                img.visible = event.data.visible;
                canvas.needsRender = true;
            }
        } else if (event.data.type === 'background_color_changed') {
            canvas.setBackgroundColor(event.data.color);
            document.body.style.backgroundColor = event.data.color;
            updateTitlebarTheme(event.data.color);
        } else if (event.data.type === 'layer_order_changed') {
            console.log('Floating window received layer order update:', event.data.updates);
            // Update zIndex for all layers
            event.data.updates.forEach(update => {
                if (update.type === 'image') {
                    const img = canvas.images.find(i => i.id === update.id);
                    if (img) {
                        console.log('Updated image', img.id, 'zIndex to', update.zIndex);
                        img.zIndex = update.zIndex;
                    }
                } else if (update.type === 'object') {
                    const obj = canvas.objectsManager.objects.find(o => o.id === update.id);
                    if (obj) {
                        console.log('Updated object', obj.id, 'zIndex to', update.zIndex);
                        obj.zIndex = update.zIndex;
                    }
                }
            });
            canvas.invalidateCullCache();
            canvas.needsRender = true;
            canvas.render();
        } else if (event.data.type === 'sync_state_response') {
            // Received current state from editor
            console.log('Floating window received state sync:', event.data.updates);
            event.data.updates.forEach(update => {
                if (update.type === 'image') {
                    const img = canvas.images.find(i => i.id === update.id);
                    if (img) {
                        img.zIndex = update.zIndex;
                    }
                } else if (update.type === 'object') {
                    const obj = canvas.objectsManager.objects.find(o => o.id === update.id);
                    if (obj) {
                        obj.zIndex = update.zIndex;
                    }
                }
            });
            canvas.invalidateCullCache();
            canvas.needsRender = true;
            canvas.render();
        }
    };
    
    await initFloatingWindow();
    setupTitlebarControls();
    setupToolbarToggle();
    setupContextMenu();
    setupDragAndDrop();
});

async function initFloatingWindow() {
    await boardManager.loadBoards();
    const board = await boardManager.getBoard(currentBoardId);
    
    if (!board) return;
    
    document.getElementById('window-title').textContent = board.name;
    
    const canvasElement = document.getElementById('floating-canvas');
    canvas = new Canvas(canvasElement);
    
    const bgColor = board.bgColor || board.bg_color;
    canvas.setBackgroundColor(bgColor);
    document.body.style.backgroundColor = bgColor;
    updateTitlebarTheme(bgColor);
    
    await loadLayers(board.layers, board.viewState);

    // Fit content to view if no viewState was saved
    if (!board.viewState) {
        canvas.fitToContent();
    }

    // Load strokes if they exist
    if (board.strokes && board.strokes.length > 0) {
        canvas.loadStrokes(board.strokes);
    }

    // Load text/shape objects if they exist
    if (board.objects && board.objects.length > 0) {
        console.log('Loading objects in floating window:', board.objects);
        canvas.objectsManager.loadObjects(board.objects);
        // Force render after loading objects
        canvas.needsRender = true;
    } else {
        console.log('No objects to load in floating window', board.objects);
    }

    canvas.canvas.addEventListener('canvasChanged', scheduleSave);
    canvas.canvas.addEventListener('objectsChanged', scheduleSave);

    // Request current state from editor
    syncChannel.postMessage({ type: 'sync_state_request' });
}

function setupDragAndDrop() {
    canvas.canvas.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) {
            canvas.showDragOverlay();
        }
    });
    
    canvas.canvas.addEventListener('dragleave', (e) => {
        if (e.target === canvas.canvas) {
            canvas.hideDragOverlay();
        }
    });
    
    canvas.canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    
    canvas.canvas.addEventListener('drop', async (e) => {
        e.preventDefault();
        canvas.hideDragOverlay();
        
        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        
        const rect = canvas.canvas.getBoundingClientRect();
        const { x, y } = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        
        for (const file of imageFiles) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const img = new Image();
                img.onload = async () => {
                    canvas.addImage(img, x, y, file.name);
                    
                    const board = await boardManager.getBoard(currentBoardId);
                    const currentAssets = board.assets || [];

                    const assetExists = currentAssets.some(a => a.name === file.name);
                    if (!assetExists) {
                        const updatedAssets = [...currentAssets, {
                            id: Date.now() + Math.random(),
                            src: event.target.result,
                            name: file.name
                        }];
                        await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });
                        await boardManager.addToAllAssets(file.name, event.target.result);
                    }
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
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
                // Restore filter properties (only if they exist and are not null)
                if (layer.brightness != null) added.brightness = layer.brightness;
                if (layer.contrast != null) added.contrast = layer.contrast;
                if (layer.saturation != null) added.saturation = layer.saturation;
                if (layer.hue != null) added.hue = layer.hue;
                if (layer.blur != null) added.blur = layer.blur;
                if (layer.opacity != null) added.opacity = layer.opacity;
                if (layer.grayscale === true) added.grayscale = true;
                if (layer.invert === true) added.invert = true;
                if (layer.mirror === true) added.mirror = true;

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

async function setupTitlebarControls() {
    if (!window.__TAURI__) return;

    try {
        const { Window } = window.__TAURI__.window;
        const currentWindow = Window.getCurrent();

        await currentWindow.setAlwaysOnTop(false);
        isPinned = false;

        // Setup titlebar dragging (needed for macOS)
        const titlebar = document.getElementById('floating-titlebar');
        if (titlebar) {
            titlebar.addEventListener('mousedown', async (e) => {
                // Don't drag if clicking on buttons
                if (e.target.closest('.titlebar-btn') || e.target.closest('.titlebar-controls')) {
                    return;
                }
                try {
                    await currentWindow.startDragging();
                } catch (err) {
                    // Ignore errors - dragging may not be supported in all contexts
                }
            });
        }

        document.getElementById('pin-btn').addEventListener('click', async () => {
            isPinned = !isPinned;
            await currentWindow.setAlwaysOnTop(isPinned);
            document.getElementById('pin-btn').classList.toggle('pinned', isPinned);
        });

        document.getElementById('minimize-btn').addEventListener('click', async () => {
            await currentWindow.minimize();
        });

        document.getElementById('close-btn').addEventListener('click', async () => {
            saveNow();
            await currentWindow.close();
        });
    } catch (err) {
        console.error('Titlebar setup error:', err);
    }
}

function setupContextMenu() {
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.innerHTML = `
        <div class="context-menu-item" data-action="recenter">Recenter View</div>
    `;
    document.body.appendChild(contextMenu);
    
    const hiddenLayersMenu = document.createElement('div');
    hiddenLayersMenu.className = 'context-submenu';
    document.body.appendChild(hiddenLayersMenu);
    
    if (!document.querySelector('#context-menu-styles')) {
        const style = document.createElement('style');
        style.id = 'context-menu-styles';
        style.textContent = `
            .context-menu {
                position: fixed;
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 4px;
                z-index: 10000;
                display: none;
                min-width: 160px;
            }
            
            .context-menu.show {
                display: block;
            }
            
            .context-menu-item {
                padding: 8px 12px;
                font-size: 13px;
                color: #1a1a1a;
                cursor: pointer;
                border-radius: 4px;
                transition: background 0.1s;
            }
            
            .context-menu-item:hover {
                background: #f5f5f5;
            }
            
            .context-menu-item.disabled {
                color: #999;
                cursor: default;
            }
            
            .context-menu-item.disabled:hover {
                background: transparent;
            }
            
            .context-submenu {
                position: fixed;
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 4px;
                z-index: 10001;
                display: none;
                min-width: 180px;
                max-height: 300px;
                overflow-y: auto;
            }
            
            .context-submenu.show {
                display: block;
            }
        `;
        document.head.appendChild(style);
    }
    
    let clickedImageId = null;
    let clickedImageObj = null;
    let contextMenuJustOpened = false;

    canvas.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        hiddenLayersMenu.classList.remove('show');

        const rect = canvas.canvas.getBoundingClientRect();
        const { x, y } = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const clickedImage = canvas.getImageAtPoint(x, y);

        contextMenu.innerHTML = '';

        if (clickedImage) {
            clickedImageId = clickedImage.id;
            clickedImageObj = clickedImage;
            contextMenu.innerHTML = `
                <div class="context-menu-item" data-action="edit-image">Edit Image</div>
                <div class="context-menu-item" data-action="hide-image">Hide Image</div>
            `;
        } else {
            clickedImageId = null;
            const hiddenImages = canvas.images.filter(img => img.visible === false);

            contextMenu.innerHTML = `
                <div class="context-menu-item" data-action="recenter">Recenter View</div>
                <div class="context-menu-item ${hiddenImages.length === 0 ? 'disabled' : ''}" data-action="hidden-layers">Hidden Layers ${hiddenImages.length > 0 ? '▶' : ''}</div>
            `;
        }

        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        contextMenu.classList.add('show');

        // Prevent click event from immediately closing the menu on macOS
        contextMenuJustOpened = true;
        setTimeout(() => {
            contextMenuJustOpened = false;
        }, 100);
    });
    
    contextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;

        if (action === 'recenter') {
            canvas.resetView();
            contextMenu.classList.remove('show');
        } else if (action === 'edit-image' && clickedImageObj) {
            showImageEditModal(clickedImageObj);
            contextMenu.classList.remove('show');
        } else if (action === 'hide-image' && clickedImageId) {
            canvas.toggleVisibility(clickedImageId);
            contextMenu.classList.remove('show');
        } else if (action === 'hidden-layers') {
            if (e.target.classList.contains('disabled')) return;
            
            const hiddenImages = canvas.images.filter(img => img.visible === false);
            hiddenLayersMenu.innerHTML = '';
            
            hiddenImages.forEach(img => {
                const item = document.createElement('div');
                item.className = 'context-menu-item';
                item.textContent = img.name;
                item.dataset.imageId = img.id;
                item.dataset.action = 'unhide';
                hiddenLayersMenu.appendChild(item);
            });
            
            const rect = e.target.getBoundingClientRect();
            hiddenLayersMenu.style.left = (rect.right + 5) + 'px';
            hiddenLayersMenu.style.top = rect.top + 'px';
            hiddenLayersMenu.classList.add('show');
        }
    });
    
    hiddenLayersMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const imageId = parseFloat(e.target.dataset.imageId);
        
        if (action === 'unhide' && imageId) {
            canvas.toggleVisibility(imageId);
            contextMenu.classList.remove('show');
            hiddenLayersMenu.classList.remove('show');
        }
    });
    
    document.addEventListener('click', (e) => {
        // Don't close if menu was just opened (macOS ctrl+click issue)
        if (contextMenuJustOpened) return;

        if (!contextMenu.contains(e.target) && !hiddenLayersMenu.contains(e.target) && e.target !== canvas.canvas) {
            contextMenu.classList.remove('show');
            hiddenLayersMenu.classList.remove('show');
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
    const layers = images.map(img => {
        const layer = {
            id: img.id,
            name: img.name,
            src: img.img.src,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            visible: img.visible !== false,
            zIndex: img.zIndex || 0
        };

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

        return layer;
    });
    const strokes = canvas.getStrokes();
    const objects = canvas.objectsManager.getObjects();
    const thumbnail = canvas.generateThumbnail(200, 150);
    boardManager.updateBoard(currentBoardId, { layers, strokes, objects, thumbnail });
}

function updateTitlebarTheme(bgColor) {
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    const titlebar = document.querySelector('.titlebar');
    if (luminance < 0.5) {
        titlebar.classList.add('dark-mode');
        document.documentElement.setAttribute('data-bg-luminance', 'dark');
    } else {
        titlebar.classList.remove('dark-mode');
        document.documentElement.setAttribute('data-bg-luminance', 'light');
    }
}

function setupToolbarToggle() {
    const toggleBtn = document.getElementById('toolbar-toggle-btn');
    const toolbar = document.getElementById('drawing-toolbar');

    // Load saved state from localStorage
    const toolbarVisible = localStorage.getItem('floating_toolbar_visible') !== 'false';

    if (!toolbarVisible) {
        toolbar.style.display = 'none';
    } else {
        toggleBtn.classList.add('active');
    }

    toggleBtn.addEventListener('click', () => {
        const isVisible = toolbar.style.display !== 'none';

        if (isVisible) {
            toolbar.style.display = 'none';
            toggleBtn.classList.remove('active');
            localStorage.setItem('floating_toolbar_visible', 'false');
        } else {
            toolbar.style.display = 'flex';
            toggleBtn.classList.add('active');
            localStorage.setItem('floating_toolbar_visible', 'true');
        }
    });
}

function showImageEditModal(imageObj) {
    // Remove any existing edit modals
    const existingModals = document.querySelectorAll('.modal-overlay');
    existingModals.forEach(m => {
        if (m.querySelector('#edit-apply')) {
            m.remove();
        }
    });

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 500px;">
            <div class="modal-header">
                <h2>Edit Image</h2>
            </div>
            <div class="modal-body" style="padding: 24px;">
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">Brightness</label>
                    <input type="range" id="edit-brightness" min="0" max="200" value="100" class="themed-slider" style="width: 100%;">
                    <div style="text-align: center; margin-top: 4px; font-size: 14px; color: var(--text-secondary);">
                        <span id="brightness-value">100%</span>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">Contrast</label>
                    <input type="range" id="edit-contrast" min="0" max="200" value="100" class="themed-slider" style="width: 100%;">
                    <div style="text-align: center; margin-top: 4px; font-size: 14px; color: var(--text-secondary);">
                        <span id="contrast-value">100%</span>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">Saturation</label>
                    <input type="range" id="edit-saturation" min="0" max="200" value="100" class="themed-slider" style="width: 100%;">
                    <div style="text-align: center; margin-top: 4px; font-size: 14px; color: var(--text-secondary);">
                        <span id="saturation-value">100%</span>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">Hue Rotate</label>
                    <input type="range" id="edit-hue" min="0" max="360" value="0" class="themed-slider" style="width: 100%;">
                    <div style="text-align: center; margin-top: 4px; font-size: 14px; color: var(--text-secondary);">
                        <span id="hue-value">0°</span>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">Blur</label>
                    <input type="range" id="edit-blur" min="0" max="10" value="0" step="0.5" class="themed-slider" style="width: 100%;">
                    <div style="text-align: center; margin-top: 4px; font-size: 14px; color: var(--text-secondary);">
                        <span id="blur-value">0px</span>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500;">Opacity</label>
                    <input type="range" id="edit-opacity" min="0" max="100" value="100" class="themed-slider" style="width: 100%;">
                    <div style="text-align: center; margin-top: 4px; font-size: 14px; color: var(--text-secondary);">
                        <span id="opacity-value">100%</span>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span style="font-weight: 500;">Grayscale</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="edit-grayscale">
                            <span class="toggle-slider"></span>
                        </label>
                    </label>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span style="font-weight: 500;">Invert Colors</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="edit-invert">
                            <span class="toggle-slider"></span>
                        </label>
                    </label>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span style="font-weight: 500;">Mirror</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="edit-mirror">
                            <span class="toggle-slider"></span>
                        </label>
                    </label>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-secondary" id="edit-reset">Reset</button>
                <button class="modal-btn modal-btn-primary" id="edit-apply">Apply</button>
                <button class="modal-btn modal-btn-secondary" id="edit-cancel">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'flex';

    // Get controls
    const brightnessSlider = modal.querySelector('#edit-brightness');
    const contrastSlider = modal.querySelector('#edit-contrast');
    const saturationSlider = modal.querySelector('#edit-saturation');
    const hueSlider = modal.querySelector('#edit-hue');
    const blurSlider = modal.querySelector('#edit-blur');
    const opacitySlider = modal.querySelector('#edit-opacity');
    const grayscaleCheckbox = modal.querySelector('#edit-grayscale');
    const invertCheckbox = modal.querySelector('#edit-invert');
    const mirrorCheckbox = modal.querySelector('#edit-mirror');
    const brightnessValue = modal.querySelector('#brightness-value');
    const contrastValue = modal.querySelector('#contrast-value');
    const saturationValue = modal.querySelector('#saturation-value');
    const hueValue = modal.querySelector('#hue-value');
    const blurValue = modal.querySelector('#blur-value');
    const opacityValue = modal.querySelector('#opacity-value');
    const resetBtn = modal.querySelector('#edit-reset');
    const applyBtn = modal.querySelector('#edit-apply');
    const cancelBtn = modal.querySelector('#edit-cancel');

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

    // Initialize with current values if they exist
    brightnessSlider.value = originalValues.brightness;
    contrastSlider.value = originalValues.contrast;
    saturationSlider.value = originalValues.saturation;
    hueSlider.value = originalValues.hue;
    blurSlider.value = originalValues.blur;
    opacitySlider.value = originalValues.opacity;
    grayscaleCheckbox.checked = originalValues.grayscale;
    invertCheckbox.checked = originalValues.invert;
    mirrorCheckbox.checked = originalValues.mirror;
    brightnessValue.textContent = `${brightnessSlider.value}%`;
    contrastValue.textContent = `${contrastSlider.value}%`;
    saturationValue.textContent = `${saturationSlider.value}%`;
    hueValue.textContent = `${hueSlider.value}°`;
    blurValue.textContent = `${blurSlider.value}px`;
    opacityValue.textContent = `${opacitySlider.value}%`;

    // Update preview as sliders change
    function updatePreview() {
        const brightness = parseInt(brightnessSlider.value);
        const contrast = parseInt(contrastSlider.value);
        const saturation = parseInt(saturationSlider.value);
        const hue = parseInt(hueSlider.value);
        const blur = parseFloat(blurSlider.value);
        const opacity = parseInt(opacitySlider.value);
        const grayscale = grayscaleCheckbox.checked;
        const invert = invertCheckbox.checked;
        const mirror = mirrorCheckbox.checked;

        brightnessValue.textContent = `${brightness}%`;
        contrastValue.textContent = `${contrast}%`;
        saturationValue.textContent = `${saturation}%`;
        hueValue.textContent = `${hue}°`;
        blurValue.textContent = `${blur}px`;
        opacityValue.textContent = `${opacity}%`;

        // Apply filters to image
        imageObj.brightness = brightness;
        imageObj.contrast = contrast;
        imageObj.saturation = saturation;
        imageObj.hue = hue;
        imageObj.blur = blur;
        imageObj.opacity = opacity;
        imageObj.grayscale = grayscale;
        imageObj.invert = invert;
        imageObj.mirror = mirror;

        canvas.needsRender = true;
    }

    brightnessSlider.addEventListener('input', updatePreview);
    contrastSlider.addEventListener('input', updatePreview);
    saturationSlider.addEventListener('input', updatePreview);
    hueSlider.addEventListener('input', updatePreview);
    blurSlider.addEventListener('input', updatePreview);
    opacitySlider.addEventListener('input', updatePreview);
    grayscaleCheckbox.addEventListener('change', updatePreview);
    invertCheckbox.addEventListener('change', updatePreview);
    mirrorCheckbox.addEventListener('change', updatePreview);

    // Reset button
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

    // Apply button - force save all current slider values
    applyBtn.addEventListener('click', async () => {
        // Get current values from controls
        const brightness = parseInt(brightnessSlider.value);
        const contrast = parseInt(contrastSlider.value);
        const saturation = parseInt(saturationSlider.value);
        const hue = parseInt(hueSlider.value);
        const blur = parseFloat(blurSlider.value);
        const opacity = parseInt(opacitySlider.value);
        const grayscale = grayscaleCheckbox.checked;
        const invert = invertCheckbox.checked;
        const mirror = mirrorCheckbox.checked;

        // Find the actual image in the canvas images array by ID
        const images = canvas.getImages();
        const actualImage = images.find(img => img.id === imageObj.id);

        if (actualImage) {
            // Force set all values on the actual image object
            actualImage.brightness = brightness;
            actualImage.contrast = contrast;
            actualImage.saturation = saturation;
            actualImage.hue = hue;
            actualImage.blur = blur;
            actualImage.opacity = opacity;
            actualImage.grayscale = grayscale;
            actualImage.invert = invert;
            actualImage.mirror = mirror;
        }

        // Also update imageObj reference
        imageObj.brightness = brightness;
        imageObj.contrast = contrast;
        imageObj.saturation = saturation;
        imageObj.hue = hue;
        imageObj.blur = blur;
        imageObj.opacity = opacity;
        imageObj.grayscale = grayscale;
        imageObj.invert = invert;
        imageObj.mirror = mirror;

        canvas.needsRender = true;
        modal.remove();

        // Broadcast filter changes to editor
        if (syncChannel) {
            syncChannel.postMessage({
                type: 'image_filters_changed',
                imageId: imageObj.id,
                filters: {
                    brightness,
                    contrast,
                    saturation,
                    hue,
                    blur,
                    opacity,
                    grayscale,
                    invert,
                    mirror
                }
            });
        }

        // Force immediate save
        pendingSave = true;
        saveNow();
    });

    // Cancel button
    cancelBtn.addEventListener('click', () => {
        // Revert to original values
        imageObj.brightness = originalValues.brightness;
        imageObj.contrast = originalValues.contrast;
        imageObj.saturation = originalValues.saturation;
        imageObj.hue = originalValues.hue;
        imageObj.blur = originalValues.blur;
        imageObj.opacity = originalValues.opacity;
        imageObj.grayscale = originalValues.grayscale;
        imageObj.invert = originalValues.invert;
        imageObj.mirror = originalValues.mirror;
        canvas.needsRender = true;
        modal.remove();
    });

    // Close modal on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            cancelBtn.click();
        }
    });
}
