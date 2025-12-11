import { boardManager } from './board-manager.js';

// Get all images from the global assets system
async function getAllImages() {
    const allAssets = await boardManager.getAllAssets();
    return allAssets || [];
}

// Show download toast notification
function showDownloadToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `download-toast download-toast-${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Remove after 2 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 2000);
}

// Download image
async function downloadImage(src, filename, buttonElement = null) {
    try {
        // Disable button and show loading state
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.style.opacity = '0.5';
            buttonElement.style.cursor = 'not-allowed';
        }

        const response = await fetch(src);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'image.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        // Show success toast
        showDownloadToast('Downloaded!');

        // Re-enable button after a short delay
        if (buttonElement) {
            setTimeout(() => {
                buttonElement.disabled = false;
                buttonElement.style.opacity = '1';
                buttonElement.style.cursor = 'pointer';
            }, 1000);
        }
    } catch (error) {
        console.error('Failed to download image:', error);
        showDownloadToast('Download failed', 'error');

        // Re-enable button immediately on error
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.style.opacity = '1';
            buttonElement.style.cursor = 'pointer';
        }
    }
}

// Show photo album viewer
function showPhotoViewer(images, startIndex) {
    const viewer = document.createElement('div');
    viewer.className = 'photo-viewer-overlay';

    let currentIndex = startIndex;

    const updateViewer = () => {
        const image = images[currentIndex];
        viewer.innerHTML = `
            <div class="photo-viewer">
                <div class="photo-viewer-header">
                    <div class="photo-viewer-info">
                        <span class="photo-viewer-counter">${currentIndex + 1} / ${images.length}</span>
                        <span class="photo-viewer-board">${image.name || 'Image'}</span>
                    </div>
                    <div class="photo-viewer-actions">
                        <button class="photo-viewer-btn" data-action="download" title="Download">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                        <button class="photo-viewer-btn" data-action="close" title="Close">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>

                <div class="photo-viewer-content">
                    <button class="photo-viewer-nav photo-viewer-prev ${currentIndex === 0 ? 'disabled' : ''}" data-action="prev">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>

                    <div class="photo-viewer-image-container">
                        <img src="${image.src}" alt="Image" class="photo-viewer-image">
                    </div>

                    <button class="photo-viewer-nav photo-viewer-next ${currentIndex === images.length - 1 ? 'disabled' : ''}" data-action="next">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        // Event listeners
        viewer.querySelector('[data-action="close"]').addEventListener('click', closeViewer);
        const downloadBtn = viewer.querySelector('[data-action="download"]');
        downloadBtn.addEventListener('click', () => {
            const filename = `image-${Date.now()}.png`;
            downloadImage(image.src, filename, downloadBtn);
        });

        const prevBtn = viewer.querySelector('[data-action="prev"]');
        const nextBtn = viewer.querySelector('[data-action="next"]');

        if (currentIndex > 0) {
            prevBtn.addEventListener('click', () => {
                currentIndex--;
                updateViewer();
            });
        }

        if (currentIndex < images.length - 1) {
            nextBtn.addEventListener('click', () => {
                currentIndex++;
                updateViewer();
            });
        }
    };

    const closeViewer = () => {
        viewer.classList.add('closing');
        setTimeout(() => {
            viewer.remove();
            document.removeEventListener('keydown', keyHandler);
        }, 250);
    };

    // Keyboard navigation
    const keyHandler = (e) => {
        if (e.key === 'Escape') {
            closeViewer();
        } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
            currentIndex--;
            updateViewer();
        } else if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
            currentIndex++;
            updateViewer();
        }
    };
    document.addEventListener('keydown', keyHandler);

    // Click outside to close
    viewer.addEventListener('click', (e) => {
        if (e.target === viewer || e.target.classList.contains('photo-viewer-content')) {
            closeViewer();
        }
    });

    document.body.appendChild(viewer);
    updateViewer();

    // Make visible
    setTimeout(() => {
        viewer.style.display = 'flex';
    }, 10);
}

// Show library modal
export async function showLibraryModal() {
    const modal = document.createElement('div');
    modal.className = 'library-modal-overlay';

    // Show modal immediately with loading skeleton
    modal.innerHTML = `
        <div class="library-modal">
            <div class="library-modal-header">
                <div class="library-header-content">
                    <h2>Library</h2>
                    <span class="library-count">Loading...</span>
                </div>
                <button class="library-close-btn" data-action="close">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <div class="library-modal-content" id="library-content">
                <div class="library-loading">
                    <div class="library-grid library-skeleton">
                        ${Array(12).fill(0).map(() => `
                            <div class="library-skeleton-card">
                                <div class="library-skeleton-image"></div>
                                <div class="library-skeleton-info">
                                    <div class="library-skeleton-text"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Make visible immediately
    setTimeout(() => {
        modal.style.display = 'flex';
    }, 10);

    const closeModal = () => {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }, 250);
    };

    // Close button
    modal.querySelector('[data-action="close"]').addEventListener('click', closeModal);

    // ESC to close
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    document.addEventListener('keydown', escHandler);

    // Click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Load images asynchronously
    const images = await getAllImages();

    // Update count
    const countElement = modal.querySelector('.library-count');
    if (countElement) {
        countElement.textContent = `${images.length} ${images.length === 1 ? 'image' : 'images'}`;
    }

    // Update content
    const contentElement = modal.querySelector('#library-content');
    if (contentElement) {
        contentElement.innerHTML = images.length === 0 ? `
            <div class="library-empty">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <p>No images in your library yet</p>
                <span>Images you add to boards will appear here</span>
            </div>
        ` : `
            <div class="library-grid" id="library-grid">
                ${images.map((image, index) => `
                    <div class="library-image-card" data-index="${index}">
                        <div class="library-image-wrapper">
                            <img src="${image.src}" alt="Image" class="library-image" loading="lazy">
                        </div>
                        <div class="library-image-info">
                            <span class="library-image-board">${image.name || 'Image'}</span>
                            <button class="library-download-btn" data-index="${index}" title="Download">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // Image card click - open viewer
        if (images.length > 0) {
            modal.querySelectorAll('.library-image-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    // Don't open viewer if clicking download button
                    if (e.target.closest('.library-download-btn')) {
                        return;
                    }
                    const index = parseInt(card.dataset.index);
                    showPhotoViewer(images, index);
                });
            });

            // Download buttons
            modal.querySelectorAll('.library-download-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(btn.dataset.index);
                    const image = images[index];
                    const filename = `${(image.name || 'image').replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.png`;
                    downloadImage(image.src, filename, btn);
                });
            });
        }
    }

    return modal;
}
