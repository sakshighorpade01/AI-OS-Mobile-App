import { messageFormatter } from './message-formatter.js';
import ContextHandler from './context-handler.js';
import FileAttachmentHandler from './add-files.js';
import { socketService } from './socket-service.js';

let chatConfig = {};
let ongoingStreams = {};
let sessionActive = false;
let contextHandler = null;
let fileAttachmentHandler = null;
let connectionStatus = false;
let chatElements = {};

function setupSocketListeners() {
    socketService.on('connect', () => {
        connectionStatus = true;
        console.log("Socket connection established.");
    });

    socketService.on('disconnect', () => {
        connectionStatus = false;
        showConnectionError("Connection lost. Please check your internet and refresh.");
    });

    socketService.on('response', (data) => {
        populateBotMessage(data);
    });
    
    socketService.on('agent_step', (data) => {
        console.log('Agent Step:', data);
    });

    socketService.on('error', (error) => {
        showConnectionError(error.message || 'An unknown error occurred.');
    });
}

function showConnectionError(message) {
    console.error("Connection Error:", message);
    alert(message);
}

function addUserMessage(message) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.innerHTML = messageFormatter.format(message);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createBotMessagePlaceholder(messageId) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    messageDiv.dataset.messageId = messageId;
    messageDiv.innerHTML = `<div class="bot-avatar"><i class="fas fa-robot"></i></div><div class="message-content"><span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></div>`;
    messagesContainer.appendChild(messageDiv);
    return messageDiv;
}

function populateBotMessage(data) {
    const { id, content, done, error } = data;
    let messageDiv = document.querySelector(`.bot-message[data-message-id="${id}"]`);
    if (!messageDiv) return;

    const contentDiv = messageDiv.querySelector('.message-content');
    if (error) {
        contentDiv.innerHTML = `<div class="error-message">${content || data.message}</div>`;
        messageFormatter.finishStreaming(id);
        sessionActive = false;
        return;
    }

    if (content) {
        const formattedContent = messageFormatter.formatStreaming(content, id);
        contentDiv.innerHTML = formattedContent;
    }

    if (done) {
        messageFormatter.finishStreaming(id);
        sessionActive = false;
    }
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function handleSendMessage() {
    const input = document.getElementById('floating-input');
    const message = input.value.trim();
    if (!message && fileAttachmentHandler.getAttachedFiles().length === 0) return;

    addUserMessage(message);
    input.value = '';
    input.style.height = 'auto';

    const messageId = `msg_${new Date().getTime()}`;
    createBotMessagePlaceholder(messageId);
    sessionActive = true;

    const payload = {
        id: messageId,
        message: message,
        context: JSON.stringify(contextHandler.getSelectedSessions()),
        files: fileAttachmentHandler.getAttachedFiles(),
        config: {
            calculator: true,
            internet_search: true,
            web_crawler: true,
            coding_assistant: true,
            investment_assistant: true,
            use_memory: true,
            enable_github: true,
            enable_google_email: true,
            enable_google_drive: true,
        }
    };

    await socketService.sendMessage(payload);

    fileAttachmentHandler.clearAttachedFiles();
    contextHandler.clearSelectedContext();
}

function init() {
    chatElements.container = document.getElementById('chat-container');
    chatElements.inputContainer = document.getElementById('floating-input-container');

    const sendBtn = document.getElementById('send-message');
    const input = document.getElementById('floating-input');
    
    sendBtn?.addEventListener('click', handleSendMessage);
    input?.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } });
    
    contextHandler = new ContextHandler();
    fileAttachmentHandler = new FileAttachmentHandler();

    socketService.init();
    setupSocketListeners();
}

function toggleChatWindow() {
    const isOpen = !chatElements.container.classList.contains('hidden');
    chatElements.container?.classList.toggle('hidden', isOpen);
    chatElements.inputContainer?.classList.toggle('hidden', isOpen);
}

export const chatModule = { 
    init,
    toggleWindow: toggleChatWindow
};