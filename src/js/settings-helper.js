// Settings helper - can be imported by canvas.js and other modules
const SETTINGS_KEY = 'canvas_settings';

export const defaultSettings = {
    showGrid: false,
    gridSize: 50,
    enableSnapping: true,
    snapThreshold: 3,
    defaultBgColor: '#ffffff',
    showDeleteConfirm: true,
    autosaveInterval: 2000,
    thumbnailQuality: 0.6
};

export function getSettings() {
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

export function getSetting(key) {
    const settings = getSettings();
    return settings[key] !== undefined ? settings[key] : defaultSettings[key];
}

export function saveSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}