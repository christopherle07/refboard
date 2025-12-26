import { boardManager } from './board-manager.js';
import { showCreateBoardModal, showDeleteConfirm } from './modal.js';
import { showToast } from './modal-utils.js';
import CollectionManager from './collection-manager.js';
import { showSettingsModal } from './settingsModal.js';
import { showLibraryModal } from './library.js';

// Apply theme on page load
const savedSettings = JSON.parse(localStorage.getItem('canvas_settings') || '{}');
const theme = savedSettings.theme || 'light';
document.documentElement.setAttribute('data-theme', theme);
document.body.setAttribute('data-theme', theme);
console.log('Applied theme on load:', theme);

let currentPage = 1;
const BOARDS_PER_PAGE = 14;
let currentSort = 'latest';
let currentCollectionId = null; // null means "All Boards"
const collectionManager = new CollectionManager();

// Time formatting utility
function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return 'Edited just now';
    if (minutes < 60) return `Edited ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    if (hours < 24) return `Edited ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    if (days < 30) return `Edited ${days} ${days === 1 ? 'day' : 'days'} ago`;
    if (months < 12) return `Edited ${months} ${months === 1 ? 'month' : 'months'} ago`;
    return `Edited ${years} ${years === 1 ? 'year' : 'years'} ago`;
}

// Layer count utility
function getLayerCount(board) {
    return board.layers?.length || 0;
}


// Export init function for ViewManager
export async function initHomepage() {
    console.log('[initHomepage] Starting homepage initialization...');
    try {
        console.log('[initHomepage] Loading boards...');
        await boardManager.loadBoards();
        console.log('[initHomepage] Rendering boards...');
        renderBoards();
        console.log('[initHomepage] Setting up event listeners...');
        setupEventListeners();
        console.log('[initHomepage] Homepage initialization complete!');
    } catch (error) {
        console.error('[initHomepage] Error during initialization:', error);
        throw error;
    }
}

// Track if event listeners have been set up
let eventListenersSetup = false;

function setupEventListeners() {
    // Prevent duplicate event listener setup
    if (eventListenersSetup) return;
    eventListenersSetup = true;

    // Board search
    const searchInput = document.getElementById('board-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderBoards();
        });
    }

    // New board button (titlebar)
    const newBoardBtn = document.getElementById('new-board-btn');
    if (newBoardBtn) {
        newBoardBtn.addEventListener('click', () => {
            showCreateBoardModal((name, bgColor) => {
                createBoard(name, bgColor);
            });
        });
    }

    // New board button (search area)
    const newBoardBtnSearch = document.getElementById('new-board-btn-search');
    if (newBoardBtnSearch) {
        newBoardBtnSearch.addEventListener('click', () => {
            showCreateBoardModal((name, bgColor) => {
                createBoard(name, bgColor);
            });
        });
    }

    // Import board button (titlebar)
    const importBtn = document.getElementById('import-board-btn');
    if (importBtn) {
        importBtn.addEventListener('click', importBoardAsNew);
    }

    // Import board button (search area)
    const importBtnSearch = document.getElementById('import-board-btn-search');
    if (importBtnSearch) {
        importBtnSearch.addEventListener('click', importBoardAsNew);
    }

    // Library button
    const libraryBtn = document.getElementById('library-btn');
    if (libraryBtn) {
        libraryBtn.addEventListener('click', () => {
            showLibraryModal();
        });
    }

    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            showSettingsModal();
        });
    }
}

