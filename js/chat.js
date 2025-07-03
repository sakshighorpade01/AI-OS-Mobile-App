import { messageFormatter } from './message-formatter.js';
import { socketService } from './socket-service.js';

let sessionActive = false;
// FIX: Remove the direct instantiation from here. These will be passed in.
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
     * Initializes the chat module with its dependencies.
     * @param {object} contextHandlerInstance - The shared context handler instance.
     * @param {object} fileAttachmentHandlerInstance - The shared file attachment handler.
     */
    init(contextHandlerInstance, fileAttachmentHandlerInstance) {
        // FIX: Receive dependencies from the main script AFTER the DOM is ready.
        contextHandler = contextHandlerInstance;
        fileAttachmentHandler = fileAttachmentHandlerInstance;
        
        socketService.init();
        setupSocketListeners();
        console.log('Chat module initialized with dependencies.');
    },

    async handleSendMessage() {
        const input = document.getElementById('floating-input');
        const message = input.value.trim();
        const attachedFiles = fileAttachmentHandler.getAttachedFiles();

        if ((!message && attachedFiles.length === 0) || sessionActive) {
            return;
        }

        addUserMessage(message);
        input.value = '';
        input.style.height = 'auto'; 
        input.focus();

        const messageId = `msg_${Date.now()}`;
        createBotMessagePlaceholder(messageId);
        sessionActive = true;

        const payload = {
            id: messageId,
            message,
            context: JSON.stringify(contextHandler.getSelectedSessions()),
            files: attachedFiles,
            config: { /* your config object */ }
        };

        try {
            // FIX: This call will now work because contextHandler is correctly initialized.
            await socketService.sendMessage(payload);
            fileAttachmentHandler.clearAttachedFiles();
            contextHandler.clearSelectedContext();
        } catch(err) {
            console.error("Failed to send message:", err);
            const errorMsgDiv = document.querySelector(`.bot-message[data-message-id="${messageId}"]`);
            if(errorMsgDiv) {
                errorMsgDiv.innerHTML = `<div class="error-message">Error: Could not connect to server.</div>`;
            }
            sessionActive = false;
        }
    },

    clearChat() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) messagesContainer.innerHTML = '';

        if (sessionActive) {
            socketService.sendMessage({ type: 'terminate_session', message: 'User started new chat' });
            sessionActive = false;
        }
        messageFormatter.pendingContent?.clear?.();
    }
};