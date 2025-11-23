const THEME_KEY = 'app_theme';

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

function applyTheme(themeName) {
    const theme = themes[themeName] || themes.light;
    
    Object.entries(theme).forEach(([property, value]) => {
        document.documentElement.style.setProperty(property, value);
    });
    
    document.body.dataset.theme = themeName;
    localStorage.setItem(THEME_KEY, themeName);
    console.log('Applied theme:', themeName);
}

function getCurrentTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
}

function setupThemeOptions() {
    const currentTheme = getCurrentTheme();
    console.log('Current theme:', currentTheme);
    
    document.querySelectorAll('.theme-option').forEach(option => {
        const theme = option.dataset.theme;
        console.log('Found theme option:', theme);
        
        if (theme === currentTheme) {
            option.classList.add('active');
        }
        
        option.addEventListener('click', () => {
            console.log('Theme clicked:', theme);
            
            document.querySelectorAll('.theme-option').forEach(opt => {
                opt.classList.remove('active');
            });
            option.classList.add('active');
            
            applyTheme(theme);
        });
    });
    
    console.log('Theme options setup complete');
}

function setupNavigation() {
    const homeBtn = document.getElementById('home-btn');
    const newBoardBtn = document.getElementById('new-board-btn');
    const openBtn = document.getElementById('open-btn');
    
    console.log('Home button found:', homeBtn);
    console.log('New board button found:', newBoardBtn);
    console.log('Open button found:', openBtn);
    
    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            console.log('Home button clicked');
            window.location.href = 'index.html';
        });
    }
    
    if (newBoardBtn) {
        newBoardBtn.addEventListener('click', () => {
            console.log('New board button clicked');
            window.location.href = 'index.html';
        });
    }
    
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            console.log('Open button clicked');
            console.log('Open board feature - coming soon');
        });
    }
    
    console.log('Navigation setup complete');
}

// Settings management
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
    console.log('Settings saved:', settings);
}

function setupSettingsControls() {
    const settings = loadSettings();
    
    // Grid settings
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
    
    // Snapping settings
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
    
    // Default background color
    const defaultBgColorInput = document.getElementById('default-bg-color');
    if (defaultBgColorInput) {
        defaultBgColorInput.value = settings.defaultBgColor;
        defaultBgColorInput.addEventListener('change', (e) => {
            settings.defaultBgColor = e.target.value;
            saveSettings(settings);
        });
    }
    
    // Delete confirmation
    const showDeleteConfirmCheckbox = document.getElementById('show-delete-confirm');
    if (showDeleteConfirmCheckbox) {
        showDeleteConfirmCheckbox.checked = settings.showDeleteConfirm;
        showDeleteConfirmCheckbox.addEventListener('change', (e) => {
            settings.showDeleteConfirm = e.target.checked;
            saveSettings(settings);
            
            // Also update the skip confirm key
            if (!e.target.checked) {
                localStorage.setItem('skip_delete_confirm', 'true');
            } else {
                localStorage.removeItem('skip_delete_confirm');
            }
        });
    }
    
    // Reset dialogs button
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
    
    // Auto-save interval
    const autosaveIntervalSelect = document.getElementById('autosave-interval');
    if (autosaveIntervalSelect) {
        autosaveIntervalSelect.value = settings.autosaveInterval;
        autosaveIntervalSelect.addEventListener('change', (e) => {
            settings.autosaveInterval = parseInt(e.target.value);
            saveSettings(settings);
        });
    }
    
    // Thumbnail quality
    const thumbnailQualitySelect = document.getElementById('thumbnail-quality');
    if (thumbnailQualitySelect) {
        thumbnailQualitySelect.value = settings.thumbnailQuality;
        thumbnailQualitySelect.addEventListener('change', (e) => {
            settings.thumbnailQuality = parseFloat(e.target.value);
            saveSettings(settings);
        });
    }
    
    console.log('Settings controls initialized:', settings);
}

// Initialize settings controls when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Settings page loaded');
    
    const savedTheme = getCurrentTheme();
    applyTheme(savedTheme);
    
    setupThemeOptions();
    setupNavigation();
    setupSettingsControls();
});