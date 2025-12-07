import { boardManager } from './board-manager.js';
import { showCreateBoardModal, showDeleteConfirm } from './modal.js';
import { showToast } from './modal-utils.js';
import { initAutoUpdateCheck, checkForUpdates } from './updater.js';
import { showUpdateNotification } from './update-ui.js';
import CollectionManager from './collection-manager.js';

let currentPage = 1;
const BOARDS_PER_PAGE = 14;
let currentSort = 'latest';
let currentCollectionId = null; // null means "All Boards"
const collectionManager = new CollectionManager();

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
    renderCollections();
    renderBoards();
    setupEventListeners();
    loadVersionInfo();

    // Check for updates 5 seconds after app loads
    initAutoUpdateCheck(showUpdateNotification);
});

function setupEventListeners() {
    // Sidebar new board button
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

    // Check for updates button
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', async () => {
            const update = await checkForUpdates();
            if (update.available) {
                showUpdateNotification(update);
            } else {
                showToast('You are on the latest version', 'success');
            }
        });
    }

    // All Boards button - clear collection filter
    document.getElementById('all-boards-btn').addEventListener('click', () => {
        currentCollectionId = null;
        currentPage = 1;
        updateActiveNavigationButton('all-boards-btn');
        renderCollections(); // Re-render to clear active states
        renderBoards();
    });

    // New Collection button
    document.getElementById('new-collection-btn').addEventListener('click', () => {
        showCreateCollectionModal();
    });

}

function renderBoards() {
    let boards = [...boardManager.getAllBoards()];

    // Filter by collection if one is selected
    if (currentCollectionId) {
        const collection = collectionManager.getCollection(currentCollectionId);
        if (collection) {
            boards = boards.filter(board => collection.boardIds.includes(board.id));
        }
    }

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

    // Show empty state message if viewing an empty collection
    if (currentCollectionId && boards.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-collection-message';
        emptyState.innerHTML = `
            <h3>This collection is empty</h3>
            <p>Go to <strong>All Boards</strong> and right-click on any board to add it to this collection.</p>
        `;
        grid.appendChild(emptyState);
        return;
    }

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

        // Add right-click context menu
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showBoardContextMenu(e, board.id);
        });

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
    input.accept = '.eyed,application/json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importData = JSON.parse(event.target.result);

                if (!importData.version || !importData.layers) {
                    showToast('Invalid .eyed file format', 'error');
                    return;
                }

                const boardName = importData.name || file.name.replace('.eyed', '');
                const bgColor = importData.bgColor || '#ffffff';

                console.log('[IMPORT AS NEW] Creating board with:', {
                    layers: importData.layers?.length || 0,
                    assets: importData.assets?.length || 0,
                    strokes: importData.strokes?.length || 0,
                    objects: importData.objects?.length || 0
                });

                const newBoard = await boardManager.createBoard(boardName, bgColor);

                // Import EVERYTHING
                const updates = {};
                if (importData.layers) updates.layers = importData.layers;
                if (importData.assets) updates.assets = importData.assets;
                if (importData.strokes) updates.strokes = importData.strokes;
                if (importData.objects) updates.objects = importData.objects;
                if (importData.groups) updates.groups = importData.groups;
                if (importData.viewState) updates.viewState = importData.viewState;

                await boardManager.updateBoard(newBoard.id, updates);

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

function renderCollections() {
    const collectionsContainer = document.getElementById('collections-list');
    collectionsContainer.innerHTML = '';

    const collections = collectionManager.getAllCollections();

    collections.forEach(collection => {
        const item = document.createElement('button');
        item.className = 'collection-item';
        if (currentCollectionId === collection.id) {
            item.classList.add('active');
        }

        const boardCount = collection.boardIds.length;

        item.innerHTML = `
            <span class="collection-name">${collection.name}</span>
            <span class="collection-count">${boardCount}</span>
        `;

        item.addEventListener('click', () => {
            currentCollectionId = collection.id;
            currentPage = 1;
            updateActiveNavigationButton(null); // Clear navigation active state
            renderCollections(); // Re-render to update active state
            renderBoards();
        });

        // Add right-click context menu
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showCollectionContextMenu(e, collection.id);
        });

        collectionsContainer.appendChild(item);
    });
}

