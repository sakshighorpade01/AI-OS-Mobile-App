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
        this.loadDependencies();
    }

    async loadDependencies() {
        try {
            // Load PDF.js for PDF extraction
            window.pdfjsLib = window.pdfjsLib || await import('https://mozilla.github.io/pdf.js/build/pdf.mjs');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://mozilla.github.io/pdf.js/build/pdf.worker.mjs';
            
            // Load Tesseract.js for OCR on images
            if (!window.Tesseract) {
                const tesseractScript = document.createElement('script');
                tesseractScript.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
                document.head.appendChild(tesseractScript);
                await new Promise(resolve => tesseractScript.onload = resolve);
            }
            console.log('Dependencies loaded successfully');
        } catch (error) {
            console.error('Error loading dependencies:', error);
        }
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
                // Processing status indicator
                const processingStatus = document.createElement('div');
                processingStatus.className = 'processing-status';
                processingStatus.textContent = `Processing ${file.name}...`;
                this.previewContent.appendChild(processingStatus);
                
                // Handle different file types
                if (file.type.startsWith('text/') || 
                    file.type === 'application/json') {
                    const textContent = await this.readFileAsText(file);
                    this.attachedFiles.push({
                        name: file.name,
                        content: textContent,
                        type: file.type
                    });
                } else if (file.type === 'application/pdf') {
                    const dataUrl = await this.readFileAsDataURL(file);
                    const extractedText = await this.extractTextFromPDF(dataUrl);
                    this.attachedFiles.push({
                        name: file.name,
                        content: dataUrl,
                        extractedText: extractedText,
                        type: file.type,
                        isMedia: true,
                        mediaType: 'pdf'
                    });
                } else if (file.type.includes('document')) {
                    const textContent = await this.extractTextFromDoc(file);
                    this.attachedFiles.push({
                        name: file.name,
                        content: await this.readFileAsDataURL(file),
                        extractedText: textContent,
                        type: file.type,
                        isMedia: true,
                        mediaType: 'document'
                    });
                } else if (file.type.startsWith('image/')) {
                    const dataUrl = await this.readFileAsDataURL(file);
                    const extractedText = await this.extractTextFromImage(dataUrl);
                    this.attachedFiles.push({
                        name: file.name,
                        content: dataUrl,
                        extractedText: extractedText,
                        type: file.type,
                        isMedia: true,
                        mediaType: 'image'
                    });
                } else if (file.type.startsWith('audio/')) {
                    const dataUrl = await this.readFileAsDataURL(file);
                    const transcript = await this.transcribeAudio(file);
                    this.attachedFiles.push({
                        name: file.name,
                        content: dataUrl,
                        extractedText: transcript,
                        type: file.type,
                        isMedia: true,
                        mediaType: 'audio'
                    });
                } else if (file.type.startsWith('video/')) {
                    const dataUrl = await this.readFileAsDataURL(file);
                    const transcript = await this.transcribeVideo(file);
                    this.attachedFiles.push({
                        name: file.name,
                        content: dataUrl,
                        extractedText: transcript,
                        type: file.type,
                        isMedia: true,
                        mediaType: 'video'
                    });
                }
                
                // Remove processing indicator
                processingStatus.remove();
                
                this.renderFilePreview();
                this.toggleSidebar(true);
                
                // Update the context indicator
                if (window.unifiedPreviewHandler) {
                    window.unifiedPreviewHandler.updateContextIndicator();
                }
            } catch (error) {
                console.error('Error reading file:', error);
                alert(`Error reading file: ${file.name}`);
            }
        }
        this.fileInput.value = '';
    }

    async extractTextFromPDF(dataUrl) {
        try {
            // Check if PDF.js is loaded
            if (!window.pdfjsLib) {
                console.warn('PDF.js not loaded, returning empty string');
                return 'PDF text extraction not available';
            }

            // Load the PDF
            const loadingTask = pdfjsLib.getDocument(dataUrl);
            const pdf = await loadingTask.promise;
            
            // Get the total number of pages
            const numPages = pdf.numPages;
            let extractedText = '';
            
            // Extract text from each page
            for (let i = 1; i <= numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => item.str).join(' ');
                extractedText += pageText + '\n';
            }
            
            return extractedText.trim() || 'No text was extracted from this PDF';
        } catch (error) {
            console.error('Error extracting text from PDF:', error);
            return 'Error extracting text from PDF';
        }
    }

    async extractTextFromDoc(file) {
        // For now, we'll use a placeholder - in a real implementation, 
        // you would use a library like mammoth.js for DOCX files
        return 'Document text extraction not implemented - please use a text extraction service or convert to PDF first.';
    }

    async extractTextFromImage(dataUrl) {
        try {
            // Check if Tesseract is loaded
            if (!window.Tesseract) {
                console.warn('Tesseract not loaded, returning empty string');
                return 'Image text extraction not available';
            }

            // Create a progress indicator
            const progressElement = document.createElement('div');
            progressElement.className = 'ocr-progress';
            progressElement.textContent = 'OCR: Starting...';
            document.body.appendChild(progressElement);
            
            // Run OCR on the image
            const worker = await Tesseract.createWorker('eng');
            
            // Listen for progress updates
            worker.setProgressHandler((progress) => {
                progressElement.textContent = `OCR: ${(progress.progress * 100).toFixed(0)}%`;
            });
            
            // Process the image
            const result = await worker.recognize(dataUrl);
            const text = result.data.text;
            
            // Clean up
            await worker.terminate();
            progressElement.remove();
            
            return text.trim() || 'No text was found in this image';
        } catch (error) {
            console.error('Error extracting text from image:', error);
            return 'Error extracting text from image';
        }
    }

    async transcribeAudio(file) {
        // This is a placeholder - in a real implementation you would:
        // 1. Either use the Web Speech API (with limitations)
        // 2. Or send the audio file to a server with a speech-to-text API
        return 'Audio transcription requires a speech-to-text service. Consider using Google Cloud Speech-to-Text or a similar service.';
    }

    async transcribeVideo(file) {
        // Similar placeholder - in a real implementation, you would
        // extract the audio track from the video and then transcribe it
        return 'Video transcription requires extracting audio and using a speech-to-text service.';
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    }

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
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

            if (file.isMedia) {
                if (file.mediaType === 'image') {
                    contentItem.innerHTML = `
                        <img src="${file.content}" alt="${file.name}" class="media-preview">
                        ${file.extractedText ? `<div class="extracted-text"><h4>Extracted Text:</h4><p>${file.extractedText}</p></div>` : ''}
                    `;
                } else if (file.mediaType === 'audio') {
                    contentItem.innerHTML = `
                        <audio controls class="media-preview">
                            <source src="${file.content}" type="${file.type}">
                            Your browser does not support the audio element.
                        </audio>
                        ${file.extractedText ? `<div class="extracted-text"><h4>Transcription:</h4><p>${file.extractedText}</p></div>` : ''}
                    `;
                } else if (file.mediaType === 'video') {
                    contentItem.innerHTML = `
                        <video controls class="media-preview">
                            <source src="${file.content}" type="${file.type}">
                            Your browser does not support the video element.
                        </video>
                        ${file.extractedText ? `<div class="extracted-text"><h4>Transcription:</h4><p>${file.extractedText}</p></div>` : ''}
                    `;
                } else if (file.mediaType === 'pdf') {
                    contentItem.innerHTML = `
                        <div class="pdf-preview">PDF preview not available</div>
                        ${file.extractedText ? `<div class="extracted-text"><h4>Extracted Text:</h4><p>${file.extractedText}</p></div>` : ''}
                    `;
                } else if (file.mediaType === 'document') {
                    contentItem.innerHTML = `
                        <div class="doc-preview">Document preview not available</div>
                        ${file.extractedText ? `<div class="extracted-text"><h4>Extracted Text:</h4><p>${file.extractedText}</p></div>` : ''}
                    `;
                }
            } else {
                contentItem.textContent = file.content;
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