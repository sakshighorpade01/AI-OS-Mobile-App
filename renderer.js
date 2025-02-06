//renderer.js
class StateManager {
    constructor() {
        this._state = {
            isDarkMode: true,
            isWindowMaximized: false,
            isChatOpen: false,
            isAIOSOpen: false,
            isTerminalOpen: false
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
        this.elements = {
            appIcon: document.getElementById('app-icon'),
            chatIcon: document.getElementById('chat-icon'),
            themeToggle: document.getElementById('theme-toggle'),
            minimizeBtn: document.getElementById('minimize-window'),
            resizeBtn: document.getElementById('resize-window'),
            closeBtn: document.getElementById('close-window'),
            terminalIcon: document.getElementById('terminal-icon')
        };

        this.setupEventListeners();
        this.setupStateSubscription();
    }

    setupEventListeners() {
        const { ipcRenderer } = require('electron');

        this.elements.minimizeBtn?.addEventListener('click', () => {
            ipcRenderer.send('minimize-window');
        });

        this.elements.resizeBtn?.addEventListener('click', () => {
            ipcRenderer.send('toggle-maximize-window');
        });

        this.elements.closeBtn?.addEventListener('click', () => {
            ipcRenderer.send('close-window');
        });

        this.elements.themeToggle?.addEventListener('click', () => {
            const currentState = this.state.getState();
            this.state.setState({ isDarkMode: !currentState.isDarkMode });
        });

        this.elements.appIcon?.addEventListener('click', () => {
            const currentState = this.state.getState();
            this.state.setState({ isAIOSOpen: !currentState.isAIOSOpen });
        });

        this.elements.chatIcon?.addEventListener('click', () => {
            const currentState = this.state.getState();
            this.state.setState({ isChatOpen: !currentState.isChatOpen });
        });

        this.elements.terminalIcon.addEventListener('click', () => {
            const currentState = this.state.getState();
            this.state.setState({ isTerminalOpen: !currentState.isTerminalOpen });
        });

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
                    case 'isTerminalOpen':
                        this.updateTerminalVisibility(state.isTerminalOpen);
                        break;
                }
            });
        });
    }

    updateTerminalVisibility(isOpen) {
        const terminalContainer = document.getElementById('terminal-container');
        if (terminalContainer) {
            terminalContainer.classList.toggle('hidden', !isOpen);
        }
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

document.addEventListener('DOMContentLoaded', () => {
    const stateManager = new StateManager();
    window.stateManager = stateManager;
    const uiManager = new UIManager(stateManager);

    loadTerminal().then(() => {
        if (window.terminalLogger) {
            window.terminalLogger.init();
        }
    });

    loadAIOS().then(() => {
        if (window.AIOS) {
            window.AIOS.init();
        }
    });
    loadChat().then(() => {
        if (window.chatModule) {
            window.chatModule.init();
        }
    });
});

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

async function loadTerminal() {
    try {
        const response = await fetch('terminal.html');
        const html = await response.text();
        const terminalRoot = document.getElementById('terminal-root'); // Use existing element
        //terminalRoot.id = 'terminal-root'; // No longer needed
        //document.body.appendChild(terminalRoot); // No longer appending
        terminalRoot.innerHTML = html;
    } catch (error) {
        console.error('Error loading terminal:', error);
    }
}
  