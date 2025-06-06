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
                console.log('User from session:', this.user);
                this._notifyListeners();
            }
            
            // Set up auth state change listener
            this.supabase.auth.onAuthStateChange((event, session) => {
                console.log('Auth state changed:', event);
                this.user = session?.user || null;
                if (this.user) {
                    console.log('User metadata:', this.user.user_metadata);
                }
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

    // Sign up with email, password and name
    async signUp(email, password, name) {
        try {
            // First sign up the user
            const { data, error } = await this.supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        name: name
                    }
                }
            });
            
            if (error) throw error;
            
            // Check if we need to update the profile in the database
            if (data.user) {
                try {
                    // Insert or update the user's name in the profiles table
                    const { error: profileError } = await this.supabase
                        .from('profiles')
                        .upsert({ 
                            id: data.user.id,
                            email: email,
                            name: name
                        }, { 
                            onConflict: 'id' 
                        });
                        
                    if (profileError) {
                        console.error('Error updating profile:', profileError);
                    }
                } catch (profileUpdateError) {
                    console.error('Failed to update profile:', profileUpdateError);
                }
            }
            
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
            
            // If sign-in successful, fetch the user's profile to get the name
            if (data.user) {
                try {
                    const { data: profileData, error: profileError } = await this.supabase
                        .from('profiles')
                        .select('name')
                        .eq('id', data.user.id)
                        .single();
                        
                    if (profileError) {
                        console.error('Error fetching profile:', profileError);
                    } else if (profileData && profileData.name) {
                        // Update the user object with the name from profiles
                        data.user.user_metadata = data.user.user_metadata || {};
                        data.user.user_metadata.name = profileData.name;
                        this.user = data.user;
                        this._notifyListeners();
                    }
                } catch (profileFetchError) {
                    console.error('Failed to fetch profile:', profileFetchError);
                }
            }
            
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