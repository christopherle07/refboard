const SETTINGS_KEY = 'canvas_settings';

const defaultSettings = {
    showGrid: false,
    gridSize: 50,
    enableSnapping: true,
    snapThreshold: 3,
    defaultBgColor: '#ffffff',
    showDeleteConfirm: true,
    autosaveInterval: 2000,
    thumbnailQuality: 0.6,
    theme: 'light'
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

export function showSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal-overlay';

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
                    <button class="settings-nav-item active" data-section="canvas">Canvas</button>
                    <button class="settings-nav-item" data-section="themes">Themes</button>
                    <button class="settings-nav-item" data-section="about">About</button>
                </nav>
            </div>

            <div class="settings-modal-content">
                <div class="settings-section active" data-section="canvas">
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
                                <span class="setting-description">Spacing between grid lines (px)</span>
                            </div>
                            <input type="number" id="grid-size" class="setting-input" min="10" value="${settings.gridSize || 50}" style="width: 80px; text-align: center;">
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

                <div class="settings-section" data-section="themes">
                    <h3>Themes</h3>
                    <p class="section-description">Choose a color scheme for the app</p>

                    <div class="themes-grid">
                        <div class="theme-card ${(settings.theme || 'light') === 'light' ? 'active' : ''}" data-theme="light">
                            <div class="theme-preview light-preview">
                                <div class="theme-preview-header"></div>
                                <div class="theme-preview-body">
                                    <div class="theme-preview-sidebar"></div>
                                    <div class="theme-preview-content"></div>
                                </div>
                            </div>
                            <div class="theme-info">
                                <span class="theme-name">Light</span>
                                ${(settings.theme || 'light') === 'light' ? '<span class="theme-badge">Active</span>' : ''}
                            </div>
                        </div>

                        <div class="theme-card ${settings.theme === 'dark' ? 'active' : ''}" data-theme="dark">
                            <div class="theme-preview truedark-preview">
                                <div class="theme-preview-header"></div>
                                <div class="theme-preview-body">
                                    <div class="theme-preview-sidebar"></div>
                                    <div class="theme-preview-content"></div>
                                </div>
                            </div>
                            <div class="theme-info">
                                <span class="theme-name">Dark</span>
                                ${settings.theme === 'dark' ? '<span class="theme-badge">Active</span>' : ''}
                            </div>
                        </div>

                        <div class="theme-card ${settings.theme === 'purplexing' ? 'active' : ''}" data-theme="purplexing">
                            <div class="theme-preview purplexing-preview">
                                <div class="theme-preview-header"></div>
                                <div class="theme-preview-body">
                                    <div class="theme-preview-sidebar"></div>
                                    <div class="theme-preview-content"></div>
                                </div>
                            </div>
                            <div class="theme-info">
                                <span class="theme-name">Purplexing</span>
                                ${settings.theme === 'purplexing' ? '<span class="theme-badge">Active</span>' : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="settings-section" data-section="about">
                    <h3>About</h3>

                    <div class="setting-group">
                        <div class="about-content">
                            <h4>EyeDea</h4>
                            <p class="about-description">A visual reference board application for organizing and managing your creative references.</p>

                            <div class="about-links">
                                <a href="https://discord.gg/6EcTTFDDA3" target="_blank" class="about-icon-link discord-link" title="Join Discord Community">
                                    <svg width="32" height="32" viewBox="0 0 512 388" fill="currentColor">
                                        <path d="M433.713 32.491A424.231 424.231 0 00328.061.005c-4.953 8.873-9.488 18.156-13.492 27.509a393.937 393.937 0 00-58.629-4.408c-19.594 0-39.284 1.489-58.637 4.37-3.952-9.33-8.543-18.581-13.525-27.476-36.435 6.212-72.045 17.196-105.676 32.555-66.867 98.92-84.988 195.368-75.928 290.446a425.967 425.967 0 00129.563 65.03c10.447-14.103 19.806-29.116 27.752-44.74a273.827 273.827 0 01-43.716-20.862c3.665-2.658 7.249-5.396 10.712-8.055 40.496 19.019 84.745 28.94 129.514 28.94 44.77 0 89.019-9.921 129.517-28.943 3.504 2.86 7.088 5.598 10.712 8.055a275.576 275.576 0 01-43.796 20.918 311.49 311.49 0 0027.752 44.705 424.235 424.235 0 00129.65-65.019l-.011.011c10.632-110.26-18.162-205.822-76.11-290.55zM170.948 264.529c-25.249 0-46.11-22.914-46.11-51.104 0-28.189 20.135-51.304 46.029-51.304 25.895 0 46.592 23.115 46.15 51.304-.443 28.19-20.336 51.104-46.069 51.104zm170.102 0c-25.29 0-46.069-22.914-46.069-51.104 0-28.189 20.135-51.304 46.069-51.304s46.472 23.115 46.029 51.304c-.443 28.19-20.296 51.104-46.029 51.104z"/>
                                    </svg>
                                </a>
                                <a href="https://x.com/chringusdingus" target="_blank" class="about-icon-link twitter-link" title="Follow on X">
                                    <img src="/assets/x-social-media-logo-icon.svg" alt="X/Twitter" width="32" height="32">
                                </a>
                            </div>
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

    // Settings controls
    const showGridCheckbox = modal.querySelector('#show-grid');
    const gridSizeSelect = modal.querySelector('#grid-size');
    const enableSnappingCheckbox = modal.querySelector('#enable-snapping');
    const snapThresholdSelect = modal.querySelector('#snap-threshold');

    // Theme card selection
    const themeCards = modal.querySelectorAll('.theme-card');
    themeCards.forEach(card => {
        card.addEventListener('click', () => {
            const theme = card.dataset.theme;

            // Update active state
            themeCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            // Update badge
            themeCards.forEach(c => {
                const badge = c.querySelector('.theme-badge');
                if (badge) badge.remove();
            });
            const themeName = card.querySelector('.theme-info');
            const badge = document.createElement('span');
            badge.className = 'theme-badge';
            badge.textContent = 'Active';
            themeName.appendChild(badge);

            // Save and apply theme
            settings.theme = theme;
            saveSettings(settings);
            document.documentElement.setAttribute('data-theme', theme);
            document.body.setAttribute('data-theme', theme);
            console.log('Theme changed to:', theme);
        });
    });

    if (showGridCheckbox) {
        showGridCheckbox.addEventListener('change', async (e) => {
            settings.showGrid = e.target.checked;
            saveSettings(settings);

            // Update active canvas if in board editor
            try {
                const { getActiveCanvas } = await import('./editor.js');
                const canvas = getActiveCanvas();
                if (canvas) {
                    canvas.updateSettings(settings);
                }
            } catch (err) {
                // Canvas might not be loaded yet, that's ok
            }
        });
    }

    if (gridSizeSelect) {
        gridSizeSelect.addEventListener('input', async (e) => {
            let value = parseInt(e.target.value);
            // Clamp value to minimum of 10
            if (value < 10) value = 10;
            settings.gridSize = value;
            saveSettings(settings);

            // Update active canvas if in board editor
            try {
                const { getActiveCanvas } = await import('./editor.js');
                const canvas = getActiveCanvas();
                if (canvas) {
                    canvas.updateSettings(settings);
                }
            } catch (err) {
                // Canvas might not be loaded yet, that's ok
            }
        });
    }

    if (enableSnappingCheckbox) {
        enableSnappingCheckbox.addEventListener('change', async (e) => {
            settings.enableSnapping = e.target.checked;
            saveSettings(settings);

            // Update active canvas if in board editor
            try {
                const { getActiveCanvas } = await import('./editor.js');
                const canvas = getActiveCanvas();
                if (canvas) {
                    canvas.updateSettings(settings);
                }
            } catch (err) {
                // Canvas might not be loaded yet, that's ok
            }
        });
    }

    if (snapThresholdSelect) {
        snapThresholdSelect.addEventListener('change', async (e) => {
            settings.snapThreshold = parseInt(e.target.value);
            saveSettings(settings);

            // Update active canvas if in board editor
            try {
                const { getActiveCanvas } = await import('./editor.js');
                const canvas = getActiveCanvas();
                if (canvas) {
                    canvas.updateSettings(settings);
                }
            } catch (err) {
                // Canvas might not be loaded yet, that's ok
            }
        });
    }

    return modal;
}
