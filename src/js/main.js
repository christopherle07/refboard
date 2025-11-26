import { boardManager } from './board-manager.js';
import { showCreateBoardModal, showDeleteConfirm } from './modal.js';
import { showToast } from './modal-utils.js';

let currentPage = 1;
const BOARDS_PER_PAGE = 14;
let currentSort = 'latest';

// Initialize theme
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
    await boardManager.loadBoards();
    renderBoards();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('new-board-btn').addEventListener('click', () => {
        showCreateBoardModal((name, bgColor) => {
            createBoard(name, bgColor);
        });
    });
    
    document.getElementById('sort-filter').addEventListener('change', (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        renderBoards();
    });
    
    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderBoards();
        }
    });
    
    document.getElementById('next-page').addEventListener('click', () => {
        const boards = boardManager.getAllBoards();
        const totalPages = Math.ceil(boards.length / BOARDS_PER_PAGE);
        if (currentPage < totalPages) {
            currentPage++;
            renderBoards();
        }
    });
    
    document.getElementById('import-board-btn').addEventListener('click', importBoardAsNew);
    
    document.getElementById('home-btn').addEventListener('click', () => {
        // Already on home
    });
    
    // Settings button with debugging
    const settingsBtn = document.getElementById('settings-btn');
    console.log('Settings button found:', settingsBtn);
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            console.log('Settings button clicked!');
            e.preventDefault();
            window.location.href = 'settings.html';
        });
        console.log('Settings button event listener attached');
    } else {
        console.error('Settings button not found in DOM!');
    }
}

function renderBoards() {
    let boards = [...boardManager.getAllBoards()];
    
    if (currentSort === 'latest') {
        boards.sort((a, b) => (b.createdAt || b.created_at) - (a.createdAt || a.created_at));
    } else if (currentSort === 'oldest') {
        boards.sort((a, b) => (a.createdAt || a.created_at) - (b.createdAt || b.created_at));
    } else if (currentSort === 'name') {
        boards.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    const grid = document.getElementById('boards-grid');
    grid.innerHTML = '';
    
    const startIdx = (currentPage - 1) * BOARDS_PER_PAGE;
    const endIdx = startIdx + BOARDS_PER_PAGE;
    const paginatedBoards = boards.slice(startIdx, endIdx);
    
    paginatedBoards.forEach(board => {
        const card = document.createElement('div');
        card.className = 'board-card';
        const bgColor = board.bgColor || board.bg_color;
        card.style.backgroundColor = bgColor;
        
        if (board.thumbnail) {
            card.style.backgroundImage = `url(${board.thumbnail})`;
            card.style.backgroundSize = 'cover';
            card.style.backgroundPosition = 'center';
        }
        
        card.innerHTML = `
            <button class="board-delete-btn" title="Delete Board">×</button>
            <div class="board-card-name">${board.name}</div>
        `;
        
        card.querySelector('.board-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteConfirm(board.name, () => deleteBoard(board.id));
        });
        
        card.addEventListener('click', () => openBoard(board.id));
        grid.appendChild(card);
    });
    
    const totalPages = Math.ceil(boards.length / BOARDS_PER_PAGE) || 1;
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage >= totalPages;
}

async function createBoard(name, bgColor) {
    const board = await boardManager.createBoard(name, bgColor);
    renderBoards();
    openBoard(board.id);
}

async function deleteBoard(boardId) {
    await boardManager.deleteBoard(boardId);
    renderBoards();
}

function openBoard(boardId) {
    window.location.href = `editor.html?id=${boardId}`;
}

function importBoardAsNew() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.aref,application/json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importData = JSON.parse(event.target.result);

                if (!importData.version || !importData.layers) {
                    showToast('Invalid .aref file format', 'error');
                    return;
                }

                const boardName = importData.name || file.name.replace('.aref', '');
                const bgColor = importData.bgColor || '#ffffff';

                const newBoard = await boardManager.createBoard(boardName, bgColor);

                if (importData.layers && importData.layers.length > 0) {
                    await boardManager.updateBoard(newBoard.id, { layers: importData.layers });
                }

                if (importData.assets && importData.assets.length > 0) {
                    await boardManager.updateBoard(newBoard.id, { assets: importData.assets });
                }

                showToast(`Board "${boardName}" imported successfully`, 'success');
                renderBoards();

                setTimeout(() => {
                    openBoard(newBoard.id);
                }, 500);

            } catch (err) {
                console.error('Import error:', err);
                showToast('Failed to import board: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    };

    input.click();
}