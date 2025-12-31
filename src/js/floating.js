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
    
    await loadLayers(board.layers);

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

function loadLayers(layers) {
    return new Promise(resolve => {
        canvas.clear();
        
        if (!layers || !layers.length) {
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
                    canvas.needsRender = true;
                    resolve();
                }
            };
            img.onerror = () => {
                loaded++;
                if (loaded >= total) {
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
    
    canvas.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        hiddenLayersMenu.classList.remove('show');
        
        const rect = canvas.canvas.getBoundingClientRect();
        const { x, y } = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const clickedImage = canvas.getImageAtPoint(x, y);
        
        contextMenu.innerHTML = '';
        
        if (clickedImage) {
            clickedImageId = clickedImage.id;
            contextMenu.innerHTML = `
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
    });
    
    contextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        
        if (action === 'recenter') {
            canvas.fitToContent();
            contextMenu.classList.remove('show');
        } else if (action === 'reset') {
            canvas.resetView();
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


