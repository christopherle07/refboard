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
    
    modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        if (onConfirm) onConfirm();
        modal.remove();
    });
    
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        modal.remove();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
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
    
    modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        if (modal.querySelector('#dont-show-again').checked) {
            localStorage.setItem(SKIP_CONFIRM_KEY, 'true');
        }
        onConfirm();
        modal.remove();
    });
    
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        modal.remove();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    return modal;
}

export function showCreateBoardModal(onConfirm) {
    const bodyHTML = `
        <div class="form-group">
            <label>Board Name</label>
            <input type="text" id="board-name-input" placeholder="Untitled Board" autofocus>
        </div>
        <div class="form-group">
            <label>Background Color</label>
            <input type="color" id="board-color-input" value="#ffffff">
        </div>
    `;
    
    const modal = createModal('Create New Board', bodyHTML, () => {
        const name = document.getElementById('board-name-input').value.trim() || 'Untitled Board';
        const bgColor = document.getElementById('board-color-input').value;
        if (onConfirm) onConfirm(name, bgColor);
    });
    
    return modal;
}