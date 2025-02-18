class FileAttachmentHandler {
    constructor(socket) {
        this.socket = socket;
        this.attachedFiles = [];
        this.initialize();
    }

    initialize() {
        this.attachButton = document.getElementById('attach-file-btn');
        this.fileInput = document.getElementById('file-input');
        this.sidebar = document.getElementById('file-preview-sidebar');
        this.previewContent = this.sidebar.querySelector('.file-preview-content');
        this.fileCount = this.sidebar.querySelector('.file-count');

        this.attachButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.fileInput.click();
        });

        this.fileInput.addEventListener('change', async (event) => {
            await this.handleFileSelection(event);
        });

        // Close sidebar button
        this.sidebar.querySelector('.close-preview-btn').addEventListener('click', () => {
            this.toggleSidebar(false);
        });
    }

    async handleFileSelection(event) {
        const files = Array.from(event.target.files);
        if (files.length + this.attachedFiles.length > 5) {
            alert("You can attach a maximum of 5 files.");
            return;
        }

        for (const file of files) {
            if (!file.type.startsWith('text/') &&
                file.type !== 'application/pdf' &&
                file.type !== 'application/json' &&
                !file.name.endsWith('.docx') &&
                !file.name.endsWith('.py') &&
                !file.name.endsWith('.js') &&
                !file.name.endsWith('.html') &&
                !file.name.endsWith('.css') &&
                !file.name.endsWith('.c')) {
                alert(`File type not supported: ${file.name}`);
                continue;
            }

            try {
                const textContent = await this.readFileContent(file);
                this.attachedFiles.push({
                    name: file.name,
                    content: textContent,
                    type: file.type
                });
                this.renderFilePreview();
                this.toggleSidebar(true);
            } catch (error) {
                console.error('Error reading file:', error);
                alert(`Error reading file: ${file.name}`);
            }
        }
        this.fileInput.value = '';
    }

    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    }

    getFileIcon(fileName) {
        const extension = fileName.split('.').pop().toLowerCase();
        const iconMap = {
            'js': 'fab fa-js',
            'py': 'fab fa-python',
            'html': 'fab fa-html5',
            'css': 'fab fa-css3',
            'json': 'fas fa-code',
            'txt': 'fas fa-file-alt',
            'pdf': 'fas fa-file-pdf',
            'docx': 'fas fa-file-word',
            'c': 'fas fa-file-code'
        };
        return iconMap[extension] || 'fas fa-file';
    }

    renderFilePreview() {
        this.previewContent.innerHTML = '';
        this.fileCount.textContent = this.attachedFiles.length;

        this.attachedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-preview-item';
            
            const headerItem = document.createElement('div');
            headerItem.className = 'file-preview-header-item';
            
            const fileInfo = document.createElement('div');
            fileInfo.className = 'file-info';
            fileInfo.innerHTML = `
                <i class="${this.getFileIcon(file.name)} file-icon"></i>
                <span class="file-name">${file.name}</span>
            `;

            const actions = document.createElement('div');
            actions.className = 'file-actions';
            actions.innerHTML = `
                <button class="preview-toggle" title="Toggle Preview">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="remove-file" title="Remove File">
                    <i class="fas fa-times"></i>
                </button>
            `;

            headerItem.appendChild(fileInfo);
            headerItem.appendChild(actions);

            const contentItem = document.createElement('div');
            contentItem.className = 'file-preview-content-item';
            contentItem.textContent = file.content;

            fileItem.appendChild(headerItem);
            fileItem.appendChild(contentItem);

            // Event listeners
            actions.querySelector('.preview-toggle').addEventListener('click', () => {
                contentItem.classList.toggle('visible');
            });

            actions.querySelector('.remove-file').addEventListener('click', () => {
                this.removeFile(index);
            });

            this.previewContent.appendChild(fileItem);
        });
    }

    toggleSidebar(show) {
        this.sidebar.classList.toggle('visible', show);
        document.getElementById('chat-container').classList.toggle('sidebar-open', show);
        document.getElementById('floating-input-container').classList.toggle('sidebar-open', show);
    }

    removeFile(index) {
        this.attachedFiles.splice(index, 1);
        this.renderFilePreview();
    }

    getAttachedFiles() {
        return this.attachedFiles;
    }

    clearAttachedFiles() {
        this.attachedFiles = [];
        this.renderFilePreview();
        this.toggleSidebar(false);
    }
}

export default FileAttachmentHandler;