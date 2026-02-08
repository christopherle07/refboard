const params = new URLSearchParams(window.location.search);
const boardId = params.get('id');

if (!boardId) {
    document.body.innerHTML = '<p style="padding:20px;color:red;">No board ID provided</p>';
    throw new Error('No board ID');
}
const savedSettings = JSON.parse(localStorage.getItem('canvas_settings') || '{}');
const theme = savedSettings.theme || 'light';
document.documentElement.setAttribute('data-theme', theme);
document.body.setAttribute('data-theme', theme);

const channel = new BroadcastChannel('sidebar_sync_' + boardId);

let isDragging = false;
let draggedElement = null;
let draggedLayerId = null;
let draggedLayerType = null; 
let draggedFromGroup = null;
let draggedFromGroupBounds = null;
let lastDragY = 0;

async function setupDragHandle() {
    if (!window.__TAURI__) return;
    try {
        const { Window } = window.__TAURI__.window;
        const currentWindow = Window.getCurrent();

        await currentWindow.setAlwaysOnTop(true);

        const handle = document.getElementById('drag-handle');
        if (handle) {
            handle.addEventListener('mousedown', async (e) => {
                try {
                    await currentWindow.startDragging();
                } catch (err) {
                    // ignore
                }
            });
        }
    } catch (err) {
        console.error('Drag handle setup error:', err);
    }
}

// context menu helpers 

function closeAllContextMenus() {
    document.querySelectorAll('.layer-context-menu').forEach(menu => menu.remove());
}

function showLayerContextMenu(x, y, layerId, layerType, isInGroup, groupId) {
    closeAllContextMenus();

    const menu = document.createElement('div');
    menu.className = 'layer-context-menu show';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10000';

    const renameItem = document.createElement('div');
    renameItem.className = 'layer-context-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'layer_rename', layerId, layerType });
    });

    const ungroupItem = document.createElement('div');
    ungroupItem.className = 'layer-context-menu-item';
    ungroupItem.textContent = 'Remove from Group';
    ungroupItem.style.display = isInGroup ? 'block' : 'none';
    ungroupItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'layer_remove_from_group', layerId, layerType, groupId });
    });

    const duplicateItem = document.createElement('div');
    duplicateItem.className = 'layer-context-menu-item';
    duplicateItem.textContent = 'Duplicate';
    duplicateItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'layer_duplicate', layerId, layerType });
    });

    const deleteItem = document.createElement('div');
    deleteItem.className = 'layer-context-menu-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'layer_delete', layerId, layerType });
    });

    menu.appendChild(renameItem);
    menu.appendChild(ungroupItem);
    menu.appendChild(duplicateItem);
    menu.appendChild(deleteItem);

    document.body.appendChild(menu);

    // Ensure menu is within viewport
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
    if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }

    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function showGroupContextMenu(x, y, groupId) {
    closeAllContextMenus();

    const menu = document.createElement('div');
    menu.className = 'layer-context-menu group-context-menu show';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10000';

    const renameItem = document.createElement('div');
    renameItem.className = 'layer-context-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'group_rename', groupId });
    });

    const visibilityItem = document.createElement('div');
    visibilityItem.className = 'layer-context-menu-item';
    visibilityItem.textContent = 'Toggle Visibility';
    visibilityItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'group_toggle_visibility', groupId });
    });

    const duplicateItem = document.createElement('div');
    duplicateItem.className = 'layer-context-menu-item';
    duplicateItem.textContent = 'Duplicate';
    duplicateItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'group_duplicate', groupId });
    });

    const separator = document.createElement('div');
    separator.className = 'layer-context-menu-separator';

    const ungroupItem = document.createElement('div');
    ungroupItem.className = 'layer-context-menu-item';
    ungroupItem.textContent = 'Ungroup';
    ungroupItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'group_ungroup', groupId });
    });

    const deleteItem = document.createElement('div');
    deleteItem.className = 'layer-context-menu-item';
    deleteItem.textContent = 'Delete Group and Layers';
    deleteItem.addEventListener('click', () => {
        menu.remove();
        channel.postMessage({ type: 'group_delete', groupId });
    });

    menu.appendChild(renameItem);
    menu.appendChild(visibilityItem);
    menu.appendChild(duplicateItem);
    menu.appendChild(separator);
    menu.appendChild(ungroupItem);
    menu.appendChild(deleteItem);

    document.body.appendChild(menu);

    // Ensure menu is within viewport
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
    if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }

    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// ---- Drag-and-drop helpers ----

