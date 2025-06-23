// chat.js

import { messageFormatter } from './message-formatter.js';
import ContextHandler from './context-handler.js';
import FileAttachmentHandler from './add-files.js';

// Use the exposed electron APIs instead of direct requires
const fs = window.electron?.fs?.promises;
const path = window.electron?.path;
const ipcRenderer = window.electron?.ipcRenderer;

let chatConfig = {
    memory: false,
    tasks: false,
    tools: {
        calculator: true,
        internet_search: true,
        python_assistant: true,
        investment_assistant: true,
        shell_tools: true,
        web_crawler: true,
        enable_github: true
    },
    deepsearch: false
};

let ongoingStreams = {};   // Tracks ongoing message streams.
let sessionActive = false;  // Flag to indicate if a chat session is active.
let contextHandler = null;  // Instance of the ContextHandler.
let fileAttachmentHandler = null; // Instance of the FileAttachmentHandler.
let connectionStatus = false; // Track connection status
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

/**
 * Set up IPC listeners for communication with python-bridge.js
 */
function setupIpcListeners() {
    // Listen for socket connection status updates
    ipcRenderer.on('socket-connection-status', (data) => {
        connectionStatus = data.connected;
        if (data.connected) {
            document.querySelectorAll('.connection-error').forEach(e => e.remove());
            sessionActive = false;
        } else {
            let statusMessage = 'Connecting to server...';

            if (data.error) {
                statusMessage = `Connection error: ${data.error}`;
                console.error('Connection error:', data.error);
            } else if (data.reconnecting) {
                statusMessage = `Reconnecting to server... (Attempt ${data.attempt}/${data.maxAttempts})`;
            }

            showConnectionError(statusMessage);

            // If we're having connection issues, auto-retry after 30 seconds
            if (data.error) {
                setTimeout(() => {
                    if (!connectionStatus) {
                        console.log('Auto-retrying connection...');
                        ipcRenderer.send('restart-python-bridge');
                    }
                }, 30000);
            }
        }
    });

    // Listen for chat responses from the Python backend
    ipcRenderer.on('chat-response', (data) => {
        try {
            if (!data) return;

            const isStreaming = data.streaming || false;
            const isDone = data.done || false;
            const messageId = data.id;

            // If this is a completion signal, make sure we clean up the UI
            if (isDone && messageId && ongoingStreams[messageId]) {
                const messageDiv = ongoingStreams[messageId];

                // Clear the timer
                if (messageDiv.timer) {
                    clearInterval(messageDiv.timer);
                }

                // Remove thinking indicator
                const thinkingIndicator = messageDiv.querySelector('.thinking-indicator');
                if (thinkingIndicator) {
                    thinkingIndicator.remove();
                }

                // Finish streaming and cleanup
                messageFormatter.finishStreaming(messageId);
                delete ongoingStreams[messageId];
            }

            if (isStreaming || data.content) {
                addMessage(data, false, isStreaming, messageId, isDone);
            }

            if (isDone || (!isStreaming && data.content)) {
                document.getElementById('floating-input').disabled = false;
                document.getElementById('send-message').disabled = false;
            }
        } catch (error) {
            console.error('Error handling response:', error);
            addMessage('Error processing response', false);
            document.getElementById('floating-input').disabled = false;
            document.getElementById('send-message').disabled = false;
        }
    });

    // Listen for errors from the socket connection
    ipcRenderer.on('socket-error', (error) => {
        console.error('Socket error:', error);
        
        try {
            // Add error message to the chat
        addMessage(error.message || 'An error occurred', false);
        showNotification(error.message || 'An error occurred. Starting new session.');
            
            // Safe DOM updates
            if (document.getElementById('floating-input')) {
        document.getElementById('floating-input').disabled = false;
            }
            
            if (document.getElementById('send-message')) {
        document.getElementById('send-message').disabled = false;
            }

        if (error.reset) {
            sessionActive = false;
                // Only try to add a new message if the button exists
                const addBtn = document.querySelector('.add-btn');
                if (addBtn) {
                    addBtn.click();
                }
            }
        } catch (e) {
            console.error('Error handling socket error:', e);
        }
    });

    // Listen for status messages from the Python backend
    ipcRenderer.on('socket-status', (data) => {
        console.log('Socket status:', data);
    });

    // Check initial connection status
    ipcRenderer.send('check-socket-connection');
}

