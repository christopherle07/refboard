/**
 * Modal and Toast Utilities
 * Provides custom modals and toast notifications with theme support
 */

let toastContainer = null;

function ensureToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

export function showToast(message, type = 'info', duration = 3000) {
    const container = ensureToastContainer();

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ',
        warning: '⚠'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close">×</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));

    container.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => removeToast(toast), duration);
    }

    return toast;
}

function removeToast(toast) {
    toast.classList.add('removing');
    setTimeout(() => {
        if (toast.parentElement) {
            toast.parentElement.removeChild(toast);
        }
    }, 250);
}

export function showInputModal(title, message, defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h2>${title}</h2>
                </div>
                <div class="modal-body">
                    ${message ? `<p class="modal-text">${message}</p>` : ''}
                    <div class="form-group">
                        <input type="text" id="modal-input" value="${defaultValue}" placeholder="${placeholder}" autocomplete="off">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="modal-btn modal-btn-primary" id="modal-confirm">OK</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input = overlay.querySelector('#modal-input');
        const confirmBtn = overlay.querySelector('#modal-confirm');
        const cancelBtn = overlay.querySelector('#modal-cancel');

        input.focus();
        input.select();

        const close = (value) => {
            overlay.classList.add('closing');
            setTimeout(() => {
                document.body.removeChild(overlay);
                resolve(value);
            }, 250);
        };

        confirmBtn.addEventListener('click', () => {
            const value = input.value.trim();
            if (value) {
                close(value);
            }
        });

        cancelBtn.addEventListener('click', () => close(null));

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const value = input.value.trim();
                if (value) {
                    close(value);
                }
            } else if (e.key === 'Escape') {
                close(null);
            }
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close(null);
            }
        });
    });
}

export function showChoiceModal(title, message, choices) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const buttonsHtml = choices.map((choice, index) => `
            <button class="modal-btn-large ${choice.className || ''}" data-index="${index}">
                <div class="btn-title">${choice.title}</div>
                ${choice.subtitle ? `<div class="btn-subtitle">${choice.subtitle}</div>` : ''}
            </button>
        `).join('');

        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h2>${title}</h2>
                </div>
                <div class="modal-body">
                    <p class="modal-text">${message}</p>
                    <div class="modal-btn-group">
                        ${buttonsHtml}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = (value) => {
            overlay.classList.add('closing');
            setTimeout(() => {
                document.body.removeChild(overlay);
                resolve(value);
            }, 250);
        };

        overlay.querySelectorAll('.modal-btn-large').forEach((btn) => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                close(choices[index].value);
            });
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close(null);
            }
        });

        document.addEventListener('keydown', function escapeHandler(e) {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', escapeHandler);
                close(null);
            }
        });
    });
}

export function showConfirmModal(title, message, confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h2>${title}</h2>
                </div>
                <div class="modal-body">
                    <p class="modal-text">${message}</p>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-secondary" id="modal-cancel">${cancelText}</button>
                    <button class="modal-btn ${isDanger ? 'modal-btn-danger' : 'modal-btn-primary'}" id="modal-confirm">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const confirmBtn = overlay.querySelector('#modal-confirm');
        const cancelBtn = overlay.querySelector('#modal-cancel');

        const close = (confirmed) => {
            overlay.classList.add('closing');
            setTimeout(() => {
                document.body.removeChild(overlay);
                resolve(confirmed);
            }, 250);
        };

        confirmBtn.addEventListener('click', () => close(true));
        cancelBtn.addEventListener('click', () => close(false));

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close(false);
            }
        });

        document.addEventListener('keydown', function escapeHandler(e) {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', escapeHandler);
                close(false);
            }
        });
    });
}
