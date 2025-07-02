import { supabase } from './supabase-client.js';

export class AIOS {
    constructor() {
        this.initialized = false;
        this.currentTab = 'profile';
        this.elements = {};
        this.userData = null; 
    }

    async init() {
        if (this.initialized) return;
        
        this.userData = this.loadUserData();
        
        this.cacheElements();
        this.setupEventListeners();
        this.loadSavedData();
        this.updateAuthUI();
        this.initialized = true;
    }

    cacheElements() {
        this.elements = {
            window: document.getElementById('floating-window'),
            closeBtn: document.getElementById('close-aios'),
            tabs: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),
            profileForm: document.getElementById('profile-form'),
            logoutBtn: document.getElementById('logout-btn'),
            userEmail: document.getElementById('userEmail'),
            userName: document.getElementById('userName'),
            accountLoggedOut: document.getElementById('account-logged-out'),
            accountLoggedIn: document.getElementById('account-logged-in'),
            authTabs: document.querySelectorAll('.auth-tab-btn'),
            loginForm: document.getElementById('login-form'),
            signupForm: document.getElementById('signup-form'),
            loginError: document.getElementById('login-error'),
            signupError: document.getElementById('signup-error'),
        };
    }

    setupEventListeners() {
        this.elements.closeBtn?.addEventListener('click', () => this.hideWindow());

        this.elements.tabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        this.elements.profileForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleProfileSubmit();
        });
        
        this.elements.logoutBtn?.addEventListener('click', () => this.handleLogout());
        
        this.elements.authTabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.authTab));
        });
        
        this.elements.loginForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
        
        this.elements.signupForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSignup();
        });
        
        supabase.auth.onAuthStateChange((event, session) => {
            this.updateAuthUI(session?.user);
        });
    }

    async handleLogin() {
        const email = this.elements.loginForm.querySelector('#loginEmail').value;
        const password = this.elements.loginForm.querySelector('#loginPassword').value;
        this.elements.loginError.textContent = '';

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            this.elements.loginError.textContent = error.message;
        } else {
            this.showNotification('Logged in successfully!', 'success');
            this.elements.loginForm.reset();
        }
    }

    async handleSignup() {
        const name = this.elements.signupForm.querySelector('#signupName').value;
        const email = this.elements.signupForm.querySelector('#signupEmail').value;
        const password = this.elements.signupForm.querySelector('#signupPassword').value;
        const confirmPassword = this.elements.signupForm.querySelector('#confirmPassword').value;
        this.elements.signupError.textContent = '';

        if (password !== confirmPassword) {
            this.elements.signupError.textContent = 'Passwords do not match.';
            return;
        }

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } }
        });

        if (error) {
            this.elements.signupError.textContent = error.message;
        } else {
            this.showNotification('Signup successful! Please check your email.', 'success');
            this.elements.signupForm.reset();
            this.switchAuthTab('login');
        }
    }

    async handleLogout() {
        if (confirm('Are you sure you want to log out?')) {
            const { error } = await supabase.auth.signOut();
            if (error) {
                this.showNotification(`Logout failed: ${error.message}`, 'error');
            } else {
                this.showNotification('Logged out successfully.', 'success');
            }
        }
    }

    async updateAuthUI(user) {
        if (!user) {
            const { data } = await supabase.auth.getSession();
            user = data.session?.user;
        }

        const isAuthenticated = !!user;
        
        this.elements.accountLoggedIn.classList.toggle('hidden', !isAuthenticated);
        this.elements.accountLoggedOut.classList.toggle('hidden', isAuthenticated);
        
        if (isAuthenticated) {
            this.elements.userEmail.textContent = user.email;
            this.elements.userName.textContent = user.user_metadata?.name || 'User';
        }
    }

    loadUserData() {
        const data = localStorage.getItem('aios_userData');
        return data ? JSON.parse(data) : { profile: {}, account: {}, about: {} };
    }

    saveUserData() {
        localStorage.setItem('aios_userData', JSON.stringify(this.userData));
    }
    
    loadSavedData() {
        // This can be adapted to load from this.userData
    }
    
    handleProfileSubmit() {
        this.showNotification('Profile saved successfully', 'success');
    }

    switchTab(tabName) {
        this.elements.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
        this.elements.tabContents.forEach(content => content.classList.toggle('active', content.id === `${tabName}-tab`));
        this.currentTab = tabName;
    }
    
    switchAuthTab(tabName) {
        this.elements.authTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.authTab === tabName));
        
        const loginForm = this.elements.loginForm;
        const signupForm = this.elements.signupForm;

        if (tabName === 'login') {
            loginForm?.classList.add('active');
            signupForm?.classList.remove('active');
        } else {
            loginForm?.classList.remove('active');
            signupForm?.classList.add('active');
        }
    }
    
    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 10);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    hideWindow() {
        this.elements.window?.classList.add('hidden');
    }

    toggleWindow() {
        this.elements.window?.classList.toggle('hidden');
    }
}