function updateActiveNavigationButton(buttonId) {
    // Remove active from all navigation buttons
    document.querySelectorAll('.sidebar-section .sidebar-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active to specified button
    if (buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.classList.add('active');
        }
    }
}

function showCreateCollectionModal() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const modal = document.createElement('div');
    modal.className = 'modal';

    modal.innerHTML = `
        <div class="modal-header">
            <h2>New Collection</h2>
            <button class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
            <label class="modal-label">Collection Name</label>
            <input type="text" id="collection-name-input" class="modal-input" placeholder="My Collection" autofocus>
        </div>
        <div class="modal-footer">
            <button class="modal-btn modal-btn-secondary" id="cancel-collection-btn">Cancel</button>
            <button class="modal-btn modal-btn-primary" id="create-collection-btn">Create</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nameInput = modal.querySelector('#collection-name-input');
    const createBtn = modal.querySelector('#create-collection-btn');
    const cancelBtn = modal.querySelector('#cancel-collection-btn');
    const closeBtn = modal.querySelector('.modal-close-btn');

    const closeModal = () => {
        overlay.remove();
    };

    const createCollection = () => {
        const name = nameInput.value.trim();
        if (!name) {
            showToast('Please enter a collection name', 'error');
            return;
        }

        collectionManager.createCollection(name);
        renderCollections();
        showToast(`Collection "${name}" created`, 'success');
        closeModal();
    };

    createBtn.addEventListener('click', createCollection);
    cancelBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createCollection();
        }
    });

    setTimeout(() => nameInput.focus(), 100);
}

function showBoardContextMenu(event, boardId) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    const collections = collectionManager.getAllCollections();
    const boardCollections = collectionManager.getBoardCollections(boardId);

    let menuHTML = '<div class="context-menu-header">Add to Collection</div>';

    if (collections.length === 0) {
        menuHTML += '<div class="context-menu-item disabled">No collections yet</div>';
    } else {
        collections.forEach(collection => {
            const isInCollection = boardCollections.some(bc => bc.id === collection.id);
            menuHTML += `
                <div class="context-menu-item ${isInCollection ? 'checked' : ''}" data-collection-id="${collection.id}">
                    <span class="context-menu-check">${isInCollection ? '✓' : ''}</span>
                    <span>${collection.name}</span>
                </div>
            `;
        });
    }

    menu.innerHTML = menuHTML;
    document.body.appendChild(menu);

    // Add click handlers
    menu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', () => {
            const collectionId = item.dataset.collectionId;
            const isChecked = item.classList.contains('checked');

            if (isChecked) {
                collectionManager.removeBoardFromCollection(collectionId, boardId);
                showToast('Removed from collection', 'success');
            } else {
                collectionManager.addBoardToCollection(collectionId, boardId);
                const collection = collectionManager.getCollection(collectionId);
                showToast(`Added to "${collection.name}"`, 'success');
            }

            renderCollections();
            menu.remove();
        });
    });

    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 10);
}

function showCollectionContextMenu(event, collectionId) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    menu.innerHTML = `
        <div class="context-menu-item" data-action="rename">
            <span>✏️</span>
            <span>Rename</span>
        </div>
        <div class="context-menu-item" data-action="delete" style="color: #f44;">
            <span>🗑️</span>
            <span>Delete</span>
        </div>
    `;

    document.body.appendChild(menu);

    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;

            if (action === 'rename') {
                showRenameCollectionModal(collectionId);
            } else if (action === 'delete') {
                const collection = collectionManager.getCollection(collectionId);
                showDeleteConfirm(
                    `collection "${collection.name}"`,
                    () => {
                        collectionManager.deleteCollection(collectionId);
                        if (currentCollectionId === collectionId) {
                            currentCollectionId = null;
                            updateActiveNavigationButton('all-boards-btn');
                        }
                        renderCollections();
                        renderBoards();
                        showToast('Collection deleted', 'success');
                    }
                );
            }

            menu.remove();
        });
    });

    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 10);
}

function showRenameCollectionModal(collectionId) {
    const collection = collectionManager.getCollection(collectionId);
    if (!collection) return;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const modal = document.createElement('div');
    modal.className = 'modal';

    modal.innerHTML = `
        <div class="modal-header">
            <h2>Rename Collection</h2>
            <button class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
            <label class="modal-label">Collection Name</label>
            <input type="text" id="rename-collection-input" class="modal-input" value="${collection.name}" autofocus>
        </div>
        <div class="modal-footer">
            <button class="modal-btn modal-btn-secondary" id="cancel-rename-btn">Cancel</button>
            <button class="modal-btn modal-btn-primary" id="rename-btn">Rename</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nameInput = modal.querySelector('#rename-collection-input');
    const renameBtn = modal.querySelector('#rename-btn');
    const cancelBtn = modal.querySelector('#cancel-rename-btn');
    const closeBtn = modal.querySelector('.modal-close-btn');

    const closeModal = () => {
        overlay.remove();
    };

    const renameCollection = () => {
        const newName = nameInput.value.trim();
        if (!newName) {
            showToast('Please enter a collection name', 'error');
            return;
        }

        collectionManager.updateCollection(collectionId, { name: newName });
        renderCollections();
        showToast(`Renamed to "${newName}"`, 'success');
        closeModal();
    };

    renameBtn.addEventListener('click', renameCollection);
    cancelBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            renameCollection();
        }
    });

    setTimeout(() => {
        nameInput.select();
        nameInput.focus();
    }, 100);
}

