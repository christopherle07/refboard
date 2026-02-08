import { Canvas } from './canvas.js';
import { boardManager } from './board-manager.js';

function extractImageUrlsFromHtml(html) {
    const urls = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract from img tags - prioritize srcset for higher resolution
    doc.querySelectorAll('img').forEach(img => {
        // Check srcset first for highest resolution
        if (img.srcset) {
            const srcsetParts = img.srcset.split(',').map(s => s.trim());
            // Sort by descriptor (2x, 3x, or width like 1200w) to get highest res
            const sorted = srcsetParts.sort((a, b) => {
                const aMatch = a.match(/(\d+)(x|w)/);
                const bMatch = b.match(/(\d+)(x|w)/);
                const aVal = aMatch ? parseInt(aMatch[1]) : 0;
                const bVal = bMatch ? parseInt(bMatch[1]) : 0;
                return bVal - aVal;
            });
            if (sorted.length > 0) {
                const url = sorted[0].split(/\s+/)[0];
                if (url && url.startsWith('http')) urls.push(url);
            }
        }
        // Fallback to src
        if (img.src && img.src.startsWith('http')) {
            urls.push(img.src);
        }
        // Check data-src for lazy loading
        const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original');
        if (dataSrc && dataSrc.startsWith('http')) {
            urls.push(dataSrc);
        }
    });

    // Extract from background-image styles
    doc.querySelectorAll('[style*="background"]').forEach(el => {
        const style = el.getAttribute('style');
        const match = style.match(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/);
        if (match) urls.push(match[1]);
    });

    // Extract from anchor tags that wrap images (Pinterest pattern)
    doc.querySelectorAll('a[href*=".jpg"], a[href*=".png"], a[href*=".gif"], a[href*=".webp"]').forEach(a => {
        if (a.href.startsWith('http')) urls.push(a.href);
    });

    // Extract any URLs containing pinimg.com (Pinterest CDN)
    const pinimgMatches = html.match(/https?:\/\/[^"'\s]*pinimg\.com[^"'\s]*/gi);
    if (pinimgMatches) {
        urls.push(...pinimgMatches);
    }

    // Extract any image URLs from the raw HTML (fallback)
    const rawUrlMatches = html.match(/https?:\/\/[^"'\s<>]+\.(jpg|jpeg|png|gif|webp)[^"'\s<>]*/gi);
    if (rawUrlMatches) {
        urls.push(...rawUrlMatches);
    }

    // Dedupe while preserving order, and filter for valid URLs
    const uniqueUrls = [...new Set(urls)].filter(url => {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    });

    // Prioritize higher resolution images (larger dimension indicators in URL)
    uniqueUrls.sort((a, b) => {
        // Pinterest URLs often have resolution like /236x/ or /564x/ or /originals/
        const aMatch = a.match(/\/(\d+)x\//);
        const bMatch = b.match(/\/(\d+)x\//);
        const aHasOriginals = a.includes('/originals/') ? 10000 : 0;
        const bHasOriginals = b.includes('/originals/') ? 10000 : 0;
        const aVal = (aMatch ? parseInt(aMatch[1]) : 0) + aHasOriginals;
        const bVal = (bMatch ? parseInt(bMatch[1]) : 0) + bHasOriginals;
        return bVal - aVal;
    });

    return uniqueUrls;
}

async function extractImageFromPinterestPin(pinUrl) {
    try {
        console.log('Fetching Pinterest page:', pinUrl);
        const html = await window.__TAURI__.core.invoke('fetch_page_html', { url: pinUrl });

        // Extract pin ID from URL
        const pinIdMatch = pinUrl.match(/\/pin\/(\d+)/);
        const pinId = pinIdMatch ? pinIdMatch[1] : null;
        console.log('Pin ID:', pinId);

        // Pinterest embeds JSON data in script tags - look for __PWS_DATA__ or similar
        // The JSON contains "orig" image URLs which are the highest quality

        // Method 1: Look for the specific pin's image in JSON data
        // Pinterest JSON often has structure like: "images":{"orig":{"url":"..."}}
        const origUrlPattern = /"orig"\s*:\s*\{\s*[^}]*"url"\s*:\s*"(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/g;
        const origMatches = [...html.matchAll(origUrlPattern)];
        if (origMatches.length > 0) {
            // Get unique URLs
            const urls = [...new Set(origMatches.map(m => m[1]))];
            console.log('Found orig URLs in JSON:', urls);
            // Return the first one (should be the pin's image)
            return urls[0];
        }

        // Method 2: Look for "url" fields with originals path in JSON context
        const jsonOriginalsPattern = /"url"\s*:\s*"(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/g;
        const jsonOrigMatches = [...html.matchAll(jsonOriginalsPattern)];
        if (jsonOrigMatches.length > 0) {
            const urls = [...new Set(jsonOrigMatches.map(m => m[1]))];
            console.log('Found originals in JSON url fields:', urls);
            return urls[0];
        }

        // Method 3: Look for high-res URLs (736x or higher) in JSON
        const highResPattern = /"url"\s*:\s*"(https:\/\/i\.pinimg\.com\/\d+x\/[^"]+)"/g;
        const highResMatches = [...html.matchAll(highResPattern)];
        if (highResMatches.length > 0) {
            const urls = [...new Set(highResMatches.map(m => m[1]))];
            // Sort by resolution
            urls.sort((a, b) => {
                const aRes = parseInt(a.match(/\/(\d+)x\//)?.[1] || '0');
                const bRes = parseInt(b.match(/\/(\d+)x\//)?.[1] || '0');
                return bRes - aRes;
            });
            console.log('Found high-res URLs in JSON:', urls[0]);
            return urls[0];
        }

        // Method 4: Fallback - look for any pinimg URL that's not a small thumbnail
        const allPinimgPattern = /https:\/\/i\.pinimg\.com\/(?:originals|\d+x)\/[a-f0-9\/]+\.[a-z]+/gi;
        const allMatches = [...new Set(html.match(allPinimgPattern) || [])];
        if (allMatches.length > 0) {
            // Filter out small sizes (75x, 140x, 236x) and sort by size
            const filtered = allMatches.filter(url => {
                const sizeMatch = url.match(/\/(\d+)x\//);
                if (!sizeMatch) return true; // originals
                return parseInt(sizeMatch[1]) >= 474;
            });
            filtered.sort((a, b) => {
                if (a.includes('/originals/')) return -1;
                if (b.includes('/originals/')) return 1;
                const aRes = parseInt(a.match(/\/(\d+)x\//)?.[1] || '0');
                const bRes = parseInt(b.match(/\/(\d+)x\//)?.[1] || '0');
                return bRes - aRes;
            });
            if (filtered.length > 0) {
                console.log('Found pinimg URL (fallback):', filtered[0]);
                return filtered[0];
            }
        }

        console.log('No image URL found in Pinterest page');
        return null;
    } catch (err) {
        console.error('Failed to fetch Pinterest page:', err);
        return null;
    }
}

let canvas;
let currentBoardId;
let isPinned = false;
let saveTimeout = null;
let pendingSave = false;

let syncChannel = null;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    currentBoardId = parseInt(params.get('id'));
    
    if (!currentBoardId) return;
    
    syncChannel = new BroadcastChannel('board_sync_' + currentBoardId);
    
    syncChannel.onmessage = async (event) => {
        if (event.data.type === 'layer_visibility_changed') {
            const img = canvas.images.find(i => i.id === event.data.layerId);
            if (img) {
                img.visible = event.data.visible;
                canvas.needsRender = true;
            }
        } else if (event.data.type === 'background_color_changed') {
            canvas.setBackgroundColor(event.data.color);
            document.body.style.backgroundColor = event.data.color;
            updateTitlebarTheme(event.data.color);
        } else if (event.data.type === 'layer_order_changed') {
            console.log('Floating window received layer order update:', event.data.updates);
            // Update zIndex for all layers
            event.data.updates.forEach(update => {
                if (update.type === 'image') {
                    const img = canvas.images.find(i => i.id === update.id);
                    if (img) {
                        console.log('Updated image', img.id, 'zIndex to', update.zIndex);
                        img.zIndex = update.zIndex;
                    }
                } else if (update.type === 'object') {
                    const obj = canvas.objectsManager.objects.find(o => o.id === update.id);
                    if (obj) {
                        console.log('Updated object', obj.id, 'zIndex to', update.zIndex);
                        obj.zIndex = update.zIndex;
                    }
                }
            });
            canvas.invalidateCullCache();
            canvas.needsRender = true;
            canvas.render();
        } else if (event.data.type === 'image_added') {
            // Image added in editor — add it here too
            const data = event.data.image;
            const resolvedSrc = await boardManager.resolveImageSrc(data.src);
            const img = new Image();
            img.onload = () => {
                const added = canvas.addImageSilent(img, data.x, data.y, data.name, data.width, data.height);
                added.id = data.id;
                if (data.src && !data.src.startsWith('data:')) added.filePath = data.src;
                canvas.invalidateCullCache();
                canvas.needsRender = true;
                canvas.render();
            };
            img.src = resolvedSrc;
        } else if (event.data.type === 'sync_state_response') {
            // Received current state from editor
            console.log('Floating window received state sync:', event.data.updates);
            event.data.updates.forEach(update => {
                if (update.type === 'image') {
                    const img = canvas.images.find(i => i.id === update.id);
                    if (img) {
                        img.zIndex = update.zIndex;
                    }
                } else if (update.type === 'object') {
                    const obj = canvas.objectsManager.objects.find(o => o.id === update.id);
                    if (obj) {
                        obj.zIndex = update.zIndex;
                    }
                }
            });
            canvas.invalidateCullCache();
            canvas.needsRender = true;
            canvas.render();
        }
    };
    
    await initFloatingWindow();
    setupTitlebarControls();
    setupToolbarToggle();
    setupContextMenu();
    setupDragAndDrop();
});

async function initFloatingWindow() {
    await boardManager.loadBoards();
    const board = await boardManager.getBoard(currentBoardId);
    
    if (!board) return;
    
    document.getElementById('window-title').textContent = board.name;
    
    const canvasElement = document.getElementById('floating-canvas');
    canvas = new Canvas(canvasElement);
    
    const bgColor = board.bgColor || board.bg_color;
    canvas.setBackgroundColor(bgColor);
    document.body.style.backgroundColor = bgColor;
    updateTitlebarTheme(bgColor);
    
    await loadLayers(board.layers, board.viewState);

    // Fit content to view if no viewState was saved
    if (!board.viewState) {
        canvas.fitToContent();
    }

    // Load strokes if they exist
    if (board.strokes && board.strokes.length > 0) {
        canvas.loadStrokes(board.strokes);
    }

    // Load text/shape objects if they exist
    if (board.objects && board.objects.length > 0) {
        console.log('Loading objects in floating window:', board.objects);
        canvas.objectsManager.loadObjects(board.objects);
        // Force render after loading objects
        canvas.needsRender = true;
    } else {
        console.log('No objects to load in floating window', board.objects);
    }

    canvas.canvas.addEventListener('canvasChanged', scheduleSave);
    canvas.canvas.addEventListener('objectsChanged', scheduleSave);

    // Request current state from editor
    syncChannel.postMessage({ type: 'sync_state_request' });
}

function setupDragAndDrop() {
    // Disable canvas.js built-in drop handler since we manage drops here
    canvas.externalDropHandler = true;

    canvas.canvas.addEventListener('dragenter', (e) => {
        e.preventDefault();
        // Show overlay for files, HTML (website drags), or URI lists
        if (e.dataTransfer.types.includes('Files') ||
            e.dataTransfer.types.includes('text/html') ||
            e.dataTransfer.types.includes('text/uri-list')) {
            canvas.showDragOverlay();
        }
    });
    
    canvas.canvas.addEventListener('dragleave', (e) => {
        if (e.target === canvas.canvas) {
            canvas.hideDragOverlay();
        }
    });
    
    canvas.canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    
    canvas.canvas.addEventListener('drop', async (e) => {
        e.preventDefault();
        canvas.hideDragOverlay();

        const rect = canvas.canvas.getBoundingClientRect();
        const { x, y } = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(f => f.type.startsWith('image/'));

        // Handle file drops (existing behavior)
        if (imageFiles.length > 0) {
            for (const file of imageFiles) {
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const dataUrl = event.target.result;

                    // Try to save as file on disk
                    let filePath = await boardManager.saveImageFile(dataUrl, file.name);
                    let imgSrc = dataUrl;
                    if (filePath) {
                        imgSrc = await boardManager.resolveImageSrc(filePath);
                    }

                    const img = new Image();
                    img.onload = async () => {
                        const added = canvas.addImage(img, x, y, file.name);
                        if (filePath) added.filePath = filePath;

                        const srcForSync = filePath || dataUrl;

                        // Broadcast to editor so it adds the image too
                        if (syncChannel) {
                            syncChannel.postMessage({
                                type: 'image_added',
                                image: {
                                    id: added.id,
                                    name: added.name,
                                    src: srcForSync,
                                    x: added.x,
                                    y: added.y,
                                    width: added.width,
                                    height: added.height
                                }
                            });
                        }

                        const board = await boardManager.getBoard(currentBoardId);
                        const currentAssets = board.assets || [];

                        const assetExists = currentAssets.some(a => a.name === file.name);
                        if (!assetExists) {
                            const updatedAssets = [...currentAssets, {
                                id: Date.now() + Math.random(),
                                src: srcForSync,
                                name: file.name
                            }];
                            await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });
                            await boardManager.addToAllAssets(file.name, srcForSync);
                        }
                    };
                    img.src = imgSrc;
                };
                reader.readAsDataURL(file);
            }
            return;
        }

        // Handle URL drops from websites (text/html or text/uri-list)
        let imageUrls = [];

        // Try to extract from HTML first (most reliable for complex sites like Pinterest)
        const html = e.dataTransfer.getData('text/html');
        if (html) {
            imageUrls = extractImageUrlsFromHtml(html);
        }

        // Fallback to uri-list or plain text
        if (imageUrls.length === 0) {
            const uriList = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (uriList) {
                const urls = uriList.split('\n').filter(u => u.trim() && !u.startsWith('#'));
                for (const url of urls) {
                    const trimmed = url.trim();
                    if (trimmed.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|bmp|svg)/i) ||
                        trimmed.match(/^https?:\/\/.+\/image/i) ||
                        trimmed.match(/^https?:\/\/.*pinimg\.com/i)) {
                        imageUrls.push(trimmed);
                    }
                    // Check for Pinterest pin page URLs - we'll need to fetch and parse these
                    else if (trimmed.match(/^https?:\/\/(www\.)?pinterest\.[a-z]+\/pin\//i)) {
                        console.log('Detected Pinterest pin URL, will fetch page to extract image');
                        try {
                            const extractedUrl = await extractImageFromPinterestPin(trimmed);
                            if (extractedUrl) {
                                imageUrls.push(extractedUrl);
                            }
                        } catch (err) {
                            console.error('Failed to extract image from Pinterest pin:', err);
                        }
                    }
                }
            }
        }

        // Fetch and add images from URLs
        if (imageUrls.length > 0) {
            try {
                const url = imageUrls[0];
                const dataUrl = await window.__TAURI__.core.invoke('fetch_image_url', { url });

                // Generate a filename from URL
                const urlObj = new URL(url);
                let filename = urlObj.pathname.split('/').pop() || 'image';
                if (!filename.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
                    filename += '.png';
                }

                let filePath = await boardManager.saveImageFile(dataUrl, filename);
                let imgSrc = dataUrl;
                if (filePath) {
                    imgSrc = await boardManager.resolveImageSrc(filePath);
                }

                const img = new Image();
                img.onload = async () => {
                    const added = canvas.addImage(img, x, y, filename);
                    if (filePath) added.filePath = filePath;

                    const srcForSync = filePath || dataUrl;

                    // Broadcast to editor so it adds the image too
                    if (syncChannel) {
                        syncChannel.postMessage({
                            type: 'image_added',
                            image: {
                                id: added.id,
                                name: added.name,
                                src: srcForSync,
                                x: added.x,
                                y: added.y,
                                width: added.width,
                                height: added.height
                            }
                        });
                    }

                    const board = await boardManager.getBoard(currentBoardId);
                    const currentAssets = board.assets || [];

                    const assetExists = currentAssets.some(a => a.name === filename);
                    if (!assetExists) {
                        const updatedAssets = [...currentAssets, {
                            id: Date.now() + Math.random(),
                            src: srcForSync,
                            name: filename
                        }];
                        await boardManager.updateBoard(currentBoardId, { assets: updatedAssets });
                        await boardManager.addToAllAssets(filename, srcForSync);
                    }
                };
                img.src = imgSrc;
            } catch (err) {
                console.error('Failed to add image from URL drop:', err);
            }
        }
    });
}

async function loadLayers(layers, viewState = null) {
    canvas.clear();

    // Restore view state immediately after clear
    if (viewState) {
        if (viewState.pan) {
            canvas.pan.x = viewState.pan.x;
            canvas.pan.y = viewState.pan.y;
        }
        if (viewState.zoom) {
            canvas.zoom = viewState.zoom;
        }
    }

    if (!layers || !layers.length) {
        // Force initial render
        canvas.invalidateCullCache();
        canvas.needsRender = true;
        canvas.render();
        return;
    }

    // Resolve all image sources (file refs → asset URLs) up front
    const resolvedLayers = await Promise.all(layers.map(async (layer) => {
        const resolvedSrc = await boardManager.resolveImageSrc(layer.src);
        const filePath = (layer.src && !layer.src.startsWith('data:')) ? layer.src : null;
        return { layer, resolvedSrc, filePath };
    }));

    return new Promise(resolve => {
        let loaded = 0;
        const total = resolvedLayers.length;

        resolvedLayers.forEach(({ layer, resolvedSrc, filePath }) => {
            // Skip video/GIF layers — they need special handling and can't load as Image
            if (layer.mediaType === 'video' || layer.mediaType === 'gif') {
                loaded++;
                if (loaded >= total) {
                    canvas.selectImage(null);
                    canvas.invalidateCullCache();
                    canvas.needsRender = true;
                    canvas.render();
                    resolve();
                }
                return;
            }

            const img = new Image();
            img.onload = () => {
                const visible = layer.visible !== false;
                const added = canvas.addImageSilent(img, layer.x, layer.y, layer.name, layer.width, layer.height, visible);
                added.id = layer.id;
                added.zIndex = layer.zIndex || 0;
                added.rotation = layer.rotation || 0;
                if (filePath) added.filePath = filePath;
                // Restore filter properties (only if they exist and are not null)
                if (layer.brightness != null) added.brightness = layer.brightness;
                if (layer.contrast != null) added.contrast = layer.contrast;
                if (layer.saturation != null) added.saturation = layer.saturation;
                if (layer.hue != null) added.hue = layer.hue;
                if (layer.blur != null) added.blur = layer.blur;
                if (layer.opacity != null) added.opacity = layer.opacity;
                if (layer.grayscale === true) added.grayscale = true;
                if (layer.invert === true) added.invert = true;
                if (layer.mirror === true) added.mirror = true;

                // Build filter cache at load time if image has non-default filter values
                if (canvas.buildFilterString(added)) {
                    canvas.applyFilters(added);
                }

                loaded++;
                if (loaded >= total) {
                    canvas.selectImage(null);
                    // Force initial render with restored view
                    canvas.invalidateCullCache();
                    canvas.needsRender = true;
                    canvas.render();
                    resolve();
                }
            };
            img.onerror = (e) => {
                console.error('Failed to load image:', layer.name, 'src:', resolvedSrc?.substring(0, 100), e);
                loaded++;
                if (loaded >= total) {
                    // Force initial render
                    canvas.invalidateCullCache();
                    canvas.needsRender = true;
                    canvas.render();
                    resolve();
                }
            };
            img.src = resolvedSrc;
        });
    });
}

async function setupTitlebarControls() {
    if (!window.__TAURI__) return;

    try {
        const { Window } = window.__TAURI__.window;
        const currentWindow = Window.getCurrent();

        await currentWindow.setAlwaysOnTop(false);
        isPinned = false;

        // Setup titlebar dragging (needed for macOS)
        const titlebar = document.getElementById('floating-titlebar');
        if (titlebar) {
            titlebar.addEventListener('mousedown', async (e) => {
                // Don't drag if clicking on buttons
                if (e.target.closest('.titlebar-btn') || e.target.closest('.titlebar-controls')) {
                    return;
                }
                try {
                    await currentWindow.startDragging();
                } catch (err) {
                    // Ignore errors - dragging may not be supported in all contexts
                }
            });
        }

        document.getElementById('pin-btn').addEventListener('click', async () => {
            isPinned = !isPinned;
            await currentWindow.setAlwaysOnTop(isPinned);
            document.getElementById('pin-btn').classList.toggle('pinned', isPinned);
        });

        document.getElementById('minimize-btn').addEventListener('click', async () => {
            await currentWindow.minimize();
        });

        document.getElementById('close-btn').addEventListener('click', async () => {
            saveNow();
            await currentWindow.close();
        });
    } catch (err) {
        console.error('Titlebar setup error:', err);
    }
}

function setupContextMenu() {
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.innerHTML = `
        <div class="context-menu-item" data-action="recenter">Recenter View</div>
    `;
    document.body.appendChild(contextMenu);
    
    const hiddenLayersMenu = document.createElement('div');
    hiddenLayersMenu.className = 'context-submenu';
    document.body.appendChild(hiddenLayersMenu);
    
    if (!document.querySelector('#context-menu-styles')) {
        const style = document.createElement('style');
        style.id = 'context-menu-styles';
        style.textContent = `
            .context-menu {
                position: fixed;
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 4px;
                z-index: 10000;
                display: none;
                min-width: 160px;
            }
            
            .context-menu.show {
                display: block;
            }
            
            .context-menu-item {
                padding: 8px 12px;
                font-size: 13px;
                color: #1a1a1a;
                cursor: pointer;
                border-radius: 4px;
                transition: background 0.1s;
            }
            
            .context-menu-item:hover {
                background: #f5f5f5;
            }
            
            .context-menu-item.disabled {
                color: #999;
                cursor: default;
            }
            
            .context-menu-item.disabled:hover {
                background: transparent;
            }
            
            .context-submenu {
                position: fixed;
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 4px;
                z-index: 10001;
                display: none;
                min-width: 180px;
                max-height: 300px;
                overflow-y: auto;
            }
            
            .context-submenu.show {
                display: block;
            }
        `;
        document.head.appendChild(style);
    }
    
    let clickedImageId = null;
    let clickedImageObj = null;
    let contextMenuJustOpened = false;

    canvas.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        hiddenLayersMenu.classList.remove('show');

        const rect = canvas.canvas.getBoundingClientRect();
        const { x, y } = canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const clickedImage = canvas.getImageAtPoint(x, y);

        contextMenu.innerHTML = '';

        if (clickedImage) {
            clickedImageId = clickedImage.id;
            clickedImageObj = clickedImage;
            contextMenu.innerHTML = `
                <div class="context-menu-item" data-action="edit-image">Edit Image</div>
                <div class="context-menu-item" data-action="hide-image">Hide Image</div>
            `;
        } else {
            clickedImageId = null;
            const hiddenImages = canvas.images.filter(img => img.visible === false);

            contextMenu.innerHTML = `
                <div class="context-menu-item" data-action="recenter">Recenter View</div>
                <div class="context-menu-item ${hiddenImages.length === 0 ? 'disabled' : ''}" data-action="hidden-layers">Hidden Layers ${hiddenImages.length > 0 ? '▶' : ''}</div>
            `;
        }

        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        contextMenu.classList.add('show');

        // Prevent click event from immediately closing the menu on macOS
        contextMenuJustOpened = true;
        setTimeout(() => {
            contextMenuJustOpened = false;
        }, 100);
    });
    
    contextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;

        if (action === 'recenter') {
            canvas.resetView();
            contextMenu.classList.remove('show');
        } else if (action === 'edit-image' && clickedImageObj) {
            showImageEditPanel(clickedImageObj);
            contextMenu.classList.remove('show');
        } else if (action === 'hide-image' && clickedImageId) {
            canvas.toggleVisibility(clickedImageId);
            contextMenu.classList.remove('show');
        } else if (action === 'hidden-layers') {
            if (e.target.classList.contains('disabled')) return;
            
            const hiddenImages = canvas.images.filter(img => img.visible === false);
            hiddenLayersMenu.innerHTML = '';
            
            hiddenImages.forEach(img => {
                const item = document.createElement('div');
                item.className = 'context-menu-item';
                item.textContent = img.name;
                item.dataset.imageId = img.id;
                item.dataset.action = 'unhide';
                hiddenLayersMenu.appendChild(item);
            });
            
            const rect = e.target.getBoundingClientRect();
            hiddenLayersMenu.style.left = (rect.right + 5) + 'px';
            hiddenLayersMenu.style.top = rect.top + 'px';
            hiddenLayersMenu.classList.add('show');
        }
    });
    
    hiddenLayersMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const imageId = parseFloat(e.target.dataset.imageId);
        
        if (action === 'unhide' && imageId) {
            canvas.toggleVisibility(imageId);
            contextMenu.classList.remove('show');
            hiddenLayersMenu.classList.remove('show');
        }
    });
    
    document.addEventListener('click', (e) => {
        // Don't close if menu was just opened (macOS ctrl+click issue)
        if (contextMenuJustOpened) return;

        if (!contextMenu.contains(e.target) && !hiddenLayersMenu.contains(e.target) && e.target !== canvas.canvas) {
            contextMenu.classList.remove('show');
            hiddenLayersMenu.classList.remove('show');
        }
    });
}

function scheduleSave() {
    pendingSave = true;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveNow();
    }, 2000);
}