function collectLayerOrder() {
    // Collect the current visual order of layers from the DOM.
    // The DOM is rendered top=front (highest zIndex), bottom=back (lowest zIndex).
    // We need to return the array in zIndex order (index 0 = back = bottom of DOM),
    // so we reverse after collecting top-to-bottom.
    const layersList = document.getElementById('layers-list');
    if (!layersList) return [];

    const order = [];
    const walkChildren = (parent) => {
        for (const child of parent.children) {
            if (child.classList.contains('layer-item')) {
                order.push({
                    type: child.dataset.layerType || 'image',
                    id: child.dataset.layerId
                });
            } else if (child.classList.contains('group-item')) {
                const groupChildren = child.querySelector('.group-children');
                if (groupChildren) {
                    walkChildren(groupChildren);
                }
            }
        }
    };
    walkChildren(layersList);
    // Reverse: DOM top-to-bottom → zIndex low-to-high
    order.reverse();
    return order;
}

function setupDragAndDrop(layerItem) {
    layerItem.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'INPUT') {
            e.preventDefault();
            return;
        }
        isDragging = true;
        draggedElement = layerItem;
        draggedLayerId = layerItem.dataset.layerId;
        draggedLayerType = layerItem.dataset.layerType || 'image';

        // Track group membership
        const groupItem = layerItem.closest('.group-item');
        if (groupItem) {
            draggedFromGroup = groupItem.dataset.groupId;
            const rect = groupItem.getBoundingClientRect();
            draggedFromGroupBounds = { top: rect.top, bottom: rect.bottom };
        } else {
            draggedFromGroup = null;
            draggedFromGroupBounds = null;
        }

        layerItem.classList.add('dragging');
        document.body.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    layerItem.addEventListener('dragend', () => {
        isDragging = false;
        document.body.classList.remove('dragging');
        layerItem.classList.remove('dragging');

        // Clear all drag indicators
        document.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
            el.classList.remove('drag-over-above', 'drag-over-below');
        });

        // Check if layer was dragged outside its group
        if (draggedFromGroup && draggedFromGroupBounds) {
            const isOutsideGroup = lastDragY < draggedFromGroupBounds.top || lastDragY > draggedFromGroupBounds.bottom;
            if (isOutsideGroup) {
                channel.postMessage({
                    type: 'layer_remove_from_group',
                    layerId: draggedLayerId,
                    layerType: draggedLayerType,
                    groupId: draggedFromGroup
                });
            }
        }

        // Collect current visual order and send to main window
        const order = collectLayerOrder();
        if (order.length > 0) {
            channel.postMessage({ type: 'layer_reorder', order });
        }

        draggedElement = null;
        draggedLayerId = null;
        draggedLayerType = null;
        draggedFromGroup = null;
        draggedFromGroupBounds = null;
        lastDragY = 0;
    });

    layerItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        lastDragY = e.clientY;

        if (!draggedElement || draggedElement === layerItem) return;

        // Clear all indicators
        document.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
            el.classList.remove('drag-over-above', 'drag-over-below');
        });

        const rect = layerItem.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midpoint;

        if (insertBefore) {
            layerItem.classList.add('drag-over-above');
        } else {
            layerItem.classList.add('drag-over-below');
        }

        // Move the dragged element in the DOM
        const parent = layerItem.parentNode;
        if (insertBefore) {
            parent.insertBefore(draggedElement, layerItem);
        } else {
            parent.insertBefore(draggedElement, layerItem.nextSibling);
        }
    });

    layerItem.addEventListener('dragleave', () => {
        layerItem.classList.remove('drag-over-above', 'drag-over-below');
    });

    layerItem.addEventListener('drop', (e) => {
        e.preventDefault();
        layerItem.classList.remove('drag-over-above', 'drag-over-below');
    });
}

function setupGroupDragAndDrop(groupHeader, groupItem) {
    groupHeader.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
            e.preventDefault();
            return;
        }
        isDragging = true;
        draggedElement = groupItem;
        draggedLayerId = groupItem.dataset.groupId;
        draggedLayerType = 'group';

        groupItem.classList.add('dragging');
        document.body.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    groupHeader.addEventListener('dragend', () => {
        isDragging = false;
        document.body.classList.remove('dragging');
        groupItem.classList.remove('dragging');

        document.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
            el.classList.remove('drag-over-above', 'drag-over-below');
        });

        // Collect visual order and send to main window
        const order = collectLayerOrder();
        if (order.length > 0) {
            channel.postMessage({ type: 'layer_reorder', order });
        }

        draggedElement = null;
        draggedLayerId = null;
        draggedLayerType = null;
        lastDragY = 0;
    });
}

