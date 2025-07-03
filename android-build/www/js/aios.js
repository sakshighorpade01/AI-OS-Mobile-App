import { supabase } from './supabase-client.js';

export class AIOS {
    constructor() {
        this.initialized = false;
        this.currentTab = 'profile';
        this.elements = {};
    }

    async init() {
        if (this.initialized) return;

        this.cacheElements();
        this.setupEventListeners();
        this.updateThemeUI(); // 🎨 Apply theme on first load

        await this.updateAuthUI();
        this.initialized = true;
    }

    cacheElements() {
        this.elements = {
            // Sidebar and Overlay
            sidebar: document.getElementById('sidebar-container'),
            overlay: document.getElementById('sidebar-overlay'),

            // Settings Panel
            settingsView: document.getElementById('settings-view'),
            closeBtn: document.getElementById('close-aios'),

            // Tabs
            tabs: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),

            // Auth
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

            // 🌗 Theme buttons
            themeOptions: document.querySelectorAll('.theme-option'),
        };
    }

    setupEventListeners() {
        // --- Sidebar Controls ---
        this.elements.closeBtn?.addEventListener('click', () => this.closeSidebar());
        this.elements.overlay?.addEventListener('click', () => this.closeSidebar());

        // --- Tabs ---
        this.elements.tabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // --- Auth Form Handlers ---
        this.elements.logoutBtn?.addEventListener('click', () => this.handleLogout());

        this.elements.loginForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        this.elements.signupForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSignup();
        });

        this.elements.authTabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.authTab));
        });

        // 🌗 Theme Toggle
        this.elements.themeOptions?.forEach(option => {
            option.addEventListener('click', () => {
                const theme = option.dataset.theme;
                this.setTheme(theme);
            });
        });

        // 🔐 Listen to Supabase auth changes
        supabase.auth.onAuthStateChange((_event, session) => {
            this.updateAuthUI(session?.user);
        });
    }

    // 🌗 Set body class for selected theme
    setTheme(theme) {
        document.body.classList.remove('light-mode', 'dark-mode');
        document.body.classList.add(`${theme}-mode`);
        this.updateThemeUI();
    }

    // 🌗 Highlight active theme button
    updateThemeUI() {
        const isDarkMode = document.body.classList.contains('dark-mode');
        this.elements.themeOptions?.forEach(option => {
            const theme = option.dataset.theme;
            const isActive = (isDarkMode && theme === 'dark') || (!isDarkMode && theme === 'light');
            option.classList.toggle('active', isActive);
        });
    }

    // 🔄 Switch between tabs
    switchTab(tabName) {
        this.elements.tabs?.forEach(tab =>
            tab.classList.toggle('active', tab.dataset.tab === tabName)
        );
        this.elements.tabContents?.forEach(content =>
            content.classList.toggle('active', content.id === `${tabName}-tab`)
        );
    }

    // 🔁 Switch between login/signup
    switchAuthTab(tabName) {
        this.elements.authTabs?.forEach(tab =>
            tab.classList.toggle('active', tab.dataset.authTab === tabName)
        );
        this.elements.loginForm?.classList.toggle('active', tabName === 'login');
        this.elements.signupForm?.classList.toggle('active', tabName === 'signup');
    }

    openSidebar() {
        this.elements.sidebar?.classList.add('open');
        this.elements.overlay?.classList.add('open');
    }

    closeSidebar() {
        this.elements.sidebar?.classList.remove('open');
        this.elements.overlay?.classList.remove('open');
    }

    async handleLogin() {
        const email = this.elements.loginForm.querySelector('#loginEmail').value;
        const password = this.elements.loginForm.querySelector('#loginPassword').value;
        this.elements.loginError.textContent = '';

        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            this.elements.loginError.textContent = error.message;
        } else {
            this.showNotification('Logged in successfully!', 'success');
            this.elements.loginForm.reset();
            this.closeSidebar();
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

        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { name }
            }
        });

        if (error) {
            this.elements.signupError.textContent = error.message;
        } else {
            this.showNotification('Signup successful! Please check your email to verify.', 'success');
            this.elements.signupForm.reset();
            this.switchAuthTab('login');
        }
    }

    async handleLogout() {
        if (confirm('Are you sure you want to log out?')) {
            await supabase.auth.signOut();
            this.showNotification('Logged out successfully.', 'success');
        }
    }

    async updateAuthUI(user) {
        const isAuthenticated = !!user;
        this.elements.accountLoggedIn?.classList.toggle('hidden', !isAuthenticated);
        this.elements.accountLoggedOut?.classList.toggle('hidden', isAuthenticated);

        if (isAuthenticated) {
            this.elements.userEmail.textContent = user.email;
            this.elements.userName.textContent = user.user_metadata?.name || 'User';
        }
    }

    showNotification(message, type = 'success') {
        const container = document.querySelector('.notification-container');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        container.appendChild(notification);

        // Animate
        setTimeout(() => {
            notification.style.transform = 'translateY(0)';
            notification.style.opacity = '1';
        }, 10);
        setTimeout(() => {
            notification.style.transform = 'translateY(20px)';
            notification.style.opacity = '0';
            notification.addEventListener('transitionend', () => notification.remove());
        }, 3000);
    }
}
