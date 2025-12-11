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

export function showSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal-overlay';

    const currentTheme = getCurrentTheme();
    const settings = loadSettings();

    modal.innerHTML = `
        <div class="settings-modal">
            <div class="settings-modal-sidebar">
                <div class="settings-modal-header">
                    <h2>Settings</h2>
                    <button class="settings-close-btn" data-action="close">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <nav class="settings-nav">
                    <button class="settings-nav-item active" data-section="appearance">Appearance</button>
                    <button class="settings-nav-item" data-section="canvas">Canvas</button>
                </nav>
            </div>

            <div class="settings-modal-content">
                <div class="settings-section active" data-section="appearance">
                    <h3>Appearance</h3>

                    <div class="setting-group">
                        <label class="setting-label">Theme</label>
                        <div class="theme-options">
                            <div class="theme-option ${currentTheme === 'light' ? 'active' : ''}" data-theme="light">
                                <div class="theme-preview theme-preview-light">
                                    <div class="preview-bar"></div>
                                    <div class="preview-content"></div>
                                </div>
                                <span class="theme-name">Light</span>
                            </div>

                            <div class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">
                                <div class="theme-preview theme-preview-dark">
                                    <div class="preview-bar"></div>
                                    <div class="preview-content"></div>
                                </div>
                                <span class="theme-name">Dark</span>
                            </div>

                            <div class="theme-option ${currentTheme === 'midnight' ? 'active' : ''}" data-theme="midnight">
                                <div class="theme-preview theme-preview-midnight">
                                    <div class="preview-bar"></div>
                                    <div class="preview-content"></div>
                                </div>
                                <span class="theme-name">Midnight</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="settings-section" data-section="canvas">
                    <h3>Canvas</h3>

                    <div class="setting-group">
                        <div class="setting-row">
                            <div class="setting-info">
                                <span class="setting-row-label">Show Grid</span>
                                <span class="setting-description">Display alignment grid on canvas</span>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="show-grid" ${settings.showGrid ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="setting-row">
                            <div class="setting-info">
                                <span class="setting-row-label">Grid Size</span>
                                <span class="setting-description">Spacing between grid lines</span>
                            </div>
                            <select id="grid-size" class="setting-select">
                                <option value="25" ${settings.gridSize === 25 ? 'selected' : ''}>25px</option>
                                <option value="50" ${settings.gridSize === 50 ? 'selected' : ''}>50px</option>
                                <option value="100" ${settings.gridSize === 100 ? 'selected' : ''}>100px</option>
                                <option value="200" ${settings.gridSize === 200 ? 'selected' : ''}>200px</option>
                            </select>
                        </div>
                    </div>

                    <div class="setting-group">
                        <div class="setting-row">
                            <div class="setting-info">
                                <span class="setting-row-label">Enable Snapping</span>
                                <span class="setting-description">Snap images to align with each other</span>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="enable-snapping" ${settings.enableSnapping ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="setting-row">
                            <div class="setting-info">
                                <span class="setting-row-label">Snap Distance</span>
                                <span class="setting-description">How close to snap</span>
                            </div>
                            <select id="snap-threshold" class="setting-select">
                                <option value="3" ${settings.snapThreshold === 3 ? 'selected' : ''}>3px (Precise)</option>
                                <option value="5" ${settings.snapThreshold === 5 ? 'selected' : ''}>5px (Default)</option>
                                <option value="8" ${settings.snapThreshold === 8 ? 'selected' : ''}>8px (Relaxed)</option>
                                <option value="12" ${settings.snapThreshold === 12 ? 'selected' : ''}>12px (Loose)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Make modal visible
    setTimeout(() => {
        modal.style.display = 'flex';
    }, 10);

    const closeModal = () => {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.remove();
        }, 250);
    };

    // Close button
    modal.querySelector('[data-action="close"]').addEventListener('click', closeModal);

    // Click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // ESC key to close
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Section navigation
    const navItems = modal.querySelectorAll('.settings-nav-item');
    const sections = modal.querySelectorAll('.settings-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const sectionName = item.dataset.section;

            navItems.forEach(nav => nav.classList.remove('active'));
            sections.forEach(section => section.classList.remove('active'));

            item.classList.add('active');
            modal.querySelector(`.settings-section[data-section="${sectionName}"]`).classList.add('active');
        });
    });

    // Theme selection
    modal.querySelectorAll('.theme-option').forEach(option => {
        option.addEventListener('click', () => {
            const theme = option.dataset.theme;
            modal.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            applyTheme(theme);
        });
    });

    // Settings controls
    const showGridCheckbox = modal.querySelector('#show-grid');
    const gridSizeSelect = modal.querySelector('#grid-size');
    const enableSnappingCheckbox = modal.querySelector('#enable-snapping');
    const snapThresholdSelect = modal.querySelector('#snap-threshold');

    if (showGridCheckbox) {
        showGridCheckbox.addEventListener('change', (e) => {
            settings.showGrid = e.target.checked;
            saveSettings(settings);
        });
    }

    if (gridSizeSelect) {
        gridSizeSelect.addEventListener('change', (e) => {
            settings.gridSize = parseInt(e.target.value);
            saveSettings(settings);
        });
    }

    if (enableSnappingCheckbox) {
        enableSnappingCheckbox.addEventListener('change', (e) => {
            settings.enableSnapping = e.target.checked;
            saveSettings(settings);
        });
    }

    if (snapThresholdSelect) {
        snapThresholdSelect.addEventListener('change', (e) => {
            settings.snapThreshold = parseInt(e.target.value);
            saveSettings(settings);
        });
    }

    return modal;
}
