const SETTINGS_KEY = 'canvas_settings';

const defaultSettings = {
    showGrid: false,
    gridSize: 50,
    enableSnapping: true,
    snapThreshold: 3,
    defaultBgColor: '#ffffff',
    showDeleteConfirm: true,
    autosaveInterval: 2000,
    thumbnailQuality: 0.6
};

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
        try {
            return { ...defaultSettings, ...JSON.parse(saved) };
        } catch (e) {
            return defaultSettings;
        }
    }
    return defaultSettings;
}

function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setupNavigation() {
    const homeBtn = document.getElementById('home-btn');
    const newBoardBtn = document.getElementById('new-board-btn');
    const importBoardBtn = document.getElementById('import-board-btn');

    if (homeBtn) {
        homeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelector('.settings-page').classList.add('page-exit');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 100);
        });
    }

    if (newBoardBtn) {
        newBoardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelector('.settings-page').classList.add('page-exit');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 100);
        });
    }

    if (importBoardBtn) {
        importBoardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelector('.settings-page').classList.add('page-exit');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 100);
        });
    }

    // Keyboard shortcuts button
    const shortcutsBtn = document.getElementById('shortcuts-btn');
    if (shortcutsBtn) {
        shortcutsBtn.addEventListener('click', () => {
            // Import and show shortcuts modal
            import('./shortcuts.js').then(module => {
                module.showShortcutsModal();
            });
        });
    }

    // Website link button
    const websiteBtn = document.getElementById('website-btn');
    if (websiteBtn) {
        websiteBtn.addEventListener('click', () => {
            window.__TAURI__.opener.openUrl('https://anihaven.site/');
        });
    }
}

function setupSettingsControls() {
    const settings = loadSettings();
    
    const showGridCheckbox = document.getElementById('show-grid');
    const gridSizeSelect = document.getElementById('grid-size');
    
    if (showGridCheckbox) {
        showGridCheckbox.checked = settings.showGrid;
        showGridCheckbox.addEventListener('change', (e) => {
            settings.showGrid = e.target.checked;
            saveSettings(settings);
        });
    }
    
    if (gridSizeSelect) {
        gridSizeSelect.value = settings.gridSize;
        gridSizeSelect.addEventListener('change', (e) => {
            settings.gridSize = parseInt(e.target.value);
            saveSettings(settings);
        });
    }
    
    const enableSnappingCheckbox = document.getElementById('enable-snapping');
    const snapThresholdSelect = document.getElementById('snap-threshold');
    
    if (enableSnappingCheckbox) {
        enableSnappingCheckbox.checked = settings.enableSnapping;
        enableSnappingCheckbox.addEventListener('change', (e) => {
            settings.enableSnapping = e.target.checked;
            saveSettings(settings);
        });
    }
    
    if (snapThresholdSelect) {
        snapThresholdSelect.value = settings.snapThreshold;
        snapThresholdSelect.addEventListener('change', (e) => {
            settings.snapThreshold = parseInt(e.target.value);
            saveSettings(settings);
        });
    }
    
    const defaultBgColorInput = document.getElementById('default-bg-color');
    if (defaultBgColorInput) {
        defaultBgColorInput.value = settings.defaultBgColor;
        defaultBgColorInput.addEventListener('change', (e) => {
            settings.defaultBgColor = e.target.value;
            saveSettings(settings);
        });
    }
    
    const showDeleteConfirmCheckbox = document.getElementById('show-delete-confirm');
    if (showDeleteConfirmCheckbox) {
        showDeleteConfirmCheckbox.checked = settings.showDeleteConfirm;
        showDeleteConfirmCheckbox.addEventListener('change', (e) => {
            settings.showDeleteConfirm = e.target.checked;
            saveSettings(settings);
            if (!e.target.checked) {
                localStorage.setItem('skip_delete_confirm', 'true');
            } else {
                localStorage.removeItem('skip_delete_confirm');
            }
        });
    }
    
    const resetDialogsBtn = document.getElementById('reset-dialogs-btn');
    if (resetDialogsBtn) {
        resetDialogsBtn.addEventListener('click', () => {
            localStorage.removeItem('skip_delete_confirm');
            settings.showDeleteConfirm = true;
            if (showDeleteConfirmCheckbox) {
                showDeleteConfirmCheckbox.checked = true;
            }
            saveSettings(settings);
            alert('All "Don\'t show again" choices have been reset.');
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupSettingsControls();

    // Load and render collections
    const collectionsModule = await import('./collections.js');
    collectionsModule.setupCollections();
});