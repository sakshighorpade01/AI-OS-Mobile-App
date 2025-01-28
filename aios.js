class AIOS {
    constructor() {
        this.initialized = false;
        this.currentTab = 'profile';
        this.elements = {};
        this.userData = this.loadUserData();
    }

    init() {
        if (this.initialized) return;

        this.cacheElements();
        this.setupEventListeners();
        this.loadSavedData();
        this.initialized = true;
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
            // Profile elements
            fullName: document.getElementById('fullName'),
            nickname: document.getElementById('nickname'),
            occupation: document.getElementById('occupation'),
            saveProfileBtn: document.getElementById('save-profile'),
            userEmail: document.getElementById('userEmail'),
            // Support elements
            subject: document.getElementById('subject'),
            description: document.getElementById('description'),
            screenshot: document.getElementById('screenshot')
        };
    }

    setupEventListeners() {
        // Close button
        this.elements.closeBtn?.addEventListener('click', () => {
            this.hideWindow();
        });

        // Tab switching
        this.elements.tabs?.forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Profile form submission
        this.elements.profileForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleProfileSubmit();
        });

        // Support form submission
        this.elements.supportForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSupportSubmit();
        });

        // Account actions
        this.elements.logoutBtn?.addEventListener('click', () => {
            this.handleLogout();
        });

        this.elements.deleteAccountBtn?.addEventListener('click', () => {
            this.handleDeleteAccount();
        });

        // Screenshot upload handling
        if (this.elements.screenshot) {
            this.elements.screenshot.addEventListener('change', (e) => {
                this.handleFileUpload(e);
            });
        }
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
        // Load profile data
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

    handleProfileSubmit() {
        // Save profile data only when form is submitted
        this.userData.profile = {
            fullName: this.elements.fullName?.value || '',
            nickname: this.elements.nickname?.value || '',
            occupation: this.elements.occupation?.value || ''
        };
        
        this.saveUserData();
        this.showSuccessMessage('Profile saved successfully');
        // Window remains open - removed hideWindow() call
    }

    handleSupportSubmit() {
        const formData = {
            subject: this.elements.subject?.value,
            description: this.elements.description?.value,
            timestamp: new Date().toISOString()
        };

        // Store feedback in localStorage
        const feedbackHistory = JSON.parse(localStorage.getItem('aiosFeedback') || '[]');
        feedbackHistory.push(formData);
        localStorage.setItem('aiosFeedback', JSON.stringify(feedbackHistory));

        // Clear form
        if (this.elements.supportForm) {
            this.elements.supportForm.reset();
        }

        this.showSuccessMessage('Feedback submitted successfully');
        // Window remains open - removed hideWindow() call
    }

    handleLogout() {
        if (confirm('Are you sure you want to log out? Your local data will be preserved.')) {
            // Preserve local data but clear session data
            sessionStorage.clear();
            this.showSuccessMessage('Logged out successfully');
            this.hideWindow();
        }
    }

    handleDeleteAccount() {
        if (confirm('Are you sure you want to delete your account? This will permanently remove all your data and cannot be undone.')) {
            // Clear all stored data
            localStorage.removeItem('aiosUserData');
            localStorage.removeItem('aiosFeedback');
            sessionStorage.clear();
            
            this.userData = this.loadUserData(); // Reset to default
            this.loadSavedData(); // Reload UI with defaults
            
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
                // Create preview if it's an image
                if (fileExtension !== '.txt') {
                    this.createImagePreview(file);
                }
                
                // Store file reference
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
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            background-color: #4CAF50;
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