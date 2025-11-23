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

export function applyTheme(themeName) {
    const theme = themes[themeName] || themes.light;
    
    Object.entries(theme).forEach(([property, value]) => {
        document.documentElement.style.setProperty(property, value);
    });
    
    document.body.dataset.theme = themeName;
    localStorage.setItem(THEME_KEY, themeName);
}

export function getCurrentTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
}

export function initTheme() {
    const savedTheme = getCurrentTheme();
    applyTheme(savedTheme);
}