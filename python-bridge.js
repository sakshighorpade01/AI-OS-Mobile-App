const { spawn } = require('child_process');
const path = require('path');
const { ipcMain } = require('electron');

class PythonBridge {
    constructor(mainWindow) {
        this.pythonProcess = null;
        this.mainWindow = mainWindow;
        this.initialized = false;
    }

    start() {
        if (this.pythonProcess) return;
        
        const pythonPath = path.join(__dirname, 'python-backend', 'app.py');
        
        this.pythonProcess = spawn('python', [pythonPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8', 
                PYTHONUTF8: '1'          
            }
        });

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.pythonProcess.stdout.on('data', (data) => {
            console.log(`Python stdout: ${data}`);
            this.mainWindow.webContents.send('python-response', data.toString());
        });
    
        this.pythonProcess.stderr.on('data', (data) => {
            console.error(`Python stderr: ${data}`);
        });
    
        this.pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
            this.pythonProcess = null;
            this.initialized = false;
        });

        ipcMain.on('python-message', (event, message) => {
            this.sendMessage(message);
        });

        this.initialized = true;
    }

    sendMessage(message) {
        if (!this.pythonProcess) {
            this.start();
        }

        try {
            const jsonMessage = JSON.stringify(message) + '\n';
            this.pythonProcess.stdin.write(jsonMessage);
        } catch (error) {
            console.error('Error sending message to Python:', error);
        }
    }

    stop() {
        if (this.pythonProcess) {
            this.pythonProcess.kill();
            this.pythonProcess = null;
            this.initialized = false;
        }
    }
}

module.exports = PythonBridge;