function saveNow() {
    if (!pendingSave) return;
    pendingSave = false;
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }

    const images = canvas.getImages();
    const layers = images.map(img => {
        const layer = {
            id: img.id,
            name: img.name,
            src: img.filePath || img.img.src,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            visible: img.visible !== false,
            zIndex: img.zIndex || 0
        };

        // Only include filter properties if they have non-default values
        if (img.rotation !== undefined && img.rotation !== 0) layer.rotation = img.rotation;
        if (img.brightness !== undefined && img.brightness !== 100) layer.brightness = img.brightness;
        if (img.contrast !== undefined && img.contrast !== 100) layer.contrast = img.contrast;
        if (img.saturation !== undefined && img.saturation !== 100) layer.saturation = img.saturation;
        if (img.hue !== undefined && img.hue !== 0) layer.hue = img.hue;
        if (img.blur !== undefined && img.blur !== 0) layer.blur = img.blur;
        if (img.opacity !== undefined && img.opacity !== 100) layer.opacity = img.opacity;
        if (img.grayscale === true) layer.grayscale = true;
        if (img.invert === true) layer.invert = true;
        if (img.mirror === true) layer.mirror = true;

        return layer;
    });
    const strokes = canvas.getStrokes();
    const objects = canvas.objectsManager.getObjects();
    const thumbnail = canvas.generateThumbnail(200, 150);
    boardManager.updateBoard(currentBoardId, { layers, strokes, objects, thumbnail });
}