/**
 * Displays a connection error message.
 */
function showConnectionError(message = 'Connecting to server...') {
    let errorDiv = document.querySelector('.connection-error');

    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        document.body.appendChild(errorDiv);
    }

    // Update the error message
    errorDiv.innerHTML = `
        <div class="connection-error-content">
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
            <button class="retry-connection">Retry Connection</button>
        </div>
    `;

    // Add retry button click handler
    errorDiv.querySelector('.retry-connection').addEventListener('click', () => {
        errorDiv.querySelector('span').textContent = 'Restarting connection...';
        ipcRenderer.send('restart-python-bridge');
    });
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

            // Add thinking indicator
            const thinkingIndicator = document.createElement('div');
            thinkingIndicator.className = 'thinking-indicator';
            thinkingIndicator.innerHTML = `
                <i class="fas fa-spinner"></i>
                <span>Thinking</span>
                <span class="timer">0s</span>
            `;
            messageDiv.appendChild(thinkingIndicator);

            // Add content container
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            messageDiv.appendChild(contentDiv);

            chatMessages.appendChild(messageDiv);
            ongoingStreams[messageId] = messageDiv;

            // Start timer
            let seconds = 0;
            const timer = setInterval(() => {
                seconds++;
                const timerSpan = messageDiv.querySelector('.timer');
                if (timerSpan) {
                    timerSpan.textContent = `${seconds}s`;
                }
            }, 1000);
            ongoingStreams[messageId].timer = timer;
        }

        if (typeof message === 'object' && message.content) {
            const contentDiv = messageDiv.querySelector('.message-content');
            if (contentDiv) {
                const formattedContent = messageFormatter.formatStreaming(message.content, messageId);
                contentDiv.innerHTML = formattedContent;

                if (contentDiv.querySelector('.mermaid')) {
                    mermaid.init(undefined, contentDiv.querySelectorAll('.mermaid'));
                }
            }
        }
    } else {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'message-user' : 'message-bot'}`;

        if (isUser) {
            messageDiv.textContent = message;
        } else if (typeof message === 'object' && message.content) {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = messageFormatter.format(message.content);
            messageDiv.appendChild(contentDiv);

            if (contentDiv.querySelector('.mermaid')) {
                mermaid.init(undefined, contentDiv.querySelectorAll('.mermaid'));
            }
        } else if (typeof message === 'string') {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = message;
            messageDiv.appendChild(contentDiv);
        }

        chatMessages.appendChild(messageDiv);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Handles sending a message to the server. Reads context files if needed.
 */
async function handleSendMessage() {
    const floatingInput = document.getElementById('floating-input');
    const message = floatingInput.value.trim();
    const sendMessageBtn = document.getElementById('send-message');

    if (!message && fileAttachmentHandler.getAttachedFiles().length === 0) {
        return; // Don't send empty messages without files
    }

    floatingInput.disabled = true;
    sendMessageBtn.disabled = true;

    // --- NEW: Authentication Check ---
    if (!window.electron || !window.electron.auth) {
        showNotification('Authentication service not available.', 'error');
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        return;
    }

    const session = await window.electron.auth.getSession();
    if (!session || !session.access_token) {
        showNotification('You must be logged in to send a message.', 'error');
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        return;
    }
    // --- END: Authentication Check ---

    if (!connectionStatus) {
        showNotification('Not connected to server. Please wait for connection...', 'error');
        ipcRenderer.send('restart-python-bridge');
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        return;
    }

    // Normal chat processing with Python backend
    const attachedFiles = fileAttachmentHandler.getAttachedFiles();

    if (message) {
        addMessage(message, true);
    }

    // Process files if any
    if (attachedFiles.length > 0) {
        // Show indication that files are being sent
        addMessage(`Sending ${attachedFiles.length} files...`, true);
    }

    const messageData = {
        message: message,
        id: Date.now().toString(),
        files: attachedFiles,
        is_deepsearch: chatConfig.deepsearch,
        accessToken: session.access_token // <-- SECURE TOKEN ADDED HERE
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
                const userContextPath = path.join(__dirname, '../user_context.txt');
                const taskListPath = path.join(__dirname, '../tasklist.txt');

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
        // Send message to python-bridge via IPC
        ipcRenderer.send('send-message', messageData);
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

    // Add DeepSearch checkbox to tools menu (Existing)
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

    // Initialize checkboxes based on initial state (Existing)
    const allToolsEnabledInitially = Object.values(chatConfig.tools).every(val => val === true);
    aiOsCheckbox.checked = allToolsEnabledInitially;
    deepSearchCheckbox.checked = chatConfig.deepsearch;

    // Make updateToolsIndicator available globally
    window.updateToolsIndicator = function() {
        const anyActive = aiOsCheckbox.checked || deepSearchCheckbox.checked;
        toolsBtn.classList.toggle('has-active', anyActive);
    };

    toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toolsBtn.classList.toggle('active');
        toolsMenu.classList.toggle('visible');
    });

    //Existing
    aiOsCheckbox.addEventListener('change', (e) => {
        const enableAll = e.target.checked;
        for (const key in chatConfig.tools) {
            chatConfig.tools[key] = enableAll;
        }
        if (enableAll) {
            deepSearchCheckbox.checked = false;
            chatConfig.deepsearch = false;
        }
        window.updateToolsIndicator();
        e.stopPropagation();
    });

    //Existing
    deepSearchCheckbox.addEventListener('change', (e) => {
        chatConfig.deepsearch = e.target.checked;
        if (e.target.checked) {
            aiOsCheckbox.checked = false;
            for (const key in chatConfig.tools) {
                chatConfig.tools[key] = false;
            }
        }
        window.updateToolsIndicator();
        e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
        if (!toolsBtn.contains(e.target)) {
            toolsBtn.classList.remove('active');
            toolsMenu.classList.remove('visible');
        }
    });

    window.updateToolsIndicator();
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
// --- MODIFIED FUNCTION ---
async function terminateSession() { // Make the function async
    sessionActive = false;
    ongoingStreams = {};
    chatConfig.deepsearch = false; // Reset DeepSearch state
    if (fileAttachmentHandler) {
        fileAttachmentHandler.clearAttachedFiles();
    }

    // --- NEW: Authenticated Termination Request ---
    // Get the session to prove the user is authorized to terminate it.
    const session = await window.electron.auth.getSession();
    if (!session || !session.access_token) {
        // If user is logged out, no need to tell the server.
        console.log("User is not logged in, terminating session locally.");
        return;
    }

    // Send termination request with the token via IPC
    ipcRenderer.send('terminate-session', {
        accessToken: session.access_token
    });
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
        // The HTML structure is already defined in chat.html
        // We just need to set up event listeners
        this.viewer.querySelector('.close-viewer-btn').addEventListener('click', () => {
            this.hideViewer();
        });

        // Set up tab switching
        const tabs = this.viewer.querySelectorAll('.viewer-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active class from all tabs
                tabs.forEach(t => t.classList.remove('active'));
                // Add active class to clicked tab
                tab.classList.add('active');

                // Show the corresponding tab content
                const tabId = tab.getAttribute('data-tab');
                this.viewer.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                this.viewer.querySelector(`#${tabId}-tab`).classList.add('active');
            });
        });

        // Update context indicator when files are attached or sessions are selected
        this.updateContextIndicator();
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
        this.updateContextIndicator();
    }

    updateContextContent() {
        const contextContent = this.viewer.querySelector('.context-preview-content');
        const sessions = this.contextHandler.getSelectedSessions();

        if (!sessions?.length) {
            contextContent.innerHTML = '<p class="empty-state">No context sessions selected</p>';
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
            filesContent.innerHTML = '<p class="empty-state">No files attached</p>';
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
                <div class="file-preview-content-item">${file.isMedia ? this.renderMediaPreview(file) : (file.content || "No preview available")}</div>
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

    renderMediaPreview(file) {
        if (file.mediaType === 'image') {
            return `<img src="${file.previewUrl}" alt="${file.name}" class="media-preview">
                   <p class="file-path-info">File path: ${file.path || "Path not available"}</p>`;
        } else if (file.mediaType === 'audio') {
            return `
                <audio controls class="media-preview">
                    <source src="${file.previewUrl}" type="${file.type}">
                    Your browser does not support the audio element.
                </audio>
                <p class="file-path-info">File path: ${file.path || "Path not available"}</p>
            `;
        } else if (file.mediaType === 'video') {
            return `
                <video controls class="media-preview">
                    <source src="${file.previewUrl}" type="${file.type}">
                    Your browser does not support the video element.
                </video>
                <p class="file-path-info">File path: ${file.path || "Path not available"}</p>
            `;
        } else if (file.mediaType === 'pdf') {
            return `
                <iframe src="${file.previewUrl}" class="pdf-preview"></iframe>
                <p class="file-path-info">File path: ${file.path || "Path not available"}</p>
            `;
        } else if (file.mediaType === 'document') {
            return `
                <div class="doc-preview">Document preview not available</div>
                <p class="file-path-info">File path: ${file.path || "Path not available"}</p>
            `;
        }
        return file.content || "No preview available";
    }

    updateContextIndicator() {
        const indicator = document.querySelector('.context-active-indicator');
        const badge = indicator.querySelector('.context-badge');

        const sessionCount = this.contextHandler?.getSelectedSessions()?.length || 0;
        const fileCount = this.fileAttachmentHandler?.getAttachedFiles()?.length || 0;
        const totalCount = sessionCount + fileCount;

        if (totalCount > 0) {
            indicator.classList.add('visible');
            if (totalCount > 1) {
                badge.textContent = totalCount;
                badge.classList.add('visible');
            } else {
                badge.classList.remove('visible');
            }
        } else {
            indicator.classList.remove('visible');
            badge.classList.remove('visible');
        }

        // Add click handler if not already added
        if (!indicator.hasClickHandler) {
            indicator.addEventListener('click', () => this.showViewer());
            indicator.hasClickHandler = true;
        }
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
    setupIpcListeners(); // Set up IPC communication
    initializeAutoExpandingTextarea();
    fileAttachmentHandler = new FileAttachmentHandler(null, supportedFileTypes, maxFileSize);
    window.unifiedPreviewHandler = new UnifiedPreviewHandler(contextHandler, fileAttachmentHandler);

    elements.sendBtn.addEventListener('click', handleSendMessage);

    elements.minimizeBtn?.addEventListener('click', () => {
        window.stateManager.setState({ isChatOpen: false });
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
                internet_search: true,
                python_assistant: true,
                investment_assistant: true,
                shell_tools: true,
                web_crawler: true,
                enable_github: true
            },
            deepsearch: false
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
}

// Remove CSS for error and status messages to the head - removing Browse AI styles
const style = document.createElement('style');
style.textContent = `
.error-message {
    color: var(--error-500);
    padding: 8px 12px;
    border-radius: 8px;
    background-color: var(--error-100);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.dark-mode .error-message {
    background-color: rgba(239, 68, 68, 0.2);
}
.status-message {
    color: var(--text-color);
    font-style: italic;
    opacity: 0.8;
    padding: 4px 8px;
    font-size: 0.9em;
    display: flex;
    align-items: center;
    gap: 8px;
}
`;
document.head.appendChild(style);

window.chatModule = { init };