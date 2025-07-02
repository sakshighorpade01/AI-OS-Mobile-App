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

        container.querySelector('.close-artifact-btn').addEventListener('click', () => this.hideArtifact());
        container.querySelector('.copy-artifact-btn').addEventListener('click', () => this.copyArtifactContent());
        container.querySelector('.download-artifact-btn').addEventListener('click', () => this.downloadArtifact());
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

        contentDiv.innerHTML = '';

        if (type === 'mermaid') {
            const mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid';
            mermaidDiv.textContent = content;
            contentDiv.appendChild(mermaidDiv);
            mermaid.init(undefined, [mermaidDiv]);

            const zoomControls = document.createElement('div');
            zoomControls.className = 'mermaid-controls';
            zoomControls.innerHTML = `
                <button class="zoom-in-btn" title="Zoom In"><i class="fas fa-plus"></i></button>
                <button class="zoom-out-btn" title="Zoom Out"><i class="fas fa-minus"></i></button>
                <button class="zoom-reset-btn" title="Reset Zoom"><i class="fas fa-search"></i></button>
            `;
            contentDiv.appendChild(zoomControls);

            let currentZoom = 1;
            mermaidDiv.style.transform = 'scale(1)';
            mermaidDiv.style.transformOrigin = 'center center';

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
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = `language-${type}`;
            code.textContent = content;
            pre.appendChild(code);
            contentDiv.appendChild(pre);
            hljs.highlightElement(code);
        }

        container.classList.remove('hidden');
        chatContainer?.classList.add('with-artifact');
        inputContainer?.classList.add('with-artifact');

        return artifactId || this.createArtifact(content, type);
    }

    hideArtifact() {
        const container = document.getElementById('artifact-container');
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        container.classList.add('hidden');
        chatContainer?.classList.remove('with-artifact');
        inputContainer?.classList.remove('with-artifact');
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
            suggestedName = `code`;
            mimeType = this.getMimeType(extension);
        }

        if (!content) return;

        if (window.electron?.ipcRenderer) {
            // Electron save
            try {
                const result = await window.electron.ipcRenderer.invoke('show-save-dialog', {
                    title: 'Save File',
                    defaultPath: suggestedName + extension,
                    filters: [{ name: 'All Files', extensions: [extension.slice(1)] }]
                });

                if (result.canceled || !result.filePath) return;

                const success = await window.electron.ipcRenderer.invoke('save-file', {
                    filePath: result.filePath,
                    content: content
                });

                this.showNotification(success ? 'File saved successfully' : 'Failed to save file', success ? 'success' : 'error');
            } catch (error) {
                console.error('Electron Save Error:', error);
                this.showNotification('Error: ' + error.message, 'error');
            }
        } else {
            // Browser-compatible download
            try {
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = suggestedName + extension;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.showNotification('File download started', 'success');
            } catch (error) {
                console.error('Browser Save Error:', error);
                this.showNotification('Error: ' + error.message, 'error');
            }
        }
    }

    getFileExtension(language) {
        const map = {
            javascript: '.js', python: '.py', html: '.html', css: '.css', json: '.json',
            typescript: '.ts', java: '.java', cpp: '.cpp', c: '.c', ruby: '.rb',
            php: '.php', go: '.go', rust: '.rs', swift: '.swift', kotlin: '.kt',
            plaintext: '.txt'
        };
        return map[language] || '.txt';
    }

    getMimeType(extension) {
        const map = {
            '.js': 'application/javascript',
            '.py': 'text/x-python',
            '.html': 'text/html',
            '.css': 'text/css',
            '.json': 'application/json',
            '.ts': 'application/typescript',
            '.txt': 'text/plain',
            '.mmd': 'text/plain',
            '.cpp': 'text/x-c++src',
            '.c': 'text/x-c',
            '.java': 'text/x-java-source'
        };
        return map[extension] || 'text/plain';
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `artifact-notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 100);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

export const artifactHandler = new ArtifactHandler();
