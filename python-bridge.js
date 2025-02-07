const { spawn } = require('child_process');
const path = require('path');
const { ipcMain } = require('electron');
const io = require('socket.io-client');
class PythonBridge {
  constructor(mainWindow) {
    this.pythonProcess = null;
    this.mainWindow = mainWindow;
    this.socket = null;
    this.initialized = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;
    this.serverStartTimeout = 15000;
  }
  async start() {
    if (this.pythonProcess) return;
    const pythonPath = path.join(__dirname, 'python-backend', 'app.py');
    this.pythonProcess = spawn('python', [pythonPath], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
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
      this.socket = io('http://localhost:8765', {
        transports: ['websocket'],
        reconnection: false
      });
      const connectionTimeout = setTimeout(() => {
        this.socket.disconnect();
        reject(new Error('Socket.IO connection timeout'));
      }, 5000);
      this.socket.on('connect', () => {
        clearTimeout(connectionTimeout);
        console.log('Connected to Socket.IO server');
        this.initialized = true;
        this.reconnectAttempts = 0;
        resolve();
      });
      this.socket.on('connect_error', (error) => {
        clearTimeout(connectionTimeout);
        console.error('Socket.IO connect error:', error);
        reject(error);
      });
      this.setupSocketHandlers();
    });
  }
  setupSocketHandlers() {
    this.socket.on('response', (data) => {
      if (data.type === 'log') {
        this.mainWindow.webContents.send('python-log', data);
      } else {
        this.mainWindow.webContents.send('python-response', data);
      }
    });
    this.socket.on('disconnect', () => {
      console.log('Socket.IO disconnected');
      this.initialized = false;
      this.handleReconnection();
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
    if (!this.socket || !this.socket.connected) {
      console.error('Socket not connected');
      return;
    }
    try {
      this.socket.emit('send_message', JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }
  cleanup() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
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
