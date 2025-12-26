/**
 * Modern Text Editor with Formatting Toolbar
 * Based on contenteditable best practices
 */

export class TextEditor {
    constructor(canvas, canvasElement) {
        this.canvas = canvas;
        this.canvasElement = canvasElement;
        this.overlay = null;
        this.input = null;
        this.toolbar = null;
        this.currentTextObject = null;
        this.isEditing = false;

        this.initElements();
        this.setupToolbar();
    }

    initElements() {
        this.overlay = document.getElementById('text-editor-overlay');
        this.input = document.getElementById('text-editor-input');
        this.toolbar = document.getElementById('text-toolbar');
    }

    setupToolbar() {
        // Font family
        const fontFamily = document.getElementById('text-font-family');
        if (fontFamily) {
            fontFamily.addEventListener('change', () => {
                if (this.currentTextObject) {
                    this.currentTextObject.fontFamily = fontFamily.value;
                    this.input.style.fontFamily = fontFamily.value;
                    this.updateCanvas();
                }
            });
        }

        // Font size
        const fontSize = document.getElementById('text-font-size');
        if (fontSize) {
            fontSize.addEventListener('change', () => {
                if (this.currentTextObject) {
                    this.currentTextObject.fontSize = parseInt(fontSize.value);
                    this.input.style.fontSize = fontSize.value + 'px';
                    this.updateCanvas();
                }
            });
        }

        // Bold
        const boldBtn = document.getElementById('text-bold');
        if (boldBtn) {
            boldBtn.addEventListener('click', () => {
                if (this.currentTextObject) {
                    this.currentTextObject.bold = !this.currentTextObject.bold;
                    this.input.style.fontWeight = this.currentTextObject.bold ? 'bold' : 'normal';
                    boldBtn.classList.toggle('active', this.currentTextObject.bold);
                    this.updateCanvas();
                }
            });
        }

        // Italic
        const italicBtn = document.getElementById('text-italic');
        if (italicBtn) {
            italicBtn.addEventListener('click', () => {
                if (this.currentTextObject) {
                    this.currentTextObject.italic = !this.currentTextObject.italic;
                    this.input.style.fontStyle = this.currentTextObject.italic ? 'italic' : 'normal';
                    italicBtn.classList.toggle('active', this.currentTextObject.italic);
                    this.updateCanvas();
                }
            });
        }

        // Underline
        const underlineBtn = document.getElementById('text-underline');
        if (underlineBtn) {
            underlineBtn.addEventListener('click', () => {
                if (this.currentTextObject) {
                    this.currentTextObject.underline = !this.currentTextObject.underline;
                    this.input.style.textDecoration = this.currentTextObject.underline ? 'underline' : 'none';
                    underlineBtn.classList.toggle('active', this.currentTextObject.underline);
                    this.updateCanvas();
                }
            });
        }

        // Alignment
        const alignLeft = document.getElementById('text-align-left');
        const alignCenter = document.getElementById('text-align-center');
        const alignRight = document.getElementById('text-align-right');

        if (alignLeft && alignCenter && alignRight) {
            alignLeft.addEventListener('click', () => this.setAlignment('left', alignLeft, alignCenter, alignRight));
            alignCenter.addEventListener('click', () => this.setAlignment('center', alignLeft, alignCenter, alignRight));
            alignRight.addEventListener('click', () => this.setAlignment('right', alignLeft, alignCenter, alignRight));
        }

        // Color
        const colorPicker = document.getElementById('text-color');
        if (colorPicker) {
            colorPicker.addEventListener('input', () => {
                if (this.currentTextObject) {
                    this.currentTextObject.color = colorPicker.value;
                    this.input.style.color = colorPicker.value;
                    this.updateCanvas();
                }
            });
        }

        // Input changes
        if (this.input) {
            this.input.addEventListener('input', () => {
                if (this.currentTextObject) {
                    this.currentTextObject.content = this.input.textContent;
                    this.updateCanvas();
                }
            });
        }

        // Click outside to finish editing
        document.addEventListener('mousedown', (e) => {
            if (this.isEditing &&
                this.overlay && !this.overlay.contains(e.target) &&
                this.toolbar && !this.toolbar.contains(e.target)) {
                this.finishEditing();
            }
        });
    }

    setAlignment(align, leftBtn, centerBtn, rightBtn) {
        if (this.currentTextObject) {
            this.currentTextObject.align = align;
            this.input.style.textAlign = align;

            leftBtn.classList.remove('active');
            centerBtn.classList.remove('active');
            rightBtn.classList.remove('active');

            if (align === 'left') leftBtn.classList.add('active');
            if (align === 'center') centerBtn.classList.add('active');
            if (align === 'right') rightBtn.classList.add('active');

            this.updateCanvas();
        }
    }