// ---- Layer rendering (receives HTML from main window) ----

channel.onmessage = (event) => {
    const msg = event.data;

    switch (msg.type) {
        case 'layers_update':
            updateLayersHTML(msg.html);
            break;
        case 'properties_update':
            updatePropertiesHTML(msg);
            break;
        case 'board_name_update': {
            const boardNameEl = document.getElementById('board-name');
            if (boardNameEl) boardNameEl.textContent = msg.name;
            break;
        }
        case 'bg_color_update': {
            const bgInput = document.getElementById('bg-color');
            if (bgInput) bgInput.value = msg.color;
            break;
        }
        case 'sidebar_close':
            // Main window wants to close us (reattach)
            closeSelf();
            break;
    }
};

function setupContainerDropZone(container) {
    // Allow dropping into empty space at the bottom of a container
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        lastDragY = e.clientY;

        if (!draggedElement) return;

        // Only act if the drag target is the container itself (empty space),
        // not a child layer-item (those have their own handlers)
        const targetItem = e.target.closest('.layer-item');
        const targetGroup = e.target.closest('.group-header');
        if (targetItem || targetGroup) return;

        // Move dragged element to end of container
        if (draggedElement.parentNode !== container || draggedElement.nextSibling !== null) {
            container.appendChild(draggedElement);
        }
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
    });
}

function updateLayersHTML(html) {
    const layersList = document.getElementById('layers-list');
    if (!layersList) return;
    layersList.innerHTML = html;

    // Setup drop zone on the main layers list container
    setupContainerDropZone(layersList);

    // Setup drop zones on group children containers
    layersList.querySelectorAll('.group-children').forEach(gc => {
        setupContainerDropZone(gc);
    });

    // Re-attach click handlers and drag-and-drop to layer items
    layersList.querySelectorAll('.layer-item').forEach(item => {
        // Keep draggable enabled for reordering
        item.draggable = true;

        item.addEventListener('click', (e) => {
            // Don't trigger if clicking buttons
            if (e.target.closest('.layer-visibility-btn') || e.target.closest('.layer-btn-delete')) return;

            const layerId = item.dataset.layerId;
            const layerType = item.dataset.layerType || 'image';
            channel.postMessage({ type: 'layer_select', layerId, layerType, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
        });

        item.addEventListener('dblclick', () => {
            const layerId = item.dataset.layerId;
            const layerType = item.dataset.layerType || 'image';
            channel.postMessage({ type: 'layer_rename', layerId, layerType });
        });

        // Right-click context menu
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const layerId = item.dataset.layerId;
            const layerType = item.dataset.layerType || 'image';

            // Check if in a group
            const groupItem = item.closest('.group-item');
            const isInGroup = !!groupItem;
            const groupId = groupItem ? groupItem.dataset.groupId : null;

            showLayerContextMenu(e.clientX, e.clientY, layerId, layerType, isInGroup, groupId);
        });

        // Drag-and-drop
        setupDragAndDrop(item);
    });

    // Visibility buttons
    layersList.querySelectorAll('.layer-visibility-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const layerItem = btn.closest('.layer-item');
            if (!layerItem) return;
            const layerId = layerItem.dataset.layerId;
            const layerType = layerItem.dataset.layerType || 'image';
            channel.postMessage({ type: 'layer_toggle_visibility', layerId, layerType });
        });
    });

    // Delete buttons
    layersList.querySelectorAll('.layer-btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const layerItem = btn.closest('.layer-item');
            if (!layerItem) return;
            const layerId = layerItem.dataset.layerId;
            const layerType = layerItem.dataset.layerType || 'image';
            channel.postMessage({ type: 'layer_delete', layerId, layerType });
        });
    });

    // Group headers - context menu and drag-and-drop
    layersList.querySelectorAll('.group-item').forEach(groupItem => {
        const groupId = groupItem.dataset.groupId;
        const groupHeader = groupItem.querySelector('.group-header');

        if (groupHeader) {
            // Keep group header draggable
            groupHeader.draggable = true;

            // Right-click context menu for group
            groupHeader.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showGroupContextMenu(e.clientX, e.clientY, groupId);
            });

            // Click to select all layers in group
            groupHeader.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
                e.stopPropagation();
                channel.postMessage({ type: 'group_select', groupId });
            });

            // Drag-and-drop for groups
            setupGroupDragAndDrop(groupHeader, groupItem);
        }
    });

    // Group collapse toggles
    layersList.querySelectorAll('.group-collapse-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupItem = btn.closest('.group-item');
            if (!groupItem) return;
            const groupId = groupItem.dataset.groupId;
            channel.postMessage({ type: 'group_toggle_collapse', groupId });
        });
    });

    // Group visibility buttons
    layersList.querySelectorAll('.group-visibility-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupItem = btn.closest('.group-item');
            if (!groupItem) return;
            const groupId = groupItem.dataset.groupId;
            channel.postMessage({ type: 'group_toggle_visibility', groupId });
        });
    });

    // Group delete buttons (× button)
    layersList.querySelectorAll('.group-item > .group-header .layer-btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupItem = btn.closest('.group-item');
            if (!groupItem) return;
            const groupId = groupItem.dataset.groupId;
            channel.postMessage({ type: 'group_ungroup', groupId });
        });
    });
}

