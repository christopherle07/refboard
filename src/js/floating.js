import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';

let canvas;
let currentBoardId;
let isPinned = false;
let saveTimeout = null;
let pendingSave = false;

// Sync channel for layer visibility
let syncChannel = null;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    if (!currentBoardId) return;
    
    // Setup sync channel
    syncChannel = new BroadcastChannel('board_sync_' + currentBoardId);
    
    // Listen for layer visibility changes from editor
    syncChannel.onmessage = (event) => {
        if (event.data.type === 'layer_visibility_changed') {
            const img = canvas.images.find(i => i.id === event.data.layerId);
            if (img) {
                img.visible = event.data.visible;
                canvas.needsRender = true;
            }
        }
    };
    
    await initFloatingWindow();
    setupTitlebarControls();
    setupContextMenu();
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
    
    canvas.canvas.addEventListener('canvasChanged', scheduleSave);
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
        const { getCurrentWindow } = window.__TAURI__.window;
        const currentWindow = getCurrentWindow();
        
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
        <div class="context-menu-item" data-action="reset">Reset Zoom</div>
    `;
    document.body.appendChild(contextMenu);
    
    // Hidden layers submenu
    const hiddenLayersMenu = document.createElement('div');
    hiddenLayersMenu.className = 'context-submenu';
    document.body.appendChild(hiddenLayersMenu);
    
    // Style injection
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
    
    // Right click to show menu
    canvas.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        
        hiddenLayersMenu.classList.remove('show');
        
        // Check if clicked on an image
        const rect = canvas.canvas.getBoundingClientRect();
        const { x, y } = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const clickedImage = canvas.getImageAtPoint(x, y);
        
        contextMenu.innerHTML = '';
        
        if (clickedImage) {
            // Clicked on image - show hide option
            clickedImageId = clickedImage.id;
            contextMenu.innerHTML = `
                <div class="context-menu-item" data-action="hide-image">Hide Image</div>
            `;
        } else {
            // Clicked on blank space
            clickedImageId = null;
            const hiddenImages = canvas.images.filter(img => img.visible === false);
            
            contextMenu.innerHTML = `
                <div class="context-menu-item" data-action="recenter">Recenter View</div>
                <div class="context-menu-item" data-action="reset">Reset Zoom</div>
                <div class="context-menu-item ${hiddenImages.length === 0 ? 'disabled' : ''}" data-action="hidden-layers">Hidden Layers ${hiddenImages.length > 0 ? '▶' : ''}</div>
            `;
        }
        
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        contextMenu.classList.add('show');
    });
    
    // Click menu items
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
            
            // Show submenu with hidden layers
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
    
    // Click submenu items (unhide)
    hiddenLayersMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const imageId = parseFloat(e.target.dataset.imageId);
        
        if (action === 'unhide' && imageId) {
            canvas.toggleVisibility(imageId);
            contextMenu.classList.remove('show');
            hiddenLayersMenu.classList.remove('show');
        }
    });
    
    // Close menus on outside click
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
    const thumbnail = canvas.generateThumbnail(200, 150);
    boardManager.updateBoard(currentBoardId, { layers, thumbnail });
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
    } else {
        titlebar.classList.remove('dark-mode');
    }
}