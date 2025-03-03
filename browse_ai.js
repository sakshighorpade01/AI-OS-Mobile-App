// browse_ai.js - Browser AI Integration

// State management variables
let isRecording = false;
let messageId = null;
let isThinking = false;
let hasWebview = false;
let pendingNavigation = null;

// DOM elements
let browseAiPanel;
let browsePanelIcon;
let messagesContainer;
let inputField;
let sendButton;
let voiceButton;
let minimizeButton;
let urlBar;
let goToUrlButton;
let backButton;
let forwardButton;
let refreshButton;
let browserContent;

// Panel visibility toggle
function toggleBrowseAiPanel() {
    browseAiPanel.classList.toggle('hidden');
    if (!browseAiPanel.classList.contains('hidden')) {
        inputField.focus();
    }
}

function minimizeBrowseAiPanel() {
    browseAiPanel.classList.add('hidden');
}

// Handle sending messages to the Python backend
function handleSendMessage() {
    console.log("Send message called");
    const message = inputField.value.trim();
    if (!message || isThinking) return;
    
    // Add user message to UI
    addMessage(message, true);
    
    // Show thinking indicator
    isThinking = true;
    addThinkingIndicator();
    
    // Prepare message data
    const messageData = {
        message: message,
        type: 'browse_ai_message',  // Indicate this is for the browse AI
        is_browser_agent: true,     // Flag for Python backend
        config: {                   // Configuration for the agent
            browser_automation: true,
            web_analyzer: true
        }
    };
    
    console.log("Sending message to backend:", messageData);
    
    // Send to main process using the same channel as chat.js
    window.electron.ipcRenderer.send('send-message', messageData);
    
    // Clear input
    inputField.value = '';
    autoResizeTextarea();
}

// Setup IPC listeners for communication with main process
function setupIpcListeners() {
    console.log("Setting up IPC listeners");
    
    // Listen for responses from Python backend
    window.electron.ipcRenderer.on('chat-response', (event, data) => {
        console.log("Received response:", data);
        // Check if this is a browser agent response
        if (data.content && data.is_browser_agent) {
            // This is a browser agent response
            messageId = data.id; // Store the ID for future checks
            handleResponse(data);
        } else if (messageId && data.id === messageId) {
            // This is a response for our current conversation
            handleResponse(data);
        }
    });
    
    // Listen for webview events
    window.electron.ipcRenderer.on('webview-created', (event, bounds) => {
        console.log("Webview created");
        hasWebview = true;
        updateBrowserUI(true);
    });
    
    window.electron.ipcRenderer.on('webview-closed', () => {
        console.log("Webview closed");
        hasWebview = false;
        updateBrowserUI(false);
    });
    
    window.electron.ipcRenderer.on('webview-navigation-updated', (event, data) => {
        console.log("Webview navigation updated:", data);
        if (data.url) {
            urlBar.value = data.url;
        }
    });
    
    window.electron.ipcRenderer.on('webview-page-loaded', () => {
        console.log("Webview page loaded");
    });
    
    window.electron.ipcRenderer.on('webview-content-captured', (event, pageData) => {
        console.log("Webview content captured:", pageData.title);
    });
}

// Handle responses from the Python backend
function handleResponse(data) {
    console.log("Handling response:", data);
    
    if (data.done) {
        // Remove thinking indicator
        removeThinkingIndicator();
        isThinking = false;
    }
    
    if (data.content) {
        addMessage(data.content, false, data.streaming);
    }
    
    // Check for navigation commands
    if (data.navigate_to) {
        console.log("Navigating to:", data.navigate_to);
        pendingNavigation = data.navigate_to;
        navigateToUrl(data.navigate_to);
    }
}

