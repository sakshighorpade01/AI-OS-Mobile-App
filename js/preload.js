const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    "electron", {
        ipcRenderer: {
            send: (channel, data) => {
                // whitelist channels
                let validChannels = [
                    'open-webview', 
                    'send-message', 
                    'webview-navigate', 
                    'close-webview', 
                    'resize-webview', 
                    'drag-webview',
                    'check-socket-connection',
                    'restart-python-bridge',
                    'terminate-session',
                    // Browse AI related channels
                    'open-browse-ai-webview',
                    'close-browse-ai-webview',
                    'browse-ai-webview-navigate',
                    'browse-ai-header-height',
                    'browse-ai-send-message',
                    'initialize-browser-agent'
                ];
                if (validChannels.includes(channel)) {
                    ipcRenderer.send(channel, data);
                }
            },
            on: (channel, func) => {
                let validChannels = [
                    'chat-response', 
                    'socket-error', 
                    'socket-status',
                    'socket-connection-status',
                    'webview-created', 
                    'webview-closed', 
                    'webview-navigation-updated', 
                    'webview-page-loaded', 
                    'webview-content-captured',
                    // Browse AI related channels
                    'browse-ai-webview-created',
                    'browse-ai-webview-closed',
                    'browse-ai-webview-navigation-updated',
                    'browse-ai-response',
                    'browse-ai-error',
                    'browse-ai-status',
                    'browse-ai-interaction',
                    'browse-ai-agent-initialized'
                ];
                if (validChannels.includes(channel)) {
                    // Deliberately strip event as it includes sender 
                    ipcRenderer.on(channel, (event, ...args) => func(...args));
                }
            }
        }
    }
);