function renderBoards() {
    let boards = [...boardManager.getAllBoards()];
    console.log('[renderBoards] Total boards:', boards.length);

    // Filter by search query
    const searchInput = document.getElementById('board-search');
    if (searchInput) {
        const searchQuery = searchInput.value.toLowerCase().trim();
        if (searchQuery) {
            boards = boards.filter(board =>
                board.name.toLowerCase().includes(searchQuery)
            );
            console.log('[renderBoards] After search filter:', boards.length);
        }
    }

    // Filter by collection if one is selected
    if (currentCollectionId) {
        const collection = collectionManager.getCollection(currentCollectionId);
        if (collection) {
            boards = boards.filter(board => collection.boardIds.includes(board.id));
            console.log('[renderBoards] After collection filter:', boards.length);
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
    if (!grid) {
        console.error('[renderBoards] boards-grid element not found!');
        return;
    }
    grid.innerHTML = '';
    console.log('[renderBoards] Rendering', boards.length, 'boards');

    // Show empty state if no boards
    if (boards.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-boards-state';
        emptyState.innerHTML = `
            <h3>No boards found</h3>
            <p>Click the + button to create your first board</p>
        `;
        grid.appendChild(emptyState);
        return;
    }

    boards.forEach(board => {
        const card = document.createElement('div');
        card.className = 'board-card';

        const timestamp = board.updatedAt || board.updated_at || board.createdAt || board.created_at || Date.now();
        const lastModified = formatTimeAgo(timestamp);

        card.innerHTML = `
            <div class="board-card-thumbnail"></div>
            <div class="board-card-content">
                <div class="board-card-title">${board.name}</div>
                <div class="board-card-meta">
                    <span class="board-card-date">${lastModified}</span>
                </div>
            </div>
        `;

        const thumbnailDiv = card.querySelector('.board-card-thumbnail');
        if (board.thumbnail) {
            const img = document.createElement('img');
            img.src = board.thumbnail;
            img.alt = board.name;
            thumbnailDiv.appendChild(img);
        } else {
            const bgColor = board.bgColor || board.bg_color || '#f0f0f0';
            thumbnailDiv.style.backgroundColor = bgColor;
        }

        // Add delete button after thumbnail content
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'board-delete-btn';
        deleteBtn.title = 'Delete board';
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent opening the board

            showDeleteConfirm(`board "${board.name}"`, async () => {
                await deleteBoard(board.id);
            });
        });
        thumbnailDiv.appendChild(deleteBtn);

        card.addEventListener('click', () => openBoard(board.id));

        // Add right-click context menu
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showBoardContextMenu(e, board.id);
        });

        grid.appendChild(card);
    });
}

async function createBoard(name, bgColor) {
    const board = await boardManager.createBoard(name, bgColor);
    renderBoards();
    openBoard(board.id);
}

async function deleteBoard(boardId) {
    console.log('[deleteBoard] Starting delete for board:', boardId);
    console.log('[deleteBoard] Boards before delete:', boardManager.getAllBoards().length);
    await boardManager.deleteBoard(boardId);
    console.log('[deleteBoard] Boards after delete:', boardManager.getAllBoards().length);
    console.log('[deleteBoard] Calling renderBoards...');
    renderBoards();
    console.log('[deleteBoard] renderBoards complete');
}

async function openBoard(boardId) {
    console.log('[openBoard] Opening board:', boardId);
    // Get board name for breadcrumb
    const board = await boardManager.getBoard(boardId);
    console.log('[openBoard] Board data:', board);

    if (!board) {
        console.error('[openBoard] Board not found:', boardId);
        return;
    }

    if (!window.appInstance) {
        console.error('[openBoard] App instance not available');
        return;
    }

    console.log('[openBoard] Opening board:', boardId, board.name);
    await window.appInstance.openBoard(boardId, board.name);
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
    if (!collectionsContainer) return; // Skip if element doesn't exist (new homepage design)
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

// Keyboard Shortcuts Modal
function showKeyboardShortcutsModal() {
    const overlay = document.getElementById('shortcuts-modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';

    // Close button
    const closeBtn = document.getElementById('shortcuts-modal-close');
    closeBtn.onclick = () => closeShortcutsModal();

    // Close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeShortcutsModal();
        }
    };

    // Close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeShortcutsModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
}

function closeShortcutsModal() {
    const overlay = document.getElementById('shortcuts-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
}

// Export state management functions for ViewManager
export function saveHomeState() {
    return {
        currentPage,
        currentSort,
        currentCollectionId,
        scrollPosition: {
            x: window.scrollX,
            y: window.scrollY
        }
    };
}

export function restoreHomeState(state) {
    if (!state) return;

    currentPage = state.currentPage || 1;
    currentSort = state.currentSort || 'latest';
    currentCollectionId = state.currentCollectionId || null;

    // Update UI
    const sortFilter = document.getElementById('sort-filter');
    if (sortFilter) {
        sortFilter.value = currentSort;
    }

    // Re-render with saved state
    renderCollections();
    renderBoards();

    // Restore scroll position
    if (state.scrollPosition) {
        window.scrollTo(state.scrollPosition.x, state.scrollPosition.y);
    }
}