/**
 * Custom Font Dropdown with Font Preview
 * Displays each font option in its actual typeface
 */

// Google Fonts - guaranteed to display correctly
const FONTS = [
    // Sans-Serif
    { name: 'Roboto', value: "'Roboto', sans-serif", category: 'Sans-Serif' },
    { name: 'Open Sans', value: "'Open Sans', sans-serif", category: 'Sans-Serif' },
    { name: 'Lato', value: "'Lato', sans-serif", category: 'Sans-Serif' },
    { name: 'Montserrat', value: "'Montserrat', sans-serif", category: 'Sans-Serif' },
    { name: 'Oswald', value: "'Oswald', sans-serif", category: 'Sans-Serif' },
    { name: 'Raleway', value: "'Raleway', sans-serif", category: 'Sans-Serif' },
    { name: 'Poppins', value: "'Poppins', sans-serif", category: 'Sans-Serif' },
    { name: 'Ubuntu', value: "'Ubuntu', sans-serif", category: 'Sans-Serif' },

    // Serif
    { name: 'Playfair Display', value: "'Playfair Display', serif", category: 'Serif' },
    { name: 'Merriweather', value: "'Merriweather', serif", category: 'Serif' },
    { name: 'Cinzel', value: "'Cinzel', serif", category: 'Serif' },
    { name: 'Abril Fatface', value: "'Abril Fatface', serif", category: 'Serif' },

    // Display
    { name: 'Bebas Neue', value: "'Bebas Neue', sans-serif", category: 'Display' },
    { name: 'Righteous', value: "'Righteous', sans-serif", category: 'Display' },
    { name: 'Lobster', value: "'Lobster', cursive", category: 'Display' },
    { name: 'Permanent Marker', value: "'Permanent Marker', cursive", category: 'Display' },

    // Handwriting
    { name: 'Pacifico', value: "'Pacifico', cursive", category: 'Handwriting' },
    { name: 'Dancing Script', value: "'Dancing Script', cursive", category: 'Handwriting' },
    { name: 'Caveat', value: "'Caveat', cursive", category: 'Handwriting' },
    { name: 'Indie Flower', value: "'Indie Flower', cursive", category: 'Handwriting' },
    { name: 'Shadows Into Light', value: "'Shadows Into Light', cursive", category: 'Handwriting' },
    { name: 'Architects Daughter', value: "'Architects Daughter', cursive", category: 'Handwriting' },

    // Monospace
    { name: 'Roboto Mono', value: "'Roboto Mono', monospace", category: 'Monospace' },
    { name: 'Source Code Pro', value: "'Source Code Pro', monospace", category: 'Monospace' },
];

export class FontDropdown {
    constructor(container, options = {}) {
        this.container = container;
        this.onChange = options.onChange || (() => {});
        this.selectedValue = options.initialValue || FONTS[0].value;
        this.isOpen = false;

        this.render();
        this.setupEventListeners();
    }

