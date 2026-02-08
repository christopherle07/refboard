/**
 * Floating Sidebar Window
 * Communicates with main window via BroadcastChannel to stay in sync.
 * The main window is the source of truth for all state.
 */

const params = new URLSearchParams(window.location.search);
const boardId = params.get('id');

if (!boardId) {
    document.body.innerHTML = '<p style="padding:20px;color:red;">No board ID provided</p>';
    throw new Error('No board ID');
}

// Apply theme
const savedSettings = JSON.parse(localStorage.getItem('canvas_settings') || '{}');
const theme = savedSettings.theme || 'light';
document.documentElement.setAttribute('data-theme', theme);
document.body.setAttribute('data-theme', theme);

const channel = new BroadcastChannel('sidebar_sync_' + boardId);

// Setup drag handle for window dragging
async function setupDragHandle() {
    if (!window.__TAURI__) return;
    try {
        const { Window } = window.__TAURI__.window;
        const currentWindow = Window.getCurrent();

        // Always on top
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
        case 'board_name_update':
            const boardNameEl = document.getElementById('board-name');
            if (boardNameEl) boardNameEl.textContent = msg.name;
            break;
        case 'bg_color_update':
            const bgInput = document.getElementById('bg-color');
            if (bgInput) bgInput.value = msg.color;
            break;
        case 'sidebar_close':
            // Main window wants to close us (reattach)
            closeSelf();
            break;
    }
};

function updateLayersHTML(html) {
    const layersList = document.getElementById('layers-list');
    if (!layersList) return;
    layersList.innerHTML = html;

    // Disable draggable on all items (drag reorder not supported in floating sidebar)
    layersList.querySelectorAll('[draggable]').forEach(el => {
        el.draggable = false;
        el.removeAttribute('draggable');
    });

    // Re-attach click handlers to layer items
    layersList.querySelectorAll('.layer-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't trigger if clicking buttons
            if (e.target.closest('.layer-visibility-btn') || e.target.closest('.layer-btn-delete')) return;

            const layerId = item.dataset.layerId;
            const layerType = item.dataset.layerType || 'image';
            console.log('[FloatingSidebar] Sending layer_select:', layerId, layerType);
            channel.postMessage({ type: 'layer_select', layerId, layerType, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
        });

        item.addEventListener('dblclick', () => {
            const layerId = item.dataset.layerId;
            const layerType = item.dataset.layerType || 'image';
            channel.postMessage({ type: 'layer_rename', layerId, layerType });
        });
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

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.board-name-wrapper')) {
        dropdownMenu?.classList.remove('show');
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
