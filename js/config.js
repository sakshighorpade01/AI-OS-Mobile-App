/**
 * Configuration for the AI-OS application
 */
const config = {
    // Backend connection settings
    backend: {
        // URL for the Python backend running in Docker
        url: 'https://ai-os-yjbb.onrender.com',
        
        // Maximum number of reconnection attempts
        maxReconnectAttempts: 50,
        
        // Delay between reconnection attempts (in milliseconds)
        reconnectDelay: 20000,
        
        // Connection timeout (in milliseconds)
        connectionTimeout: 20000
    }
};

module.exports = config; 