    render() {
        // Find the selected font
        const selectedFont = FONTS.find(f => f.value === this.selectedValue) || FONTS[0];

        this.container.innerHTML = `
            <div class="font-dropdown">
                <button class="font-dropdown-trigger" type="button">
                    <span class="font-dropdown-selected" style="font-family: ${selectedFont.value}">${selectedFont.name}</span>
                    <svg class="font-dropdown-arrow" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <div class="font-dropdown-menu">
                    ${FONTS.map((font, index) => `
                        <div class="font-dropdown-item ${font.value === this.selectedValue ? 'selected' : ''}"
                             data-index="${index}"
                             style="font-family: ${font.value}">
                            ${font.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        this.dropdown = this.container.querySelector('.font-dropdown');
        this.trigger = this.container.querySelector('.font-dropdown-trigger');
        this.menu = this.container.querySelector('.font-dropdown-menu');
        this.selectedSpan = this.container.querySelector('.font-dropdown-selected');
    }

    setupEventListeners() {
        // Toggle dropdown on trigger click
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Handle item selection
        this.menu.addEventListener('click', (e) => {
            const item = e.target.closest('.font-dropdown-item');
            if (item) {
                const index = parseInt(item.dataset.index);
                this.selectByIndex(index);
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });

        // Keyboard navigation
        this.trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            } else if (e.key === 'Escape') {
                this.close();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!this.isOpen) {
                    this.open();
                }
                this.focusNextItem();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!this.isOpen) {
                    this.open();
                }
                this.focusPrevItem();
            }
        });

        this.menu.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
                this.trigger.focus();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.focusNextItem();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.focusPrevItem();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const focused = this.menu.querySelector('.font-dropdown-item:focus');
                if (focused) {
                    const index = parseInt(focused.dataset.index);
                    this.selectByIndex(index);
                }
            }
        });

        // Make items focusable
        this.menu.querySelectorAll('.font-dropdown-item').forEach(item => {
            item.setAttribute('tabindex', '-1');
        });
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.isOpen = true;
        this.dropdown.classList.add('open');

        // Scroll to selected item
        const selectedItem = this.menu.querySelector('.font-dropdown-item.selected');
        if (selectedItem) {
            selectedItem.scrollIntoView({ block: 'nearest' });
        }
    }

    close() {
        this.isOpen = false;
        this.dropdown.classList.remove('open');
    }

    selectByIndex(index) {
        const font = FONTS[index];
        if (!font) return;

        this.selectedValue = font.value;

        // Update selected display
        this.selectedSpan.textContent = font.name;
        this.selectedSpan.style.fontFamily = font.value;

        // Update selected state in menu
        this.menu.querySelectorAll('.font-dropdown-item').forEach((item, i) => {
            item.classList.toggle('selected', i === index);
        });

        this.close();
        this.onChange(font.value, font.name);
    }

    select(value) {
        const index = FONTS.findIndex(f => f.value === value);
        if (index >= 0) {
            this.selectByIndex(index);
        }
    }

    focusNextItem() {
        const items = Array.from(this.menu.querySelectorAll('.font-dropdown-item'));
        const currentIndex = items.findIndex(item => item === document.activeElement);
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[nextIndex].focus();
    }

    focusPrevItem() {
        const items = Array.from(this.menu.querySelectorAll('.font-dropdown-item'));
        const currentIndex = items.findIndex(item => item === document.activeElement);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prevIndex].focus();
    }

    getValue() {
        return this.selectedValue;
    }

    setValue(value, triggerChange = false) {
        const index = FONTS.findIndex(f => f.value === value);
        if (index < 0) return;

        const font = FONTS[index];
        this.selectedValue = font.value;

        // Update selected display
        this.selectedSpan.textContent = font.name;
        this.selectedSpan.style.fontFamily = font.value;

        // Update selected state in menu
        this.menu.querySelectorAll('.font-dropdown-item').forEach((item, i) => {
            item.classList.toggle('selected', i === index);
        });

        if (triggerChange) {
            this.onChange(font.value, font.name);
        }
    }
}

// Initialize font dropdowns when DOM is ready
export function initFontDropdowns() {
    // Initialize sidebar font dropdown
    const sidebarContainer = document.getElementById('font-dropdown-container');
    if (sidebarContainer) {
        const initialValue = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
        window.sidebarFontDropdown = new FontDropdown(sidebarContainer, {
            initialValue,
            onChange: (value) => {
                // Dispatch custom event for the editor to handle
                sidebarContainer.dispatchEvent(new CustomEvent('fontchange', {
                    detail: { value },
                    bubbles: true
                }));
            }
        });
    }

    // Initialize floating toolbar font dropdown
    const floatingContainer = document.getElementById('floating-font-dropdown-container');
    if (floatingContainer) {
        const initialValue = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
        window.floatingFontDropdown = new FontDropdown(floatingContainer, {
            initialValue,
            onChange: (value) => {
                // Dispatch custom event for the editor to handle
                floatingContainer.dispatchEvent(new CustomEvent('fontchange', {
                    detail: { value },
                    bubbles: true
                }));
            }
        });
    }
}
