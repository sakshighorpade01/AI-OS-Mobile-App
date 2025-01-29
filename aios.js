class AIOS {
    constructor() {
        this.initialized = false;
        this.currentTab = 'profile';
        this.elements = {};
        this.fs = require('fs');
        this.path = require('path');
        this.userDataPath = this.path.join(__dirname, 'userData');
        this.userData = this.loadUserData();
    }

    init() {
        if (this.initialized) return;

        // Create userData directory if it doesn't exist
        if (!this.fs.existsSync(this.userDataPath)) {
            this.fs.mkdirSync(this.userDataPath, { recursive: true });
        }

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
        try {
            const profilePath = this.path.join(this.userDataPath, 'profile.json');
            if (this.fs.existsSync(profilePath)) {
                const data = this.fs.readFileSync(profilePath, 'utf8');
                return {
                    ...JSON.parse(data),
                    account: { email: 'user@example.com' },
                    about: {
                        version: '1.0.0',
                        lastUpdate: new Date().toISOString()
                    }
                };
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }

        return {
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
        try {
            const profilePath = this.path.join(this.userDataPath, 'profile.json');
            const profileData = {
                profile: this.userData.profile,
                lastUpdate: new Date().toISOString()
            };
            
            this.fs.writeFileSync(
                profilePath,
                JSON.stringify(profileData, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving user data:', error);
            this.showErrorMessage('Failed to save profile data');
        }
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
    }

    handleSupportSubmit() {
        const formData = {
            subject: this.elements.subject?.value,
            description: this.elements.description?.value,
            timestamp: new Date().toISOString()
        };

        try {
            const feedbackPath = this.path.join(this.userDataPath, 'feedback.json');
            let feedbackHistory = [];
            
            if (this.fs.existsSync(feedbackPath)) {
                feedbackHistory = JSON.parse(this.fs.readFileSync(feedbackPath, 'utf8'));
            }
            
            feedbackHistory.push(formData);
            this.fs.writeFileSync(feedbackPath, JSON.stringify(feedbackHistory, null, 2), 'utf8');

            // Clear form
            if (this.elements.supportForm) {
                this.elements.supportForm.reset();
            }

            this.showSuccessMessage('Feedback submitted successfully');
        } catch (error) {
            console.error('Error saving feedback:', error);
            this.showErrorMessage('Failed to submit feedback');
        }
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
            try {
                // Delete all data files
                const profilePath = this.path.join(this.userDataPath, 'profile.json');
                const feedbackPath = this.path.join(this.userDataPath, 'feedback.json');

                if (this.fs.existsSync(profilePath)) {
                    this.fs.unlinkSync(profilePath);
                }
                if (this.fs.existsSync(feedbackPath)) {
                    this.fs.unlinkSync(feedbackPath);
                }
                
                sessionStorage.clear();
                
                this.userData = this.loadUserData(); // Reset to default
                this.loadSavedData(); // Reload UI with defaults
                
                this.showSuccessMessage('Account deleted successfully');
                this.hideWindow();
            } catch (error) {
                console.error('Error deleting account:', error);
                this.showErrorMessage('Failed to delete account data');
            }
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
                
                // Store file metadata
                const uploadPath = this.path.join(this.userDataPath, 'uploads.json');
                try {
                    let uploads = [];
                    if (this.fs.existsSync(uploadPath)) {
                        uploads = JSON.parse(this.fs.readFileSync(uploadPath, 'utf8'));
                    }
                    
                    uploads.push({
                        name: file.name,
                        type: fileExtension,
                        size: file.size,
                        timestamp: new Date().toISOString()
                    });
                    
                    this.fs.writeFileSync(uploadPath, JSON.stringify(uploads, null, 2), 'utf8');
                } catch (error) {
                    console.error('Error saving upload metadata:', error);
                }
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
            background-color: ${type === 'success' ? '#4CAF50' : '#f44336'};
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