import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';

let canvas;
let currentBoardId;
let isPinned = false;
let syncInterval = null;
let lastSyncTime = 0;
let isLoading = false;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    if (!currentBoardId) return;
    
    await initFloatingWindow();
    setupTitlebarControls();
    startSync();
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
    lastSyncTime = board.updatedAt || board.updated_at || Date.now();
    
    canvas.canvas.addEventListener('canvasChanged', saveToBoard);
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
            const bgColor = board.bgColor || board.bg_color;
            canvas.setBackgroundColor(bgColor);
            document.body.style.backgroundColor = bgColor;
            updateTitlebarTheme(bgColor);
            await loadLayers(board.layers);
        }
    }, 500);
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
            if (syncInterval) clearInterval(syncInterval);
            await currentWindow.close();
        });
    } catch (err) {
        console.error('Titlebar setup error:', err);
    }
}

function saveToBoard() {
    if (isLoading) return;
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
    lastSyncTime = Date.now();
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