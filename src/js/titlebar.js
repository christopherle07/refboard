// Custom Titlebar Controls

let appWindow = null;
let isMaximized = false;
let initAttempts = 0;
const MAX_INIT_ATTEMPTS = 50; // 5 seconds max

// Initialize titlebar controls
export function initTitlebar() {
    console.log('Attempting to initialize titlebar...');
    console.log('Tauri available:', !!window.__TAURI__);
    console.log('Tauri.window available:', !!window.__TAURI__?.window);

    // Log what's actually available
    if (window.__TAURI__?.window) {
        console.log('Available window methods:', Object.keys(window.__TAURI__.window));
    }

    // Wait for Tauri API to be available
    if (window.__TAURI__ && window.__TAURI__.window) {
        try {
            // Try Tauri v2 API first
            if (window.__TAURI__.window.Window) {
                appWindow = window.__TAURI__.window.Window.getCurrent();
                console.log('✓ Tauri window API (v2) initialized successfully', appWindow);
            }
            // Fallback to v1 API
            else if (window.__TAURI__.window.getCurrent) {
                appWindow = window.__TAURI__.window.getCurrent();
                console.log('✓ Tauri window API (v1) initialized successfully', appWindow);
            } else {
                throw new Error('Unable to find getCurrent method');
            }
            setupTitlebarControls();
        } catch (err) {
            console.error('Failed to get Tauri window:', err);
            retryInit();
        }
    } else {
        console.warn('Tauri API not yet available, will retry...');
        retryInit();
    }
}

function retryInit() {
    initAttempts++;
    if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initTitlebar, 100);
    } else {
        console.error('Failed to initialize Tauri after', MAX_INIT_ATTEMPTS, 'attempts');
    }
}

function setupTitlebarControls() {
    console.log('Setting up titlebar controls...');
    const minimizeBtn = document.getElementById('titlebar-minimize');
    const maximizeBtn = document.getElementById('titlebar-maximize');
    const closeBtn = document.getElementById('titlebar-close');

    console.log('Buttons found:', {
        minimize: !!minimizeBtn,
        maximize: !!maximizeBtn,
        close: !!closeBtn,
        appWindow: !!appWindow
    });

    if (minimizeBtn && appWindow) {
        console.log('✓ Adding minimize handler');
        minimizeBtn.addEventListener('click', async () => {
            console.log('Minimize button clicked!');
            try {
                await appWindow.minimize();
            } catch (err) {
                console.error('Failed to minimize:', err);
            }
        });
    }

    if (maximizeBtn && appWindow) {
        console.log('✓ Adding maximize handler');
        maximizeBtn.addEventListener('click', async () => {
            console.log('Maximize button clicked!');
            try {
                await appWindow.toggleMaximize();
            } catch (err) {
                console.error('Failed to toggle maximize:', err);
            }
        });
    }

    if (closeBtn && appWindow) {
        console.log('✓ Adding close handler');
        closeBtn.addEventListener('click', async () => {
            console.log('Close button clicked!');
            try {
                await appWindow.close();
            } catch (err) {
                console.error('Failed to close:', err);
            }
        });
    }

    // Listen for window resize to update maximize button state
    if (appWindow) {
        const unlisten = appWindow.onResized(async () => {
            try {
                const maximized = await appWindow.isMaximized();
                updateMaximizeButton(maximized);
            } catch (err) {
                console.error('Failed to check maximize state:', err);
            }
        });

        // Check initial maximize state
        checkMaximizeState();
    }
}

async function checkMaximizeState() {
    if (!appWindow) return;

    try {
        const maximized = await appWindow.isMaximized();
        updateMaximizeButton(maximized);
    } catch (err) {
        console.error('Failed to check maximize state:', err);
    }
}

function updateMaximizeButton(maximized) {
    isMaximized = maximized;
    const maximizeBtn = document.getElementById('titlebar-maximize');
    if (maximizeBtn) {
        if (maximized) {
            maximizeBtn.classList.add('maximized');
            maximizeBtn.title = 'Restore';
        } else {
            maximizeBtn.classList.remove('maximized');
            maximizeBtn.title = 'Maximize';
        }
    }
}

// Update titlebar title (useful for editor page)
export function updateTitlebarTitle(title) {
    const titleElement = document.querySelector('.titlebar-title');
    if (titleElement) {
        titleElement.textContent = title;
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTitlebar);
} else {
    initTitlebar();
}
