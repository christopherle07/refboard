import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';

let canvas;
let currentBoardId;
let syncInterval = null;
let lastSyncTime = 0;
let isLoading = false;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    if (!currentBoardId) {
        window.location.href = 'index.html';
        return;
    }
    
    await initEditor();
    setupEventListeners();
    startSync();
});

async function initEditor() {
    await boardManager.loadBoards();
    const board = await boardManager.getBoard(currentBoardId);
    if (!board) {
        window.location.href = 'index.html';
        return;
    }
    
    document.getElementById('board-name').textContent = board.name;
    
    const canvasElement = document.getElementById('main-canvas');
    canvas = new Canvas(canvasElement);
    canvas.setBackgroundColor(board.bgColor || board.bg_color);
    
    const colorInput = document.getElementById('bg-color');
    colorInput.value = board.bgColor || board.bg_color;
    
    await loadLayers(board.layers);
    lastSyncTime = board.updatedAt || board.updated_at || Date.now();
    
    setTimeout(() => {
        renderLayers();
        renderAssets();
    }, 100);
}

function loadLayers(layers) {
    return new Promise(resolve => {
        isLoading = true;
        canvas.clear();
        
        if (!layers || !layers.length) {
            isLoading = false;
            resolve();
            return;
        }
        
        let loaded = 0;
        const total = layers.length;
        
        layers.forEach(layer => {
            const img = new Image();
            img.onload = () => {
                const added = canvas.addImageSilent(img, layer.x, layer.y, layer.name, layer.width, layer.height);
                added.id = layer.id;
                loaded++;
                if (loaded >= total) {
                    canvas.selectImage(null);
                    canvas.needsRender = true;
                    isLoading = false;
                    resolve();
                }
            };
            img.onerror = () => {
                loaded++;
                if (loaded >= total) {
                    isLoading = false;
                    resolve();
                }
            };
            img.src = layer.src;
        });
    });
}

function startSync() {
    syncInterval = setInterval(async () => {
        if (canvas.isDragging || canvas.isResizing || isLoading) return;
        
        const board = await boardManager.getBoard(currentBoardId);
        if (!board) return;
        
        const boardTime = board.updatedAt || board.updated_at || 0;
        if (boardTime > lastSyncTime + 200) {
            lastSyncTime = boardTime;
            canvas.setBackgroundColor(board.bgColor || board.bg_color);
            document.getElementById('bg-color').value = board.bgColor || board.bg_color;
            await loadLayers(board.layers);
            setTimeout(renderLayers, 150);
        }
    }, 500);
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
    
    document.getElementById('bg-color').addEventListener('input', (e) => {
        const color = e.target.value;
        canvas.setBackgroundColor(color);
        saveCurrentBoard();
    });
    
    document.getElementById('import-assets-btn').addEventListener('click', importAssets);
    document.getElementById('open-floating-btn').addEventListener('click', openFloatingWindow);
    
    document.getElementById('back-home-btn').addEventListener('click', () => {
        if (syncInterval) clearInterval(syncInterval);
        saveCurrentBoard();
        window.location.href = 'index.html';
    });
    
    document.getElementById('collapse-layers-btn').addEventListener('click', (e) => {
        const content = document.getElementById('layers-content');
        const btn = e.target;
        content.classList.toggle('collapsed');
        btn.textContent = content.classList.contains('collapsed') ? '+' : '−';
    });
    
    canvas.canvas.addEventListener('canvasChanged', () => {
        renderLayers();
        saveCurrentBoard();
    });
    
    canvas.canvas.addEventListener('imageSelected', (e) => {
        highlightLayer(e.detail ? e.detail.id : null);
    });
}

function saveCurrentBoard() {
    const images = canvas.getImages();
    const layers = images.map(img => ({
        id: img.id,
        name: img.name,
        src: img.img.src,
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height
    }));
    const thumbnail = canvas.generateThumbnail(200, 150);
    const bgColor = canvas.bgColor;
    lastSyncTime = Date.now();
    boardManager.updateBoard(currentBoardId, { layers, thumbnail, bgColor });
}

function renderLayers() {
    const layersList = document.getElementById('layers-list');
    const images = canvas.getImages();
    
    if (images.length === 0) {
        layersList.innerHTML = '<div class="empty-message">No layers yet</div>';
        return;
    }
    
    layersList.innerHTML = '';
    
    [...images].reverse().forEach((img, index) => {
        const layerItem = document.createElement('div');
        layerItem.className = 'layer-item';
        layerItem.setAttribute('data-layer-id', img.id);
        
        const layerContent = document.createElement('div');
        layerContent.className = 'layer-content';
        
        const layerName = document.createElement('input');
        layerName.type = 'text';
        layerName.className = 'layer-name-input';
        layerName.value = img.name;
        layerName.addEventListener('change', (e) => {
            canvas.renameLayer(img.id, e.target.value);
            saveCurrentBoard();
        });
        layerName.addEventListener('click', (e) => e.stopPropagation());
        
        const layerControls = document.createElement('div');
        layerControls.className = 'layer-controls';
        
        const upBtn = document.createElement('button');
        upBtn.textContent = '↑';
        upBtn.className = 'layer-btn';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            canvas.moveLayer(img.id, 'up');
            renderLayers();
        });
        
        const downBtn = document.createElement('button');
        downBtn.textContent = '↓';
        downBtn.className = 'layer-btn';
        downBtn.disabled = index === images.length - 1;
        downBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            canvas.moveLayer(img.id, 'down');
            renderLayers();
        });
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.className = 'layer-btn layer-btn-delete';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Delete this layer?')) {
                canvas.deleteImage(img.id);
                renderLayers();
            }
        });
        
        layerControls.appendChild(upBtn);
        layerControls.appendChild(downBtn);
        layerControls.appendChild(deleteBtn);
        
        layerContent.appendChild(layerName);
        layerItem.appendChild(layerContent);
        layerItem.appendChild(layerControls);
        
        layerItem.addEventListener('click', () => {
            canvas.selectImage(img);
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

function renderAssets() {
    const assetsGrid = document.getElementById('assets-grid');
    const board = boardManager.currentBoard;
    
    if (!board || !board.assets || board.assets.length === 0) {
        assetsGrid.innerHTML = '<div class="empty-message">No assets yet</div>';
        return;
    }
    
    assetsGrid.innerHTML = '';
    board.assets.forEach(asset => {
        const assetItem = document.createElement('div');
        assetItem.className = 'asset-item';
        const img = document.createElement('img');
        img.src = asset.src;
        assetItem.appendChild(img);
        
        assetItem.addEventListener('click', () => {
            const imgElement = new Image();
            imgElement.onload = () => {
                canvas.addImage(imgElement, 100, 100, asset.name);
                renderLayers();
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
                
                board.assets.push({
                    id: Date.now() + Math.random(),
                    src: event.target.result,
                    name: file.name
                });
                
                await boardManager.updateBoard(currentBoardId, { assets: board.assets });
                renderAssets();
            };
            reader.readAsDataURL(file);
        });
    };
    
    input.click();
}

async function openFloatingWindow() {
    saveCurrentBoard();
    
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