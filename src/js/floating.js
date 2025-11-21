// Floating window - minimal canvas viewer
import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';

let canvas;
let currentBoardId;
let isPinned = false;

console.log('Floating.js loaded');

document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded');
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    console.log('Board ID:', currentBoardId);
    
    if (!currentBoardId) {
        console.error('No board ID');
        return;
    }
    
    await initFloatingWindow();
    setupTitlebarControls();
    startSync();
});

async function initFloatingWindow() {
    console.log('Initializing floating window');
    
    await boardManager.loadBoards();
    const board = await boardManager.getBoard(currentBoardId);
    
    console.log('Board loaded:', board);
    
    if (!board) {
        console.error('Board not found');
        return;
    }
    
    // Set window title
    document.getElementById('window-title').textContent = board.name;
    
    const canvasElement = document.getElementById('floating-canvas');
    console.log('Canvas element:', canvasElement);
    
    canvas = new Canvas(canvasElement);
    document.body.style.backgroundColor = board.bgColor;
    updateTitlebarTheme(board.bgColor);
    
    console.log('Canvas initialized, layers:', board.layers);
    
    if (board.layers && board.layers.length > 0) {
        board.layers.forEach(layer => {
            const img = new Image();
            img.onload = () => {
                console.log('Image loaded:', layer.name);
                canvas.addImage(img, layer.x, layer.y, layer.name, layer.width, layer.height);
            };
            img.onerror = (e) => {
                console.error('Image failed to load:', e);
            };
            img.src = layer.src;
        });
    }
    
    // Listen to canvas changes and save
    canvas.canvas.addEventListener('canvasChanged', () => {
        saveToBoard();
    });
}

async function setupTitlebarControls() {
    try {
        const { getCurrent } = window.__TAURI__.webviewWindow;
        const currentWindow = getCurrent();
        
        console.log('Setting up titlebar controls');
        
        // Set initial state to unpinned
        await currentWindow.setAlwaysOnTop(false);
        isPinned = false;
        console.log('Initial state set');
        
        // Pin button
        document.getElementById('pin-btn').addEventListener('click', async () => {
            try {
                isPinned = !isPinned;
                console.log('Pin clicked, new state:', isPinned);
                await currentWindow.setAlwaysOnTop(isPinned);
                document.getElementById('pin-btn').classList.toggle('pinned', isPinned);
            } catch (err) {
                console.error('Pin error:', err);
            }
        });
        
        // Minimize button
        document.getElementById('minimize-btn').addEventListener('click', async () => {
            try {
                console.log('Minimize clicked');
                await currentWindow.minimize();
            } catch (err) {
                console.error('Minimize error:', err);
            }
        });
        
        // Close button
        document.getElementById('close-btn').addEventListener('click', async () => {
            try {
                console.log('Close clicked');
                await currentWindow.close();
            } catch (err) {
                console.error('Close error:', err);
            }
        });
    } catch (err) {
        console.error('Setup titlebar error:', err);
    }
}

function saveToBoard() {
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
    boardManager.updateBoard(currentBoardId, { layers });
}

function startSync() {
    // Poll for updates from main window every 500ms
    setInterval(async () => {
        const board = await boardManager.getBoard(currentBoardId);
        if (!board) return;
        
        // Update background color if changed
        const currentBg = document.body.style.backgroundColor;
        const boardBg = board.bgColor;
        if (currentBg !== boardBg) {
            document.body.style.backgroundColor = boardBg;
            updateTitlebarTheme(boardBg);
        }
        
        // Check if layers changed (only if not currently dragging)
        if (!canvas.isDragging && !canvas.isResizing) {
            const currentImages = canvas.getImages();
            
            // Simple check: if layer count differs or layer IDs differ, resync
            if (!board.layers || board.layers.length !== currentImages.length) {
                resyncLayers(board.layers);
            } else {
                // Check if any layer IDs are different
                const currentIds = currentImages.map(img => img.id).sort();
                const boardIds = board.layers.map(l => l.id).sort();
                if (JSON.stringify(currentIds) !== JSON.stringify(boardIds)) {
                    resyncLayers(board.layers);
                }
            }
        }
    }, 500);
}

function resyncLayers(layers) {
    canvas.clear();
    if (layers && layers.length > 0) {
        layers.forEach(layer => {
            const img = new Image();
            img.onload = () => {
                canvas.addImage(img, layer.x, layer.y, layer.name, layer.width, layer.height);
            };
            img.src = layer.src;
        });
    }
}

function updateTitlebarTheme(bgColor) {
    // Convert hex to RGB
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    const titlebar = document.querySelector('.titlebar');
    if (luminance < 0.5) {
        // Dark background
        titlebar.classList.add('dark-mode');
    } else {
        // Light background
        titlebar.classList.remove('dark-mode');
    }
}