    startEditing(textObject) {
        if (!this.overlay || !this.input || !this.toolbar) {
            console.error('Text editor elements not found');
            return;
        }

        this.currentTextObject = textObject;
        this.isEditing = true;

        // Position overlay
        const rect = this.canvasElement.getBoundingClientRect();
        const screenX = textObject.x * this.canvas.zoom + this.canvas.pan.x;
        const screenY = textObject.y * this.canvas.zoom + this.canvas.pan.y;

        this.overlay.style.left = (rect.left + screenX) + 'px';
        this.overlay.style.top = (rect.top + screenY) + 'px';
        this.overlay.style.display = 'block';

        // Set input content and style
        this.input.textContent = textObject.content || '';
        this.input.style.fontFamily = textObject.fontFamily || 'Arial';
        this.input.style.fontSize = (textObject.fontSize || 16) + 'px';
        this.input.style.fontWeight = textObject.bold ? 'bold' : 'normal';
        this.input.style.fontStyle = textObject.italic ? 'italic' : 'normal';
        this.input.style.textDecoration = textObject.underline ? 'underline' : 'none';
        this.input.style.color = textObject.color || '#000000';
        this.input.style.textAlign = textObject.align || 'left';
        this.input.style.width = (textObject.width || 200) + 'px';

        // Position toolbar above input
        this.toolbar.style.left = (rect.left + screenX) + 'px';
        this.toolbar.style.top = (rect.top + screenY - 50) + 'px';
        this.toolbar.style.display = 'flex';

        // Update toolbar controls
        const fontFamilyEl = document.getElementById('text-font-family');
        const fontSizeEl = document.getElementById('text-font-size');
        const colorEl = document.getElementById('text-color');
        const boldEl = document.getElementById('text-bold');
        const italicEl = document.getElementById('text-italic');
        const underlineEl = document.getElementById('text-underline');
        const alignLeftEl = document.getElementById('text-align-left');
        const alignCenterEl = document.getElementById('text-align-center');
        const alignRightEl = document.getElementById('text-align-right');

        if (fontFamilyEl) fontFamilyEl.value = textObject.fontFamily || 'Arial';
        if (fontSizeEl) fontSizeEl.value = textObject.fontSize || 16;
        if (colorEl) colorEl.value = textObject.color || '#000000';

        if (boldEl) boldEl.classList.toggle('active', textObject.bold || false);
        if (italicEl) italicEl.classList.toggle('active', textObject.italic || false);
        if (underlineEl) underlineEl.classList.toggle('active', textObject.underline || false);

        const align = textObject.align || 'left';
        if (alignLeftEl) alignLeftEl.classList.toggle('active', align === 'left');
        if (alignCenterEl) alignCenterEl.classList.toggle('active', align === 'center');
        if (alignRightEl) alignRightEl.classList.toggle('active', align === 'right');

        // Focus input
        this.input.focus();

        // Select all text
        const range = document.createRange();
        range.selectNodeContents(this.input);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    finishEditing() {
        if (!this.isEditing) return;

        this.isEditing = false;
        if (this.overlay) this.overlay.style.display = 'none';
        if (this.toolbar) this.toolbar.style.display = 'none';

        // Measure final text size
        if (this.currentTextObject) {
            const ctx = this.canvasElement.getContext('2d');
            ctx.font = this.getFont(this.currentTextObject);

            const lines = this.currentTextObject.content.split('\n');
            let maxWidth = 0;
            lines.forEach(line => {
                const metrics = ctx.measureText(line);
                maxWidth = Math.max(maxWidth, metrics.width);
            });

            this.currentTextObject.width = Math.max(100, maxWidth + 16);
            this.currentTextObject.height = lines.length * this.currentTextObject.fontSize * 1.2 + 16;
        }

        this.currentTextObject = null;
        this.canvas.needsRender = true;
        this.canvas.render();
    }

    updateCanvas() {
        this.canvas.needsRender = true;
        this.canvas.render();
    }

    getFont(textObj) {
        const weight = textObj.bold ? 'bold' : 'normal';
        const style = textObj.italic ? 'italic' : 'normal';
        return `${style} ${weight} ${textObj.fontSize}px ${textObj.fontFamily}`;
    }

    renderText(ctx, textObj) {
        ctx.save();

        // Draw text box border
        ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(textObj.x, textObj.y, textObj.width, textObj.height);

        // Draw text content if it exists
        if (textObj.content) {
            ctx.font = this.getFont(textObj);
            ctx.fillStyle = textObj.color || '#000000';
            ctx.textBaseline = 'top';

            const lines = textObj.content.split('\n');
            const lineHeight = textObj.fontSize * 1.2;

            lines.forEach((line, i) => {
                let x = textObj.x + 8;
                const y = textObj.y + 8 + (i * lineHeight);

                if (textObj.align === 'center') {
                    const metrics = ctx.measureText(line);
                    x = textObj.x + (textObj.width - metrics.width) / 2;
                } else if (textObj.align === 'right') {
                    const metrics = ctx.measureText(line);
                    x = textObj.x + textObj.width - metrics.width - 8;
                }

                ctx.fillText(line, x, y);

                if (textObj.underline) {
                    const metrics = ctx.measureText(line);
                    ctx.strokeStyle = textObj.color || '#000000';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, y + textObj.fontSize);
                    ctx.lineTo(x + metrics.width, y + textObj.fontSize);
                    ctx.stroke();
                }
            });
        }

        ctx.restore();
    }
}
