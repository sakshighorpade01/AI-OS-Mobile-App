const { spawn } = require('child_process');
const path = require('path');

class BackendManager {
    constructor() {
        this.serverProcess = null;
        this.isServerRunning = false;
    }

    startBackend() {
        const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';


        const serverScript = path.join(__dirname, 'python-backend', 'server.py');

        try {
            this.serverProcess = spawn(pythonCommand, [serverScript]);
            this.isServerRunning = true;

            this.serverProcess.stdout.on('data', (data) => {
                console.log(`Backend output: ${data}`);
            });

            this.serverProcess.stderr.on('data', (data) => {
                console.error(`Backend error: ${data}`);
            });

            this.serverProcess.on('close', (code) => {
                console.log(`Backend process exited with code ${code}`);
                this.isServerRunning = false;
            });

            process.on('exit', () => {
                this.stopBackend();
            });

        } catch (error) {
            console.error('Failed to start backend:', error);
            throw error;
        }
    }

    stopBackend() {
        if (this.serverProcess && this.isServerRunning) {
            this.serverProcess.kill();
            this.isServerRunning = false;
        }
    }
}

class AIOS {
    constructor() {
        this.initialized = false;
        this.currentTab = 'profile';
        this.elements = {};
        this.userData = this.loadUserData();
        this.API_URL = 'http://localhost:5000/api';
        this.backendManager = new BackendManager();
    }

    async init() {
        if (this.initialized) return;

        try {
            // Start backend server
            await this.startBackendServer();

            this.cacheElements();
            this.setupEventListeners();
            this.loadSavedData();
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize AIOS:', error);
            this.showErrorMessage('Failed to start the application. Please check the console for details.');
        }
    }

    async startBackendServer() {
        try {
            this.backendManager.startBackend();
            
            // Wait for backend to be ready
            await this.waitForBackend();
            console.log('Backend server started successfully');
        } catch (error) {
            console.error('Failed to start backend server:', error);
            throw error;
        }
    }

