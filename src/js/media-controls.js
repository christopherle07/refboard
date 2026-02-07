export class MediaControls {
    constructor(canvas, canvasContainer) {
        this.canvas = canvas;
        this.container = canvasContainer;
        this.activeControl = null;
        this.hoveredImage = null;
        this.activeImage = null; 
        this.hideTimeout = null;
        this.filmstripOpen = false;
        this.filmstripOffset = 0;
        this.filmstripImage = null;
        this.FILMSTRIP_PAGE_SIZE = 8;

        this.videoBar = this.createVideoBar();
        this.gifBar = this.createGifBar();
        this.filmstrip = this.createFilmstrip();
        this.container.appendChild(this.videoBar);
        this.container.appendChild(this.gifBar);
        this.container.appendChild(this.filmstrip);

        this.setupHoverDetection();
        this.setupKeyboardControls();
    }

    createVideoBar() {
        const bar = document.createElement('div');
        bar.className = 'media-control-bar video-control-bar';
        bar.innerHTML = `
            <button class="mc-btn mc-play-btn" title="Play/Pause">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="mc-time">0:00 / 0:00</span>
            <input type="range" class="mc-seek" min="0" max="100" value="0" step="0.1">
            <button class="mc-btn mc-mute-btn" title="Mute/Unmute">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
            </button>
            <button class="mc-btn mc-fullscreen-btn" title="Fullscreen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
            </button>
        `;

        // Prevent any pointer events from reaching the canvas underneath
        bar.addEventListener('pointerdown', (e) => e.stopPropagation());
        bar.addEventListener('mousedown', (e) => e.stopPropagation());

        // Use pointerdown instead of click — click breaks because updateVideoBar()
        // replaces innerHTML on every tick, destroying the SVG between mousedown and
        // mouseup, which prevents the browser from firing a click event.
        bar.querySelector('.mc-play-btn').addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const img = this.activeImage || this.hoveredImage;
            if (img) {
                this.canvas.toggleVideoPlayback(img);
                this.updateVideoBar(img);
            }
        });

        bar.querySelector('.mc-seek').addEventListener('input', (e) => {
            e.stopPropagation();
            const img = this.activeImage || this.hoveredImage;
            if (img?.videoElement) {
                const time = (e.target.value / 100) * img.duration;
                img.videoElement.currentTime = time;
                img.currentTime = time;
            }
        });

        bar.querySelector('.mc-mute-btn').addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const img = this.activeImage || this.hoveredImage;
            if (img?.videoElement) {
                img.muted = !img.muted;
                img.videoElement.muted = img.muted;
                this.updateVideoBar(img);
            }
        });

        bar.querySelector('.mc-fullscreen-btn').addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const img = this.activeImage || this.hoveredImage;
            if (img) {
                this.canvas.openVideoFullscreen(img);
            }
        });

        bar.addEventListener('mouseenter', () => this.clearHideTimeout());
        bar.addEventListener('mouseleave', () => this.scheduleHide());

        return bar;
    }

    createGifBar() {
        const bar = document.createElement('div');
        bar.className = 'media-control-bar gif-control-bar';
        bar.innerHTML = `
            <button class="mc-btn mc-gif-play-btn" title="Play/Pause">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="mc-frame-info">1 / 1</span>
            <button class="mc-btn mc-filmstrip-btn" title="Show Frames">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="12" x2="7" y2="12"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="12" x2="22" y2="12"/><line x1="17" y1="17" x2="22" y2="17"/></svg>
            </button>
        `;

        bar.addEventListener('pointerdown', (e) => e.stopPropagation());
        bar.addEventListener('mousedown', (e) => e.stopPropagation());

        // Use pointerdown instead of click — click breaks because updateGifBar()
        // replaces innerHTML on every tick, destroying the SVG between mousedown and
        // mouseup, which prevents the browser from firing a click event.
        bar.querySelector('.mc-gif-play-btn').addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const img = this.activeImage || this.hoveredImage;
            if (img) {
                this.canvas.toggleGifPlayback(img);
                this.updateGifBar(img);
            }
        });

        bar.querySelector('.mc-filmstrip-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFilmstrip();
        });

        bar.addEventListener('mouseenter', () => this.clearHideTimeout());
        bar.addEventListener('mouseleave', () => this.scheduleHide());

        return bar;
    }

    createFilmstrip() {
        const panel = document.createElement('div');
        panel.className = 'gif-filmstrip';
        panel.innerHTML = `
            <button class="mc-btn filmstrip-nav filmstrip-prev" title="Previous frames">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <div class="filmstrip-frames"></div>
            <button class="mc-btn filmstrip-nav filmstrip-next" title="Next frames">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
        `;

        panel.addEventListener('pointerdown', (e) => e.stopPropagation());
        panel.addEventListener('mousedown', (e) => e.stopPropagation());

        panel.querySelector('.filmstrip-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            this.pageFilmstrip(-1);
        });

        panel.querySelector('.filmstrip-next').addEventListener('click', (e) => {
            e.stopPropagation();
            this.pageFilmstrip(1);
        });

        panel.addEventListener('mouseenter', () => this.clearHideTimeout());
        panel.addEventListener('mouseleave', () => this.scheduleHide());

        return panel;
    }

    toggleFilmstrip() {
        if (this.filmstripOpen) {
            this.filmstrip.style.display = 'none';
            this.filmstripOpen = false;
        } else if (this.hoveredImage?.mediaType === 'gif' && this.hoveredImage.gifFrameCanvases) {
            this.filmstripOpen = true;
            this.filmstripImage = this.hoveredImage;
            // Jump offset to show the page containing the current frame
            this.filmstripOffset = Math.floor(this.hoveredImage.gifCurrentFrame / this.FILMSTRIP_PAGE_SIZE) * this.FILMSTRIP_PAGE_SIZE;
            this.renderFilmstripThumbnails();
            this.positionFilmstrip();
            this.filmstrip.style.display = 'flex';
        }
    }

    renderFilmstripThumbnails() {
        const img = this.filmstripImage;
        if (!img || !img.gifFrameCanvases) return;

        const container = this.filmstrip.querySelector('.filmstrip-frames');
        container.innerHTML = '';

        const total = img.gifTotalFrames;
        const start = this.filmstripOffset;
        const end = Math.min(start + this.FILMSTRIP_PAGE_SIZE, total);

        // Compute thumbnail dimensions preserving aspect ratio
        const sampleFrame = img.gifFrameCanvases[0];
        const aspect = sampleFrame.width / sampleFrame.height;
        const thumbH = 48;
        const thumbW = Math.round(thumbH * aspect);

        for (let i = start; i < end; i++) {
            const frame = document.createElement('div');
            frame.className = 'filmstrip-frame';
            if (i === img.gifCurrentFrame) frame.classList.add('active');

            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = thumbW;
            thumbCanvas.height = thumbH;
            thumbCanvas.className = 'filmstrip-thumb';
            const ctx = thumbCanvas.getContext('2d');
            ctx.drawImage(img.gifFrameCanvases[i], 0, 0, thumbW, thumbH);

            const num = document.createElement('span');
            num.className = 'filmstrip-frame-num';
            num.textContent = i + 1;

            frame.appendChild(thumbCanvas);
            frame.appendChild(num);

            frame.addEventListener('click', (e) => {
                e.stopPropagation();
                this.canvas.setGifFrame(img, i);
                img.gifPlaying = false;
                this.canvas.updatePlayingMediaState();
                this.updateGifBar(img);
                this.updateFilmstripHighlight();
            });

            container.appendChild(frame);
        }

        // Update nav button visibility
        this.filmstrip.querySelector('.filmstrip-prev').style.visibility = start > 0 ? 'visible' : 'hidden';
        this.filmstrip.querySelector('.filmstrip-next').style.visibility = end < total ? 'visible' : 'hidden';
    }

    updateFilmstripHighlight() {
        if (!this.filmstripOpen || !this.filmstripImage) return;
        const img = this.filmstripImage;
        const frames = this.filmstrip.querySelectorAll('.filmstrip-frame');
        frames.forEach((el, idx) => {
            const frameIndex = this.filmstripOffset + idx;
            el.classList.toggle('active', frameIndex === img.gifCurrentFrame);
        });
    }

    pageFilmstrip(direction) {
        const img = this.filmstripImage;
        if (!img) return;
        const total = img.gifTotalFrames;
        const newOffset = this.filmstripOffset + (direction * this.FILMSTRIP_PAGE_SIZE);
        if (newOffset >= 0 && newOffset < total) {
            this.filmstripOffset = newOffset;
            this.renderFilmstripThumbnails();
        }
    }

    positionFilmstrip() {
        if (!this.hoveredImage) return;
        const img = this.hoveredImage;

        const bottomCenter = {
            x: img.x + img.width / 2,
            y: img.y + img.height
        };
        const screen = {
            x: bottomCenter.x * this.canvas.zoom + this.canvas.pan.x,
            y: bottomCenter.y * this.canvas.zoom + this.canvas.pan.y
        };

        // Position below the gif bar (bar is ~30px tall + 8px gap + 8px more)
        this.filmstrip.style.left = `${screen.x}px`;
        this.filmstrip.style.top = `${screen.y + 42}px`;
        this.filmstrip.style.transform = 'translateX(-50%)';
    }

    setupHoverDetection() {
        const canvasEl = this.canvas.canvas;

        canvasEl.addEventListener('mousemove', (e) => {
            const rect = canvasEl.getBoundingClientRect();
            const worldPos = this.canvas.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
            const img = this.canvas.getImageAtPoint(worldPos.x, worldPos.y);

            if (img && (img.mediaType === 'video' || img.mediaType === 'gif')) {
                this.clearHideTimeout();
                this.hoveredImage = img;
                this.showControlFor(img);
            } else if (!this.isOverBar(e)) {
                this.scheduleHide();
            }
        });

        canvasEl.addEventListener('mouseleave', () => {
            this.scheduleHide();
        });
    }

    setupKeyboardControls() {
        this._keyRepeatInterval = null;
        this._keyDown = null;

        this._onKeyDown = (e) => {
            if (!this.filmstripOpen || !this.filmstripImage) return;
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

            e.preventDefault();
            e.stopPropagation();

            const dir = e.key === 'ArrowLeft' ? -1 : 1;

            // If already holding this key, skip (interval handles it)
            if (this._keyDown === e.key) return;

            // First step immediately
            this.stepFilmstripFrame(dir);
            this._keyDown = e.key;

            // Start repeating after a short delay
            this._keyRepeatInterval = setInterval(() => {
                this.stepFilmstripFrame(dir);
            }, 80);
        };

        this._onKeyUp = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                this._keyDown = null;
                if (this._keyRepeatInterval) {
                    clearInterval(this._keyRepeatInterval);
                    this._keyRepeatInterval = null;
                }
            }
        };

        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
    }

    stepFilmstripFrame(direction) {
        const img = this.filmstripImage;
        if (!img) return;

        img.gifPlaying = false;
        this.canvas.stepGifFrame(img, direction);
        this.canvas.updatePlayingMediaState();
        this.updateGifBar(img);

        // Auto-page if current frame goes out of visible range
        const currentPage = Math.floor(img.gifCurrentFrame / this.FILMSTRIP_PAGE_SIZE) * this.FILMSTRIP_PAGE_SIZE;
        if (currentPage !== this.filmstripOffset) {
            this.filmstripOffset = currentPage;
            this.renderFilmstripThumbnails();
        } else {
            this.updateFilmstripHighlight();
        }
    }

    isOverBar(e) {
        const bars = [this.videoBar, this.gifBar, this.filmstrip];
        for (const bar of bars) {
            const rect = bar.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                return true;
            }
        }
        return false;
    }

    showControlFor(img) {
        // Reset cached play state when switching to a different image
        if (this.activeImage !== img) {
            this._lastVideoPlaying = undefined;
            this._lastGifPlaying = undefined;
        }
        this.activeImage = img;

        const bottomCenter = {
            x: img.x + img.width / 2,
            y: img.y + img.height
        };
        const screen = {
            x: bottomCenter.x * this.canvas.zoom + this.canvas.pan.x,
            y: bottomCenter.y * this.canvas.zoom + this.canvas.pan.y
        };

        if (img.mediaType === 'video') {
            // Only hide gif bar if it was showing (avoid hiding video bar mid-click)
            if (this.gifBar.style.display !== 'none') this.gifBar.style.display = 'none';
            this.videoBar.style.display = 'flex';
            this.videoBar.style.left = `${screen.x}px`;
            this.videoBar.style.top = `${screen.y + 8}px`;
            this.videoBar.style.transform = 'translateX(-50%)';
            this.updateVideoBar(img);
            if (this.filmstripOpen) {
                this.filmstrip.style.display = 'none';
                this.filmstripOpen = false;
            }
        } else if (img.mediaType === 'gif') {
            // Only hide video bar if it was showing (avoid hiding gif bar mid-click)
            if (this.videoBar.style.display !== 'none') this.videoBar.style.display = 'none';
            this.gifBar.style.display = 'flex';
            this.gifBar.style.left = `${screen.x}px`;
            this.gifBar.style.top = `${screen.y + 8}px`;
            this.gifBar.style.transform = 'translateX(-50%)';
            this.updateGifBar(img);
            if (this.filmstripOpen && this.filmstripImage === img) {
                this.positionFilmstrip();
                this.updateFilmstripHighlight();
            } else if (this.filmstripOpen && this.filmstripImage !== img) {
                this.filmstrip.style.display = 'none';
                this.filmstripOpen = false;
            }
        }
    }

    updateVideoBar(img) {
        if (!img || img.mediaType !== 'video') return;

        // Only update icon when state changes to avoid DOM churn
        const playBtn = this.videoBar.querySelector('.mc-play-btn');
        if (img.isPlaying !== this._lastVideoPlaying) {
            this._lastVideoPlaying = img.isPlaying;
            if (img.isPlaying) {
                playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
            } else {
                playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
            }
        }

        const time = this.videoBar.querySelector('.mc-time');
        const current = img.videoElement?.currentTime || img.currentTime || 0;
        const duration = img.duration || 0;
        time.textContent = `${this.formatTime(current)} / ${this.formatTime(duration)}`;

        const seek = this.videoBar.querySelector('.mc-seek');
        seek.value = duration > 0 ? (current / duration) * 100 : 0;

        const muteBtn = this.videoBar.querySelector('.mc-mute-btn');
        if (img.muted) {
            muteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
        } else {
            muteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
        }
    }

    updateGifBar(img) {
        if (!img || img.mediaType !== 'gif') return;

        // Only update icon when state changes to avoid DOM churn
        const playBtn = this.gifBar.querySelector('.mc-gif-play-btn');
        if (img.gifPlaying !== this._lastGifPlaying) {
            this._lastGifPlaying = img.gifPlaying;
            if (img.gifPlaying) {
                playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
            } else {
                playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
            }
        }

        const info = this.gifBar.querySelector('.mc-frame-info');
        info.textContent = `${img.gifCurrentFrame + 1} / ${img.gifTotalFrames}`;

        // Update filmstrip highlight if open
        if (this.filmstripOpen && this.filmstripImage === img) {
            // Auto-scroll filmstrip to follow current frame during playback
            const currentPage = Math.floor(img.gifCurrentFrame / this.FILMSTRIP_PAGE_SIZE) * this.FILMSTRIP_PAGE_SIZE;
            if (currentPage !== this.filmstripOffset) {
                this.filmstripOffset = currentPage;
                this.renderFilmstripThumbnails();
            } else {
                this.updateFilmstripHighlight();
            }
        }
    }

    hideAll() {
        this.videoBar.style.display = 'none';
        this.gifBar.style.display = 'none';
        this.filmstrip.style.display = 'none';
        this.filmstripOpen = false;
    }

    dismiss() {
        this.clearHideTimeout();
        this.hideAll();
        this.hoveredImage = null;
        this.activeImage = null;
        this.filmstripImage = null;
    }

    scheduleHide() {
        this.clearHideTimeout();
        this.hideTimeout = setTimeout(() => {
            this.hideAll();
            this.hoveredImage = null;
            this.activeImage = null;
            this.filmstripImage = null;
        }, 300);
    }

    clearHideTimeout() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    updatePosition() {
        if (this.hoveredImage) {
            this.showControlFor(this.hoveredImage);
        }
    }

    tick() {
        const img = this.activeImage || this.hoveredImage;
        if (img?.mediaType === 'video' && img.isPlaying) {
            this.updateVideoBar(img);
        }
        if (img?.mediaType === 'gif' && img.gifPlaying) {
            this.updateGifBar(img);
        }
    }

    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        if (this._keyRepeatInterval) clearInterval(this._keyRepeatInterval);
        this.videoBar.remove();
        this.gifBar.remove();
        this.filmstrip.remove();
    }
}
