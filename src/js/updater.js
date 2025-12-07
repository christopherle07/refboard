// Auto-updater for EyeDea

export async function checkForUpdates() {
    try {
        const { check } = window.__TAURI__.updater;
        const update = await check();

        if (update?.available) {
            return {
                available: true,
                currentVersion: update.currentVersion,
                version: update.version,
                date: update.date,
                body: update.body
            };
        }

        return { available: false };
    } catch (error) {
        console.error('Failed to check for updates:', error);
        return { available: false, error: error.message };
    }
}

export async function downloadAndInstall(onProgress) {
    try {
        const { check } = window.__TAURI__.updater;
        const update = await check();

        if (!update?.available) {
            return { success: false, error: 'No update available' };
        }

        // Download and install with progress callback
        await update.downloadAndInstall((event) => {
            switch (event.event) {
                case 'Started':
                    onProgress?.({ status: 'started', contentLength: event.data.contentLength });
                    break;
                case 'Progress':
                    onProgress?.({
                        status: 'downloading',
                        chunkLength: event.data.chunkLength,
                        downloaded: event.data.downloaded,
                        total: event.data.contentLength
                    });
                    break;
                case 'Finished':
                    onProgress?.({ status: 'finished' });
                    break;
            }
        });

        // Restart the app after installation
        const { relaunch } = window.__TAURI__.process;
        await relaunch();

        return { success: true };
    } catch (error) {
        console.error('Failed to download and install update:', error);
        return { success: false, error: error.message };
    }
}

// Check for updates on app start (with delay to not interfere with startup)
export function initAutoUpdateCheck(onUpdateAvailable) {
    setTimeout(async () => {
        const update = await checkForUpdates();
        if (update.available) {
            onUpdateAvailable?.(update);
        }
    }, 5000); // Check 5 seconds after app starts
}
