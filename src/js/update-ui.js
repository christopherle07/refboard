import { downloadAndInstall } from './updater.js';

let currentNotification = null;

export function showUpdateNotification(updateInfo) {
    // Remove existing notification if any
    if (currentNotification) {
        currentNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div class="update-header">
            <svg class="update-icon" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z"/>
            </svg>
            <span class="update-title">Update Available</span>
            <button class="update-close">×</button>
        </div>
        <div class="update-content">
            <div class="update-version">Version ${updateInfo.version}</div>
            <div class="update-description">${updateInfo.body || 'A new version is available.'}</div>
        </div>
        <div class="update-actions">
            <button class="update-btn update-btn-secondary" id="update-later">Later</button>
            <button class="update-btn update-btn-primary" id="update-now">Update Now</button>
        </div>
    `;

    document.body.appendChild(notification);
    currentNotification = notification;

    // Close button
    const closeBtn = notification.querySelector('.update-close');
    closeBtn.addEventListener('click', () => hideNotification());

    // Later button
    const laterBtn = notification.querySelector('#update-later');
    laterBtn.addEventListener('click', () => hideNotification());

    // Update now button
    const updateBtn = notification.querySelector('#update-now');
    updateBtn.addEventListener('click', () => startUpdate());
}

function hideNotification() {
    if (!currentNotification) return;

    currentNotification.classList.add('hiding');
    setTimeout(() => {
        if (currentNotification) {
            currentNotification.remove();
            currentNotification = null;
        }
    }, 300);
}

async function startUpdate() {
    if (!currentNotification) return;

    // Replace content with progress UI
    const content = currentNotification.querySelector('.update-content');
    const actions = currentNotification.querySelector('.update-actions');

    content.innerHTML = `
        <div class="update-progress">
            <div class="update-progress-bar">
                <div class="update-progress-fill" style="width: 0%"></div>
            </div>
            <div class="update-progress-text">Preparing download...</div>
        </div>
    `;
    actions.remove();

    const progressBar = currentNotification.querySelector('.update-progress-fill');
    const progressText = currentNotification.querySelector('.update-progress-text');

    try {
        const result = await downloadAndInstall((progress) => {
            if (progress.status === 'downloading' && progress.total) {
                const percent = Math.round((progress.downloaded / progress.total) * 100);
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `Downloading... ${percent}%`;
            } else if (progress.status === 'finished') {
                progressBar.style.width = '100%';
                progressText.textContent = 'Installing update...';

                // Show installing UI
                content.innerHTML = `
                    <div class="update-installing">
                        <div class="update-spinner"></div>
                        <div class="update-installing-text">Installing update...</div>
                        <div class="update-installing-text" style="margin-top: 8px; font-size: 11px;">
                            The app will restart automatically
                        </div>
                    </div>
                `;
            }
        });

        if (!result.success) {
            showError(result.error);
        }
    } catch (error) {
        showError(error.message);
    }
}

function showError(message) {
    if (!currentNotification) return;

    const content = currentNotification.querySelector('.update-content');
    content.innerHTML = `
        <div style="text-align: center; padding: 12px;">
            <div style="color: #e74c3c; font-size: 13px; margin-bottom: 8px;">Update Failed</div>
            <div style="color: var(--text-tertiary); font-size: 12px;">${message}</div>
        </div>
    `;

    setTimeout(() => hideNotification(), 5000);
}
