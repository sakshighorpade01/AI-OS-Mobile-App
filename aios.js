// aios.js
class AIOS {
    constructor() {
        this.floatingWindow = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        
        this.floatingWindow = document.getElementById('floating-window');
        
        if (this.floatingWindow) {
            this.setupEventListeners();
            this.initialized = true;
        }
    }

    setupEventListeners() {
        const closeBtn = this.floatingWindow.querySelector('#close-window');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // Prevent clicks inside window from bubbling
        this.floatingWindow.addEventListener('click', (e) => e.stopPropagation());
    }

    show() {
        if (!this.floatingWindow) return;
        this.floatingWindow.classList.remove('hidden');
        // Close chat if open
        const chatBox = document.getElementById('chat-container');
        if (chatBox) {
            chatBox.classList.add('hidden');
        }
    }

    hide() {
        if (!this.floatingWindow) return;
        this.floatingWindow.classList.add('hidden');
    }

    toggle() {
        if (!this.floatingWindow) return;
        if (this.floatingWindow.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    }
}

// Create and export a single instance
window.AIOS = new AIOS();