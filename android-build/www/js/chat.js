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
    messageDiv.innerHTML = `<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>`;
    messagesContainer.appendChild(messageDiv);
    return messageDiv;
}

function populateBotMessage(data) {
    const { id, content, done, error, message } = data;
    const messageDiv = document.querySelector(`.bot-message[data-message-id="${id}"]`);
    if (!messageDiv) return;

    if (error) {
        messageDiv.innerHTML = `<div class="error-message">${content || message}</div>`;
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
        }
        sessionActive = false;
    }

    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function setupSocketListeners() {
    socketService.on('connect', () => console.log('Socket connected.'));
    socketService.on('disconnect', () => console.error('Socket disconnected.'));
    socketService.on('response', populateBotMessage);
    socketService.on('agent_step', (data) => console.log('Agent Step:', data));
    socketService.on('error', (err) => console.error('Socket error:', err));
}

// --- Public Module ---

export const chatModule = {
    /**
     * Initializes the chat module with external dependencies.
     * @param {object} contextHandlerInstance
     * @param {object} fileAttachmentHandlerInstance
     */
    init(contextHandlerInstance, fileAttachmentHandlerInstance) {
        contextHandler = contextHandlerInstance;
        fileAttachmentHandler = fileAttachmentHandlerInstance;

        socketService.init();
        setupSocketListeners();

        console.log('Chat module initialized with dependencies.');
    },

    /**
     * Sends a message with context, files, and config options.
     * @param {boolean} isMemoryEnabled
     * @param {string} agentType - either 'aios' or 'deepsearch'
     */
    async handleSendMessage(isMemoryEnabled = false, agentType = 'aios') {
        const input = document.getElementById('floating-input');
        const message = input.value.trim();
        const attachedFiles = fileAttachmentHandler.getAttachedFiles();

        if ((!message && attachedFiles.length === 0) || sessionActive) return;

        addUserMessage(message);
        input.value = '';
        input.style.height = 'auto';
        input.focus();

        const messageId = `msg_${Date.now()}`;
        createBotMessagePlaceholder(messageId);

        const payload = {
            id: messageId,
            message,
            context: JSON.stringify(contextHandler.getSelectedSessions()),
            files: attachedFiles,
            config: {}
        };

        if (!sessionActive) {
            payload.config = {
                calculator: true,
                internet_search: true,
                web_crawler: true,
                coding_assistant: true,
                investment_assistant: true,
                enable_github: true,
                enable_google_email: true,
                enable_google_drive: true,
                use_memory: isMemoryEnabled,
                is_deepsearch: agentType === 'deepsearch'
            };
        }

        sessionActive = true;

        try {
            await socketService.sendMessage(payload);
            fileAttachmentHandler.clearAttachedFiles();
            contextHandler.clearSelectedContext();
        } catch (err) {
            console.error("Failed to send message:", err);
            const errorMsgDiv = document.querySelector(`.bot-message[data-message-id="${messageId}"]`);
            if (errorMsgDiv) {
                errorMsgDiv.innerHTML = `<div class="error-message">Error: Could not connect to server.</div>`;
            }
            sessionActive = false;
        }
    },

    /**
     * Clears the chat messages and resets the session.
     */
    clearChat() {
        const messagesContainer = document.getElementById('chat-messages');
        // === REVERT TO THIS SIMPLER VERSION ===
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
        // ======================================

        if (sessionActive) {
            socketService.sendMessage({ type: 'terminate_session', message: 'User started new chat' });
            sessionActive = false;
        }

        messageFormatter.pendingContent?.clear?.();
    },

    /**
     * Displays a toast notification.
     * @param {string} message 
     * @param {'info'|'error'|'success'} type 
     */
    showNotification(message, type = 'info') {
        const container = document.querySelector('.notification-container');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        container.appendChild(notification);

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
};
