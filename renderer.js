// renderer.js
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
        this.cacheElements();
        this.setupEventListeners();
        this.setupStateSubscription();
    }
    cacheElements() {
        this.elements = {
            appIcon: document.getElementById('app-icon'),
            chatIcon: document.getElementById('chat-icon'),
            themeToggle: document.getElementById('theme-toggle'),
            minimizeBtn: document.getElementById('minimize-window'),
            resizeBtn: document.getElementById('resize-window'),
            closeBtn: document.getElementById('close-window'),
            terminalIcon: document.getElementById('terminal-icon')
        };
    }

    setupEventListeners() {
        const { ipcRenderer } = require('electron');

        const addClickHandler = (element, handler) => {
            element?.addEventListener('click', handler);
        };

        addClickHandler(this.elements.minimizeBtn, () => ipcRenderer.send('minimize-window'));
        addClickHandler(this.elements.resizeBtn, () => ipcRenderer.send('toggle-maximize-window'));
        addClickHandler(this.elements.closeBtn, () => ipcRenderer.send('close-window'));
        addClickHandler(this.elements.themeToggle, () => this.state.setState({ isDarkMode: !this.state.getState().isDarkMode }));
        addClickHandler(this.elements.appIcon, () => this.state.setState({ isAIOSOpen: !this.state.getState().isAIOSOpen }));
        addClickHandler(this.elements.chatIcon, () => this.state.setState({ isChatOpen: !this.state.getState().isChatOpen }));
        addClickHandler(this.elements.terminalIcon, () => this.state.setState({ isTerminalOpen: !this.state.getState().isTerminalOpen }));

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
                        if (state.isChatOpen && (state.isAIOSOpen || state.isTerminalOpen)) {
                            this.state.setState({ isAIOSOpen: false, isTerminalOpen: false });
                        }
                        this.updateChatVisibility(state.isChatOpen);
                        this.updateTaskbarPosition(state.isChatOpen);
                        break;
                    case 'isAIOSOpen':
                        if (state.isAIOSOpen && (state.isChatOpen || state.isTerminalOpen)) {
                            this.state.setState({ isChatOpen: false, isTerminalOpen: false });
                        }
                        this.updateAIOSVisibility(state.isAIOSOpen);
                        break;
                    case 'isTerminalOpen':
                        if (state.isTerminalOpen && (state.isChatOpen || state.isAIOSOpen)) {
                            this.state.setState({ isChatOpen: false, isAIOSOpen: false });
                        }
                        this.updateTerminalVisibility(state.isTerminalOpen);
                        break;
                }
            });
        });
    }

    updateTerminalVisibility(isOpen) {
        document.getElementById('terminal-container')?.classList.toggle('hidden', !isOpen);
    }

    updateTheme(isDarkMode) {
        document.body.classList.toggle('dark-mode', isDarkMode);
        if (this.elements.themeToggle) {
          this.elements.themeToggle.querySelector('i').className = isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
        }

    }

    updateWindowControls(isMaximized) {
        if(this.elements.resizeBtn){
          this.elements.resizeBtn.querySelector('i').className = isMaximized ? 'fas fa-compress' : 'fas fa-expand';
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
            document.getElementById('floating-window')?.classList.toggle('hidden', !isOpen);
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
    new UIManager(stateManager);

    const loadModule = async (name, containerId, initFunc) => {
        try {
            const response = await fetch(`${name}.html`);
            const html = await response.text();
            document.getElementById(containerId).innerHTML = html;
            initFunc?.();
        } catch (error) {
            console.error(`Error loading ${name}:`, error);
        }
    };
    loadModule('aios', 'aios-container', () => window.AIOS?.init());
    loadModule('chat', 'chat-root', () => window.chatModule?.init());
    loadModule('terminal', 'terminal-root', () => window.terminalLogger?.init());
});