// chat.js
import { messageFormatter } from './message-formatter.js';

let chatConfig = {
    memory: false,
    tools: {
        calculator: true,
        ddg_search: true,
        python_assistant: true,
        investment_assistant: true,
        shell_tools: true,
        web_crawler: true
    }
};

let socket = null;
let ongoingStreams = {};
let sessionActive = false;

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
        console.log('Raw response:', data); 
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
        // Reset UI and start new chat if needed
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

function showConnectionError() {
    if (!document.querySelector('.connection-error')) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        errorDiv.textContent = 'Connecting to server...';
        document.body.appendChild(errorDiv);
    }
}

function addMessage(message, isUser, isStreaming = false, messageId = null, isDone = false) {
    const chatMessages = document.getElementById('chat-messages');
    const inputElement = document.getElementById('floating-input');
    const sendButton = document.getElementById('send-message');
    
    // Always ensure input is enabled when adding new messages
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

function onSendMessage(data) {
    try {
        const messageData = {
            message: data.message,
            config: !sessionActive ? {
                use_memory: chatConfig.memory,
                ...chatConfig.tools
            } : undefined,
            id: data.id
        };

        // Add selected context if available
        if (window.selectedContextSessions?.length > 0) {
            messageData.context = window.selectedContextSessions.map(session => ({
                interactions: session.interactions
            }));
        }

        socket.emit('send_message', JSON.stringify(messageData));
    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('Error sending message', false);
    }
}


function handleSendMessage() {
    const floatingInput = document.getElementById('floating-input');
    const sendMessageBtn = document.getElementById('send-message');
    const message = floatingInput.value.trim();
    
    if (!message || !socket?.connected) return;
    
    floatingInput.disabled = true;
    sendMessageBtn.disabled = true;
    
    addMessage(message, true);
    
    // Create the base message data
    const messageData = {
        message: message,
        id: Date.now().toString()
    };

    // Add configuration for new sessions
    if (!sessionActive) {
        messageData.config = {
            use_memory: chatConfig.memory,
            ...chatConfig.tools
        };
        sessionActive = true;
    }

    // Add selected context if available
    if (window.selectedContextSessions?.length > 0) {
        messageData.context = window.selectedContextSessions.map(session => ({
            interactions: session.interactions.map(interaction => ({
                user_input: interaction.user_input,
                llm_output: interaction.llm_output
            }))
        }));
        console.log('Sending message with context:', messageData); // Debug log
    }

    try {
        socket.emit('send_message', JSON.stringify(messageData));
    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('Error sending message', false);
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
    }
    
    floatingInput.value = '';
    floatingInput.style.height = 'auto';
}

function initializeToolsMenu() {
    const toolsBtn = document.querySelector('[data-tool="tools"]');
    const toolsMenu = toolsBtn.querySelector('.tools-menu');
    const checkboxes = toolsMenu.querySelectorAll('input[type="checkbox"]');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = chatConfig.tools[checkbox.id] || false;
    });

    const updateToolsIndicator = () => {
        const anyActive = Array.from(checkboxes).some(c => c.checked);
        toolsBtn.classList.toggle('has-active', anyActive);
    };

    toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toolsBtn.classList.toggle('active');
        toolsMenu.classList.toggle('visible');
    });

    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            chatConfig.tools[e.target.id] = e.target.checked;
            updateToolsIndicator();
            e.stopPropagation();
        });
    });

    document.addEventListener('click', (e) => {
        if (!toolsBtn.contains(e.target)) {
            toolsBtn.classList.remove('active');
            toolsMenu.classList.remove('visible');
        }
    });

    updateToolsIndicator();
}

function handleMemoryToggle() {
    const memoryBtn = document.querySelector('[data-tool="memory"]');
    memoryBtn.addEventListener('click', () => {
        chatConfig.memory = !chatConfig.memory;
        memoryBtn.classList.toggle('active', chatConfig.memory);
    });
}

