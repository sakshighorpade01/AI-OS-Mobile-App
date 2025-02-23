import { messageFormatter } from './message-formatter.js';
import ContextHandler from './context-handler.js';
import FileAttachmentHandler from './add-files.js';

const fs = require('fs').promises; 
const path = require('path');

let chatConfig = {
    memory: false,  
    tasks: false,    
    tools: {        
        calculator: true,
        ddg_search: true,
        python_assistant: true,
        investment_assistant: true,
        shell_tools: true,
        web_crawler: true
    },
    deepsearch: false
};

let socket = null;          // WebSocket connection.
let ongoingStreams = {};   // Tracks ongoing message streams.
let sessionActive = false;  // Flag to indicate if a chat session is active.
let contextHandler = null;  // Instance of the ContextHandler.
let fileAttachmentHandler = null; // Instance of the FileAttachmentHandler.

const maxFileSize = 10 * 1024 * 1024; // 10MB limit
const supportedFileTypes = {
    'txt': 'text/plain',
    'js': 'text/javascript',
    'py': 'text/x-python',
    'html': 'text/html',
    'css': 'text/css',
    'json': 'application/json',
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'c': 'text/x-c'
};  
function connectSocket() {
    socket = io('http://localhost:8765', {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ['websocket']
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        document.querySelectorAll('.connection-error').forEach(e => e.remove());
        sessionActive = false;
    });

    socket.on('response', (data) => {
        try {
            if (!data) return;

            const isStreaming = data.streaming || false;
            const isDone = data.done || false;
            const messageId = data.id;

            if (isStreaming || data.content) {
                addMessage(data, false, isStreaming, messageId, isDone);
            }

        } catch (error) {
            console.error('Error handling response:', error);
            addMessage('Error processing response', false);
            document.getElementById('floating-input').disabled = false;
            document.getElementById('send-message').disabled = false;
        }
    });

    socket.on('error', (error) => {
        console.error('Error:', error);
        addMessage(error.message || 'An error occurred', false);
        showNotification(error.message || 'An error occurred. Starting new session.');
        document.getElementById('floating-input').disabled = false;
        document.getElementById('send-message').disabled = false;

        if (error.reset) {
            sessionActive = false;
            document.querySelector('.add-btn').click();
        }
    });

    socket.on('disconnect', () => {
        sessionActive = false;
        if (!document.querySelector('.connection-error')) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'connection-error';
            errorDiv.textContent = 'Connecting to server...';
            document.body.appendChild(errorDiv);
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Connection Error:', error);
        sessionActive = false;
        showConnectionError();
    });
}

/**
 * Displays a connection error message.
 */
function showConnectionError() {
    if (!document.querySelector('.connection-error')) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        errorDiv.textContent = 'Connecting to server...';
        document.body.appendChild(errorDiv);
    }
}

/**
 * Adds a message to the chat interface.
 * @param {string|object} message - The message content.
 * @param {boolean} isUser - True if the message is from the user, false if from the bot.
 * @param {boolean} isStreaming - True if the message is part of a stream.
 * @param {string} [messageId] - Unique ID for streamed messages.
 * @param {boolean} [isDone] - True if the stream is complete.
 */