// Add message to the UI
function addMessage(content, isUser, isStreaming = false) {
    let messageElement;
    
    if (isUser) {
        // Add user message
        messageElement = document.createElement('div');
        messageElement.className = 'browse-ai-message message-user';
        messageElement.textContent = content;
        messagesContainer.appendChild(messageElement);
    } else {
        // For AI responses
        if (isStreaming && messagesContainer.lastElementChild && 
            messagesContainer.lastElementChild.classList.contains('message-bot')) {
            // Update existing message for streaming
            messageElement = messagesContainer.lastElementChild;
            messageElement.innerHTML = formatMessage(content);
        } else {
            // Create new message
            messageElement = document.createElement('div');
            messageElement.className = 'browse-ai-message message-bot';
            messageElement.innerHTML = formatMessage(content);
            messagesContainer.appendChild(messageElement);
        }
    }
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add welcome message to the UI
function addWelcomeMessage() {
    const welcomeMessage = `
        **Welcome to Browse AI!**
        
        I can help you browse the web and complete tasks. Here are some things you can ask me to do:
        
        - Search for information on a topic
        - Navigate to a specific website
        - Fill out forms and interact with web pages
        - Extract and summarize information from websites
        
        What would you like me to help you with today?
    `;
    
    addMessage(welcomeMessage, false);
}

// Add thinking indicator
function addThinkingIndicator() {
    const thinkingElement = document.createElement('div');
    thinkingElement.className = 'browse-ai-message message-bot thinking';
    thinkingElement.textContent = 'Thinking';
    messagesContainer.appendChild(thinkingElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return thinkingElement;
}

// Remove thinking indicator
function removeThinkingIndicator() {
    const thinkingElements = document.querySelectorAll('.message-bot.thinking');
    thinkingElements.forEach(el => el.remove());
}

// Format message with markdown
function formatMessage(content) {
    // Simple formatting - could be expanded with a markdown library
    return content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// Navigate to URL
function navigateToUrl(url) {
    if (!url) return;
    
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    console.log("Navigating to URL:", url);
    
    // Update URL bar
    urlBar.value = url;
    
    // Send to main process to open webview
    window.electron.ipcRenderer.send('open-webview', url);
    
    // Update UI
    updateBrowserUI(true, url);
}

// Update browser UI based on webview state
function updateBrowserUI(hasActiveWebview, currentUrl) {
    if (hasActiveWebview) {
        // Show active browser UI
        browserContent.querySelector('.browser-placeholder')?.classList.add('hidden');
        backButton.disabled = false;
        forwardButton.disabled = false;
        refreshButton.disabled = false;
        
        if (currentUrl) {
            urlBar.value = currentUrl;
        }
    } else {
        // Show placeholder
        const placeholder = browserContent.querySelector('.browser-placeholder');
        if (placeholder) {
            placeholder.classList.remove('hidden');
        }
        backButton.disabled = true;
        forwardButton.disabled = true;
        refreshButton.disabled = true;
    }
}

// Voice input handling
function toggleVoiceInput() {
    if (!isRecording) {
        startVoiceRecording();
    } else {
        stopVoiceRecording();
    }
}

function startVoiceRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addMessage("Voice input is not supported in your browser.", false);
        return;
    }
    
    isRecording = true;
    voiceButton.classList.add('recording');
    
    // TODO: Implement actual voice recording and transcription
    // This would typically use the Web Speech API or another service
}

function stopVoiceRecording() {
    isRecording = false;
    voiceButton.classList.remove('recording');
    
    // Placeholder for actual transcription
    // In a real implementation, you would process the audio and get text
}

// Auto-resize textarea
function autoResizeTextarea() {
    inputField.style.height = 'auto';
    inputField.style.height = (inputField.scrollHeight) + 'px';
}

// Make an element draggable
function makeDraggable(element, handleSelector) {
    const handle = element.querySelector(handleSelector);
    if (!handle) return;
    
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    handle.onmousedown = dragMouseDown;
    
    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }
    
    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        const newTop = (element.offsetTop - pos2);
        const newLeft = (element.offsetLeft - pos1);
        
        // Check bounds
        if (newTop >= 0 && newTop + element.offsetHeight <= window.innerHeight) {
            element.style.top = newTop + "px";
        }
        
        if (newLeft >= 0 && newLeft + element.offsetWidth <= window.innerWidth) {
            element.style.left = newLeft + "px";
        }
    }
    
    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// Setup event listeners
