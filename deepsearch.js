// deepsearch.js
import { messageFormatter } from './message-formatter.js';

class Deepsearch {
    constructor() {
        this.fileList = [];
        this.elements = {};
        this.ongoingStreams = {};
        this.sessionActive = false;
        this.socket = null;
        this.maxFileSize = 10 * 1024 * 1024; // 10MB limit
        this.supportedFileTypes = {
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

        // Bind methods to preserve 'this' context
        this.handleAttachFile = this.handleAttachFile.bind(this);
        this.handlePreview = this.handlePreview.bind(this);
        this.handleRemoveFile = this.handleRemoveFile.bind(this);

        this.init(); // Call init() to set everything up
    }

    init() {
        // Cache DOM elements
        const $ = id => document.getElementById(id);
        this.elements = {
            fileListUI: $('file-list'),
            attachFileBtn: $('attach-file-btn'),
            newChatBtn: $('new-chat-btn'),
            sendBtn: $('send-deepsearch-btn'),
            searchInput: $('deepsearch-input'),
            searchResults: $('deepsearch-results'),
            container: $('deepsearch-container')
        };

        // Setup WebSocket
        this.socket = io('http://localhost:8765', {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket']
        });

        this.setupEventListeners();
        this.setupSocketListeners();

        const style = document.createElement('style');
        style.textContent = `
            .notification-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
            }
            
            .notification {
                padding: 12px 24px;
                margin-bottom: 10px;
                border-radius: 8px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                transition: opacity 0.3s ease-out;
            }
        `;
        document.head.appendChild(style);
    }

    setupEventListeners() {
        // Attach file handling
        if (this.elements.attachFileBtn) {
            this.elements.attachFileBtn.addEventListener('click', this.handleAttachFile);
        }

        // Other event listeners
        this.elements.newChatBtn?.addEventListener('click', () => this.handleNewChat());
        this.elements.sendBtn?.addEventListener('click', () => this.handleSend());
        this.elements.searchInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
    }

    handleAttachFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = Object.keys(this.supportedFileTypes).map(ext => `.${ext}`).join(',');
    
        input.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) {
                try {
                    await this.processFiles(files);
                } catch (error) {
                    this.showNotification(error.message, 'error');
                }
            }
            input.remove();
        };
    
        // Properly handle the input element
        input.style.display = 'none';
        document.body.appendChild(input);
        input.click();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            document.querySelectorAll('.connection-error').forEach(e => e.remove());
            this.elements.searchInput.disabled = false;
            this.elements.sendBtn.disabled = false;
        });

        this.socket.on('response', data => this.handleResponse(data));

        this.socket.on('error', error => {
            this.showNotification(error.message || 'An error occurred', 'error');
            this.elements.searchInput.disabled = false;
            this.elements.sendBtn.disabled = false;
            if (error.reset) this.handleNewChat();
        });

        this.socket.on('disconnect', () => this.showConnectionError());
    }

    async processFiles(files) {
        const processedFiles = [];
        const errors = [];
    
        for (const file of files) {
            try {
                if (file.size > this.maxFileSize) {
                    throw new Error(`${file.name} exceeds 10MB limit`);
                }
    
                const ext = file.name.split('.').pop().toLowerCase();
                if (!this.supportedFileTypes[ext]) {
                    throw new Error(`${ext} files not supported`);
                }
    
                if (this.fileList.some(f => f.name === file.name)) {
                    throw new Error(`${file.name} already exists`);
                }
    
                const fileData = {
                    name: file.name,
                    type: this.supportedFileTypes[ext],
                    size: file.size
                };
    
                // Read file content based on type
                if (fileData.type.startsWith('text/') || fileData.type === 'application/json') {
                    try {
                        fileData.content = await this.readFileAsText(file);
                        fileData.dataURL = await this.readFileAsDataURL(file);
                    } catch (readError) {
                        throw new Error(`Failed to read ${file.name}: ${readError.message}`);
                    }
                }
    
                processedFiles.push(fileData);
            } catch (error) {
                errors.push(error.message);
            }
        }
    
        if (processedFiles.length) {
            this.fileList.push(...processedFiles);
            this.renderFileList();
            this.showNotification(`Added ${processedFiles.length} file(s)`, 'success');
        }
    
        if (errors.length) {
            this.showNotification(errors.join('\n'), 'error');
        }
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
    
    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    readFile(file, type) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            reader[type === 'text' ? 'readAsText' : 'readAsDataURL'](file);
        });
    }

    renderFileList() {
        if (!this.elements.fileListUI) return;

        this.elements.fileListUI.innerHTML = this.fileList.map((file, index) => `
            <li>
                <span class="file-name">${file.name}</span>
                <div class="file-buttons">
                    ${file.dataURL ? `
                        <button onclick="deepsearch.handlePreview(${index})">
                            <i class="fas fa-eye"></i>
                        </button>
                    ` : ''}
                    <button onclick="deepsearch.handleRemoveFile(${index})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </li>
        `).join('');
    }
    handlePreview(index) {
        const file = this.fileList[index];
        if (!file.dataURL && !file.content) {
            this.showNotification("Preview not available for this file type.");
            return;
        }

        const previewContainer = document.createElement("div");
        previewContainer.classList.add("file-preview");
        previewContainer.style.position = "fixed";
        previewContainer.style.top = "50%";
        previewContainer.style.left = "50%";
        previewContainer.style.transform = "translate(-50%, -50%)";
        previewContainer.style.backgroundColor = "var(--window-bg)";
        previewContainer.style.padding = "20px";
        previewContainer.style.zIndex = "1000";
        previewContainer.style.maxWidth = "80%";
        previewContainer.style.maxHeight = "80vh";
        previewContainer.style.overflow = "hidden";
        previewContainer.style.display = "flex";
        previewContainer.style.flexDirection = "column";
        previewContainer.style.boxShadow = "0 8px 32px var(--shadow-color)";
        previewContainer.style.border = "1px solid var(--border-color)";
        previewContainer.style.borderRadius = "12px";

        // Header with file name and close button
        const previewHeader = document.createElement("div");
        previewHeader.style.display = "flex";
        previewHeader.style.justifyContent = "space-between";
        previewHeader.style.alignItems = "center";
        previewHeader.style.padding = "0 0 16px 0";
        previewHeader.style.borderBottom = "1px solid var(--border-color)";
        previewHeader.style.position = "sticky";
        previewHeader.style.top = "0";
        previewHeader.style.backgroundColor = "var(--window-bg)";
        previewHeader.style.zIndex = "1";

        const fileName = document.createElement("span");
        fileName.textContent = file.name;
        fileName.style.fontWeight = "600";
        fileName.style.color = "var(--heading-color)";

        const closeButton = document.createElement("button");
        closeButton.innerHTML = '<i class="fas fa-times"></i>';
        closeButton.style.background = "none";
        closeButton.style.border = "none";
        closeButton.style.cursor = "pointer";
        closeButton.style.padding = "8px";
        closeButton.style.borderRadius = "8px";
        closeButton.style.color = "var(--icon-color)";
        closeButton.style.display = "flex";
        closeButton.style.alignItems = "center";
        closeButton.style.justifyContent = "center";
        closeButton.style.transition = "all 0.2s ease";

        closeButton.addEventListener("mouseover", () => {
            closeButton.style.backgroundColor = "var(--accent-color)";
            closeButton.style.color = "white";
        });

        closeButton.addEventListener("mouseout", () => {
            closeButton.style.backgroundColor = "transparent";
            closeButton.style.color = "var(--icon-color)";
        });

        closeButton.addEventListener("click", () => previewContainer.remove());

        previewHeader.appendChild(fileName);
        previewHeader.appendChild(closeButton);

        // Content container with scroll
        const contentContainer = document.createElement("div");
        contentContainer.style.overflow = "auto";
        contentContainer.style.flex = "1";
        contentContainer.style.marginTop = "16px";
        contentContainer.style.position = "relative";

        if (file.type.startsWith("image/")) {
            const img = document.createElement("img");
            img.src = file.dataURL;
            img.style.maxWidth = "100%";
            img.style.height = "auto";
            img.style.borderRadius = "8px";
            contentContainer.appendChild(img);
        } else if (file.type.startsWith("text/") || file.type === "application/json") {
            const pre = document.createElement("pre");
            pre.style.margin = "0";
            pre.style.backgroundColor = "var(--taskbar-bg)";
            pre.style.padding = "16px";
            pre.style.borderRadius = "8px";
            pre.style.overflow = "auto";
            pre.style.color = "var(--text-color)";

            const code = document.createElement("code");
            code.textContent = file.content || atob(file.dataURL.split(",")[1]);

            // Set appropriate language class for syntax highlighting
            if (file.name.endsWith(".js")) {
                code.className = "language-javascript";
            } else if (file.name.endsWith(".py")) {
                code.className = "language-python";
            } else if (file.name.endsWith(".html")) {
                code.className = "language-html";
            } else if (file.name.endsWith(".css")) {
                code.className = "language-css";
            }

            pre.appendChild(code);
            contentContainer.appendChild(pre);

            // Apply syntax highlighting if available
            if (window.hljs) {
                window.hljs.highlightElement(code);
            }
        } else if (file.type === "application/pdf") {
            const iframe = document.createElement("iframe");
            iframe.src = file.dataURL;
            iframe.style.width = "100%";
            iframe.style.height = "calc(80vh - 100px)"; // Account for header
            iframe.style.border = "none";
            iframe.style.borderRadius = "8px";
            contentContainer.appendChild(iframe);
        }

        previewContainer.appendChild(previewHeader);
        previewContainer.appendChild(contentContainer);

        // Add backdrop
        const backdrop = document.createElement("div");
        backdrop.style.position = "fixed";
        backdrop.style.top = "0";
        backdrop.style.left = "0";
        backdrop.style.right = "0";
        backdrop.style.bottom = "0";
        backdrop.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
        backdrop.style.zIndex = "999";
        backdrop.addEventListener("click", () => {
            backdrop.remove();
            previewContainer.remove();
        });

        document.body.appendChild(backdrop);
        document.body.appendChild(previewContainer);
    }

    handleRemoveFile(index) {
        this.fileList.splice(index, 1);
        this.renderFileList();
    }

    handleNewChat() {
        this.fileList = [];
        this.elements.searchInput.value = '';
        this.elements.searchResults.innerHTML = '';
        this.renderFileList();

        if (this.socket?.connected) {
            this.socket.emit('send_message', JSON.stringify({ type: 'terminate_session' }));
        }
    }

    handleSend() {
        const query = this.elements.searchInput.value.trim();

        if (!query && !this.fileList.length) return;

        this.elements.searchInput.disabled = true;
        this.elements.sendBtn.disabled = true;

        if (query) this.addMessage(query, true);

        const messageData = {
            message: query,
            files: this.fileList.map(({ name, content, type }) => ({ name, content, type })),
            is_deepsearch: true,
            id: Date.now().toString()
        };

        if (this.socket?.connected) {
            this.socket.emit('send_message', JSON.stringify(messageData));
            this.elements.searchInput.value = '';
        } else {
            this.addMessage('Error: Not connected to server', false);
            this.elements.searchInput.disabled = false;
            this.elements.sendBtn.disabled = false;
        }
    }

    handleResponse(data) {
        if (!data) return;

        const { streaming, done, id, content } = data;

        if (streaming || content) {
            this.addMessage(data, false, streaming, id, done);
        }
    }
    addMessage(message, isUser, isStreaming = false, messageId = null, isDone = false) {
        if (isStreaming && !isUser) {
            if (!messageId) return;

            let messageDiv = this.ongoingStreams[messageId];
            if (!messageDiv) {
                messageDiv = document.createElement('div');
                messageDiv.className = 'message message-bot';
                this.elements.searchResults.appendChild(messageDiv);
                this.ongoingStreams[messageId] = messageDiv;
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
                delete this.ongoingStreams[messageId];
                this.elements.searchInput.disabled = false;
                this.elements.sendBtn.disabled = false;
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
                messageDiv.innerHTML = messageFormatter.format(message);

                if (messageDiv.querySelector('.mermaid')) {
                    mermaid.init(undefined, messageDiv.querySelectorAll('.mermaid'));
                }
            }

            this.elements.searchResults.appendChild(messageDiv);
            this.elements.searchInput.disabled = false;
            this.elements.sendBtn.disabled = false;
        }

        this.elements.searchResults.scrollTop = this.elements.searchResults.scrollHeight;
    }


    showNotification(message, type = 'error', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;

        let container = document.querySelector('.notification-container') || (() => {
            const cont = document.createElement('div');
            cont.className = 'notification-container';
            Object.assign(cont.style, {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: '9999'
            });
            document.body.appendChild(cont);
            return cont;
        })();

        Object.assign(notification.style, {
            padding: '12px 24px',
            marginBottom: '10px',
            borderRadius: '8px',
            backgroundColor: type === 'error' ? '#ff4444' : type === 'warning' ? '#ffbb33' : '#00C851',
            color: 'white',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            opacity: '1',
            transition: 'opacity 0.3s ease-out'
        });

        container.appendChild(notification);

        // Fixed notification timing
        setTimeout(() => {
            notification.style.opacity = '0';
            // Wait for fade out animation before removing
            setTimeout(() => {
                if (notification && notification.parentElement) {
                    notification.remove();
                    if (container && !container.children.length) {
                        container.remove();
                    }
                }
            }, 300); // Match transition duration
        }, duration);
    }

    showConnectionError() {
        if (!document.querySelector('.connection-error')) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'connection-error';
            errorDiv.textContent = 'Connecting to server...';
            document.body.appendChild(errorDiv);
        }
    }
}

window.deepsearch = new Deepsearch();