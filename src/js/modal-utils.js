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

        // Force display to flex (override CSS default of display: none)
        overlay.style.display = 'flex';

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

        // Force display to flex (override CSS default of display: none)
        overlay.style.display = 'flex';

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

        // Force display to flex (override CSS default of display: none)
        overlay.style.display = 'flex';

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

export function showColorExtractorModal() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal modal-color-extractor">
                <div class="modal-header">
                    <h2>Color Palette Extractor</h2>
                </div>
                <div class="modal-body">
                    <div class="extractor-content">
                        <div class="image-upload-area" id="image-upload-area">
                            <div class="upload-placeholder">
                                <div class="upload-icon">+</div>
                                <p>Click to import an image</p>
                                <p class="upload-hint">Supports JPG, PNG, WebP</p>
                            </div>
                            <canvas id="extractor-canvas" style="display: none;"></canvas>
                        </div>
                        <div class="extractor-status" id="extractor-status" style="display: none;">
                            <div class="status-message"></div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="modal-btn modal-btn-primary" id="modal-extract" disabled>Extract Colors</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Force display to flex (override CSS default of display: none)
        overlay.style.display = 'flex';

        const uploadArea = overlay.querySelector('#image-upload-area');
        const canvas = overlay.querySelector('#extractor-canvas');
        const ctx = canvas.getContext('2d');
        const placeholder = uploadArea.querySelector('.upload-placeholder');
        const extractBtn = overlay.querySelector('#modal-extract');
        const cancelBtn = overlay.querySelector('#modal-cancel');
        const statusDiv = overlay.querySelector('#extractor-status');
        const statusMsg = statusDiv.querySelector('.status-message');

        let currentImage = null;

        const close = (result) => {
            overlay.classList.add('closing');
            setTimeout(() => {
                document.body.removeChild(overlay);
                resolve(result);
            }, 250);
        };

        const loadImage = (file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    currentImage = img;

                    // Show canvas, hide placeholder
                    placeholder.style.display = 'none';
                    canvas.style.display = 'block';

                    // Set canvas size (max 400px for preview)
                    const maxSize = 400;
                    let width = img.width;
                    let height = img.height;

                    if (width > height && width > maxSize) {
                        height = (height / width) * maxSize;
                        width = maxSize;
                    } else if (height > maxSize) {
                        width = (width / height) * maxSize;
                        height = maxSize;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    extractBtn.disabled = false;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        };

        uploadArea.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    loadImage(file);
                }
            };
            input.click();
        });

        extractBtn.addEventListener('click', async () => {
            if (!currentImage) {
                console.error('[Color Extractor] No image loaded');
                return;
            }

            extractBtn.disabled = true;
            statusDiv.style.display = 'block';
            statusMsg.textContent = 'Extracting colors...';

            try {
                console.log('[Color Extractor] Starting extraction from modal image');
                console.log('[Color Extractor] Image dimensions:', currentImage.width, 'x', currentImage.height);
                const colors = await extractColorsFromImage(currentImage);
                console.log('[Color Extractor] Extraction complete, colors:', colors);
                // Return both colors and the source image for regeneration
                close({ colors, sourceImage: currentImage });
            } catch (error) {
                console.error('[Color Extractor] Error:', error);
                console.error('[Color Extractor] Error stack:', error.stack);
                statusMsg.textContent = `Error extracting colors: ${error.message}`;
                extractBtn.disabled = false;
            }
        });

        cancelBtn.addEventListener('click', () => close(null));

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

// K-means color extraction algorithm
export async function extractColorsFromImage(img) {
    return new Promise((resolve) => {
        // Use a hidden canvas for analysis
        const analyzeCanvas = document.createElement('canvas');
        const ctx = analyzeCanvas.getContext('2d');

        // Downsample large images for performance
        const maxDimension = 200;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDimension) {
            height = (height / width) * maxDimension;
            width = maxDimension;
        } else if (height > maxDimension) {
            width = (width / height) * maxDimension;
            height = maxDimension;
        }

        analyzeCanvas.width = width;
        analyzeCanvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = [];

        // Sample pixels (skip alpha channel, only RGB)
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const a = imageData.data[i + 3];

            // Skip fully transparent pixels
            if (a > 128) {
                pixels.push([r, g, b]);
            }
        }

        // Determine optimal number of colors (1-10)
        const k = determineOptimalK(pixels);

        // Run k-means clustering
        const clusters = kMeans(pixels, k);

        // Sort by brightness/value
        clusters.sort((a, b) => {
            const brightnessA = (a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114);
            const brightnessB = (b[0] * 0.299 + b[1] * 0.587 + b[2] * 0.114);
            return brightnessA - brightnessB;
        });

        // Convert to hex and RGB format
        const colors = clusters.map(([r, g, b]) => ({
            hex: rgbToHex(Math.round(r), Math.round(g), Math.round(b)),
            rgb: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
        }));

        resolve(colors);
    });
}