    async waitForBackend(retries = 5) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(`${this.API_URL}/status`);
                if (response.ok) {
                    return true;
                }
            } catch (error) {
                if (i === retries - 1) {
                    throw new Error('Backend server failed to start');
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    cacheElements() {
        this.elements = {
            window: document.getElementById('floating-window'),
            closeBtn: document.getElementById('close-aios'),
            tabs: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),
            profileForm: document.getElementById('profile-form'),
            supportForm: document.getElementById('support-form'),
            logoutBtn: document.getElementById('logout-btn'),
            deleteAccountBtn: document.getElementById('delete-account-btn'),
            fullName: document.getElementById('fullName'),
            nickname: document.getElementById('nickname'),
            occupation: document.getElementById('occupation'),
            saveProfileBtn: document.getElementById('save-profile'),
            userEmail: document.getElementById('userEmail'),
            subject: document.getElementById('subject'),
            description: document.getElementById('description'),
            screenshot: document.getElementById('screenshot')
        };
    }

    setupEventListeners() {
        this.elements.closeBtn?.addEventListener('click', () => this.hideWindow());

        this.elements.tabs?.forEach(tab => {
            tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        this.elements.profileForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleProfileSubmit();
        });

        this.elements.supportForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSupportSubmit();
        });

        this.elements.logoutBtn?.addEventListener('click', () => this.handleLogout());

        this.elements.deleteAccountBtn?.addEventListener('click', () => this.handleDeleteAccount());

        this.elements.screenshot?.addEventListener('change', (e) => this.handleFileUpload(e));
    }

    loadUserData() {
        const savedData = localStorage.getItem('aiosUserData');
        return savedData ? JSON.parse(savedData) : {
            profile: {
                fullName: '',
                nickname: '',
                occupation: ''
            },
            account: {
                email: 'user@example.com'
            },
            about: {
                version: '1.0.0',
                lastUpdate: new Date().toISOString()
            }
        };
    }

    saveUserData() {
        localStorage.setItem('aiosUserData', JSON.stringify(this.userData));
    }

    loadSavedData() {
        if (this.elements.fullName) {
            this.elements.fullName.value = this.userData.profile.fullName;
        }
        if (this.elements.nickname) {
            this.elements.nickname.value = this.userData.profile.nickname;
        }
        if (this.elements.occupation) {
            this.elements.occupation.value = this.userData.profile.occupation;
        }
        if (this.elements.userEmail) {
            this.elements.userEmail.textContent = this.userData.account.email;
        }
    }

    async handleProfileSubmit() {
        const profileData = {
            fullName: this.elements.fullName?.value || '',
            nickname: this.elements.nickname?.value || '',
            occupation: this.elements.occupation?.value || ''
        };

        // Save to localStorage
        this.userData.profile = profileData;
        this.saveUserData();

        try {
            // Send to backend
            const response = await fetch(`${this.API_URL}/profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(profileData)
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || 'Failed to save profile to server');
            }

            this.showSuccessMessage('Profile saved successfully to both local storage and server');
        } catch (error) {
            console.error('Error saving profile to server:', error);
            this.showSuccessMessage('Profile saved locally but failed to save to server');
        }
    }

    handleSupportSubmit() {
        const formData = {
            subject: this.elements.subject?.value,
            description: this.elements.description?.value,
            timestamp: new Date().toISOString()
        };

        const feedbackHistory = JSON.parse(localStorage.getItem('aiosFeedback') || '[]');
        feedbackHistory.push(formData);
        localStorage.setItem('aiosFeedback', JSON.stringify(feedbackHistory));

        if (this.elements.supportForm) {
            this.elements.supportForm.reset();
        }

        this.showSuccessMessage('Feedback submitted successfully');
    }

    handleLogout() {
        if (confirm('Are you sure you want to log out? Your local data will be preserved.')) {
            sessionStorage.clear();
            this.showSuccessMessage('Logged out successfully');
            this.hideWindow();
        }
    }

    handleDeleteAccount() {
        if (confirm('Are you sure you want to delete your account? This will permanently remove all your data and cannot be undone.')) {
            localStorage.removeItem('aiosUserData');
            localStorage.removeItem('aiosFeedback');
            sessionStorage.clear();
            
            this.userData = this.loadUserData();
            this.loadSavedData();
            
            this.showSuccessMessage('Account deleted successfully');
            this.hideWindow();
        }
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file) {
            const validTypes = ['.jpg', '.png', '.gif', '.txt'];
            const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            
            if (validTypes.includes(fileExtension)) {
                if (fileExtension !== '.txt') {
                    this.createImagePreview(file);
                }
                
                this.userData.currentUpload = {
                    name: file.name,
                    type: fileExtension,
                    size: file.size,
                    timestamp: new Date().toISOString()
                };
                this.saveUserData();
            } else {
                alert('Invalid file type. Please upload .jpg, .png, .gif, or .txt files only.');
                event.target.value = '';
            }
        }
    }

    createImagePreview(file) {
        const reader = new FileReader();
        const previewContainer = document.createElement('div');
        previewContainer.className = 'screenshot-preview';
        
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.maxWidth = '200px';
            img.style.maxHeight = '200px';
            
            previewContainer.innerHTML = '';
            previewContainer.appendChild(img);
            
            const previewArea = document.querySelector('.screenshot-preview');
            if (previewArea) {
                previewArea.replaceWith(previewContainer);
            } else {
                this.elements.screenshot.parentNode.appendChild(previewContainer);
            }
        };
        
        reader.readAsDataURL(file);
    }

    switchTab(tabName) {
        this.elements.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        this.elements.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });

        this.currentTab = tabName;
    }

    showWindow() {
        this.elements.window?.classList.remove('hidden');
    }

    hideWindow() {
        this.elements.window?.classList.add('hidden');
    }

    showSuccessMessage(message) {
        this.showNotification(message, 'success');
    }

    showErrorMessage(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            background-color: ${type === 'success' ? '#4CAF50' : '#FF3B30'};
            color: white;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s;
        `;

        document.body.appendChild(notification);
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            setTimeout(() => {
                notification.style.opacity = '0';
                setTimeout(() => {
                    document.body.removeChild(notification);
                }, 300);
            }, 3000);
        });
    }
}

// Initialize AIOS
window.AIOS = new AIOS();
// Start the application
window.AIOS.init().catch(console.error);