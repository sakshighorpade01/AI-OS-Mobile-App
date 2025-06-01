// artifact-handler.js
class ArtifactHandler {
    constructor() {
        this.artifacts = new Map();
        this.currentId = 0;
        this.init();
    }

    init() {
        const container = document.createElement('div');
        container.id = 'artifact-container';
        container.className = 'artifact-container hidden';
        
        container.innerHTML = `
            <div class="artifact-window">
                <div class="artifact-header">
                    <div class="artifact-title">Code/Diagram Viewer</div>
                    <div class="artifact-controls">
                        <button class="copy-artifact-btn" title="Copy to Clipboard">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="download-artifact-btn" title="Download">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="close-artifact-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="artifact-content"></div>
            </div>
        `;
        
        document.body.appendChild(container);
        
        // Close button handler
        container.querySelector('.close-artifact-btn').addEventListener('click', () => {
            this.hideArtifact();
        });

        // Copy button handler
        container.querySelector('.copy-artifact-btn').addEventListener('click', () => {
            this.copyArtifactContent();
        });

        // Download button handler
        container.querySelector('.download-artifact-btn').addEventListener('click', () => {
            this.downloadArtifact();
        });
    }

    createArtifact(content, type) {
        const id = `artifact-${this.currentId++}`;
        this.artifacts.set(id, { content, type });
        return id;
    }

    showArtifact(content, type, artifactId = null) {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        
        // Clear previous content
        contentDiv.innerHTML = '';
        
        // Add new content based on type
        if (type === 'mermaid') {
            const mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid';
            mermaidDiv.textContent = content;
            contentDiv.appendChild(mermaidDiv);
            mermaid.init(undefined, [mermaidDiv]);

            // Add zoom controls for Mermaid diagrams
            const zoomControls = document.createElement('div');
            zoomControls.className = 'mermaid-controls';
            zoomControls.innerHTML = `
                <button class="zoom-in-btn" title="Zoom In"><i class="fas fa-plus"></i></button>
                <button class="zoom-out-btn" title="Zoom Out"><i class="fas fa-minus"></i></button>
                <button class="zoom-reset-btn" title="Reset Zoom"><i class="fas fa-search"></i></button>
            `;
            contentDiv.appendChild(zoomControls);

            // Initialize zoom state
            mermaidDiv.style.transform = 'scale(1)';
            mermaidDiv.style.transformOrigin = 'center center';

            // Add zoom event handlers
            let currentZoom = 1;
            zoomControls.querySelector('.zoom-in-btn').addEventListener('click', () => {
                currentZoom = Math.min(currentZoom + 0.1, 2);
                mermaidDiv.style.transform = `scale(${currentZoom})`;
            });
            zoomControls.querySelector('.zoom-out-btn').addEventListener('click', () => {
                currentZoom = Math.max(currentZoom - 0.1, 0.5);
                mermaidDiv.style.transform = `scale(${currentZoom})`;
            });
            zoomControls.querySelector('.zoom-reset-btn').addEventListener('click', () => {
                currentZoom = 1;
                mermaidDiv.style.transform = 'scale(1)';
            });
        } else {
            // For code blocks
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = `language-${type}`;
            code.textContent = content;
            pre.appendChild(code);
            contentDiv.appendChild(pre);
            hljs.highlightElement(code);
        }
        
        // Show artifact and adjust chat position
        container.classList.remove('hidden');
        chatContainer.classList.add('with-artifact');
        inputContainer.classList.add('with-artifact');

        return artifactId || this.createArtifact(content, type);
    }

    hideArtifact() {
        const container = document.getElementById('artifact-container');
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        
        container.classList.add('hidden');
        chatContainer.classList.remove('with-artifact');
        inputContainer.classList.remove('with-artifact');
    }

    reopenArtifact(artifactId) {
        const artifact = this.artifacts.get(artifactId);
        if (artifact) {
            this.showArtifact(artifact.content, artifact.type, artifactId);
        }
    }

    async copyArtifactContent() {
        const contentDiv = document.querySelector('.artifact-content');
        let content = '';

        if (contentDiv.querySelector('.mermaid')) {
            content = contentDiv.querySelector('.mermaid').textContent;
        } else if (contentDiv.querySelector('code')) {
            content = contentDiv.querySelector('code').textContent;
        }

        if (content) {
            try {
                await navigator.clipboard.writeText(content);
                this.showNotification('Content copied to clipboard!', 'success');
            } catch (err) {
                this.showNotification('Failed to copy content', 'error');
            }
        }
    }

    async downloadArtifact() {
        const contentDiv = document.querySelector('.artifact-content');
        let content = '';
        let suggestedName = 'artifact';
        let extension = '.txt';
        let mimeType = 'text/plain';

        if (contentDiv.querySelector('.mermaid')) {
            content = contentDiv.querySelector('.mermaid').textContent;
            extension = '.mmd';
            suggestedName = 'diagram';
        } else if (contentDiv.querySelector('code')) {
            const code = contentDiv.querySelector('code');
            content = code.textContent;
            const language = code.className.replace('language-', '');
            extension = this.getFileExtension(language);
            suggestedName = `code${extension}`;
            
            // Set appropriate MIME type based on extension
            if (extension === '.js') mimeType = 'application/javascript';
            else if (extension === '.html') mimeType = 'text/html';
            else if (extension === '.css') mimeType = 'text/css';
            else if (extension === '.json') mimeType = 'application/json';
            else if (extension === '.py') mimeType = 'text/x-python';
        }

        if (!content) return;

        try {
            // Use the exposed ipcRenderer from preload.js
            // Request the main process to show a save dialog
            const result = await window.electron.ipcRenderer.invoke('show-save-dialog', {
                title: 'Save File',
                defaultPath: suggestedName + extension,
                filters: [{
                    name: 'All Files',
                    extensions: [extension.substring(1)] // Remove the dot
                }]
            });
            
            if (result.canceled || !result.filePath) return;
            
            // Save the file using the main process
            const success = await window.electron.ipcRenderer.invoke('save-file', {
                filePath: result.filePath,
                content: content
            });
            
            if (success) {
                this.showNotification('File saved successfully', 'success');
            } else {
                this.showNotification('Failed to save file', 'error');
            }
        } catch (error) {
            console.error('Error saving file:', error);
            this.showNotification('Error: ' + error.message, 'error');
        }
    }

    getFileExtension(language) {
        const extensions = {
            javascript: '.js',
            python: '.py',
            html: '.html',
            css: '.css',
            json: '.json',
            typescript: '.ts',
            java: '.java',
            cpp: '.cpp',
            c: '.c',
            ruby: '.rb',
            php: '.php',
            go: '.go',
            rust: '.rs',
            swift: '.swift',
            kotlin: '.kt',
            plaintext: '.txt'
        };
        return extensions[language] || '.txt';
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `artifact-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

export const artifactHandler = new ArtifactHandler();