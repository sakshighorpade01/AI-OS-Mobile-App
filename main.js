const electron = require('electron');
const { app, BrowserWindow, ipcMain, BrowserView } = electron;
const path = require('path');
const PythonBridge = require('./python-bridge');

let mainWindow;
let pythonBridge;
let linkWebView = null; // Keep existing linkWebView
let browseAiWebView = null; // New BrowserView for Browse AI
let browseAiHeaderHeight = 0;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false
        },
        frame: true,
        transparent: true
    });

    mainWindow.maximize();
    mainWindow.loadFile('index.html');

    pythonBridge = new PythonBridge(mainWindow);
    console.log('Starting Python bridge...');
    pythonBridge.start().catch(error => {
        console.error('Python bridge error:', error.message);
        // Notify the renderer process about the error
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('socket-connection-status', { 
                connected: false,
                error: 'Failed to start Python server: ' + error.message
            });
        });
        
        // Try restarting after a delay
        setTimeout(() => {
            console.log('Attempting to restart Python bridge...');
            if (pythonBridge) {
                pythonBridge.stop();
            }
            pythonBridge = new PythonBridge(mainWindow);
            pythonBridge.start().catch(err => {
                console.error('Python bridge restart failed:', err.message);
            });
        }, 10000);
    });

    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('toggle-maximize-window', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
        mainWindow.webContents.send('window-state-changed', mainWindow.isMaximized());
    });

    ipcMain.on('close-window', () => {
        mainWindow.close();
    });

    ipcMain.on('deepsearch-request', (event, data) => {
        pythonBridge.sendMessage(data);
    });

    ipcMain.on('check-socket-connection', (event) => {
        const isConnected = pythonBridge.socket && pythonBridge.socket.connected;
        event.reply('socket-connection-status', { connected: isConnected });
    });

    ipcMain.on('restart-python-bridge', () => {
        if (pythonBridge) {
            pythonBridge.stop();
        }
        pythonBridge = new PythonBridge(mainWindow);
        pythonBridge.start().catch(error => {
            console.error('Failed to restart Python bridge:', error);
            mainWindow.webContents.send('socket-connection-status', { 
                connected: false,
                error: 'Failed to restart Python server: ' + error.message
            });
        });
    });

    ipcMain.on('open-webview', (event, url) => {
        console.log('Received open-webview request for URL:', url);

        // Close existing linkWebView if there is one
        if (linkWebView) {
            try {
                mainWindow.removeBrowserView(linkWebView);
                linkWebView.webContents.destroy();
                linkWebView = null;
            } catch (error) {
                console.error('Error closing existing linkWebView:', error);
            }
        }

        try {
            // Create new linkWebView
            linkWebView = new BrowserView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true
                }
            });

            mainWindow.addBrowserView(linkWebView);

            // Get the content bounds for proper sizing
            const contentBounds = mainWindow.getContentBounds();

            // Create a smaller window positioned in the top-right
            const bounds = {
                x: Math.round(contentBounds.width * 0.65), // Position more to the right
                y: 100, // A bit from the top
                width: Math.round(contentBounds.width * 0.30), // 30% of window width
                height: Math.round(contentBounds.height * 0.5) // 50% of window height
            };

            // Set bounds with offset for header and borders
            // Make the actual linkWebView much smaller to avoid overlapping controls
            linkWebView.setBounds({
                x: bounds.x + 10, // Add padding for left border
                y: bounds.y + 60, // Add significant padding for header 
                width: bounds.width - 20, // Remove width for left and right borders
                height: bounds.height - 70 // Remove height for header and borders
            });

            // Set up navigation event handlers
            linkWebView.webContents.on('did-start-loading', () => {
                mainWindow.webContents.send('webview-navigation-updated', {
                    url: linkWebView.webContents.getURL(),
                    loading: true
                });
            });

            linkWebView.webContents.on('did-finish-load', () => {
                const currentUrl = linkWebView.webContents.getURL();
                mainWindow.webContents.send('webview-navigation-updated', {
                    url: currentUrl,
                    loading: false,
                    canGoBack: linkWebView.webContents.canGoBack(),
                    canGoForward: linkWebView.webContents.canGoForward()
                });

                mainWindow.webContents.send('webview-page-loaded');
            });

            linkWebView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                console.error('linkWebView failed to load:', errorDescription);
                mainWindow.webContents.send('webview-navigation-updated', {
                    error: errorDescription
                });
            });

            // Finally load the URL
            linkWebView.webContents.loadURL(url).then(() => {
                console.log('URL loaded successfully:', url);
                mainWindow.webContents.send('webview-created', bounds);
            }).catch((error) => {
                console.error('Failed to load URL:', error);
                mainWindow.webContents.send('socket-error', {
                    message: `Failed to load URL: ${error.message}`
                });
            });
        } catch (error) {
            console.error('Error creating linkWebView:', error);
            mainWindow.webContents.send('socket-error', {
                message: `Error creating linkWebView: ${error.message}`
            });
        }
    });

    ipcMain.on('resize-webview', (event, bounds) => {
        if (linkWebView) {
            // Use a more aggressive padding to ensure the content doesn't overlap controls
            linkWebView.setBounds({
                x: bounds.x + 10, // Add padding for left border
                y: bounds.y + 60, // Add significant padding for header
                width: bounds.width - 20, // Remove width for left and right borders
                height: bounds.height - 70 // Remove height for header and bottom
            });
        }
    });

    ipcMain.on('drag-webview', (event, { x, y }) => {
        if (linkWebView) {
            const currentBounds = linkWebView.getBounds();
            linkWebView.setBounds({
                x: x + 10, // Add padding for left border
                y: y + 60, // Add significant padding for header
                width: currentBounds.width,
                height: currentBounds.height
            });
        }
    });

    ipcMain.on('close-webview', () => {
        if (linkWebView) {
            mainWindow.removeBrowserView(linkWebView);
            linkWebView.webContents.destroy();
            linkWebView = null;
            mainWindow.webContents.send('webview-closed');
        }
    });

    ipcMain.on('open-browse-ai-webview', () => {
        if (browseAiWebView) {
            mainWindow.addBrowserView(browseAiWebView);
            browseAiWebView.webContents.focus();
            updateBrowseAiWebViewBounds(mainWindow.getContentBounds());
            return;
        }
    
        browseAiWebView = new BrowserView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
            }
        });
        mainWindow.addBrowserView(browseAiWebView);
        updateBrowseAiWebViewBounds(mainWindow.getContentBounds());
    
        browseAiWebView.webContents.loadURL('https://www.google.com').then(() => {
            browseAiWebView.webContents.focus();
        });
    
        browseAiWebView.webContents.on('did-start-loading', () => {
            mainWindow.webContents.send('browse-ai-webview-navigation-updated', {
                url: browseAiWebView.webContents.getURL(),
                loading: true,
                canGoBack: browseAiWebView.webContents.canGoBack(),
                canGoForward: browseAiWebView.webContents.canGoForward()
            });
        });
    
        browseAiWebView.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('browse-ai-webview-navigation-updated', {
                url: browseAiWebView.webContents.getURL(),
                loading: false,
                canGoBack: browseAiWebView.webContents.canGoBack(),
                canGoForward: browseAiWebView.webContents.canGoForward()
            });
        });
    
        browseAiWebView.webContents.on('did-navigate', () => {
            mainWindow.webContents.send('browse-ai-webview-navigation-updated', {
                url: browseAiWebView.webContents.getURL(),
                loading: false,
                canGoBack: browseAiWebView.webContents.canGoBack(),
                canGoForward: browseAiWebView.webContents.canGoForward()
            });
        });
    
        browseAiWebView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error("Browse AI WebView failed to load:", errorDescription);
            mainWindow.webContents.send('browse-ai-webview-navigation-updated', { error: errorDescription });
        });
    
        mainWindow.webContents.send('browse-ai-webview-created');
    });

    ipcMain.on('browse-ai-header-height', (event, height) => {
        console.log('Received browse-ai-header-height:', height);
        browseAiHeaderHeight = height;
        
        // If the BrowserView exists, update its bounds immediately
        if (browseAiWebView) {
            updateBrowseAiWebViewBounds(mainWindow.getContentBounds());
            
            // Log the bounds for debugging
            const bounds = browseAiWebView.getBounds();
            console.log('After updating, BrowserView bounds are:', bounds);
        }
    });

    ipcMain.on('close-browse-ai-webview', () => {
        if (browseAiWebView) {
            mainWindow.removeBrowserView(browseAiWebView);
            // Don't destroy, just hide it.
            // browseAiWebView.webContents.destroy();
            // browseAiWebView = null;
            mainWindow.webContents.send('browse-ai-webview-closed');
        }
    });

    ipcMain.on('browse-ai-webview-navigate', (event, action) => {
        if (!browseAiWebView) {
            console.error('No BrowserView available for navigation');
            mainWindow.webContents.send('browse-ai-webview-navigation-updated', {
                error: 'Browser view not initialized'
            });
            return;
        }

        try {
            console.log('Navigation action:', action);
            switch (action.type) {
                case 'back':
                    if (browseAiWebView.webContents.canGoBack()) {
                        browseAiWebView.webContents.goBack();
                        console.log('Navigating back');
                    } else {
                        console.log('Cannot go back - no history');
                    }
                    break;
                case 'forward':
                    if (browseAiWebView.webContents.canGoForward()) {
                        browseAiWebView.webContents.goForward();
                        console.log('Navigating forward');
                    } else {
                        console.log('Cannot go forward - no history');
                    }
                    break;
                case 'refresh':
                    browseAiWebView.webContents.reload();
                    console.log('Refreshing page');
                    break;
                case 'load':
                    if (action.url) {
                        if (!/^(https?):\/\//i.test(action.url)) {
                            console.error("Invalid URL:", action.url);
                            mainWindow.webContents.send('browse-ai-webview-navigation-updated', {
                                error: "Invalid URL. Must start with http:// or https://"
                            });
                            return;
                        }
                        browseAiWebView.webContents.loadURL(action.url);
                        console.log('Loading URL:', action.url);
                    }
                    break;
            }

            // Focus the webview after navigation
            browseAiWebView.webContents.focus();

        } catch (error) {
            console.error('Failed to navigate Browse AI WebView:', error);
            mainWindow.webContents.send('browse-ai-webview-navigation-updated', {
                error: error.message
            });
        }
    });

    // Helper function to calculate and set Browse AI WebView bounds
    function updateBrowseAiWebViewBounds(contentBounds) {
        if (!browseAiWebView) return;
        
        // Calculate dimensions with padding
        const topPadding = 25;  // Match CSS top spacing
        const rightPadding = 20;  // Match CSS right spacing
        const chatWidth = Math.floor(contentBounds.width * 0.32); // 32% for chat
        const browseAiWidth = contentBounds.width - chatWidth - (rightPadding * 2); // Account for right padding
        
        // Ensure we have a minimum header height
        const headerHeight = Math.max(browseAiHeaderHeight || 45, 45);
        
        // Calculate bounds with proper offsets and padding
        const bounds = {
            x: chatWidth + rightPadding,  // Add right padding
            y: topPadding + headerHeight,  // Add top padding
            width: browseAiWidth,
            height: contentBounds.height - (topPadding * 2) - headerHeight  // Account for top/bottom padding
        };
        
        console.log('Setting BrowserView bounds:', bounds);
        browseAiWebView.setBounds(bounds);
    }

    // Listen for window resize events to update the Browse AI WebView bounds.
    mainWindow.on('resize', () => {
        if (browseAiWebView) {
            updateBrowseAiWebViewBounds(mainWindow.getContentBounds());
        }
    });
}

