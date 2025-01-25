// main.js
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const path = require('path');
const PythonBridge = require('./python-bridge');

let mainWindow;
let pythonBridge;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        frame: false,
        transparent: true
    });

    mainWindow.maximize();
    mainWindow.loadFile('index.html');

    // Initialize Python bridge with mainWindow reference
    pythonBridge = new PythonBridge(mainWindow);
    pythonBridge.start();

    // Existing IPC handlers
    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('toggle-maximize-window', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
        mainWindow.webContents.send('window-state-changed', mainWindow.isMaximized());
    });

    ipcMain.on('close-window', () => {
        mainWindow.close();
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (pythonBridge) {
        pythonBridge.stop();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});