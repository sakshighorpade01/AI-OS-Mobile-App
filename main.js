// main.js (Updated)
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
            enableRemoteModule: true,
            webSecurity: false
        },
        frame: true,
        transparent: true
    });

    mainWindow.maximize();
    mainWindow.loadFile('index.html');

    pythonBridge = new PythonBridge(mainWindow);
    pythonBridge.start();

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

    ipcMain.on('deepsearch-request', (event, data) => {
        pythonBridge.sendMessage(data);
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