async function loadVersionInfo() {
    try {
        // Get version from Tauri app (reads from tauri.conf.json)
        const version = await window.__TAURI__.app.getVersion();

        const versionElement = document.getElementById('version-info');
        if (versionElement) {
            versionElement.innerHTML = `<span class="version-text">v${version}</span>`;
        }
    } catch (error) {
        console.error('Failed to load version:', error);
        const versionElement = document.getElementById('version-info');
        if (versionElement) {
            versionElement.innerHTML = `<span class="version-text">Version unavailable</span>`;
        }
    }
}

function showAddBoardsModal(collectionId) {
    const collection = collectionManager.getCollection(collectionId);
    if (!collection) return;

    const allBoards = boardManager.getAllBoards();
    const availableBoards = allBoards.filter(board => !collection.boardIds.includes(board.id));

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';

    let boardsHTML = '';
    if (availableBoards.length === 0) {
        boardsHTML = '<div class="modal-text" style="text-align: center; padding: 20px;">All boards are already in this collection.</div>';
    } else {
        boardsHTML = '<div class="add-boards-grid">';
        availableBoards.forEach(board => {
            const bgColor = board.bgColor || board.bg_color || '#f0f0f0';
            const thumbnail = board.thumbnail || '';
            const bgStyle = thumbnail ? `background-image: url(${thumbnail}); background-size: cover; background-position: center;` : `background-color: ${bgColor};`;

            boardsHTML += `
                <div class="add-board-item" data-board-id="${board.id}" style="${bgStyle}">
                    <div class="add-board-item-name">${board.name}</div>
                    <button class="add-board-item-btn" title="Add to collection">+</button>
                </div>
            `;
        });
        boardsHTML += '</div>';
    }

    modal.innerHTML = `
        <div class="modal-header">
            <h2>Add Boards to "${collection.name}"</h2>
            <button class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
            ${boardsHTML}
        </div>
        <div class="modal-footer">
            <button class="modal-btn modal-btn-secondary" id="close-add-boards-btn">Close</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const closeBtn = modal.querySelector('.modal-close-btn');
    const closeBtnFooter = modal.querySelector('#close-add-boards-btn');

    const closeModal = () => {
        overlay.remove();
        renderCollections();
        renderBoards();
    };

    closeBtn.addEventListener('click', closeModal);
    closeBtnFooter.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Add click handlers for board items
    const addButtons = modal.querySelectorAll('.add-board-item-btn');
    console.log('Found add buttons:', addButtons.length);

    addButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            console.log('Add button clicked!');

            const boardItem = btn.closest('.add-board-item');
            const boardId = boardItem.dataset.boardId;

            console.log('Adding board to collection:', boardId, collectionId);

            const success = collectionManager.addBoardToCollection(collectionId, boardId);
            console.log('Add result:', success);

            if (success) {
                boardItem.remove();
                showToast(`Added to "${collection.name}"`, 'success');

                // Check if there are no more boards
                const remainingBoards = modal.querySelectorAll('.add-board-item');
                if (remainingBoards.length === 0) {
                    const grid = modal.querySelector('.add-boards-grid');
                    if (grid) {
                        grid.innerHTML = '<div class="modal-text" style="text-align: center; padding: 20px;">All boards are now in this collection.</div>';
                    }
                }
            }
        });
    });
}