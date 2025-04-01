const electron = require('electron');
const { app, BrowserWindow, ipcMain, BrowserView } = electron;
const path = require('path');
const PythonBridge = require('./python-bridge');
const { spawn } = require('child_process');
const http = require('http');  

// Enable Chrome DevTools Protocol for all browser instances at startup
// This must be called before app.whenReady()
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess');

let mainWindow;
let pythonBridge;
let linkWebView = null; // Keep existing linkWebView
let browseAiWebView = null; // New BrowserView for Browse AI
let browseAiHeaderHeight = 0;
let browserAgentProcess = null; // Track browser agent process

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
    
        // No need to set remote-debugging-port here as it's set at app startup
        
        browseAiWebView = new BrowserView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                devTools: true, // Enable DevTools for CDP access
                additionalArguments: ['--remote-debugging-port=9222'] // Set debugging port
            }
        });
        
        // Explicitly enable remote debugging on the webContents
        browseAiWebView.webContents.setDevToolsWebContents = true;
        
        mainWindow.addBrowserView(browseAiWebView);
        updateBrowseAiWebViewBounds(mainWindow.getContentBounds());
    
        browseAiWebView.webContents.loadURL('https://www.google.com').then(() => {
            browseAiWebView.webContents.focus();
            
            // Open DevTools in detached mode to ensure CDP is available
            browseAiWebView.webContents.openDevTools({ mode: 'detach' });
            // Close it after a short delay - this ensures the CDP endpoint is active
            setTimeout(() => {
                if (browseAiWebView && browseAiWebView.webContents) {
                    browseAiWebView.webContents.closeDevTools();
                }
            }, 1000);
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
            mainWindow.webContents.send('browse-ai-webview-closed');
            
            // Terminate browser agent if running
            terminateBrowserAgent();
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
    
    // Clean up browser agent process
    if (browserAgentProcess) {
        try {
            browserAgentProcess.kill();
            browserAgentProcess = null;
        } catch (error) {
            console.error('Error cleaning up browser agent process:', error.message);
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

// Function to get CDP URL from a BrowserView
async function getWebViewCDPUrl(browserView) {
    try {
        // Check if debugger is already attached
        if (!browserView.webContents.debugger.isAttached()) {
            try {
                // Attach debugger with a specific protocol version
                browserView.webContents.debugger.attach('1.3');
                console.log('Debugger attached successfully');
            } catch (err) {
                console.error('Failed to attach debugger:', err);
                // Continue anyway as it might already be attached in a way we can't detect
            }
        }
        
        // Set a unique title to help identify the target
        await browserView.webContents.executeJavaScript(`
            document.title = "AI-OS BrowseAI - " + document.title;
        `).catch(err => {
            console.error('Failed to update title:', err);
            // Continue anyway, it's just a helper
        });
        
        // Focus the BrowserView to make it the active target
        browserView.webContents.focus();
        
        // Get the current URL to help identify the target
        const currentUrl = browserView.webContents.getURL();
        console.log('Current BrowserView URL:', currentUrl);
        
        // Get the internal process ID that Chromium uses
        const pid = browserView.webContents.getOSProcessId();
        console.log('Browser process ID:', pid);
        
        // First determine the debugging port - default is 9222 from app.commandLine.appendSwitch
        let debuggingPort = 9222;
        
        // Function to get the list of targets with some error handling and retry
        const getTargetsList = async (maxRetries = 3) => {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    return new Promise((resolve, reject) => {
                        const targetUrl = `http://localhost:${debuggingPort}/json/list`;
                        console.log(`Fetching CDP targets from ${targetUrl} (attempt ${attempt + 1}/${maxRetries})`);
                        
                        http.get(targetUrl, (res) => {
                            let data = '';
                            
                            res.on('data', (chunk) => {
                                data += chunk;
                            });
                            
                            res.on('end', () => {
                                try {
                                    const targets = JSON.parse(data);
                                    resolve(targets);
                                } catch (e) {
                                    reject(new Error(`Failed to parse targets: ${e.message}`));
                                }
                            });
                        }).on('error', (err) => {
                            reject(new Error(`Failed to get targets: ${err.message}`));
                        });
                    });
                } catch (error) {
                    console.error(`Error getting CDP targets (attempt ${attempt + 1})`, error);
                    if (attempt === maxRetries - 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        };
        
        // Get the list of targets with retry
        const targets = await getTargetsList();
        
        // Log all available targets for debugging
        console.log('Available CDP targets:', targets.map(t => ({ 
            type: t.type, 
            url: t.url, 
            title: t.title,
            id: t.id
        })));
        
        // Try to find the BrowserView's target
        // First look for our unique title prefix
        let target = targets.find(t => 
            t.type === 'page' && 
            t.title && 
            t.title.startsWith('AI-OS BrowseAI -')
        );
        
        // If not found by title, try to match by URL
        if (!target) {
            target = targets.find(t => t.url === currentUrl);
        }
        
        // If still no exact match, look for a page target that's not the main app window
        if (!target) {
            // Look for the most likely one - a page that doesn't have 'Electron' in the title
            // and doesn't contain our index.html
            target = targets.find(t => 
                t.type === 'page' && 
                t.url !== 'chrome://inspect/#devices' && 
                !t.url.includes('index.html') &&
                t.title && 
                !t.title.includes('Electron')
            );
        }
        
        // If still no target, use any page target
        if (!target) {
            target = targets.find(t => t.type === 'page');
        }
        
        if (target) {
            console.log('Found specific target for BrowserView:', {
                type: target.type,
                url: target.url,
                title: target.title,
                id: target.id
            });
            
            // We'll now pass the regular CDP URL rather than the WebSocket URL
            // Browser Use doesn't seem to handle the WebSocket URL consistently
            const cdpUrl = `http://localhost:${debuggingPort}`;
            console.log('Using CDP URL with target ID:', cdpUrl, 'Target ID:', target.id);
            
            // Encode the target ID in the environment variable
            process.env.TARGET_ID = target.id;
            
            return cdpUrl;
        }
        
        // Fallback - use a CDP URL with the correct port
        console.log('Could not find specific target - using default CDP URL with detected port');
        return `http://localhost:${debuggingPort}`;
    } catch (error) {
        console.error('Error getting CDP URL:', error);
        // Fallback to default port as last resort
        return 'http://localhost:9222';
    }
}

// Initialize browser agent
ipcMain.on('initialize-browser-agent', async (event) => {
    if (browserAgentProcess) {
        console.log('Browser agent already running');
        mainWindow.webContents.send('browse-ai-agent-initialized');
        return;
    }

    // Ensure the browser view exists before initializing the agent
    if (!browseAiWebView) {
        console.error('BrowserView not created. Cannot initialize browser agent.');
        mainWindow.webContents.send('browse-ai-error', 'BrowserView not created');
        return;
    }

    // Make sure DevTools is activated to ensure CDP is available
    try {
        // Open DevTools if not already open (this ensures CDP endpoint is active)
        if (!browseAiWebView.webContents.isDevToolsOpened()) {
            browseAiWebView.webContents.openDevTools({ mode: 'detach' });
            // Give it a moment to initialize
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Close it to avoid cluttering the UI
            browseAiWebView.webContents.closeDevTools();
            // Small delay after closing
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Get CDP debugging URL with retry logic
        let debuggingUrl = null;
        let targetId = null;
        let retries = 3;
        
        while (retries > 0 && !debuggingUrl) {
            try {
                debuggingUrl = await getWebViewCDPUrl(browseAiWebView);
                // Target ID will be set in process.env.TARGET_ID by getWebViewCDPUrl
                targetId = process.env.TARGET_ID;
                
                if (debuggingUrl) {
                    console.log('Successfully obtained CDP URL:', debuggingUrl);
                    if (targetId) {
                        console.log('Using target ID:', targetId);
                    } else {
                        console.warn('No target ID found, may connect to main application');
                    }
                    break;
                }
            } catch (error) {
                console.error(`Error getting CDP URL (${retries} retries left):`, error);
            }
            
            retries--;
            if (retries > 0) {
                console.log(`Retrying CDP URL retrieval in 1 second (${retries} retries left)...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        if (!debuggingUrl) {
            throw new Error('Could not get CDP URL after multiple attempts');
        }
        
        // Create environment object with both CDP_URL and TARGET_ID
        const env = { 
            ...process.env, 
            CDP_URL: debuggingUrl
        };
        
        // Add TARGET_ID if available
        if (targetId) {
            env.TARGET_ID = targetId;
        }
        
        // Add the current URL to help with domain restriction
        const currentUrl = browseAiWebView.webContents.getURL();
        if (currentUrl) {
            console.log('Setting initial URL for browser agent:', currentUrl);
            env.INITIAL_URL = currentUrl;
        } else {
            console.log('No URL available, using default');
            env.INITIAL_URL = 'https://www.google.com';
        }
        
        // Start browser agent process with CDP URL and target ID
        browserAgentProcess = spawn('python', ['python-backend/browser_agent.py'], {
            env: env,
            // Ensure we use the 'pipe' option for stdin/stdout/stderr
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        console.log('Browser agent process started with CDP URL:', debuggingUrl, 'Target ID:', targetId || 'none');
        
        // Initialize buffer to handle incomplete lines in stdout
        let stdoutBuffer = '';
        
        // Handle stdout from browser agent (JSON messages)
        browserAgentProcess.stdout.on('data', (data) => {
            try {
                // Append new data to buffer and process complete lines
                stdoutBuffer += data.toString();
                
                // Find complete lines (ending with newline)
                const lines = stdoutBuffer.split('\n');
                
                // The last element might be incomplete, keep it in the buffer
                stdoutBuffer = lines.pop() || '';
                
                // Process complete lines
                lines.forEach(line => {
                    const trimmedLine = line.trim();
                    if (trimmedLine) {
                        try {
                            // Explicitly verify this looks like JSON before parsing
                            if (trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) {
                                const parsedMessage = JSON.parse(trimmedLine);
                            handleBrowserAgentMessage(parsedMessage);
                            } else {
                                // If it doesn't look like JSON, log it but don't try to parse
                                console.log('Non-JSON output from browser agent:', trimmedLine);
                            }
                        } catch (error) {
                            console.error('Error parsing JSON message:', error.message);
                            // Only log the problematic line if it's not too long
                            if (trimmedLine.length < 200) {
                                console.error('Problem line:', trimmedLine);
                            } else {
                                console.error('Problem line (truncated):', trimmedLine.substring(0, 200) + '...');
                            }
                        }
                    }
                });
                
                // Safety check: if buffer gets too large, clear it to prevent memory issues
                if (stdoutBuffer.length > 10000) {
                    console.warn('Stdout buffer too large, clearing to prevent memory issues');
                    stdoutBuffer = '';
                }
            } catch (error) {
                console.error('Error processing browser agent output:', error);
            }
        });
        
        // Handle stderr for errors and logging
        browserAgentProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            
            // Debug mode: uncomment to see all stderr output
            // console.log('Browser agent stderr:', message);
            
            // Only log important messages to console to reduce noise
            if (message.includes('ERROR') || 
                message.includes('CRITICAL') || 
                message.includes('WARNING') ||
                message.includes('CDP') ||
                message.includes('EXCEPTION') ||
                message.includes('browser_use')) {
            console.log('Browser agent stderr:', message);
            }
            
            // Send important error messages to the renderer
            if (message.includes('ERROR') || message.includes('CRITICAL') || 
                message.includes('EXCEPTION') || message.includes('Traceback')) {
                mainWindow.webContents.send('browse-ai-error', message);
            }
        });
        
        // Handle process exit
        browserAgentProcess.on('close', (code) => {
            console.log(`Browser agent process exited with code ${code}`);
            
            // Clean up reference to avoid using terminated process
            browserAgentProcess = null;
            
            if (code !== 0) {
                // Non-zero exit status indicates an error
                mainWindow.webContents.send('browse-ai-error', `Browser agent exited with code ${code}`);
            }
        });
        
        // Handle unexpected errors
        browserAgentProcess.on('error', (error) => {
            console.error('Browser agent process error:', error);
            mainWindow.webContents.send('browse-ai-error', `Browser agent error: ${error.message}`);
            
            // Clean up
            browserAgentProcess = null;
        });
        
        // Set up a heartbeat to check if the agent is still responsive
        let heartbeatInterval = setInterval(() => {
            if (browserAgentProcess) {
                try {
                    browserAgentProcess.stdin.write(JSON.stringify({
                        type: 'ping'
                    }) + '\n');
                } catch (error) {
                    console.error('Error sending heartbeat to browser agent:', error);
                    clearInterval(heartbeatInterval);
                }
            } else {
                // Process is gone, clear the interval
                clearInterval(heartbeatInterval);
            }
        }, 30000); // Check every 30 seconds
        
        // Wait for first status message before notifying renderer
        // This ensures the agent is properly initialized
        let initTimeout = setTimeout(() => {
            if (browserAgentProcess) {
                console.log('Browser agent initialization timed out, notifying renderer anyway');
                mainWindow.webContents.send('browse-ai-agent-initialized');
            }
        }, 10000); // 10 second timeout
        
        // Set up temporary listener for initialization status
        const initListener = (message) => {
            if (message.type === 'status' && message.content === 'Browser agent ready') {
                clearTimeout(initTimeout);
                console.log('Browser agent initialization confirmed');
        mainWindow.webContents.send('browse-ai-agent-initialized');
            }
        };
        
        // Add this to browserAgentMessageHandlers
        handleBrowserAgentMessage(initListener);
        
    } catch (error) {
        console.error('Error initializing browser agent:', error);
        mainWindow.webContents.send('browse-ai-error', error.message);
        
        // Clean up if initialization failed
        if (browserAgentProcess) {
            try {
                browserAgentProcess.kill();
                browserAgentProcess = null;
            } catch (cleanupError) {
                console.error('Error cleaning up browser agent process:', cleanupError);
            }
        }
    }
});

// Function to safely terminate the browser agent process
function terminateBrowserAgent() {
    if (browserAgentProcess) {
        try {
            // Try to send a clean shutdown message
            browserAgentProcess.stdin.write(JSON.stringify({
                type: 'shutdown'
            }) + '\n');
            
            // Give it a moment to clean up
            setTimeout(() => {
                try {
                    // If still running, force terminate
                    if (browserAgentProcess) {
                        browserAgentProcess.kill();
                        browserAgentProcess = null;
                        console.log('Browser agent process terminated');
                    }
                } catch (error) {
                    console.error('Error terminating browser agent process:', error);
                }
            }, 1000);
        } catch (error) {
            // If we can't write to stdin, just kill it
            try {
                browserAgentProcess.kill();
                browserAgentProcess = null;
                console.log('Browser agent process terminated');
            } catch (innerError) {
                console.error('Error terminating browser agent process:', innerError);
            }
        }
    }
}

// Handle browser agent messages
function handleBrowserAgentMessage(message) {
    if (typeof message === 'function') {
        // Special case: this is a message handler function
        // Add it to an array of handlers to be called for each message
        browserAgentMessageHandlers.push(message);
        return;
    }
    
    console.log('Browser agent message:', message);
    
    // Call all registered message handlers
    if (browserAgentMessageHandlers && browserAgentMessageHandlers.length > 0) {
        browserAgentMessageHandlers.forEach(handler => handler(message));
    }
    
    switch (message.type) {
        case 'navigation':
            // Handle navigation events
            if (browseAiWebView && message.url) {
                browseAiWebView.webContents.loadURL(message.url).catch(err => {
                    console.error('Failed to navigate:', err);
                });
            }
            break;
        
        case 'interaction':
            // Could highlight elements being interacted with
            mainWindow.webContents.send('browse-ai-interaction', message.element);
            break;
            
        case 'result':
            // Send the result back to chat
            mainWindow.webContents.send('browse-ai-response', message.content);
            break;
            
        case 'status':
            // Update status in UI
            mainWindow.webContents.send('browse-ai-status', message.content);
            break;
            
        case 'error':
            console.error('Browser agent error:', message.error);
            mainWindow.webContents.send('browse-ai-error', message.error);
            break;
            
        case 'pong':
            // Heartbeat response - agent is alive
            console.log('Browser agent heartbeat received');
            break;
    }
}

// Initialize empty array for message handlers
const browserAgentMessageHandlers = [];

// When sending tasks to browser agent
ipcMain.on('browse-ai-send-message', (event, message) => {
    if (browserAgentProcess) {
        try {
            // Add a request ID to track this specific request
            const requestId = `req_${Date.now()}`;
            const taskMessage = JSON.stringify({
                type: 'task',
                content: message,
                request_id: requestId
            }) + '\n';
            
            console.log(`Sending browser agent task (${requestId}): ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
            browserAgentProcess.stdin.write(taskMessage);
            
            // Set a timeout for this specific request
            setTimeout(() => {
                // Check if this request is still in progress and report if it's taking too long
                console.log(`Task ${requestId} check: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
            }, 30000); // Check after 30 seconds
            
        } catch (error) {
            console.error('Error sending message to browser agent:', error);
            mainWindow.webContents.send('browse-ai-error', 'Failed to send message to browser agent');
            
            // If we can't write to stdin, the process might be dead
            if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED' || error.code === 'ECONNRESET') {
                console.error('Browser agent process appears to be dead, cleaning up');
                browserAgentProcess = null;
                
                // Notify UI
                mainWindow.webContents.send('browse-ai-error', 'Browser agent process terminated unexpectedly. Please restart Browse AI.');
            }
        }
    } else {
        console.error('Browser agent not initialized');
        mainWindow.webContents.send('browse-ai-error', 'Browser agent not initialized. Please restart Browse AI.');
    }
});