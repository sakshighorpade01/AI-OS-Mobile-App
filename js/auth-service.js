const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

class AuthService {
    constructor() {
        // Initialize with empty values - will be set in init()
        this.supabase = null;
        this.user = null;
        this.listeners = [];
    }

    async init() {
        try {
            // Create Supabase client
            this.supabase = createClient(
                config.supabase.url,
                config.supabase.anonKey
            );
            
            // Check for existing session
            const { data } = await this.supabase.auth.getSession();
            if (data.session) {
                this.user = data.session.user;
                this._notifyListeners();
            }
            
            // Set up auth state change listener
            this.supabase.auth.onAuthStateChange((event, session) => {
                this.user = session?.user || null;
                this._notifyListeners();
            });
            
            return true;
        } catch (error) {
            console.error('Failed to initialize auth service:', error);
            return false;
        }
    }

    // Add listener for auth state changes
    onAuthChange(callback) {
        this.listeners.push(callback);
        // Immediately notify with current state
        if (callback && typeof callback === 'function') {
            callback(this.user);
        }
        return () => {
            this.listeners = this.listeners.filter(listener => listener !== callback);
        };
    }

    // Notify all listeners of auth state change
    _notifyListeners() {
        this.listeners.forEach(listener => {
            if (listener && typeof listener === 'function') {
                listener(this.user);
            }
        });
    }

    // Sign up with email and password
    async signUp(email, password) {
        try {
            const { data, error } = await this.supabase.auth.signUp({
                email,
                password
            });
            
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }

    // Sign in with email and password
    async signIn(email, password) {
        try {
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email,
                password
            });
            
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    // Sign out
    async signOut() {
        try {
            const { error } = await this.supabase.auth.signOut();
            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    }

    // Get current user
    getCurrentUser() {
        return this.user;
    }

    // Check if user is authenticated
    isAuthenticated() {
        return !!this.user;
    }
}

// Create singleton instance
const authService = new AuthService();

module.exports = authService; 