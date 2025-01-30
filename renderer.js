// renderer.js
class StateManager {
    constructor() {
        this._state = {
            isDarkMode: true,
            isWindowMaximized: false,
            isChatOpen: false,
            isAIOSOpen: false
        };
        
        this.subscribers = new Set();
    }

    setState(updates) {
        const changedKeys = Object.keys(updates).filter(
            key => this._state[key] !== updates[key]
        );
        
        Object.assign(this._state, updates);
        
        if (changedKeys.length > 0) {
            this.notifySubscribers(changedKeys);
        }
    }

    getState() {
        return { ...this._state };
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    notifySubscribers(changedKeys) {
        const state = this.getState();
        this.subscribers.forEach(callback => callback(state, changedKeys));
    }
}

class UIManager {
    constructor(stateManager) {
        this.state = stateManager;
        this.elements = {};
        this.init();
    }

    init() {
        // Cache DOM elements
        this.elements = {
            appIcon: document.getElementById('app-icon'),
            chatIcon: document.getElementById('chat-icon'),
            themeToggle: document.getElementById('theme-toggle'),
            minimizeBtn: document.getElementById('minimize-window'),
            resizeBtn: document.getElementById('resize-window'),
            closeBtn: document.getElementById('close-window')
        };

        this.setupEventListeners();
        this.setupStateSubscription();
    }

    setupEventListeners() {
        const { ipcRenderer } = require('electron');

        // Window controls
        this.elements.minimizeBtn?.addEventListener('click', () => {
            ipcRenderer.send('minimize-window');
        });

        this.elements.resizeBtn?.addEventListener('click', () => {
            ipcRenderer.send('toggle-maximize-window');
        });

        this.elements.closeBtn?.addEventListener('click', () => {
            ipcRenderer.send('close-window');
        });

        // Theme toggle
        this.elements.themeToggle?.addEventListener('click', () => {
            const currentState = this.state.getState();
            this.state.setState({ isDarkMode: !currentState.isDarkMode });
        });

        // App icons
        this.elements.appIcon?.addEventListener('click', () => {
            const currentState = this.state.getState();
            this.state.setState({ isAIOSOpen: !currentState.isAIOSOpen });
        });

        this.elements.chatIcon?.addEventListener('click', () => {
            const currentState = this.state.getState();
            this.state.setState({ isChatOpen: !currentState.isChatOpen });
        });

        // IPC listeners
        ipcRenderer.on('window-state-changed', (_, isMaximized) => {
            this.state.setState({ isWindowMaximized: isMaximized });
        });
    }

    setupStateSubscription() {
        this.state.subscribe((state, changedKeys) => {
            changedKeys.forEach(key => {
                switch (key) {
                    case 'isDarkMode':
                        this.updateTheme(state.isDarkMode);
                        break;
                    case 'isWindowMaximized':
                        this.updateWindowControls(state.isWindowMaximized);
                        break;
                    case 'isChatOpen':
                        if (state.isChatOpen && state.isAIOSOpen) {
                            this.state.setState({ isAIOSOpen: false });
                        }
                        this.updateChatVisibility(state.isChatOpen);
                        this.updateTaskbarPosition(state.isChatOpen);
                        break;
                    case 'isAIOSOpen':
                        if (state.isAIOSOpen && state.isChatOpen) {
                            this.state.setState({ isChatOpen: false });
                        }
                        this.updateAIOSVisibility(state.isAIOSOpen);
                        break;
                }
            });
        });
    }
    
    updateTheme(isDarkMode) {
        document.body.classList.toggle('dark-mode', isDarkMode);
        const icon = this.elements.themeToggle?.querySelector('i');
        if (icon) {
            icon.className = isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    updateWindowControls(isMaximized) {
        const icon = this.elements.resizeBtn?.querySelector('i');
        if (icon) {
            icon.className = isMaximized ? 'fas fa-compress' : 'fas fa-expand';
        }
    }

    updateChatVisibility(isOpen) {
        const chatContainer = document.getElementById('chat-container');
        const inputContainer = document.getElementById('floating-input-container');
        const taskbar = document.querySelector('.taskbar');

        if (chatContainer && inputContainer && taskbar) {
            chatContainer.classList.toggle('hidden', !isOpen);
            inputContainer.classList.toggle('hidden', !isOpen);
            taskbar.classList.toggle('chat-open', isOpen);
        }
    }

    updateAIOSVisibility(isOpen) {
        if (window.AIOS?.initialized) {
            const floatingWindow = document.getElementById('floating-window');
            if (floatingWindow) {
                floatingWindow.classList.toggle('hidden', !isOpen);
            }
        }
    }

    updateTaskbarPosition(isChatOpen) {
        const taskbar = document.querySelector('.taskbar');
        if (taskbar) {
            taskbar.style.transition = 'all 0.3s ease';
            taskbar.classList.toggle('chat-open', isChatOpen);
        }
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    const stateManager = new StateManager();
    window.stateManager = stateManager;
    const uiManager = new UIManager(stateManager);

    // Load AIOS content
    loadAIOS().then(() => {
        if (window.AIOS) {
            window.AIOS.init();
        }
    });

    // Load chat content
    loadChat().then(() => {
        if (window.chatModule) {
            window.chatModule.init();
        }
    });
});

// Helper functions
async function loadAIOS() {
    try {
        const response = await fetch('aios.html');
        const html = await response.text();
        document.getElementById('aios-container').innerHTML = html;
    } catch (error) {
        console.error('Error loading AIOS:', error);
    }
}

async function loadChat() {
    try {
        const response = await fetch('chat.html');
        const html = await response.text();
        document.getElementById('chat-root').innerHTML = html;
    } catch (error) {
        console.error('Error loading chat:', error);
    }
}