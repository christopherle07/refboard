import { boardManager } from './board-manager.js';
import { showCreateBoardModal, showDeleteConfirm } from './modal.js';

let currentPage = 1;
const BOARDS_PER_PAGE = 14;
let currentSort = 'latest';

document.addEventListener('DOMContentLoaded', async () => {
    await boardManager.loadBoards();
    renderBoards();
    setupEventListeners();
});

function setupEventListeners() {
    // New board button in sidebar
    document.getElementById('new-board-btn').addEventListener('click', () => {
        showCreateBoardModal((name, bgColor) => {
            createBoard(name, bgColor);
        });
    });
    
    // Sort dropdown
    document.getElementById('sort-filter').addEventListener('change', (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        renderBoards();
    });
    
    // Pagination
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
    
    // Placeholder handlers for future features
    document.getElementById('open-btn').addEventListener('click', () => {
        // TODO: Implement board import functionality
        console.log('Open board feature - coming soon');
    });
    
    document.getElementById('home-btn').addEventListener('click', () => {
        // Already on home, do nothing or refresh
    });
    
    document.getElementById('settings-btn').addEventListener('click', () => {
        // TODO: Implement settings page
        console.log('Settings feature - coming soon');
    });
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