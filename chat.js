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
        socket.emit('send_message', JSON.stringify({
            message: data.message,
            config: !sessionActive ? {
                use_memory: chatConfig.memory,
                ...chatConfig.tools
            } : undefined,
            id: data.id
        }));
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
    
    // Only disable input while sending
    floatingInput.disabled = true;
    sendMessageBtn.disabled = true;
    
    addMessage(message, true);
    
    const messageData = {
        message: message,
        id: Date.now().toString()
    };

    if (!sessionActive) {
        messageData.config = {
            use_memory: chatConfig.memory,
            ...chatConfig.tools
        };
        sessionActive = true;
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

function init() {
    const elements = {
        container: document.getElementById('chat-container'),
        messages: document.getElementById('chat-messages'),
        input: document.getElementById('floating-input'),
        sendBtn: document.getElementById('send-message'),
        minimizeBtn: document.getElementById('minimize-chat'),
        closeBtn: document.getElementById('close-chat'),
        newChatBtn: document.querySelector('.add-btn')
    };

    initializeToolsMenu();
    handleMemoryToggle();
    connectSocket();
    initializeAutoExpandingTextarea();

    elements.sendBtn.addEventListener('click', handleSendMessage);

    elements.minimizeBtn?.addEventListener('click', () => {
        window.stateManager.setState({ isChatOpen: false });
    });

    elements.closeBtn?.addEventListener('click', () => {
        window.stateManager.setState({ isChatOpen: false });
        elements.messages.innerHTML = '';
        terminateSession(); // Add this line
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
            document.querySelector('.add-btn').click();
        }
    });
}

window.chatModule = { init };