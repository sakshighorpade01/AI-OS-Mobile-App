class FileAttachmentHandler {
    constructor(socket, supportedFileTypes, maxFileSize) {
        // socket parameter is kept for backward compatibility but no longer used
        this.supportedFileTypes = supportedFileTypes || {
            // Text files
            'txt': 'text/plain',
            'js': 'text/javascript',
            'py': 'text/x-python',
            'html': 'text/html',
            'css': 'text/css',
            'json': 'application/json',
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'c': 'text/x-c',
            // Image files
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp',
            // Audio files
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'm4a': 'audio/mp4',
            // Video files
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'avi': 'video/x-msvideo',
            'mov': 'video/quicktime',
            'mkv': 'video/x-matroska'
        };
        this.maxFileSize = maxFileSize || 10 * 1024 * 1024; // 10MB default
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
        if (files.length + this.attachedFiles.length > 50) {
            alert("You can attach a maximum of 50 files.");
            return;
        }

        for (const file of files) {
            // Check file size
            if (file.size > this.maxFileSize) {
                alert(`File too large: ${file.name} (max size: ${Math.round(this.maxFileSize/1024/1024)}MB)`);
                continue;
            }

            // Check if file type is supported
            const extension = file.name.split('.').pop().toLowerCase();
            const mimeType = this.supportedFileTypes[extension] || file.type;
            const isSupported = this.supportedFileTypes[extension] || file.type.startsWith('text/') || 
                                file.type.startsWith('image/') || file.type.startsWith('audio/') || 
                                file.type.startsWith('video/');
            
            if (!isSupported) {
                alert(`File type not supported: ${file.name}`);
                continue;
            }

            try {
                // Store file information with the path property
                const fileObject = {
                        name: file.name,
                        type: file.type,
                };

                // In Electron, we can access the file's path directly from the File object
                // This is not available in standard browsers
                if (file.path) {
                    fileObject.path = file.path;
                    console.log(`File path: ${file.path} for ${file.name}`);
                } else {
                    console.warn(`No file path available for ${file.name} - multimodal processing may be limited`);
                }

                // Handle file based on type
                if (file.type.startsWith('image/')) {
                    fileObject.mediaType = 'image';
                    fileObject.previewUrl = URL.createObjectURL(file);
                    // For images, we only send the path (no content extraction)
                    fileObject.isMedia = true;
                } else if (file.type.startsWith('audio/')) {
                    fileObject.mediaType = 'audio';
                    fileObject.previewUrl = URL.createObjectURL(file);
                    // For audio, we only send the path (no content extraction)
                    fileObject.isMedia = true;
                } else if (file.type.startsWith('video/')) {
                    fileObject.mediaType = 'video';
                    fileObject.previewUrl = URL.createObjectURL(file);
                    // For video, we only send the path (no content extraction)
                    fileObject.isMedia = true;
                } else if (file.type === 'application/pdf') {
                    fileObject.mediaType = 'pdf';
                    // Create preview URL for PDF files
                    fileObject.previewUrl = URL.createObjectURL(file);
                    // For PDFs, we only send the path (no content extraction)
                    fileObject.isMedia = true;
                } else if (file.type.includes('document')) {
                    fileObject.mediaType = 'document';
                    fileObject.isMedia = true;
                } else if (file.type.startsWith('text/') || file.type === 'application/json' || 
                          ['py', 'js', 'c', 'cpp', 'java', 'html', 'css', 'txt'].includes(extension)) {
                    // For text files, extract content and send it along with the path
                    fileObject.content = await this.readFileAsText(file);
                    fileObject.isText = true; // Flag to indicate this is a text file with content
                    fileObject.mediaType = 'text';
                }

                this.attachedFiles.push(fileObject);
                this.renderFilePreview();
                this.toggleSidebar(true);
                
                // Update the context indicator
                if (window.unifiedPreviewHandler) {
                    window.unifiedPreviewHandler.updateContextIndicator();
                }
            } catch (error) {
                console.error('Error processing file:', error);
                alert(`Error processing file: ${file.name}`);
            }
        }
        this.fileInput.value = '';
    }

    readFileAsText(file) {
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
            // Text files
            'js': 'fab fa-js',
            'py': 'fab fa-python',
            'html': 'fab fa-html5',
            'css': 'fab fa-css3',
            'json': 'fas fa-code',
            'txt': 'fas fa-file-alt',
            'pdf': 'fas fa-file-pdf',
            'docx': 'fas fa-file-word',
            'c': 'fas fa-file-code',
            // Image files
            'jpg': 'fas fa-file-image',
            'jpeg': 'fas fa-file-image',
            'png': 'fas fa-file-image',
            'gif': 'fas fa-file-image',
            'svg': 'fas fa-file-image',
            'webp': 'fas fa-file-image',
            // Audio files
            'mp3': 'fas fa-file-audio',
            'wav': 'fas fa-file-audio',
            'ogg': 'fas fa-file-audio',
            'm4a': 'fas fa-file-audio',
            // Video files
            'mp4': 'fas fa-file-video',
            'webm': 'fas fa-file-video',
            'avi': 'fas fa-file-video',
            'mov': 'fas fa-file-video',
            'mkv': 'fas fa-file-video'
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

            fileItem.appendChild(headerItem);

            // Create content container based on file type
            const contentItem = document.createElement('div');
            contentItem.className = 'file-preview-content-item';

            if (file.mediaType === 'image' && file.previewUrl) {
                    contentItem.innerHTML = `
                    <img src="${file.previewUrl}" alt="${file.name}" class="media-preview">
                    <p class="file-path-info">File path: ${file.path || "Path not available in browser"}</p>
                    `;
            } else if (file.mediaType === 'audio' && file.previewUrl) {
                    contentItem.innerHTML = `
                        <audio controls class="media-preview">
                        <source src="${file.previewUrl}" type="${file.type}">
                            Your browser does not support the audio element.
                        </audio>
                    <p class="file-path-info">File path: ${file.path || "Path not available in browser"}</p>
                    `;
            } else if (file.mediaType === 'video' && file.previewUrl) {
                    contentItem.innerHTML = `
                        <video controls class="media-preview">
                        <source src="${file.previewUrl}" type="${file.type}">
                            Your browser does not support the video element.
                        </video>
                    <p class="file-path-info">File path: ${file.path || "Path not available in browser"}</p>
                    `;
            } else if (file.mediaType === 'pdf' && file.previewUrl) {
                    contentItem.innerHTML = `
                    <iframe src="${file.previewUrl}" class="pdf-preview"></iframe>
                    <p class="file-path-info">File path: ${file.path || "Path not available in browser"}</p>
                    `;
                } else if (file.mediaType === 'document') {
                    contentItem.innerHTML = `
                        <div class="doc-preview">Document preview not available</div>
                    <p class="file-path-info">File path: ${file.path || "Path not available in browser"}</p>
                    `;
            } else if (file.content) {
                // For text files, display content
                contentItem.innerHTML = `<pre>${file.content}</pre>`;
            } else {
                // Fallback for other file types
                contentItem.innerHTML = `
                    <p class="file-path-info">File path: ${file.path || "Path not available in browser"}</p>
                `;
            }

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
        // Instead of showing the separate sidebar, use the unified preview handler
        if (show && window.unifiedPreviewHandler) {
            window.unifiedPreviewHandler.showViewer();
            // Select the Files tab
            const filesTab = document.querySelector('.viewer-tab[data-tab="files"]');
            if (filesTab) {
                filesTab.click();
            }
        } else {
            // For backward compatibility, still toggle the original sidebar classes
            this.sidebar.classList.toggle('visible', show);
            document.getElementById('chat-container').classList.toggle('sidebar-open', show);
            document.getElementById('floating-input-container').classList.toggle('sidebar-open', show);
        }
        
        // Always update the context indicator when files are attached or removed
        if (window.unifiedPreviewHandler) {
            window.unifiedPreviewHandler.updateContextIndicator();
        }
    }

    removeFile(index) {
        // Release the object URL if it exists
        if (this.attachedFiles[index].previewUrl) {
            URL.revokeObjectURL(this.attachedFiles[index].previewUrl);
        }
        
        this.attachedFiles.splice(index, 1);
        this.renderFilePreview();
        
        // Update the context indicator
        if (window.unifiedPreviewHandler) {
            window.unifiedPreviewHandler.updateContextIndicator();
        }
        
        // If no files are left, hide the sidebar
        if (this.attachedFiles.length === 0) {
            this.toggleSidebar(false);
        }
    }

    getAttachedFiles() {
        return this.attachedFiles;
    }

    clearAttachedFiles() {
        // Release all object URLs
        this.attachedFiles.forEach(file => {
            if (file.previewUrl) {
                URL.revokeObjectURL(file.previewUrl);
            }
        });
        
        this.attachedFiles = [];
        this.renderFilePreview();
        this.toggleSidebar(false);
        
        // Update the context indicator
        if (window.unifiedPreviewHandler) {
            window.unifiedPreviewHandler.updateContextIndicator();
        }
    }
}

export default FileAttachmentHandler;