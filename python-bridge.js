//python-bridge.js
const { spawn } = require('child_process');
const path = require('path');
const { ipcMain } = require('electron');
const WebSocket = require('ws');

class PythonBridge {
    constructor(mainWindow) {
        this.pythonProcess = null;
        this.mainWindow = mainWindow;
        this.ws = null;
        this.initialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 2000;
        this.serverStartTimeout = 5000;
    }

    async start() {
        if (this.pythonProcess) return;
        
        const pythonPath = path.join(__dirname, 'python-backend', 'app.py');
        this.pythonProcess = spawn('python', [pythonPath], {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
        });

        // Wait for Python server startup indication
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Python server startup timeout'));
            }, this.serverStartTimeout);

            this.pythonProcess.stdout.on('data', (data) => {
                if (data.toString().includes('Starting server on port 8765')) {
                    clearTimeout(timeout);
                    resolve();
                }
            });

            this.pythonProcess.stderr.on('data', (data) => {
                console.error(`Python stderr: ${data}`);
            });
        });

        this.setupProcessHandlers();
        await this.connectWebSocket();
    }

    setupProcessHandlers() {
        this.pythonProcess.stderr.on('data', (data) => {
            console.error(`Python stderr: ${data}`);
        });

        this.pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
            this.cleanup();
        });

        ipcMain.on('python-message', (event, message) => {
            this.sendMessage(message);
        });
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket('ws://localhost:8765');

            const connectionTimeout = setTimeout(() => {
                this.ws.close();
                reject(new Error('WebSocket connection timeout'));
            }, 5000);

            this.ws.on('open', () => {
                clearTimeout(connectionTimeout);
                console.log('WebSocket connected to Python backend');
                this.initialized = true;
                this.reconnectAttempts = 0;
                resolve();
            });

            this.setupWebSocketHandlers();
        });
    }

    setupWebSocketHandlers() {
        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                 // Centralized Message Handling
                if (message.type === 'log') {
                    this.mainWindow.webContents.send('python-log', message); // Send to terminal
                } else {
                    this.mainWindow.webContents.send('python-response', message); // Send to chat
                }

            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        });

        this.ws.on('close', () => {
            console.log('WebSocket connection closed');
            this.initialized = false;
            this.handleReconnection();
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            if (error.code === 'ECONNREFUSED') {
                this.handleReconnection();
            }
        });
    }

    async handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.cleanup();
            return;
        }

        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        try {
            await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
            await this.connectWebSocket();
        } catch (error) {
            console.error('Reconnection failed:', error);
            this.handleReconnection();
        }
    }

    sendMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected');
            return;
        }

        try {
            this.ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    cleanup() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.pythonProcess) {
            this.pythonProcess.kill();
            this.pythonProcess = null;
        }
        this.initialized = false;
    }

    stop() {
        this.cleanup();
    }
}

module.exports = PythonBridge;