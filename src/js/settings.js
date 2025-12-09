const THEME_KEY = 'app_theme';
const SETTINGS_KEY = 'canvas_settings';

const themes = {
    light: {
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#f8f8f8',
        '--bg-tertiary': '#fafafa',
        '--bg-hover': 'rgba(0, 0, 0, 0.05)',
        '--bg-active': 'rgba(0, 0, 0, 0.08)',
        '--border-color': '#e0e0e0',
        '--border-color-hover': '#999',
        '--text-primary': '#1a1a1a',
        '--text-secondary': '#666',
        '--text-tertiary': '#888',
        '--text-disabled': '#999',
        '--shadow': 'rgba(0, 0, 0, 0.08)',
        '--modal-overlay': 'rgba(0, 0, 0, 0.5)'
    },
    dark: {
        '--bg-primary': '#3d3d3d',
        '--bg-secondary': '#2d2d2d',
        '--bg-tertiary': '#333333',
        '--bg-hover': 'rgba(255, 255, 255, 0.05)',
        '--bg-active': 'rgba(255, 255, 255, 0.08)',
        '--border-color': '#555555',
        '--border-color-hover': '#777777',
        '--text-primary': '#e8e8e8',
        '--text-secondary': '#b8b8b8',
        '--text-tertiary': '#999999',
        '--text-disabled': '#666666',
        '--shadow': 'rgba(0, 0, 0, 0.3)',
        '--modal-overlay': 'rgba(0, 0, 0, 0.7)'
    },
    midnight: {
        '--bg-primary': '#1a1a1a',
        '--bg-secondary': '#0f0f0f',
        '--bg-tertiary': '#151515',
        '--bg-hover': 'rgba(255, 255, 255, 0.03)',
        '--bg-active': 'rgba(255, 255, 255, 0.06)',
        '--border-color': '#2a2a2a',
        '--border-color-hover': '#444444',
        '--text-primary': '#e0e0e0',
        '--text-secondary': '#a0a0a0',
        '--text-tertiary': '#707070',
        '--text-disabled': '#505050',
        '--shadow': 'rgba(0, 0, 0, 0.5)',
        '--modal-overlay': 'rgba(0, 0, 0, 0.8)'
    }
};

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

function applyTheme(themeName) {
    const theme = themes[themeName] || themes.light;
    Object.entries(theme).forEach(([property, value]) => {
        document.documentElement.style.setProperty(property, value);
    });
    document.body.dataset.theme = themeName;
    localStorage.setItem(THEME_KEY, themeName);
}

function getCurrentTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
}

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

function setupThemeOptions() {
    const currentTheme = getCurrentTheme();
    document.querySelectorAll('.theme-option').forEach(option => {
        const theme = option.dataset.theme;
        if (theme === currentTheme) {
            option.classList.add('active');
        }
        option.addEventListener('click', () => {
            document.querySelectorAll('.theme-option').forEach(opt => {
                opt.classList.remove('active');
            });
            option.classList.add('active');
            applyTheme(theme);
        });
    });
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

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = getCurrentTheme();
    applyTheme(savedTheme);
    setupThemeOptions();
    setupNavigation();
    setupSettingsControls();

});