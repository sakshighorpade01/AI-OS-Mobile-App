const { spawn } = require('child_process');
const path = require('path');
const { ipcMain } = require('electron');

class PythonBridge {
    constructor(mainWindow) {
        this.pythonProcess = null;
        this.mainWindow = mainWindow;
        this.messageQueue = [];
        this.isProcessing = false;
        this.responseBuffer = '';
    }

    start() {
        const pythonPath = path.join(__dirname, 'python-backend', 'app.py');
        
        this.pythonProcess = spawn('python', [pythonPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });
    
        // Log stdout instead of parsing
        this.pythonProcess.stdout.on('data', (data) => {
            console.log(`Python stdout: ${data}`);
        });
    
        // Log stderr instead of emitting errors
        this.pythonProcess.stderr.on('data', (data) => {
            console.error(`Python stderr: ${data}`);
        });
    
        this.pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
            this.pythonProcess = null;
        });

        // Set up IPC listener
        ipcMain.on('python-message', (event, message) => {
            this.sendMessage(message);
        });
    }

    sendMessage(message) {
        if (!this.pythonProcess) {
            console.error('Python process not started');
            return;
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
        }
    }
}

module.exports = PythonBridge;