function addMessage(message, isUser, isStreaming = false, messageId = null, isDone = false) {
    const chatMessages = document.getElementById('chat-messages');
    const inputElement = document.getElementById('floating-input');
    const sendButton = document.getElementById('send-message');

    inputElement.disabled = false;
    sendButton.disabled = false;

    if (isStreaming && !isUser) {
        if (!messageId) return;

        let messageDiv = ongoingStreams[messageId];
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            messageDiv.className = 'message message-bot';
            chatMessages.appendChild(messageDiv);
            ongoingStreams[messageId] = messageDiv;
        }

        if (typeof message === 'object' && message.content) {
            const formattedContent = messageFormatter.formatStreaming(message.content, messageId);
            messageDiv.innerHTML = formattedContent;

            if (messageDiv.querySelector('.mermaid')) {
                mermaid.init(undefined, messageDiv.querySelectorAll('.mermaid'));
            }
        }

        if (isDone) {
            messageFormatter.finishStreaming(messageId);
            delete ongoingStreams[messageId];
        }
    } else {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'message-user' : 'message-bot'}`;

        if (isUser) {
            messageDiv.textContent = message;
        } else if (typeof message === 'object' && message.content) {
            messageDiv.innerHTML = messageFormatter.format(message.content);

            if (messageDiv.querySelector('.mermaid')) {
                mermaid.init(undefined, messageDiv.querySelectorAll('.mermaid'));
            }
        } else if (typeof message === 'string') {
            messageDiv.textContent = message;
        }

        chatMessages.appendChild(messageDiv);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Handles sending a message to the server.  Reads context files if needed.
 */
async function handleSendMessage() {
    const floatingInput = document.getElementById('floating-input');
    const sendMessageBtn = document.getElementById('send-message');
    const message = floatingInput.value.trim();
    const attachedFiles = fileAttachmentHandler.getAttachedFiles();

    if (!message && attachedFiles.length === 0) {
        return;
    }

    if (!socket?.connected) return;

    floatingInput.disabled = true;
    sendMessageBtn.disabled = true;

    if (message) {
        addMessage(message, true);
    }

    const messageData = {
        message: message,
        id: Date.now().toString(),
        files: attachedFiles,
        is_deepsearch: chatConfig.deepsearch // Add DeepSearch flag
    };

    if (!sessionActive) {
        messageData.config = {
            use_memory: chatConfig.memory,
            ...chatConfig.tools
        };

        let combinedContext = "";
        const selectedSessions = contextHandler.getSelectedSessions();
        
        if (selectedSessions && selectedSessions.length > 0) {
            const contextStr = selectedSessions.map(session => {
                if (!session.interactions || !session.interactions.length) return '';
                const formattedInteractions = session.interactions.map(interaction => {
                    return `User: ${interaction.user_input}\nAssistant: ${interaction.llm_output}`;
                }).join('\n\n');
                return formattedInteractions;
            }).filter(Boolean).join('\n---\n');

            if (contextStr) {
                combinedContext += contextStr + "\n---\n";
            }
        }

        if (chatConfig.tasks) {
            try {
                const userContextPath = path.join(__dirname, 'user_context.txt');
                const taskListPath = path.join(__dirname, 'tasklist.txt');

                const userContextContent = await fs.readFile(userContextPath, 'utf8');
                const taskListContent = await fs.readFile(taskListPath, 'utf8');

                combinedContext += `User Context:\n${userContextContent}\n---\n`;
                combinedContext += `Task List:\n${taskListContent}\n---\n`;
            } catch (error) {
                console.error("Error reading user context or task list:", error);
                showNotification("Error reading context files. Check console.", "error");
            }
        }
        
        if (combinedContext) {
            messageData.context = combinedContext;
        }
        sessionActive = true;
    }

    try {
        console.log('Sending message with data:', messageData);
        socket.emit('send_message', JSON.stringify(messageData));
        fileAttachmentHandler.clearAttachedFiles();
    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('Error sending message', false);
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
    }

    floatingInput.value = '';
    floatingInput.style.height = 'auto';
}


/**
 * Initializes the tools menu and its behavior.
 */
function initializeToolsMenu() {
    const toolsBtn = document.querySelector('[data-tool="tools"]');
    const toolsMenu = toolsBtn.querySelector('.tools-menu');
    const aiOsCheckbox = document.getElementById('ai_os');
    
    // Add DeepSearch checkbox to tools menu
    const deepSearchDiv = document.createElement('div');
    deepSearchDiv.className = 'tool-item';
    deepSearchDiv.innerHTML = `
        <input type="checkbox" id="deep_search" />
        <label for="deep_search">
            <i class="fa-solid fa-magnifying-glass"></i>
            DeepSearch
        </label>
    `;
    toolsMenu.appendChild(deepSearchDiv);
    
    const deepSearchCheckbox = document.getElementById('deep_search');

    // Initialize checkboxes based on initial state
    const allToolsEnabledInitially = Object.values(chatConfig.tools).every(val => val === true);
    aiOsCheckbox.checked = allToolsEnabledInitially;
    deepSearchCheckbox.checked = chatConfig.deepsearch;

    const updateToolsIndicator = () => {
        const anyActive = aiOsCheckbox.checked || deepSearchCheckbox.checked;
        toolsBtn.classList.toggle('has-active', anyActive);
    };

    toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toolsBtn.classList.toggle('active');
        toolsMenu.classList.toggle('visible');
    });

    aiOsCheckbox.addEventListener('change', (e) => {
        const enableAll = e.target.checked;
        for (const key in chatConfig.tools) {
            chatConfig.tools[key] = enableAll;
        }
        updateToolsIndicator();
        e.stopPropagation();
    });

    deepSearchCheckbox.addEventListener('change', (e) => {
        chatConfig.deepsearch = e.target.checked;
        updateToolsIndicator();
        e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
        if (!toolsBtn.contains(e.target)) {
            toolsBtn.classList.remove('active');
            toolsMenu.classList.remove('visible');
        }
    });

    updateToolsIndicator();
}


/**
 * Handles toggling the memory feature on and off.
 */
function handleMemoryToggle() {
    const memoryBtn = document.querySelector('[data-tool="memory"]');
    memoryBtn.addEventListener('click', () => {
        chatConfig.memory = !chatConfig.memory;
        memoryBtn.classList.toggle('active', chatConfig.memory);
    });
}

/**
 * Handles toggling the tasks context feature on and off.
 */
function handleTasksToggle() {
    const tasksBtn = document.querySelector('[data-tool="tasks"]');
    tasksBtn.addEventListener('click', () => {
        chatConfig.tasks = !chatConfig.tasks;
        tasksBtn.classList.toggle('active', chatConfig.tasks);
    });
}

/**
 * Terminates the current chat session.
 */
function terminateSession() {
    sessionActive = false;
    ongoingStreams = {};
    chatConfig.deepsearch = false; // Reset DeepSearch state
    if (fileAttachmentHandler) {
        fileAttachmentHandler.clearAttachedFiles();
    }

    if (socket?.connected) {
        socket.emit('send_message', JSON.stringify({
            type: 'terminate_session'
        }));
    }
}

/**
 * Initializes the auto-expanding behavior of the input textarea.
 */
function initializeAutoExpandingTextarea() {
    const textarea = document.getElementById('floating-input');

    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
}

/**
 * Displays a notification message.
 * @param {string} message - The message to display.
 * @param {string} [type='error'] - The type of notification ('error', 'success', etc.).
 * @param {number} [duration=10000] - How long to show the notification (in milliseconds).
 */
function showNotification(message, type = 'error', duration = 10000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;

    const icon = document.createElement('i');
    icon.className = type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-info-circle';

    const textDiv = document.createElement('div');
    textDiv.className = 'notification-text';
    textDiv.textContent = message;

    notification.appendChild(icon);
    notification.appendChild(textDiv);

    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }

    container.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 100);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
            if (container.children.length === 0) {
                container.remove();
            }
        }, 300);
    }, duration);
}

/**
 * Manages the unified preview of selected context and attached files.
 */
class UnifiedPreviewHandler {
    constructor(contextHandler, fileAttachmentHandler) {
        this.contextHandler = contextHandler;
        this.fileAttachmentHandler = fileAttachmentHandler;
        this.viewer = document.getElementById('selected-context-viewer');
        this.initializeViewer();
    }

    initializeViewer() {
        // Update viewer HTML structure
        this.viewer.innerHTML = `
            <div class="context-viewer-header">
                <h3>Selected Content Preview</h3>
                <button class="close-viewer-btn">×</button>
            </div>
            <div class="context-viewer-content">
                <div class="preview-section context-section">
                    <h4>Selected Context Sessions</h4>
                    <div class="context-preview-content"></div>
                </div>
                <div class="preview-section files-section">
                    <h4>Attached Files</h4>
                    <div class="files-preview-content"></div>
                </div>
            </div>
        `;

        this.viewer.querySelector('.close-viewer-btn').addEventListener('click', () => {
            this.hideViewer();
        });
    }

    showViewer() {
        this.updateContent();
        this.viewer.classList.add('visible');
    }

    hideViewer() {
        this.viewer.classList.remove('visible');
    }

    updateContent() {
        this.updateContextContent();
        this.updateFilesContent();
    }

    updateContextContent() {
        const contextContent = this.viewer.querySelector('.context-preview-content');
        const sessions = this.contextHandler.getSelectedSessions();

        if (!sessions?.length) {
            contextContent.innerHTML = '<p>No context sessions selected</p>';
            return;
        }

        contextContent.innerHTML = sessions.map((session, index) => `
            <div class="session-block">
                <h4>Session ${index + 1}</h4>
                ${session.interactions.map(int => `
                    <div class="interaction">
                        <div class="user-message"><strong>User:</strong> ${int.user_input}</div>
                        <div class="assistant-message"><strong>Assistant:</strong> ${int.llm_output}</div>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    updateFilesContent() {
        const filesContent = this.viewer.querySelector('.files-preview-content');
        const files = this.fileAttachmentHandler.getAttachedFiles();

        if (!files?.length) {
            filesContent.innerHTML = '<p>No files attached</p>';
            return;
        }

        filesContent.innerHTML = files.map((file, index) => `
            <div class="file-preview-item">
                <div class="file-preview-header-item">
                    <div class="file-info">
                        <i class="${this.fileAttachmentHandler.getFileIcon(file.name)} file-icon"></i>
                        <span class="file-name">${file.name}</span>
                    </div>
                    <div class="file-actions">
                        <button class="preview-toggle" title="Toggle Preview">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="remove-file" title="Remove File">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="file-preview-content-item">${file.content}</div>
            </div>
        `).join('');

        // Add event listeners for file actions
        filesContent.querySelectorAll('.file-preview-item').forEach((item, index) => {
            item.querySelector('.preview-toggle').addEventListener('click', () => {
                item.querySelector('.file-preview-content-item').classList.toggle('visible');
            });

            item.querySelector('.remove-file').addEventListener('click', () => {
                this.fileAttachmentHandler.removeFile(index);
                this.updateContent();
            });
        });
    }
}

/**
 * Initializes the chat module.
 */
function init() {
    const elements = {
        container: document.getElementById('chat-container'),
        messages: document.getElementById('chat-messages'),
        input: document.getElementById('floating-input'),
        sendBtn: document.getElementById('send-message'),
        minimizeBtn: document.getElementById('minimize-chat'),
        newChatBtn: document.querySelector('.add-btn'),
        attachBtn: document.getElementById('attach-file-btn')
    };

    contextHandler = new ContextHandler();

    initializeToolsMenu();
    handleMemoryToggle();
    handleTasksToggle(); // Initialize the Tasks button
    connectSocket();
    initializeAutoExpandingTextarea();  
    fileAttachmentHandler = new FileAttachmentHandler(socket, supportedFileTypes, maxFileSize);
    window.unifiedPreviewHandler = new UnifiedPreviewHandler(contextHandler, fileAttachmentHandler);

    elements.sendBtn.addEventListener('click', handleSendMessage);

    elements.minimizeBtn?.addEventListener('click', () => {
        window.stateManager.setState({ isChatOpen: false });
    });

    elements.attachBtn.addEventListener('click', () => {
        fileAttachmentHandler.fileInput.click(); // Directly trigger fileInput
    });

    elements.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    elements.newChatBtn.addEventListener('click', () => {
        terminateSession();
        const chatMessages = document.getElementById('chat-messages');
        const inputElement = document.getElementById('floating-input');
        const sendButton = document.getElementById('send-message');

        chatMessages.innerHTML = '';
        inputElement.disabled = false;
        sendButton.disabled = false;

        sessionActive = false;
        ongoingStreams = {};
        contextHandler.clearSelectedContext();

        chatConfig = {
            memory: false,
            tasks: false, // Reset tasks to false
            tools: {  // Reset tools to their default state
                calculator: true,
                ddg_search: true,
                python_assistant: true,
                investment_assistant: true,
                shell_tools: true,
                web_crawler: true
            }
        };
        // Reset the AI-OS checkbox
        document.getElementById('ai_os').checked = true;
        //reset tasks
        document.querySelector('[data-tool="tasks"]').classList.remove('active');
        document.getElementById('deep_search').checked = false;

        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        document.querySelectorAll('.connection-error').forEach(e => e.remove());
        sessionActive = false;

        elements.input.disabled = false;
        elements.sendBtn.disabled = false;
    });

    socket.on('error', (error) => {
        console.error('Error:', error);
        showNotification(error.message || 'An error occurred. Starting new session.');

        elements.input.disabled = false;
        elements.sendBtn.disabled = false;

        if (error.reset) {
            sessionActive = false;
            contextHandler.clearSelectedContext();
            document.querySelector('.add-btn').click();
        }
    });
}

window.chatModule = { init };