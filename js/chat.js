// js/chat.js (PWA/Mobile Version)

import { messageFormatter } from './message-formatter.js';
import { socketService } from './socket-service.js';

let sessionActive = false;
let contextHandler = null;
let fileAttachmentHandler = null;
let contextViewer = null; // To hold the viewer instance

// Map to store context for each message
const sentContexts = new Map();

// --- Private Functions ---

function addUserMessage(message, files = [], sessions = []) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    const messageId = `user_msg_${Date.now()}`;
    const wrapperDiv = document.createElement('div');
    wrapperDiv.className = 'message-wrapper user-message-wrapper';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.innerHTML = messageFormatter.format(message);
    
    wrapperDiv.appendChild(messageDiv);

    // Store the context data regardless of whether it's empty
    sentContexts.set(messageId, { files, sessions });

    const contextButton = document.createElement('button');
    contextButton.className = 'user-message-context-button';
    
    const fileCount = files.length;
    const sessionCount = sessions.length;
    let buttonText = 'Context'; // Default text

    if (sessionCount > 0 && fileCount > 0) {
        buttonText = `Context: ${sessionCount} session & ${fileCount} file(s)`;
    } else if (sessionCount > 0) {
        buttonText = `Context: ${sessionCount} session(s)`;
    } else if (fileCount > 0) {
        buttonText = `Context: ${fileCount} file(s)`;
    }
    
    contextButton.innerHTML = `<i class="fas fa-paperclip"></i> ${buttonText}`;
    contextButton.dataset.contextId = messageId;

    contextButton.addEventListener('click', () => {
        const contextData = sentContexts.get(messageId);
        if (contextViewer && contextData) {
            contextViewer.show(contextData);
        }
    });

    wrapperDiv.appendChild(contextButton);

    messagesContainer.appendChild(wrapperDiv);
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
    const messageDiv = document.querySelector(`.bot-message[data-message-id="${id}"]`);
    if (!messageDiv) return;

    if (error) {
        const errorMessage = content || message || 'An unknown error occurred.';
        messageDiv.innerHTML = `<div class="error-message">${messageFormatter.format(errorMessage)}</div>`;
        messageFormatter.finishStreaming(id);
        sessionActive = false;
        return;
    }

    if (content) {
        messageDiv.innerHTML = messageFormatter.formatStreaming(content, id);
    }

    if (done) {
        const finalContent = messageFormatter.finishStreaming(id);
        if (finalContent) {
            messageDiv.innerHTML = finalContent;
        } else if (messageDiv.innerHTML.includes('loading-dots')) {
            messageDiv.remove();
        }
        sessionActive = false;
    }

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
        console.log('Agent Step:', data);
    });
    socketService.on('error', (err) => {
        console.error('Socket error:', err);
        chatModule.showNotification(err.message || 'A server error occurred.', 'error');
        sessionActive = false;
    });
}

// --- Public Module ---

export const chatModule = {
    init(contextHandlerInstance, fileAttachmentHandlerInstance, contextViewerInstance) {
        contextHandler = contextHandlerInstance;
        fileAttachmentHandler = fileAttachmentHandlerInstance;
        contextViewer = contextViewerInstance;

        socketService.init();
        setupSocketListeners();

        console.log('Chat module initialized for PWA.');
    },

    async handleSendMessage(isMemoryEnabled = false, agentType = 'aios') {
        const input = document.getElementById('floating-input');
        const message = input.value.trim();
        
        // ★★★ FIX: Correctly copy file objects to preserve the previewUrl ★★★
        const attachedFiles = fileAttachmentHandler.getAttachedFiles().map(f => ({ ...f }));
        const selectedSessions = JSON.parse(JSON.stringify(contextHandler.getSelectedSessions()));

        if ((!message && attachedFiles.length === 0) || sessionActive) {
            if (sessionActive) {
                this.showNotification("Please wait for the current response to finish.", "warning");
            }
            return;
        }
        
        sessionActive = true;

        if (message) {
            addUserMessage(message, attachedFiles, selectedSessions);
        }

        input.value = '';
        input.style.height = 'auto';
        input.focus();

        const messageId = `msg_${Date.now()}`;
        createBotMessagePlaceholder(messageId);

        const payload = {
            id: messageId,
            message: message,
            context: JSON.stringify(selectedSessions),
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
            await socketService.sendMessage(payload);
            fileAttachmentHandler.clearAttachedFiles();
            contextHandler.clearSelectedContext();
        } catch (err) {
            console.error("Failed to send message:", err);
            const errorMsgDiv = document.querySelector(`.bot-message[data-message-id="${messageId}"]`);
            if (errorMsgDiv) {
                errorMsgDiv.innerHTML = `<div class="error-message"><strong>Error:</strong> ${err.message}</div>`;
            }
            sessionActive = false;
        }
    },

    clearChat() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
        if (sessionActive) {
            try {
                socketService.sendMessage({ type: 'terminate_session', message: 'User started a new chat' });
            } catch (e) {
                console.warn("Could not send terminate message, socket may be disconnected.", e.message);
            }
        }
        sessionActive = false;
        messageFormatter.pendingContent.clear();
    },

    showNotification(message, type = 'info', duration = 3000) {
        const container = document.querySelector('.notification-container');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        container.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        setTimeout(() => {
            notification.classList.remove('show');
            notification.addEventListener('transitionend', () => notification.remove());
        }, duration);
    }
};