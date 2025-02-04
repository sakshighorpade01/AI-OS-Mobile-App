class Terminal {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.currentFilter = 'all';
        this.init();
    }

    init() {
        this.setupWebSocket();
        this.setupEventListeners();
    }

    setupWebSocket() {
        const socket = io('http://localhost:8765');
        
        socket.on('log', (logData) => {
            this.addLog(logData);
        });
    }

    setupEventListeners() {
        // Terminal visibility toggle
        document.getElementById('terminal-icon').addEventListener('click', () => {
            const terminal = document.getElementById('terminal-container');
            terminal.classList.toggle('hidden');
        });

        // Close button
        document.getElementById('close-terminal').addEventListener('click', () => {
            document.getElementById('terminal-container').classList.add('hidden');
        });

        // Clear button
        document.getElementById('clear-terminal').addEventListener('click', () => {
            this.clearLogs();
        });

        // Download button
        document.getElementById('download-logs').addEventListener('click', () => {
            this.downloadLogs();
        });

        // Tab filtering
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setFilter(e.target.dataset.log);
            });
        });
    }

    addLog(logData) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: logData.level,
            message: logData.message
        };

        this.logs.unshift(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }

        this.renderLog(logEntry);
    }

    renderLog(logEntry) {
        const container = document.querySelector('.log-container');
        const entry = document.createElement('div');
        entry.className = `log-entry ${this.currentFilter !== 'all' && this.currentFilter !== logEntry.level ? 'filtered' : ''}`;
        entry.dataset.level = logEntry.level;

        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = new Date(logEntry.timestamp).toLocaleTimeString();

        const level = document.createElement('span');
        level.className = `log-level ${logEntry.level}`;
        level.textContent = logEntry.level.toUpperCase();

        const message = document.createElement('span');
        message.className = 'log-message';
        message.textContent = logEntry.message;

        entry.appendChild(time);
        entry.appendChild(level);
        entry.appendChild(message);
        container.insertBefore(entry, container.firstChild);
    }

    setFilter(filter) {
        this.currentFilter = filter;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.log === filter);
        });

        document.querySelectorAll('.log-entry').forEach(entry => {
            if (filter === 'all' || entry.dataset.level === filter) {
                entry.classList.remove('filtered');
            } else {
                entry.classList.add('filtered');
            }
        });
    }

    clearLogs() {
        this.logs = [];
        document.querySelector('.log-container').innerHTML = '';
    }

    downloadLogs() {
        const logText = this.logs
            .map(log => `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`)
            .join('\n');
        
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${new Date().toISOString()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize terminal when document is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.terminal = new Terminal();
});