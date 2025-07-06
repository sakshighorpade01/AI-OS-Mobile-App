// js/chat.js (PWA/Mobile Version)

import { messageFormatter } from './message-formatter.js';
import { socketService } from './socket-service.js';

let sessionActive = false;
let contextHandler = null;
let fileAttachmentHandler = null;

// --- Private Functions ---

function addUserMessage(message) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    // Use the formatter to render potential markdown in user input
    messageDiv.innerHTML = messageFormatter.format(message);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createBotMessagePlaceholder(messageId) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    messageDiv.dataset.messageId = messageId;
    messageDiv.innerHTML = `<div class="loading-dots"><span>.</span><span>.</span><span>.</span></div>`;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return messageDiv;
}

function updateBotMessage(data) {
    const { id, content, done, error, message } = data;
    // Find the correct message placeholder by its ID
    const messageDiv = document.querySelector(`.bot-message[data-message-id="${id}"]`);
    if (!messageDiv) return;

    if (error) {
        const errorMessage = content || message || 'An unknown error occurred.';
        messageDiv.innerHTML = `<div class="error-message">${messageFormatter.format(errorMessage)}</div>`;
        messageFormatter.finishStreaming(id);
        sessionActive = false; // End the session on error
        return;
    }

    if (content) {
        // Stream the content into the message div
        messageDiv.innerHTML = messageFormatter.formatStreaming(content, id);
    }

    if (done) {
        // Finalize the content and clean up the stream
        const finalContent = messageFormatter.finishStreaming(id);
        if (finalContent) {
            messageDiv.innerHTML = finalContent;
        } else if (messageDiv.innerHTML.includes('loading-dots')) {
            // If the message is done but has no content (e.g., just a tool call), remove the placeholder
            messageDiv.remove();
        }
        sessionActive = false; // The bot is done, a new message can be sent
    }

    // Auto-scroll to the bottom
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function setupSocketListeners() {
    socketService.on('connect', () => {
        console.log('Socket connected successfully.');
        chatModule.showNotification('Connected to AI server', 'success');
    });
    socketService.on('disconnect', () => {
        console.error('Socket disconnected.');
        chatModule.showNotification('Connection lost. Attempting to reconnect...', 'error');
    });
    socketService.on('response', updateBotMessage);
    socketService.on('agent_step', (data) => {
        // This can be expanded to show tool usage indicators
        console.log('Agent Step:', data);
    });
    socketService.on('error', (err) => {
        console.error('Socket error:', err);
        chatModule.showNotification(err.message || 'A server error occurred.', 'error');
        sessionActive = false; // Reset session on critical error
    });
}

// --- Public Module ---

export const chatModule = {
    /**
     * Initializes the chat module and its dependencies.
     */
    init(contextHandlerInstance, fileAttachmentHandlerInstance) {
        contextHandler = contextHandlerInstance;
        fileAttachmentHandler = fileAttachmentHandlerInstance;

        // Initialize and set up listeners for the socket service
        socketService.init();
        setupSocketListeners();

        console.log('Chat module initialized for PWA.');
    },

    /**
     * Handles sending the user's message to the backend.
     */
    async handleSendMessage(isMemoryEnabled = false, agentType = 'aios') {
        const input = document.getElementById('floating-input');
        const message = input.value.trim();
        const attachedFiles = fileAttachmentHandler.getAttachedFiles();

        if ((!message && attachedFiles.length === 0) || sessionActive) {
            if (sessionActive) {
                this.showNotification("Please wait for the current response to finish.", "warning");
            }
            return;
        }
        
        sessionActive = true;

        if (message) {
            addUserMessage(message);
        }

        // Clear the input and reset its height
        input.value = '';
        input.style.height = 'auto';
        input.focus();

        const messageId = `msg_${Date.now()}`;
        createBotMessagePlaceholder(messageId);

        // Construct the payload exactly as the backend expects it
        const payload = {
            id: messageId,
            message: message,
            context: JSON.stringify(contextHandler.getSelectedSessions()),
            files: attachedFiles.map(f => ({ name: f.name, type: f.type, path: f.path, content: f.content, isText: f.isText })),
            config: {
                calculator: true,
                internet_search: true,
                web_crawler: true,
                coding_assistant: true,
                investment_assistant: true,
                enable_github: true,
                enable_google_email: true,
                enable_google_drive: true,
                use_memory: isMemoryEnabled,
            },
            is_deepsearch: agentType === 'deepsearch'
        };

        try {
            // Use the socketService to send the message
            await socketService.sendMessage(payload);
            // Clean up UI after successful send
            fileAttachmentHandler.clearAttachedFiles();
            contextHandler.clearSelectedContext();
        } catch (err) {
            console.error("Failed to send message:", err);
            // Display the error in the chat window
            const errorMsgDiv = document.querySelector(`.bot-message[data-message-id="${messageId}"]`);
            if (errorMsgDiv) {
                errorMsgDiv.innerHTML = `<div class="error-message"><strong>Error:</strong> ${err.message}</div>`;
            }
            sessionActive = false; // Allow user to try again
        }
    },

    /**
     * Clears the chat UI and terminates the session on the backend.
     */
    clearChat() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }

        if (sessionActive) {
            try {
                // Send a terminate message to the backend to clean up resources
                socketService.sendMessage({ type: 'terminate_session', message: 'User started a new chat' });
            } catch (e) {
                console.warn("Could not send terminate message, socket may be disconnected.", e.message);
            }
        }
        sessionActive = false;

        // Clear any pending message streams
        messageFormatter.pendingContent.clear();
    },

    /**
     * Displays a toast notification to the user.
     */
    showNotification(message, type = 'info', duration = 3000) {
        const container = document.querySelector('.notification-container');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        container.appendChild(notification);

        // Animate the notification in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Animate the notification out after a delay
        setTimeout(() => {
            notification.classList.remove('show');
            notification.addEventListener('transitionend', () => notification.remove());
        }, duration);
    }
};