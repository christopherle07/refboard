export function createModal(title, bodyHTML, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>${title}</h2>
            </div>
            <div class="modal-body">
                ${bodyHTML}
            </div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-secondary" data-action="cancel">Cancel</button>
                <button class="modal-btn modal-btn-primary" data-action="confirm">Confirm</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Make modal visible
    setTimeout(() => {
        modal.style.display = 'flex';
    }, 10);

    const closeModal = () => {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.remove();
        }, 250);
    };
    
    modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        if (onConfirm) onConfirm();
        closeModal();
    });
    
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        closeModal();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    return modal;
}

const SKIP_CONFIRM_KEY = 'skip_delete_confirm';

export function showDeleteConfirm(itemName, onConfirm) {
    if (localStorage.getItem(SKIP_CONFIRM_KEY) === 'true') {
        onConfirm();
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Delete "${itemName}"?</h2>
            </div>
            <div class="modal-body">
                <p class="delete-warning">This action cannot be undone.</p>
                <label class="dont-show-checkbox">
                    <input type="checkbox" id="dont-show-again">
                    <span>Don't show again</span>
                </label>
            </div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-secondary" data-action="cancel">Cancel</button>
                <button class="modal-btn modal-btn-danger" data-action="confirm">Delete</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Make modal visible
    setTimeout(() => {
        modal.style.display = 'flex';
    }, 10);

    const closeModal = () => {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.remove();
        }, 250);
    };

    modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        if (modal.querySelector('#dont-show-again').checked) {
            localStorage.setItem(SKIP_CONFIRM_KEY, 'true');
        }
        onConfirm();
        closeModal();
    });
    
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        closeModal();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    return modal;
}

export function showEditBoardModal(currentName, currentBgColor, onConfirm) {
    let selectedColor = currentBgColor || '#ffffff';

    const bodyHTML = `
        <div class="form-group">
            <label>Board Name</label>
            <input type="text" id="edit-board-name-input" value="${currentName}" autofocus>
        </div>
        <div class="form-group">
            <label>Background Color</label>
            <div class="color-swatch-btn" id="edit-board-color-swatch" style="background: ${selectedColor};"></div>
        </div>
    `;

    const modal = createModal('Edit Board', bodyHTML, () => {
        const name = document.getElementById('edit-board-name-input').value.trim() || currentName;
        if (onConfirm) onConfirm(name, selectedColor);
    });

    // Select existing text for easy replacement
    setTimeout(() => {
        const input = modal.querySelector('#edit-board-name-input');
        if (input) input.select();
    }, 50);

    // Wire up color swatch to open custom picker
    import('./color-picker.js').then(({ openColorPicker }) => {
        const swatch = modal.querySelector('#edit-board-color-swatch');
        if (swatch) {
            swatch.addEventListener('click', () => {
                openColorPicker(selectedColor, (hex) => {
                    selectedColor = hex;
                    swatch.style.background = hex;
                });
            });
        }
    });

    return modal;
}

export function showCreateBoardModal(onConfirm) {
    let selectedColor = '#ffffff';

    const bodyHTML = `
        <div class="form-group">
            <label>Board Name</label>
            <input type="text" id="board-name-input" placeholder="Untitled Board" autofocus>
        </div>
        <div class="form-group">
            <label>Background Color</label>
            <div class="color-swatch-btn" id="board-color-swatch" style="background: #ffffff;"></div>
        </div>
    `;

    const modal = createModal('Create New Board', bodyHTML, () => {
        const name = document.getElementById('board-name-input').value.trim() || 'Untitled Board';
        if (onConfirm) onConfirm(name, selectedColor);
    });

    // Wire up color swatch to open custom picker
    import('./color-picker.js').then(({ openColorPicker }) => {
        const swatch = modal.querySelector('#board-color-swatch');
        if (swatch) {
            swatch.addEventListener('click', () => {
                openColorPicker(selectedColor, (hex) => {
                    selectedColor = hex;
                    swatch.style.background = hex;
                });
            });
        }
    });

    return modal;
}