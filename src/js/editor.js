import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';
import { showDeleteConfirm } from './modal.js';

let canvas;
let currentBoardId;
let saveTimeout = null;
let pendingSave = false;

// Drag state
let dragSourceIndex = null;
let dragOverIndex = null;
let dragOverPosition = null; // 'above' or 'below'

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    if (!currentBoardId) {
        window.location.href = 'index.html';
        return;
    }
    
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

function renderLayers() {
    const layersList = document.getElementById('layers-list');
    const images = canvas.getImages();
    
    if (images.length === 0) {
        layersList.innerHTML = '<div class="empty-message">No layers yet</div>';
        return;
    }
    
    layersList.innerHTML = '';
    
    // Reverse for display (top layer first in list)
    const reversedImages = [...images].reverse();
    
    reversedImages.forEach((img, displayIndex) => {
        // Real index in canvas.images array
        const realIndex = images.length - 1 - displayIndex;
        
        const layerItem = document.createElement('div');
        layerItem.className = 'layer-item';
        layerItem.setAttribute('data-layer-id', img.id);
        layerItem.setAttribute('data-real-index', realIndex);
        layerItem.setAttribute('draggable', 'true');
        
        if (img.visible === false) {
            layerItem.classList.add('layer-hidden');
        }
        
        // Drag handle (6 dots in 2x3 grid)
        const dragHandle = document.createElement('div');
        dragHandle.className = 'layer-drag-handle';
        dragHandle.innerHTML = `
            <div class="drag-row"><span></span><span></span></div>
            <div class="drag-row"><span></span><span></span></div>
            <div class="drag-row"><span></span><span></span></div>
        `;
        
        // Visibility toggle
        const visibilityBtn = document.createElement('button');
        visibilityBtn.className = 'layer-visibility-btn';
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
            canvas.toggleVisibility(img.id);
            renderLayers();
        });
        
        // Layer name input
        const layerContent = document.createElement('div');
        layerContent.className = 'layer-content';
        
        const layerName = document.createElement('input');
        layerName.type = 'text';
        layerName.className = 'layer-name-input';
        layerName.value = img.name;
        layerName.addEventListener('change', (e) => {
            canvas.renameLayer(img.id, e.target.value);
            scheduleSave();
        });
        layerName.addEventListener('click', (e) => e.stopPropagation());
        layerName.addEventListener('mousedown', (e) => e.stopPropagation());
        
        // Delete button
        const layerControls = document.createElement('div');
        layerControls.className = 'layer-controls';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.className = 'layer-btn-delete';
        deleteBtn.title = 'Delete layer';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
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
        
        // Click to select
        layerItem.addEventListener('click', () => {
            if (img.visible !== false) {
                canvas.selectImage(img);
            }
        });
        
        // ===== DRAG AND DROP EVENTS =====
        
        layerItem.addEventListener('dragstart', (e) => {
            dragSourceIndex = realIndex;
            layerItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(realIndex));
            
            // Need a slight delay for the drag image to be set
            setTimeout(() => {
                layerItem.style.opacity = '0.4';
            }, 0);
        });
        
        layerItem.addEventListener('dragend', (e) => {
            layerItem.classList.remove('dragging');
            layerItem.style.opacity = '';
            
            // Clear all drag-over states
            document.querySelectorAll('.layer-item').forEach(item => {
                item.classList.remove('drag-over-above', 'drag-over-below');
            });
            
            dragSourceIndex = null;
            dragOverIndex = null;
            dragOverPosition = null;
        });
        
        layerItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            if (dragSourceIndex === null) return;
            
            const targetRealIndex = parseInt(layerItem.getAttribute('data-real-index'));
            if (targetRealIndex === dragSourceIndex) return;
            
            // Determine if we're in the top or bottom half of the item
            const rect = layerItem.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const isAbove = e.clientY < midY;
            
            // Clear previous states
            document.querySelectorAll('.layer-item').forEach(item => {
                item.classList.remove('drag-over-above', 'drag-over-below');
            });
            
            // Set new state
            if (isAbove) {
                layerItem.classList.add('drag-over-above');
                dragOverPosition = 'above';
            } else {
                layerItem.classList.add('drag-over-below');
                dragOverPosition = 'below';
            }
            dragOverIndex = targetRealIndex;
        });
        
        layerItem.addEventListener('dragleave', (e) => {
            // Only remove if we're actually leaving (not entering a child element)
            const rect = layerItem.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom) {
                layerItem.classList.remove('drag-over-above', 'drag-over-below');
            }
        });
        
        layerItem.addEventListener('drop', (e) => {
            e.preventDefault();
            
            layerItem.classList.remove('drag-over-above', 'drag-over-below');
            
            if (dragSourceIndex === null || dragOverIndex === null) return;
            
            const fromIndex = dragSourceIndex;
            let toIndex = dragOverIndex;
            
            // Adjust toIndex based on position and direction
            // The list is displayed in reverse, so we need to think carefully:
            // - "above" in display = higher in the layers stack = higher real index
            // - "below" in display = lower in the layers stack = lower real index
            
            if (dragOverPosition === 'above') {
                // Moving above this item means we want to be at a higher index
                if (fromIndex < toIndex) {
                    // Moving up in the display (to higher index)
                    // toIndex stays the same
                } else {
                    // Moving down in the display
                    toIndex = toIndex + 1;
                }
            } else {
                // Moving below this item
                if (fromIndex > toIndex) {
                    // Moving down in display (to lower index)
                    // toIndex stays the same
                } else {
                    // Moving up in display
                    toIndex = toIndex - 1;
                }
            }
            
            // Clamp to valid range
            toIndex = Math.max(0, Math.min(canvas.getImages().length - 1, toIndex));
            
            if (fromIndex !== toIndex) {
                canvas.reorderLayers(fromIndex, toIndex);
                renderLayers();
            }
            
            dragSourceIndex = null;
            dragOverIndex = null;
            dragOverPosition = null;
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
