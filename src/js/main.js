// Main - Homepage logic
import { boardManager } from './board-manager.js';
import { showCreateBoardModal } from './modal.js';

let currentPage = 1;
const BOARDS_PER_PAGE = 14;
let currentSort = 'latest';

document.addEventListener('DOMContentLoaded', async () => {
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
}

function renderBoards() {
    let boards = boardManager.getAllBoards();
    
    // Sort
    if (currentSort === 'latest') {
        boards.sort((a, b) => b.createdAt - a.createdAt);
    } else if (currentSort === 'oldest') {
        boards.sort((a, b) => a.createdAt - b.createdAt);
    } else if (currentSort === 'name') {
        boards.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    const grid = document.getElementById('boards-grid');
    const newBoardCard = document.getElementById('new-board-btn');
    
    grid.innerHTML = '';
    grid.appendChild(newBoardCard);
    
    // Pagination
    const startIdx = (currentPage - 1) * BOARDS_PER_PAGE;
    const endIdx = startIdx + BOARDS_PER_PAGE;
    const paginatedBoards = boards.slice(startIdx, endIdx);
    
    // Render boards
    paginatedBoards.forEach(board => {
        const card = document.createElement('div');
        card.className = 'board-card';
        card.style.backgroundColor = board.bgColor;
        card.innerHTML = `<div class="board-card-name">${board.name}</div>`;
        card.addEventListener('click', () => openBoard(board.id));
        grid.appendChild(card);
    });
    
    // Update pagination
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

function openBoard(boardId) {
    window.location.href = `editor.html?id=${boardId}`;
}