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
    this.reconnectAttempts = 10;
    this.maxReconnectAttempts = 50;
    this.reconnectDelay = 20000;
    this.serverStartTimeout = 120000;
    this.ongoingStreams = {};
  }

  async start() {
    if (this.pythonProcess) return;
    const pythonPath = path.join(__dirname, 'python-backend', 'app.py');
    this.pythonProcess = spawn('python', [pythonPath], {
      env: { 
        ...process.env, 
        PYTHONIOENCODING: 'utf-8', 
        PYTHONUTF8: '1',
        // Set Python logging level to INFO to reduce debug output
        LOGLEVEL: 'INFO'
      }
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Python server startup timeout'));
      }, this.serverStartTimeout);
      
      const checkForStartupMessage = (data) => {
        const message = data.toString();
        // Instead of logging everything, only check for the startup message
        if (message.includes('Starting server on port 8765')) {
          console.log('Python server started successfully');
          clearTimeout(timeout);
          resolve();
        }
      };
      
      this.pythonProcess.stdout.on('data', checkForStartupMessage);
      this.pythonProcess.stderr.on('data', (data) => {
        const message = data.toString();
        // Only log connection-related messages and errors
        if (message.includes('ERROR') || 
            message.includes('socket') || 
            message.includes('connect') || 
            message.includes('Starting server') ||
            message.includes('port')) {
          console.error(`Python: ${message.trim()}`);
        }
        // Still check for startup message
        checkForStartupMessage(data);
      });
    });
    this.setupProcessHandlers();
    await this.connectWebSocket();
  }

  setupProcessHandlers() {
    this.pythonProcess.stderr.on('data', (data) => {
      const message = data.toString();
      // Only log important messages
      if (message.includes('ERROR') || 
          message.includes('socket') || 
          message.includes('connect') ||
          message.includes('Starting server') ||
          message.includes('port')) {
        console.error(`Python: ${message.trim()}`);
      }
    });
    this.pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
      this.cleanup();
    });
    
    // Set up message handlers for chat functionality
    this.setupIpcHandlers();
  }

  setupIpcHandlers() {
    // Handle messages from chat.js to send to Python backend
    ipcMain.on('send-message', (event, data) => {
      this.sendMessage(data);
    });

    // Handle session termination requests
    ipcMain.on('terminate-session', () => {
      this.sendMessage({ type: 'terminate_session' });
    });

    // Legacy handler for backward compatibility
    ipcMain.on('python-message', (event, message) => {
      this.sendMessage(message);
    });
  }

  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      // Only log first connection attempt
      if (this.reconnectAttempts <= 1) {
        console.log('Connecting to Socket.IO server...');
      }
      
      this.socket = io('http://localhost:8765', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
      });
      
      const connectionTimeout = setTimeout(() => {
        console.error('Socket.IO connection timeout');
        this.socket.disconnect();
        reject(new Error('Socket.IO connection timeout'));
      }, 20000);
      
      this.socket.on('connect', () => {
        clearTimeout(connectionTimeout);
        console.log('Connected to Socket.IO server');
        this.initialized = true;
        this.reconnectAttempts = 0;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('socket-connection-status', { connected: true });
        }
        resolve();
      });
      
      this.socket.on('connect_error', (error) => {
        clearTimeout(connectionTimeout);
        // Only log detailed error on first attempt
        if (this.reconnectAttempts <= 1) {
          console.error('Socket.IO connect error:', error.message);
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('socket-connection-status', { 
            connected: false,
            error: error.message
          });
        }
        reject(error);
      });
      
      this.setupSocketHandlers();
    });
  }

  setupSocketHandlers() {
    // Handle response messages from Python backend without logging
    this.socket.on('response', (data) => {
      // Forward the response to the renderer process (chat.js)
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('chat-response', data);
      }
    });

    // Only log critical errors
    this.socket.on('error', (error) => {
      if (typeof error === 'object') {
        console.error('Socket.IO error:', error.message || 'Unknown error');
      } else {
        console.error('Socket.IO error:', error);
      }
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('socket-error', error);
      }
    });

    // Don't log status messages to console, just forward to renderer
    this.socket.on('status', (data) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('socket-status', data);
      }
    });

    // Handle disconnection
    this.socket.on('disconnect', () => {
      // Only log the first disconnection
      if (this.initialized) {
        console.log('Socket.IO disconnected');
      }
      this.initialized = false;
      
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('socket-connection-status', { connected: false });
      }
      
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.handleReconnection();
      }
    });
  }

  async handleReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('socket-connection-status', {
          connected: false,
          error: 'Max reconnection attempts reached'
        });
      }
      this.cleanup();
      return;
    }
    this.reconnectAttempts++;
    
    // Only log every 5 attempts to reduce console spam
    if (this.reconnectAttempts % 5 === 1 || this.reconnectAttempts === this.maxReconnectAttempts) {
      console.log(`Reconnecting: attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    }
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('socket-connection-status', {
        connected: false,
        reconnecting: true,
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts
      });
    }
    
    try {
      await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
      await this.connectWebSocket();
    } catch (error) {
      // Only log detailed error on first attempt or every 5 attempts
      if (this.reconnectAttempts === 1 || this.reconnectAttempts % 5 === 0) {
        console.error('Reconnection failed:', error.message);
      }
      // Only attempt reconnection if window still exists
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.handleReconnection();
      }
    }
  }

  sendMessage(message) {
    if (!this.socket || !this.socket.connected) {
      console.error('Socket not connected');
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('socket-error', {
          message: 'Cannot send message, socket not connected'
        });
      }
      return;
    }
    try {
      this.socket.emit('send_message', JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message:', error);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('socket-error', {
          message: 'Error sending message: ' + error.message
        });
      }
    }
  }

  cleanup() {
    // Remove all socket event listeners first
    if (this.socket) {
      // Remove all listeners before closing to prevent callbacks
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
    
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    
    this.initialized = false;
    this.ongoingStreams = {};
  }

  stop() {
    // Check if mainWindow still exists and is not destroyed
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // Only notify if the window still exists
      this.mainWindow.webContents.send('socket-connection-status', { connected: false });
    }
    this.cleanup();
  }
}

module.exports = PythonBridge;