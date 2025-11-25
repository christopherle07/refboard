import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';

let canvas;
let currentBoardId;
let isPinned = false;
let overlayMode = false;
let overlayOpacity = 0.7;
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
        }
    };
    
    await initFloatingWindow();
    setupTitlebarControls();
    setupContextMenu();
    setupDragAndDrop();
    setupKeyboardShortcuts();
    injectDisclaimerStyles();
});

function injectDisclaimerStyles() {
    if (document.querySelector('#disclaimer-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'disclaimer-styles';
    style.textContent = `
        .overlay-disclaimer {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1a1a1a;
            color: #ffffff;
            padding: 32px 40px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            z-index: 100000;
            max-width: 500px;
            border: 2px solid #ff6b6b;
            animation: disclaimerFadeIn 0.3s ease;
            pointer-events: auto;
        }
        
        @keyframes disclaimerFadeIn {
            from {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.9);
            }
            to {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }
        }
        
        .disclaimer-title {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #ff6b6b;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .disclaimer-message {
            font-size: 15px;
            line-height: 1.6;
            margin-bottom: 24px;
            color: #e0e0e0;
        }
        
        .disclaimer-message strong {
            color: #ffffff;
            background: rgba(255, 107, 107, 0.2);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
        }
        
        .disclaimer-buttons {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
        }
        
        .disclaimer-btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .disclaimer-btn-cancel {
            background: #3a3a3a;
            color: #ffffff;
        }
        
        .disclaimer-btn-cancel:hover {
            background: #4a4a4a;
        }
        
        .disclaimer-btn-confirm {
            background: #ff6b6b;
            color: #ffffff;
        }
        
        .disclaimer-btn-confirm:hover {
            background: #ff5252;
        }
    `;
    document.head.appendChild(style);
}

function showOverlayDisclaimer() {
    return new Promise((resolve) => {
        const disclaimer = document.createElement('div');
        disclaimer.className = 'overlay-disclaimer';
        disclaimer.innerHTML = `
            <div class="disclaimer-title">⚠️ Trace Mode Disclaimer</div>
            <div class="disclaimer-message">
                To disable trace mode, you must refocus this window from your taskbar and press <strong>CTRL + L</strong>
                <br><br>
                While in trace mode, this window will be click-through and semi-transparent for tracing references.
            </div>
            <div class="disclaimer-buttons">
                <button class="disclaimer-btn disclaimer-btn-cancel">Cancel</button>
                <button class="disclaimer-btn disclaimer-btn-confirm">I Understand</button>
            </div>
        `;
        
        document.body.appendChild(disclaimer);
        
        disclaimer.querySelector('.disclaimer-btn-cancel').addEventListener('click', () => {
            disclaimer.remove();
            resolve(false);
        });
        
        disclaimer.querySelector('.disclaimer-btn-confirm').addEventListener('click', () => {
            disclaimer.remove();
            resolve(true);
        });
    });
}

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
                    if (!board.assets) board.assets = [];
                    
                    const assetExists = board.assets.some(a => a.name === file.name);
                    if (!assetExists) {
                        board.assets.push({
                            id: Date.now() + Math.random(),
                            src: event.target.result,
                            name: file.name
                        });
                        await boardManager.updateBoard(currentBoardId, { assets: board.assets });
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
        
        document.getElementById('overlay-btn').addEventListener('click', async () => {
            await toggleOverlayMode();
        });
        
        document.getElementById('pin-btn').addEventListener('click', async () => {
            isPinned = !isPinned;
            await currentWindow.setAlwaysOnTop(isPinned);
            document.getElementById('pin-btn').classList.toggle('pinned', isPinned);
        });
        
        document.getElementById('minimize-btn').addEventListener('click', async () => {
            await currentWindow.minimize();
        });
        
        document.getElementById('close-btn').addEventListener('click', async () => {
            if (overlayMode) {
                await toggleOverlayMode();
            }
            saveNow();
            await currentWindow.close();
        });
    } catch (err) {
        console.error('Titlebar setup error:', err);
    }
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', async (e) => {
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            await toggleOverlayMode();
        }
    });
}

async function toggleOverlayMode() {
    if (!window.__TAURI__) return;
    
    if (!overlayMode) {
        const confirmed = await showOverlayDisclaimer();
        if (!confirmed) {
            return;
        }
    }
    
    overlayMode = !overlayMode;
    
    try {
        const { getCurrentWindow } = window.__TAURI__.window;
        const currentWindow = getCurrentWindow();
        
        await window.__TAURI__.core.invoke('set_overlay_mode', {
            enabled: overlayMode,
            opacity: overlayOpacity
        });
        
        if (overlayMode) {
            isPinned = true;
            document.getElementById('pin-btn').classList.add('pinned');
        }
        
        updateOverlayUI();
        
    } catch (err) {
        console.error('Failed to toggle overlay mode:', err);
        overlayMode = !overlayMode;
    }
}

function updateOverlayUI() {
    const indicator = document.getElementById('overlay-indicator');
    const overlayBtn = document.getElementById('overlay-btn');
    
    if (overlayMode) {
        indicator.classList.add('active');
        indicator.textContent = 'TRACE MODE ACTIVE';
        overlayBtn.classList.add('active');
    } else {
        indicator.classList.remove('active');
        indicator.textContent = '';
        overlayBtn.classList.remove('active');
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
        
        if (overlayMode) return;
        
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
                <div class="context-menu-item" data-action="reset">Reset Zoom</div>
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