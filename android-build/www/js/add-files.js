// add-files.js (Browser-Compatible Version)
import { supabase } from './supabase-client.js';

class FileAttachmentHandler {
    constructor() {
        this.supportedFileTypes = {
            'txt': 'text/plain', 'js': 'text/javascript', 'py': 'text/x-python', 'html': 'text/html',
            'css': 'text/css', 'json': 'application/json', 'c': 'text/x-c',
            'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif'
        };
        this.maxFileSize = 10 * 1024 * 1024; // 10MB
        this.attachedFiles = [];
        this.initialize();
    }

    initialize() {
        this.attachButton = document.getElementById('attach-file-btn');
        this.fileInput = document.getElementById('file-input');
        
        this.attachButton?.addEventListener('click', (event) => {
            event.preventDefault();
            this.fileInput.click();
        });

        this.fileInput?.addEventListener('change', (event) => {
            this.handleFileSelection(event);
        });
    }

    async uploadFileToSupabase(file) {
        // FIX: Replaced window.electron with the browser-compatible supabase client.
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            throw new Error("User not authenticated. Please log in again.");
        }

        const response = await fetch('https://ai-os-yjbb.onrender.com/api/generate-upload-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ fileName: file.name })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Could not get an upload URL from the server.');
        }

        const { signedURL, path } = await response.json();
        if (!signedURL) {
             throw new Error('The server did not return a valid signed URL.');
        }

        const uploadResponse = await fetch(signedURL, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file
        });

        if (!uploadResponse.ok) {
            throw new Error('File upload to cloud storage failed.');
        }
        return path;
    }
    
    // ... (The rest of the file is unchanged and correct) ...

    async handleFileSelection(event) {
        const files = Array.from(event.target.files);
        if (files.length + this.attachedFiles.length > 10) { // Limit to 10 files for now
            alert("You can attach a maximum of 10 files.");
            return;
        }

        for (const file of files) {
            if (file.size > this.maxFileSize) {
                alert(`File too large: ${file.name}`);
                continue;
            }
            
            const fileIndex = this.attachedFiles.length;
            const fileObject = {
                id: `file_${Date.now()}_${fileIndex}`,
                name: file.name,
                type: file.type,
                status: 'uploading', 
                isText: file.type.startsWith('text/') || this.supportedFileTypes[file.name.split('.').pop()] === 'text/plain',
                file, // Keep the original file object for upload
            };
            this.attachedFiles.push(fileObject);
            // In a full UI, you would render a preview here.

            try {
                if (fileObject.isText) {
                    fileObject.content = await this.readFileAsText(file);
                    fileObject.status = 'completed';
                } else {
                    const filePathInBucket = await this.uploadFileToSupabase(file);
                    fileObject.path = filePathInBucket;
                    fileObject.status = 'completed';
                }
            } catch(error) {
                console.error('File processing failed:', error);
                alert(`Failed to process ${file.name}: ${error.message}`);
                fileObject.status = 'failed';
            }
            // Update UI with file status
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

    getAttachedFiles() {
        return this.attachedFiles.filter(file => file.status === 'completed');
    }

    clearAttachedFiles() {
        this.attachedFiles = [];
        // Update UI to remove all file previews
    }
}

export default FileAttachmentHandler;