function updatePropertiesHTML(msg) {
    const objProps = document.getElementById('object-properties');
    const defaultProps = document.getElementById('default-properties');

    if (msg.visible) {
        if (objProps) {
            objProps.style.display = '';
            const propsContent = document.getElementById('properties-content');
            if (propsContent && msg.html) {
                propsContent.innerHTML = msg.html;
                attachPropertyListeners();
            }
            const title = document.getElementById('object-properties-title');
            if (title && msg.title) title.textContent = msg.title;
        }
        if (defaultProps) defaultProps.style.display = 'none';
    } else {
        if (objProps) objProps.style.display = 'none';
        if (defaultProps) defaultProps.style.display = '';
    }
}

function attachPropertyListeners() {
    // Forward all property changes to main window
    const inputs = document.querySelectorAll('#properties-content input, #properties-content select, #properties-content textarea');
    inputs.forEach(input => {
        const eventType = input.type === 'color' || input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventType, () => {
            channel.postMessage({
                type: 'property_change',
                inputId: input.id,
                value: input.type === 'checkbox' ? input.checked : input.value
            });
        });
    });

    // Alignment buttons
    document.querySelectorAll('#properties-content .alignment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            channel.postMessage({
                type: 'property_change',
                inputId: 'text-align',
                value: btn.dataset.align || btn.textContent.trim().toLowerCase()
            });
        });
    });
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        channel.postMessage({ type: 'tab_switch', tab });
    });
});

// Background color change
const bgColorInput = document.getElementById('bg-color');
if (bgColorInput) {
    bgColorInput.addEventListener('change', (e) => {
        channel.postMessage({ type: 'bg_color_change', color: e.target.value });
    });
}

// Close properties button
const closePropsBtn = document.getElementById('close-properties-btn');
if (closePropsBtn) {
    closePropsBtn.addEventListener('click', () => {
        channel.postMessage({ type: 'close_properties' });
    });
}

// Collapse layers section
const collapseLayersBtn = document.getElementById('collapse-layers-btn');
if (collapseLayersBtn) {
    collapseLayersBtn.addEventListener('click', () => {
        const content = document.getElementById('layers-content');
        if (content) {
            content.classList.toggle('collapsed');
        }
    });
}

// Board dropdown
const boardNameEl = document.getElementById('board-name');
const dropdownBtn = document.getElementById('board-dropdown-btn');
const dropdownMenu = document.getElementById('board-dropdown-menu');

if (boardNameEl) {
    boardNameEl.addEventListener('click', () => {
        dropdownMenu?.classList.toggle('show');
    });
}
if (dropdownBtn) {
    dropdownBtn.addEventListener('click', () => {
        dropdownMenu?.classList.toggle('show');
    });
}

// Dropdown items forward to main window
['dropdown-rename', 'dropdown-export', 'dropdown-import', 'dropdown-export-lines'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('click', () => {
            channel.postMessage({ type: 'dropdown_action', action: id });
            dropdownMenu?.classList.remove('show');
        });
    }
});

// Close dropdown and context menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.board-name-wrapper')) {
        dropdownMenu?.classList.remove('show');
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+G = Group selected layers
    if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        channel.postMessage({ type: 'create_group' });
    }
});

async function closeSelf() {
    if (!window.__TAURI__) return;
    try {
        const { Window } = window.__TAURI__.window;
        const currentWindow = Window.getCurrent();
        await currentWindow.close();
    } catch (err) {
        console.error('Close error:', err);
    }
}

// Notify main window when this window is closing (taskbar close, Alt+F4, etc.)
window.addEventListener('beforeunload', () => {
    channel.postMessage({ type: 'sidebar_closed' });
});

// On load, request current state from main window
function init() {
    setupDragHandle();
    channel.postMessage({ type: 'sidebar_ready' });
}

init();
