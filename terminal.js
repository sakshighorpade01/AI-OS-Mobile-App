// terminal.js
class TerminalLogger {
    constructor() {
        this.logCounts = { debug: 0, info: 0, error: 0 };
        this.maxLogs = 1000;
        this.currentFilter = 'all';
        this.logBuffer = [];
        //this.ws = null; // No longer creating a separate WebSocket
        this.init();
    }

  init() {
    //this.setupWebSocket(); // Removed separate WebSocket setup
    this.setupEventListeners();
    this.setupRendererListener(); // Listen for logs from renderer
    this.updateCounters();
}

    setupRendererListener() {
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('python-log', (_, logData) => {
            this.processLog(logData);
        });
    }


    // setupWebSocket() { // Removed - Using main WebSocket now
    //     this.ws = new WebSocket('ws://localhost:8765/logs');

    //     this.ws.onmessage = (event) => {
    //         try {
    //             const logData = JSON.parse(event.data);
    //             this.processLog(logData);
    //         } catch (error) {
    //             console.error('Error processing log:', error);
    //         }
    //     };

    //     this.ws.onclose = () => {
    //         console.log('Log WebSocket closed, attempting to reconnect...');
    //         setTimeout(() => this.setupWebSocket(), 5000);
    //     };
    // }

   processLog(logData) {
    // Validate log level
    if (!['debug', 'info', 'error'].includes(logData.level)) {
        return;
    }

    // Update counters
    this.logCounts[logData.level]++;
    this.updateCounters();

    // Create log entry
    const entry = {
        timestamp: new Date().toISOString(),
        level: logData.level,
        message: logData.message,
        source: logData.source || 'system',
        metadata: logData.metadata || {}
    };

    // Add to buffer
    this.logBuffer.unshift(entry);
    
    // Maintain buffer size
    if (this.logBuffer.length > this.maxLogs) {
        this.logBuffer.pop();
    }

    // Add to DOM
    this.addLogEntry(entry);

    // Maintain max visible logs
    const entries = document.querySelectorAll('.log-entry');
    if (entries.length > 100) { // Keep DOM lighter
        entries[entries.length - 1].remove();
    }
}

    addLogEntry(entry) {
        const container = document.querySelector('.log-container');
        if (!container) return;

        const entryEl = document.createElement('div');
        entryEl.className = `log-entry ${entry.level}`;
        entryEl.dataset.level = entry.level;
        entryEl.dataset.timestamp = entry.timestamp;

        const time = new Date(entry.timestamp).toLocaleTimeString();
        const metadata = entry.metadata ? `<span class="log-metadata">${JSON.stringify(entry.metadata)}</span>` : '';

        entryEl.innerHTML = `
            <span class="log-timestamp">${time}</span>
            <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
            <span class="log-source">${this.sanitizeMessage(entry.source)}</span>
            <span class="log-message">${this.sanitizeMessage(entry.message)}</span>
            ${metadata}
        `;

        container.insertBefore(entryEl, container.firstChild);
        this.applyCurrentFilter();
    }

    sanitizeMessage(message) {
        const div = document.createElement('div');
        div.textContent = message;
        return div.innerHTML;
    }

    updateCounters() {
        document.querySelectorAll('.log-counter').forEach(counter => {
            const level = counter.classList[1];
            counter.textContent = `${level.charAt(0).toUpperCase() + level.slice(1)}: ${this.logCounts[level]}`;
        });
    }

    setupEventListeners() {
        // Filter tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setFilter(btn.dataset.log);
                document.querySelectorAll('.tab-btn').forEach(b => 
                    b.classList.toggle('active', b === btn)
                );
            });
        });

        // Clear logs
        document.getElementById('clear-terminal')?.addEventListener('click', () => {
            this.clearLogs();
        });

        // Export logs
        document.getElementById('export-logs')?.addEventListener('click', () => {
            this.exportLogs();
        });

        // Search functionality
        const searchInput = document.getElementById('log-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterLogs(e.target.value);
            });
        }
         // Close terminal
        document.getElementById('close-terminal')?.addEventListener('click', () => {
            window.stateManager.setState({ isTerminalOpen: false });
        });
    }

    setFilter(level) {
        this.currentFilter = level;
        this.applyCurrentFilter();
    }

    applyCurrentFilter() {
        const searchTerm = document.getElementById('log-search')?.value || '';
        document.querySelectorAll('.log-entry').forEach(entry => {
            const matchesFilter = this.currentFilter === 'all' || entry.dataset.level === this.currentFilter;
            const matchesSearch = searchTerm === '' || entry.textContent.toLowerCase().includes(searchTerm.toLowerCase());
            entry.style.display = matchesFilter && matchesSearch ? '' : 'none';
        });
    }

    filterLogs(searchTerm) {
        this.applyCurrentFilter();
    }

    clearLogs() {
        const container = document.querySelector('.log-container');
        if (container) {
            container.innerHTML = '';
            this.logBuffer = [];
            this.logCounts = { debug: 0, info: 0, error: 0 };
            this.updateCounters();
        }
    }

    exportLogs() {
        const exportData = {
            timestamp: new Date().toISOString(),
            logs: this.logBuffer,
            stats: this.logCounts
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
            type: 'application/json' 
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${new Date().toISOString()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    window.terminalLogger = new TerminalLogger();
});