function updateTitlebarTheme(bgColor) {
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    const titlebar = document.querySelector('.titlebar');
    if (luminance < 0.5) {
        titlebar.classList.add('dark-mode');
        document.documentElement.setAttribute('data-bg-luminance', 'dark');
    } else {
        titlebar.classList.remove('dark-mode');
        document.documentElement.setAttribute('data-bg-luminance', 'light');
    }
}

function setupToolbarToggle() {
    const toggleBtn = document.getElementById('toolbar-toggle-btn');
    const toolbar = document.getElementById('drawing-toolbar');

    // Load saved state from localStorage
    const toolbarVisible = localStorage.getItem('floating_toolbar_visible') !== 'false';

    if (!toolbarVisible) {
        toolbar.style.display = 'none';
    } else {
        toggleBtn.classList.add('active');
    }

    toggleBtn.addEventListener('click', () => {
        const isVisible = toolbar.style.display !== 'none';

        if (isVisible) {
            toolbar.style.display = 'none';
            toggleBtn.classList.remove('active');
            localStorage.setItem('floating_toolbar_visible', 'false');
        } else {
            toolbar.style.display = 'flex';
            toggleBtn.classList.add('active');
            localStorage.setItem('floating_toolbar_visible', 'true');
        }
    });
}

function showImageEditPanel(imageObj) {
    // Remove any existing edit panels
    const existingPanel = document.querySelector('.image-edit-panel');
    if (existingPanel) {
        existingPanel.remove();
    }

    // Store original values for cancel
    const originalValues = {
        brightness: imageObj.brightness || 100,
        contrast: imageObj.contrast || 100,
        saturation: imageObj.saturation || 100,
        hue: imageObj.hue || 0,
        blur: imageObj.blur || 0,
        opacity: imageObj.opacity !== undefined ? imageObj.opacity : 100,
        grayscale: imageObj.grayscale || false,
        invert: imageObj.invert || false,
        mirror: imageObj.mirror || false
    };

    const panel = document.createElement('div');
    panel.className = 'image-edit-panel';
    panel.innerHTML = `
        <div class="image-edit-panel-header">
            <span class="image-edit-panel-title">Edit Image</span>
            <button class="image-edit-panel-close">&times;</button>
        </div>
        <div class="image-edit-panel-body">
            <div class="edit-control">
                <label>Brightness <span class="edit-value" id="brightness-value">${originalValues.brightness}%</span></label>
                <input type="range" id="edit-brightness" min="0" max="200" value="${originalValues.brightness}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Contrast <span class="edit-value" id="contrast-value">${originalValues.contrast}%</span></label>
                <input type="range" id="edit-contrast" min="0" max="200" value="${originalValues.contrast}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Saturation <span class="edit-value" id="saturation-value">${originalValues.saturation}%</span></label>
                <input type="range" id="edit-saturation" min="0" max="200" value="${originalValues.saturation}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Hue <span class="edit-value" id="hue-value">${originalValues.hue}°</span></label>
                <input type="range" id="edit-hue" min="0" max="360" value="${originalValues.hue}" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Blur <span class="edit-value" id="blur-value">${originalValues.blur}px</span></label>
                <input type="range" id="edit-blur" min="0" max="10" value="${originalValues.blur}" step="0.5" class="themed-slider">
            </div>
            <div class="edit-control">
                <label>Opacity <span class="edit-value" id="opacity-value">${originalValues.opacity}%</span></label>
                <input type="range" id="edit-opacity" min="0" max="100" value="${originalValues.opacity}" class="themed-slider">
            </div>
            <div class="edit-checkbox-row">
                <label><input type="checkbox" id="edit-grayscale" ${originalValues.grayscale ? 'checked' : ''}> Grayscale</label>
                <label><input type="checkbox" id="edit-invert" ${originalValues.invert ? 'checked' : ''}> Invert</label>
                <label><input type="checkbox" id="edit-mirror" ${originalValues.mirror ? 'checked' : ''}> Mirror</label>
            </div>
        </div>
        <div class="image-edit-panel-footer">
            <button class="edit-btn edit-btn-secondary" id="edit-reset">Reset</button>
            <button class="edit-btn edit-btn-secondary" id="edit-cancel">Cancel</button>
            <button class="edit-btn edit-btn-primary" id="edit-apply">Apply</button>
        </div>
    `;

    // Add panel styles if not already present
    if (!document.querySelector('#image-edit-panel-styles')) {
        const style = document.createElement('style');
        style.id = 'image-edit-panel-styles';
        style.textContent = `
            .image-edit-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 280px;
                background: var(--bg-primary, #ffffff);
                border: 1px solid var(--border-color, #e0e0e0);
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                user-select: none;
            }
            .image-edit-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid var(--border-color, #e0e0e0);
                cursor: move;
                background: var(--bg-secondary, #f5f5f5);
                border-radius: 8px 8px 0 0;
            }
            .image-edit-panel-title {
                font-weight: 600;
                font-size: 14px;
                color: var(--text-primary, #1a1a1a);
            }
            .image-edit-panel-close {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: var(--text-secondary, #666);
                padding: 0;
                line-height: 1;
            }
            .image-edit-panel-close:hover {
                color: var(--text-primary, #1a1a1a);
            }
            .image-edit-panel-body {
                padding: 16px;
            }
            .edit-control {
                margin-bottom: 14px;
            }
            .edit-control label {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                font-weight: 500;
                margin-bottom: 6px;
                color: var(--text-primary, #1a1a1a);
            }
            .edit-value {
                color: var(--text-secondary, #666);
                font-weight: 400;
            }
            .edit-control input[type="range"] {
                width: 100%;
            }
            .edit-checkbox-row {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                padding-top: 8px;
                border-top: 1px solid var(--border-color, #e0e0e0);
            }
            .edit-checkbox-row label {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: var(--text-primary, #1a1a1a);
                cursor: pointer;
            }
            .image-edit-panel-footer {
                display: flex;
                gap: 8px;
                padding: 12px 16px;
                border-top: 1px solid var(--border-color, #e0e0e0);
                justify-content: flex-end;
            }
            .edit-btn {
                padding: 6px 12px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                border: 1px solid var(--border-color, #e0e0e0);
            }
            .edit-btn-primary {
                background: var(--accent-color, #007AFF);
                color: white;
                border-color: var(--accent-color, #007AFF);
            }
            .edit-btn-primary:hover {
                background: var(--accent-hover, #0056b3);
            }
            .edit-btn-secondary {
                background: var(--bg-primary, #ffffff);
                color: var(--text-primary, #1a1a1a);
            }
            .edit-btn-secondary:hover {
                background: var(--bg-secondary, #f5f5f5);
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(panel);

    // Make panel draggable
    const header = panel.querySelector('.image-edit-panel-header');
    let isDraggingPanel = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('image-edit-panel-close')) return;
        isDraggingPanel = true;
        dragOffsetX = e.clientX - panel.offsetLeft;
        dragOffsetY = e.clientY - panel.offsetTop;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingPanel) return;
        panel.style.left = (e.clientX - dragOffsetX) + 'px';
        panel.style.top = (e.clientY - dragOffsetY) + 'px';
        panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
        isDraggingPanel = false;
    });

    // Get controls
    const brightnessSlider = panel.querySelector('#edit-brightness');
    const contrastSlider = panel.querySelector('#edit-contrast');
    const saturationSlider = panel.querySelector('#edit-saturation');
    const hueSlider = panel.querySelector('#edit-hue');
    const blurSlider = panel.querySelector('#edit-blur');
    const opacitySlider = panel.querySelector('#edit-opacity');
    const grayscaleCheckbox = panel.querySelector('#edit-grayscale');
    const invertCheckbox = panel.querySelector('#edit-invert');
    const mirrorCheckbox = panel.querySelector('#edit-mirror');
    const brightnessValue = panel.querySelector('#brightness-value');
    const contrastValue = panel.querySelector('#contrast-value');
    const saturationValue = panel.querySelector('#saturation-value');
    const hueValue = panel.querySelector('#hue-value');
    const blurValue = panel.querySelector('#blur-value');
    const opacityValue = panel.querySelector('#opacity-value');
    const resetBtn = panel.querySelector('#edit-reset');
    const applyBtn = panel.querySelector('#edit-apply');
    const cancelBtn = panel.querySelector('#edit-cancel');
    const closeBtn = panel.querySelector('.image-edit-panel-close');

    // Update live preview
    function updatePreview() {
        const brightness = parseInt(brightnessSlider.value);
        const contrast = parseInt(contrastSlider.value);
        const saturation = parseInt(saturationSlider.value);
        const hue = parseInt(hueSlider.value);
        const blur = parseFloat(blurSlider.value);
        const opacity = parseInt(opacitySlider.value);
        const grayscale = grayscaleCheckbox.checked;
        const invert = invertCheckbox.checked;
        const mirror = mirrorCheckbox.checked;

        brightnessValue.textContent = `${brightness}%`;
        contrastValue.textContent = `${contrast}%`;
        saturationValue.textContent = `${saturation}%`;
        hueValue.textContent = `${hue}°`;
        blurValue.textContent = `${blur}px`;
        opacityValue.textContent = `${opacity}%`;

        // Apply to image object
        imageObj.brightness = brightness;
        imageObj.contrast = contrast;
        imageObj.saturation = saturation;
        imageObj.hue = hue;
        imageObj.blur = blur;
        imageObj.opacity = opacity;
        imageObj.grayscale = grayscale;
        imageObj.invert = invert;
        imageObj.mirror = mirror;

        // Rebuild filter cache and render
        canvas.clearFilterCache(imageObj);
        canvas.applyFilters(imageObj);
        canvas.needsRender = true;
    }

    brightnessSlider.addEventListener('input', updatePreview);
    contrastSlider.addEventListener('input', updatePreview);
    saturationSlider.addEventListener('input', updatePreview);
    hueSlider.addEventListener('input', updatePreview);
    blurSlider.addEventListener('input', updatePreview);
    opacitySlider.addEventListener('input', updatePreview);
    grayscaleCheckbox.addEventListener('change', updatePreview);
    invertCheckbox.addEventListener('change', updatePreview);
    mirrorCheckbox.addEventListener('change', updatePreview);

    // Reset to defaults
    resetBtn.addEventListener('click', () => {
        brightnessSlider.value = 100;
        contrastSlider.value = 100;
        saturationSlider.value = 100;
        hueSlider.value = 0;
        blurSlider.value = 0;
        opacitySlider.value = 100;
        grayscaleCheckbox.checked = false;
        invertCheckbox.checked = false;
        mirrorCheckbox.checked = false;
        updatePreview();
    });

    // Apply and close
    applyBtn.addEventListener('click', async () => {
        // Values already applied via updatePreview
        canvas.clearFilterCache(imageObj);
        canvas.applyFilters(imageObj);
        canvas.needsRender = true;
        panel.remove();

        // Broadcast filter changes to editor
        if (syncChannel) {
            syncChannel.postMessage({
                type: 'image_filters_changed',
                imageId: imageObj.id,
                filters: {
                    brightness: imageObj.brightness,
                    contrast: imageObj.contrast,
                    saturation: imageObj.saturation,
                    hue: imageObj.hue,
                    blur: imageObj.blur,
                    opacity: imageObj.opacity,
                    grayscale: imageObj.grayscale,
                    invert: imageObj.invert,
                    mirror: imageObj.mirror
                }
            });
        }

        pendingSave = true;
        saveNow();
    });

    // Cancel - revert to original
    function cancelEdit() {
        imageObj.brightness = originalValues.brightness;
        imageObj.contrast = originalValues.contrast;
        imageObj.saturation = originalValues.saturation;
        imageObj.hue = originalValues.hue;
        imageObj.blur = originalValues.blur;
        imageObj.opacity = originalValues.opacity;
        imageObj.grayscale = originalValues.grayscale;
        imageObj.invert = originalValues.invert;
        imageObj.mirror = originalValues.mirror;

        canvas.clearFilterCache(imageObj);
        canvas.applyFilters(imageObj);
        canvas.needsRender = true;
        panel.remove();
    }

    cancelBtn.addEventListener('click', cancelEdit);
    closeBtn.addEventListener('click', cancelEdit);
}