function determineOptimalK(pixels) {
    if (pixels.length < 100) return 1;

    // Calculate color variance
    const variance = calculateColorVariance(pixels);

    // Map variance to k (1-10), but with a minimum of 6
    // Lower threshold from 10000 to 3000 to extract more colors
    const normalizedVariance = Math.min(variance / 3000, 1);
    let k = Math.max(6, Math.min(10, Math.ceil(normalizedVariance * 10)));

    // BUT: Check if image truly has very few distinct colors
    // Only reduce k for EXTREMELY simple images (like solid color backgrounds)
    if (variance < 200) {
        // Extremely low variance = basically solid colors only
        k = Math.max(1, Math.min(3, Math.ceil(normalizedVariance * 10)));
    } else if (variance < 500) {
        // Very low variance = very limited palette (2-3 flat colors)
        k = Math.max(3, Math.min(5, Math.ceil(normalizedVariance * 10)));
    }

    return k;
}

function calculateColorVariance(pixels) {
    // Calculate variance in RGB space
    let rSum = 0, gSum = 0, bSum = 0;

    pixels.forEach(([r, g, b]) => {
        rSum += r;
        gSum += g;
        bSum += b;
    });

    const count = pixels.length;
    const rMean = rSum / count;
    const gMean = gSum / count;
    const bMean = bSum / count;

    let rVariance = 0, gVariance = 0, bVariance = 0;

    pixels.forEach(([r, g, b]) => {
        rVariance += Math.pow(r - rMean, 2);
        gVariance += Math.pow(g - gMean, 2);
        bVariance += Math.pow(b - bMean, 2);
    });

    return (rVariance + gVariance + bVariance) / count;
}

function kMeans(pixels, k, maxIterations = 20) {
    if (pixels.length === 0) return [[0, 0, 0]];
    if (k === 1) {
        // Return average color
        const avg = [0, 0, 0];
        pixels.forEach(([r, g, b]) => {
            avg[0] += r;
            avg[1] += g;
            avg[2] += b;
        });
        return [[avg[0] / pixels.length, avg[1] / pixels.length, avg[2] / pixels.length]];
    }

    // Initialize centroids RANDOMLY for different results each time
    let centroids = [];
    const used = new Set();
    for (let i = 0; i < k; i++) {
        let idx;
        do {
            idx = Math.floor(Math.random() * pixels.length);
        } while (used.has(idx));
        used.add(idx);
        centroids.push([...pixels[idx]]);
    }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Assign pixels to nearest centroid
        const clusters = Array.from({ length: k }, () => []);

        pixels.forEach(pixel => {
            let minDist = Infinity;
            let closestIdx = 0;

            centroids.forEach((centroid, idx) => {
                const dist = colorDistance(pixel, centroid);
                if (dist < minDist) {
                    minDist = dist;
                    closestIdx = idx;
                }
            });

            clusters[closestIdx].push(pixel);
        });

        // Update centroids
        const newCentroids = clusters.map(cluster => {
            if (cluster.length === 0) return centroids[0]; // Fallback

            const sum = [0, 0, 0];
            cluster.forEach(([r, g, b]) => {
                sum[0] += r;
                sum[1] += g;
                sum[2] += b;
            });

            return [
                sum[0] / cluster.length,
                sum[1] / cluster.length,
                sum[2] / cluster.length
            ];
        });

        // Check convergence
        let converged = true;
        for (let i = 0; i < k; i++) {
            if (colorDistance(centroids[i], newCentroids[i]) > 1) {
                converged = false;
                break;
            }
        }

        centroids = newCentroids;

        if (converged) break;
    }

    return centroids;
}

function colorDistance(c1, c2) {
    return Math.sqrt(
        Math.pow(c1[0] - c2[0], 2) +
        Math.pow(c1[1] - c2[1], 2) +
        Math.pow(c1[2] - c2[2], 2)
    );
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}