function setupEventListeners() {
    console.log("Setting up event listeners");
    
    // Initialize event listeners
    browsePanelIcon?.addEventListener('click', toggleBrowseAiPanel);
    minimizeButton?.addEventListener('click', minimizeBrowseAiPanel);
    sendButton?.addEventListener('click', handleSendMessage);
    voiceButton?.addEventListener('click', toggleVoiceInput);
    
    // Navigation controls
    goToUrlButton?.addEventListener('click', () => navigateToUrl(urlBar.value));
    urlBar?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') navigateToUrl(urlBar.value);
    });
    backButton?.addEventListener('click', () => {
        if (hasWebview) {
            window.electron.ipcRenderer.send('webview-navigate', { action: 'back' });
        }
    });
    forwardButton?.addEventListener('click', () => {
        if (hasWebview) {
            window.electron.ipcRenderer.send('webview-navigate', { action: 'forward' });
        }
    });
    refreshButton?.addEventListener('click', () => {
        if (hasWebview) {
            window.electron.ipcRenderer.send('webview-navigate', { action: 'refresh' });
        }
    });
    
    // Input handling
    inputField?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
    
    // Auto-expanding textarea
    inputField?.addEventListener('input', autoResizeTextarea);
}

// Initialize electron if it's not available
function initializeElectron() {
    console.log("Initializing electron");
    
    if (!window.electron) {
        window.electron = {
            ipcRenderer: {
                send: (channel, data) => {
                    console.log('IPC send:', channel, data);
                },
                on: (channel, func) => {
                    console.log('IPC on:', channel);
                }
            }
        };
        console.warn('Running outside of Electron environment. IPC calls will be mocked.');
    }
}

// Export necessary functions for potential use from other modules
window.browseAI = {
    show: () => {
        document.getElementById('browse-ai-panel')?.classList.remove('hidden');
    },
    hide: () => {
        document.getElementById('browse-ai-panel')?.classList.add('hidden');
    },
    navigate: (url) => {
        window.electron.ipcRenderer.send('open-webview', url);
    },
    init: () => {
        console.log('BrowseAI module initializing');
        
        // Initialize electron if needed
        initializeElectron();
        
        // Cache DOM elements
        browseAiPanel = document.getElementById('browse-ai-panel');
        browsePanelIcon = document.getElementById('browse-ai-icon');
        messagesContainer = document.getElementById('browse-ai-messages');
        inputField = document.getElementById('browse-ai-input');
        sendButton = document.getElementById('send-browse-ai-message');
        voiceButton = document.getElementById('voice-input-btn');
        minimizeButton = document.getElementById('minimize-browse-ai');
        urlBar = document.getElementById('browse-url-bar');
        goToUrlButton = document.getElementById('browse-goto-btn');
        backButton = document.getElementById('browse-back-btn');
        forwardButton = document.getElementById('browse-forward-btn');
        refreshButton = document.getElementById('browse-refresh-btn');
        browserContent = document.getElementById('browser-content');
        
        console.log("DOM elements cached:", {
            browseAiPanel: !!browseAiPanel,
            messagesContainer: !!messagesContainer,
            inputField: !!inputField,
            sendButton: !!sendButton
        });
        
        // Make panel draggable
        if (browseAiPanel) {
            makeDraggable(browseAiPanel, '.browse-ai-handle');
        }
        
        // Setup IPC listeners
        setupIpcListeners();
        
        // Setup event listeners
        setupEventListeners();
        
        // Add welcome message if messages container is empty
        if (messagesContainer && messagesContainer.children.length === 0) {
            addWelcomeMessage();
        }
        
        console.log('BrowseAI module initialization complete');
    }
};