function terminateSession() {
    sessionActive = false;
    ongoingStreams = {};
    
    if (socket?.connected) {
        socket.emit('send_message', JSON.stringify({
            type: 'terminate_session'
        }));
    }
}

function initializeAutoExpandingTextarea() {
    const textarea = document.getElementById('floating-input');
    
    textarea.addEventListener('input', function() {
        // Reset height to auto to get correct scrollHeight
        this.style.height = 'auto';
        // Set new height based on scrollHeight
        this.style.height = (this.scrollHeight) + 'px';
    });
}

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
    
    // Add to notification container or create if doesn't exist
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    
    container.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    // Remove after duration
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

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function syncSessions() {
    // Adjust the command if you need to use 'python3' instead of 'python'
    const pythonProcess = spawn('python', ['python-backend/context_manager.py']);
    
    pythonProcess.stdout.on('data', (data) => {
        console.log(`Sync stdout: ${data}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
        console.error(`Sync stderr: ${data}`);
    });
    
    pythonProcess.on('close', (code) => {
        console.log(`Sync process exited with code ${code}`);
        // Optionally notify the user of a successful sync
        showNotification('Sessions synced successfully!', 'info', 3000);
        // Optionally reload sessions
        loadSessions();
    });
}


function loadSessions() {
    const contextPath = path.join(__dirname, 'context');
    const sessionsContainer = document.querySelector('.context-content');
    
    sessionsContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    sessionsContainer.innerHTML = '';

    try {
        if (!fs.existsSync(contextPath)) {
            console.error('Context directory does not exist');
            sessionsContainer.innerHTML = '<div class="session-item">No sessions directory found</div>';
            return;
        }

        const files = fs.readdirSync(contextPath)
            .filter(file => file.endsWith('.json'))
            .sort((a, b) => {
                return fs.statSync(path.join(contextPath, b)).mtime.getTime() - 
                       fs.statSync(path.join(contextPath, a)).mtime.getTime();
            });
        
        if (files.length === 0) {
            sessionsContainer.innerHTML = '<div class="session-item">No sessions found</div>';
            return;
        }

        // Add header with selection controls
        const selectionHeader = document.createElement('div');
        selectionHeader.className = 'selection-controls';
        selectionHeader.innerHTML = `
            <div class="selection-actions hidden">
                <span class="selected-count">0 selected</span>
                <button class="use-selected-btn">Use Selected</button>
                <button class="clear-selection-btn">Clear</button>
            </div>
        `;
        sessionsContainer.appendChild(selectionHeader);

        files.forEach(file => {
            try {
                const filePath = path.join(contextPath, file);
                const data = fs.readFileSync(filePath, 'utf8');
                const session = JSON.parse(data);
                
                const sessionItem = document.createElement('div');
                sessionItem.className = 'session-item';
                sessionItem.dataset.filepath = filePath;
                
                const sessionName = file.replace('.json', '')
                                      .split('_')
                                      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                      .join(' ');
                
                const creationDate = new Date(session.created_at || fs.statSync(filePath).mtime);
                const formattedDate = creationDate.toLocaleDateString() + ' ' + 
                                    creationDate.toLocaleTimeString();
                
                sessionItem.innerHTML = `
                    <div class="session-select">
                        <input type="checkbox" class="session-checkbox" />
                    </div>
                    <div class="session-content">
                        <h3>${sessionName}</h3>
                        <div class="session-meta">
                            <div class="meta-item">
                                <i class="far fa-clock"></i>
                                <span>${formattedDate}</span>
                            </div>
                            <div class="meta-item">
                                <i class="far fa-comments"></i>
                                <span>${session.interactions?.length || 0} messages</span>
                            </div>
                        </div>
                    </div>
                `;
                
                const checkbox = sessionItem.querySelector('.session-checkbox');
                const contentArea = sessionItem.querySelector('.session-content');
                
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    sessionItem.classList.toggle('selected', checkbox.checked);
                    updateSelectionUI();
                });
                
                contentArea.onclick = () => showSessionDetails(filePath);
                sessionsContainer.appendChild(sessionItem);
            } catch (err) {
                console.error(`Error loading session ${file}:`, err);
            }
        });

        // Initialize selection controls
        initializeSelectionControls();
    } catch (err) {
        console.error('Error loading sessions:', err);
        sessionsContainer.innerHTML = '<div class="session-item">Error loading sessions</div>';
    }
}

function initializeSelectionControls() {
    const selectionActions = document.querySelector('.selection-actions');
    const clearBtn = document.querySelector('.clear-selection-btn');
    const useSelectedBtn = document.querySelector('.use-selected-btn');

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            document.querySelectorAll('.session-checkbox').forEach(checkbox => {
                checkbox.checked = false;
            });
            document.querySelectorAll('.session-item').forEach(item => {
                item.classList.remove('selected');
            });
            window.selectedContextSessions = null;
            updateContextIndicator();
            updateSelectionUI();
        });
    }

    if (useSelectedBtn) {
        useSelectedBtn.addEventListener('click', () => {
            const selectedSessions = getSelectedSessionsData();
            if (selectedSessions.length > 0) {
                window.selectedContextSessions = selectedSessions;
                document.getElementById('context-window').classList.add('hidden');
                updateContextIndicator();
                showNotification(`${selectedSessions.length} sessions selected as context`, 'info', 3000);
            }
        });
    }
}

function updateSelectionUI() {
    const selectionActions = document.querySelector('.selection-actions');
    const selectedCount = document.querySelectorAll('.session-checkbox:checked').length;
    
    if (selectedCount > 0) {
        selectionActions.classList.remove('hidden');
        selectionActions.querySelector('.selected-count').textContent = 
            `${selectedCount} selected`;
    } else {
        selectionActions.classList.add('hidden');
    }
}

function getSelectedSessionsData() {
    const selectedSessions = [];
    document.querySelectorAll('.session-checkbox:checked').forEach(checkbox => {
        const sessionItem = checkbox.closest('.session-item');
        const filePath = sessionItem.dataset.filepath;
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data && data.interactions) {
                selectedSessions.push({
                    interactions: data.interactions.map(interaction => ({
                        user_input: interaction.user_input,
                        llm_output: interaction.llm_output
                    }))
                });
            }
        } catch (err) {
            console.error(`Error reading session data: ${filePath}`, err);
            showNotification(`Error reading session data: ${err.message}`, 'error');
        }
    });
    return selectedSessions;
}

function clearSelectedContext() {
    window.selectedContextSessions = null;
    updateContextIndicator();
}

function showSessionDetails(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const session = JSON.parse(data);
        const content = document.querySelector('.context-content');
        
        // Use a single column layout for the details view
        content.style.gridTemplateColumns = '1fr';
        
        const sessionName = path.basename(filePath, '.json')
                              .split('_')
                              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                              .join(' ');
        
        content.innerHTML = `
            <div class="session-details-view">
                <div class="session-header">
                    <button class="back-button" id="back-to-sessions">
                        <i class="fas fa-arrow-left"></i>
                        Back
                    </button>
                    <h3>${sessionName}</h3>
                </div>
                
                <div class="conversation-history">
                    <div class="conversation-header">
                        <h3>Conversation History</h3>
                    </div>
                    <div class="conversation-messages">
                        ${session.interactions && session.interactions.length 
                            ? session.interactions.map(interaction => `
                                <div class="message-entry">
                                    <div class="message-content">
                                        <span class="message-label">User Input:</span>
                                        ${interaction.user_input}
                                        <br>
                                        <span class="message-label">Assistant:</span>
                                        ${interaction.llm_output[0]}
                                    </div>
                                </div>
                              `).join('')
                            : '<div class="message-entry">No messages in this session</div>'
                        }
                    </div>
                </div>
            </div>
        `;

        // Bind the back button event
        document.getElementById('back-to-sessions').addEventListener('click', (e) => {
            e.preventDefault();
            loadSessions();
        });
        
    } catch (err) {
        console.error('Error showing session details:', err);
        document.querySelector('.context-content').innerHTML = `
            <div class="session-details-view">
                <button class="back-button" id="back-to-sessions">
                    <i class="fas fa-arrow-left"></i>
                    Back to Sessions
                </button>
                <div class="session-info">
                    <h3>Error</h3>
                    <p>Unable to load session details. Please try again.</p>
                </div>
            </div>
        `;
        
        // Bind the back button event in error state
        document.getElementById('back-to-sessions').addEventListener('click', (e) => {
            e.preventDefault();
            loadSessions();
        });
    }
}

function updateContextIndicator() {
    const indicator = document.querySelector('.context-active-indicator');
    const sessionCount = window.selectedContextSessions?.length || 0;
    
    if (indicator) {
        indicator.classList.toggle('visible', sessionCount > 0);
        const countSpan = indicator.querySelector('.context-count');
        if (countSpan) {
            countSpan.textContent = sessionCount > 0 ? `${sessionCount} sessions in context` : '';
        }
    }
}

function init() {
    const elements = {
        container: document.getElementById('chat-container'),
        messages: document.getElementById('chat-messages'),
        input: document.getElementById('floating-input'),
        sendBtn: document.getElementById('send-message'),
        minimizeBtn: document.getElementById('minimize-chat'),
        closeBtn: document.getElementById('close-chat'),
        newChatBtn: document.querySelector('.add-btn'),
        contextIndicator: document.querySelector('.context-active-indicator')
    };

    initializeToolsMenu();
    handleMemoryToggle();
    connectSocket();
    initializeAutoExpandingTextarea();

    const contextBtn = document.querySelector('[data-tool="context"]');
    const contextWindow = document.getElementById('context-window');
    
    contextBtn.addEventListener('click', () => {
        contextWindow.classList.remove('hidden');
        loadSessions();
    });

    document.querySelector('.close-context-btn').addEventListener('click', () => {
        contextWindow.classList.add('hidden');
    });

    const syncBtn = document.querySelector('.sync-context-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', (e) => {
            e.preventDefault();
            syncSessions();
        });
    }

    elements.sendBtn.addEventListener('click', handleSendMessage);

    elements.minimizeBtn?.addEventListener('click', () => {
        window.stateManager.setState({ isChatOpen: false });
    });

    elements.closeBtn?.addEventListener('click', () => {
        window.stateManager.setState({ isChatOpen: false });
        elements.messages.innerHTML = '';
        clearSelectedContext();
        updateContextIndicator(); // Update indicator when closing chat
        terminateSession();
    });    


    elements.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    elements.newChatBtn.addEventListener('click', () => {
        const chatMessages = document.getElementById('chat-messages');
        const inputElement = document.getElementById('floating-input');
        const sendButton = document.getElementById('send-message');

        // Clear chat and enable inputs
        chatMessages.innerHTML = '';
        inputElement.disabled = false;
        sendButton.disabled = false;
        
        // Reset session state
        sessionActive = false;
        ongoingStreams = {};
        clearSelectedContext();
        updateContextIndicator();

        chatConfig = {
            memory: false,
            tools: {
                calculator: true,
                ddg_search: true,
                python_assistant: true,
                investment_assistant: true,
                shell_tools: true,
                web_crawler: true
            }
        };
        
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        document.querySelectorAll('.tools-menu input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = chatConfig.tools[checkbox.id] || false;
        });

        if (socket?.connected) {
            socket.emit('send_message', JSON.stringify({
                type: 'new_chat'
            }));
        }
    });

    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to server');
        document.querySelectorAll('.connection-error').forEach(e => e.remove());
        sessionActive = false;
        
        // Enable inputs on connect
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
            clearSelectedContext();
            updateContextIndicator(); // Update indicator on error reset
            document.querySelector('.add-btn').click();
        }
    });
    updateContextIndicator();
}

window.chatModule = { init };