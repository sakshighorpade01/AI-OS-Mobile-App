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
            fullName: document.getElementById('fullName'),
            nickname: document.getElementById('nickname'),
            occupation: document.getElementById('occupation'),
            userEmail: document.getElementById('userEmail'),
            subject: document.getElementById('subject'),
            description: document.getElementById('description'),
            screenshot: document.getElementById('screenshot')
        };
    }

    setupEventListeners() {
      const addClickHandler = (element, handler) => {
            element?.addEventListener('click', handler);
        };

        addClickHandler(this.elements.closeBtn, () => this.hideWindow());

        this.elements.tabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        this.elements.profileForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleProfileSubmit();
        });

        this.elements.supportForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSupportSubmit();
        });
        addClickHandler(this.elements.logoutBtn, () => this.handleLogout());
        addClickHandler(this.elements.deleteAccountBtn, () => this.handleDeleteAccount());


        this.elements.screenshot?.addEventListener('change', (e) => this.handleFileUpload(e));
    }

    loadUserData() {
      const defaultData = {
          profile: { fullName: '', nickname: '', occupation: '' },
          account: { email: 'user@example.com' },
          about: { version: '1.0.0', lastUpdate: new Date().toISOString() }
      };
      try {
          const profilePath = this.path.join(this.userDataPath, 'profile.json');
          return this.fs.existsSync(profilePath)
              ? { ...defaultData, ...JSON.parse(this.fs.readFileSync(profilePath, 'utf8')) }
              : defaultData;
      } catch (error) {
          console.error('Error loading user data:', error);
          return defaultData; // Always return default data on error
      }
    }

    saveUserData() {
        try {
            const profilePath = this.path.join(this.userDataPath, 'profile.json');
            const profileData = {
                profile: this.userData.profile,
                lastUpdate: new Date().toISOString()
            };
            this.fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving user data:', error);
            this.showNotification('Failed to save profile data', 'error');
        }
    }

    loadSavedData() {
      ['fullName', 'nickname', 'occupation'].forEach(field => {
        if (this.elements[field]) {
            this.elements[field].value = this.userData.profile[field] || '';
        }
      });
      if (this.elements.userEmail) {
          this.elements.userEmail.textContent = this.userData.account.email || 'user@example.com';
      }
    }

    handleProfileSubmit() {
        this.userData.profile = {
            fullName: this.elements.fullName?.value || '',
            nickname: this.elements.nickname?.value || '',
            occupation: this.elements.occupation?.value || ''
        };
        this.saveUserData();
        this.showNotification('Profile saved successfully', 'success');
    }

    handleSupportSubmit() {
        const formData = {
            subject: this.elements.subject?.value,
            description: this.elements.description?.value,
            timestamp: new Date().toISOString()
        };

        try {
            const feedbackPath = this.path.join(this.userDataPath, 'feedback.json');
            const feedbackHistory = this.fs.existsSync(feedbackPath) ? JSON.parse(this.fs.readFileSync(feedbackPath, 'utf8')) : [];
            feedbackHistory.push(formData);
            this.fs.writeFileSync(feedbackPath, JSON.stringify(feedbackHistory, null, 2), 'utf8');
            this.elements.supportForm?.reset();
            this.showNotification('Feedback submitted successfully', 'success');
        } catch (error) {
            console.error('Error saving feedback:', error);
            this.showNotification('Failed to submit feedback', 'error');
        }
    }

    handleLogout() {
        if (confirm('Are you sure you want to log out?')) {
            sessionStorage.clear();
            this.showNotification('Logged out successfully', 'success');
            this.hideWindow();
        }
    }

    handleDeleteAccount() {
        if (confirm('Delete your account? This is irreversible!')) {
            try {
                ['profile.json', 'feedback.json'].forEach(file => {
                    const filePath = this.path.join(this.userDataPath, file);
                    if (this.fs.existsSync(filePath)) {
                        this.fs.unlinkSync(filePath);
                    }
                });
                sessionStorage.clear();
                this.userData = this.loadUserData();
                this.loadSavedData();
                this.showNotification('Account deleted successfully', 'success');
                this.hideWindow();
            } catch (error) {
                console.error('Error deleting account:', error);
                this.showNotification('Failed to delete account', 'error');
            }
        }
    }
    handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const validTypes = ['.jpg', '.png', '.gif', '.txt'];
      const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

      if (!validTypes.includes(fileExtension)) {
          alert('Invalid file type. Please upload .jpg, .png, .gif, or .txt files only.');
          event.target.value = '';
          return;
      }

      if (fileExtension !== '.txt') {
          this.createImagePreview(file);
      }

      try {
            const uploadPath = this.path.join(this.userDataPath, 'uploads.json');
            const uploads = this.fs.existsSync(uploadPath)
                ? JSON.parse(this.fs.readFileSync(uploadPath, 'utf8'))
                : [];

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
        this.elements.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
        this.elements.tabContents.forEach(content => content.classList.toggle('active', content.id === `${tabName}-tab`));
        this.currentTab = tabName;
    }

    showWindow() {
        this.elements.window?.classList.remove('hidden');
    }

    hideWindow() {
        this.elements.window?.classList.add('hidden');
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 12px 24px;
            background-color: ${type === 'success' ? '#4CAF50' : '#f44336'}; color: white;
            border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10000; opacity: 0; transition: opacity 0.3s;
        `;

        document.body.appendChild(notification);
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            setTimeout(() => {
                notification.style.opacity = '0';
                setTimeout(() => document.body.removeChild(notification), 300);
            }, 3000);
        });
    }
}

window.AIOS = new AIOS();