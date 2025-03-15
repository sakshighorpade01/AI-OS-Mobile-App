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
                    'terminate-session'
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
                    'webview-content-captured'
                ];
                if (validChannels.includes(channel)) {
                    // Deliberately strip event as it includes sender 
                    ipcRenderer.on(channel, (event, ...args) => func(...args));
                }
            }
        }
    }
);