// File handling IPC handlers for artifact download
const fs = require('fs').promises;

// Handler for showing save dialog
ipcMain.handle('show-save-dialog', async (event, options) => {
  const { dialog } = require('electron');
  return await dialog.showSaveDialog(mainWindow, options);
});

// Handler for saving file content
ipcMain.handle('save-file', async (event, { filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving file:', error);
    return false;
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    // Clean up Python bridge
    if (pythonBridge) {
        try {
            pythonBridge.stop();
            pythonBridge = null;
        } catch (error) {
            console.error('Error stopping Python bridge:', error.message);
        }
    }
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', (event) => {
    // Clean up resources before quitting
    if (linkWebView) {
        try {
            mainWindow.removeBrowserView(linkWebView);
            linkWebView.webContents.destroy();
            linkWebView = null;
        } catch (error) {
            console.error('Error cleaning up linkWebView:', error.message);
        }
    }
    if (browseAiWebView) {
        try {
            mainWindow.removeBrowserView(browseAiWebView);
            browseAiWebView.webContents.destroy();
            browseAiWebView = null;
        } catch (error) {
            console.error('Error cleaning up browseAiWebView:', error.message);
        }
    }
    
    // Make sure Python bridge is properly cleaned up
    if (pythonBridge) {
        try {
            pythonBridge.stop();
            pythonBridge = null;
        } catch (error) {
            console.error('Error stopping Python bridge:', error.message);
        }
    }
});