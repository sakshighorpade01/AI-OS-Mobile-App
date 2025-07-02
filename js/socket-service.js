// This service replaces the need for python-bridge.js and ipcRenderer for chat.
import { supabase } from './supabase-client.js';

// The backend URL from your config.js, hardcoded for simplicity in PWA
const BACKEND_URL = 'https://ai-os-yjbb.onrender.com'; 
let socket = null;

// Store callbacks for different events
const eventListeners = {
    'response': [],
    'agent_step': [],
    'error': [],
    'status': [],
    'connect': [],
    'disconnect': []
};

function setupSocketHandlers() {
    socket.on('connect', () => {
        console.log('Successfully connected to backend socket server.');
        emitEvent('connect');
    });

    socket.on('disconnect', () => {
        console.warn('Disconnected from backend socket server.');
        emitEvent('disconnect');
    });

    socket.on('response', (data) => emitEvent('response', data));
    socket.on('agent_step', (data) => emitEvent('agent_step', data));
    socket.on('error', (data) => emitEvent('error', data));
    socket.on('status', (data) => emitEvent('status', data));
}

function emitEvent(eventName, data) {
    if (eventListeners[eventName]) {
        eventListeners[eventName].forEach(callback => callback(data));
    }
}

export const socketService = {
    init: () => {
        if (socket && socket.connected) {
            return;
        }
        // The 'io' function is available globally from the script in index.html
        socket = io(BACKEND_URL, {
            transports: ['websocket'],
            reconnection: true,
        });
        setupSocketHandlers();
    },

    sendMessage: async (messagePayload) => {
        if (!socket || !socket.connected) {
            console.error('Socket not connected. Cannot send message.');
            alert('Not connected to the server. Please refresh and try again.');
            return;
        }

        // Get the access token from Supabase to authenticate the request
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            alert('You are not logged in. Please log in to chat.');
            return;
        }
        
        // Add the access token to the payload
        const authenticatedPayload = {
            ...messagePayload,
            accessToken: session.access_token
        };
        
        // The backend expects a JSON string
        socket.emit('send_message', JSON.stringify(authenticatedPayload));
    },

    // Function to allow other modules to listen for events
    on: (eventName, callback) => {
        if (eventListeners[eventName]) {
            eventListeners[eventName].push(callback);
        }
    },

    disconnect: () => {
        if (socket) {
            socket.disconnect();
        }
    }
};