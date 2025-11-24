import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';
import { showDeleteConfirm } from './modal.js';

let canvas;
let currentBoardId;
let saveTimeout = null;
let pendingSave = false;
let dragSourceIndex = null;
let currentOrder = [];
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
    
    const colorInput = document.getElementById('bg-color');
    colorInput.value = board.bgColor || board.bg_color;
    
    await loadLayers(board.layers);
    
    renderLayers();
    renderAssets();
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
    document.getElementById('recenter-btn').addEventListener('click', () => {
        canvas.fitToContent();
    });
    
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
    const thumbnail = canvas.generateThumbnail(200, 150);
    boardManager.updateBoard(currentBoardId, { layers, bgColor, thumbnail });
}

function renderLayers(orderOverride = null) {
    const layersList = document.getElementById('layers-list');
    const images = canvas.getImages();
    
    if (images.length === 0) {
        layersList.innerHTML = '<div class="empty-message">No layers yet</div>';
        return;
    }
    
    const displayOrder = orderOverride || [...images].reverse();
    
    layersList.innerHTML = '';
    
    displayOrder.forEach((img) => {
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
            showDeleteConfirm(img.name, () => {
                canvas.deleteImage(img.id);
                renderLayers();
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
            if (img.visible !== false) {
                canvas.selectImage(img);
            }
        });
        
        layerItem.addEventListener('dragstart', (e) => {
            if (e.target.tagName === 'INPUT') {
                e.preventDefault();
                return;
            }
            dragSourceIndex = realIndex;
            currentOrder = [...images].reverse();
            layerItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
        });
        
        layerItem.addEventListener('dragend', () => {
            if (currentOrder.length > 0) {
                const newCanvasOrder = [...currentOrder].reverse();
                canvas.images = newCanvasOrder;
                canvas.needsRender = true;
                canvas.notifyChange();
            }
            
            dragSourceIndex = null;
            currentOrder = [];
            renderLayers();
        });
        
        layerItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            if (dragSourceIndex === null) return;
            
            const targetId = img.id;
            const draggedId = images[dragSourceIndex].id;
            
            if (targetId === draggedId) return;
            
            const fromIdx = currentOrder.findIndex(i => i.id === draggedId);
            const toIdx = currentOrder.findIndex(i => i.id === targetId);
            
            if (fromIdx === toIdx || fromIdx === -1 || toIdx === -1) return;
            
            const newOrder = [...currentOrder];
            const [moved] = newOrder.splice(fromIdx, 1);
            newOrder.splice(toIdx, 0, moved);
            
            currentOrder = newOrder;
            renderLayers(currentOrder);
        });
        
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