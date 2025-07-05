import { supabase } from './supabase-client.js';

const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168');
const BACKEND_URL = IS_LOCAL ? 'https://ai-os-yjbb.onrender.com' : '';

class FileAttachmentHandler {
  constructor() {
    // Supported file types including audio and video
    this.supportedFileTypes = {
      // Text files
      'txt': 'text/plain', 'js': 'text/javascript', 'py': 'text/x-python', 'html': 'text/html',
      'css': 'text/css', 'json': 'application/json', 'c': 'text/x-c',
      // Document files
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Image files
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif',
      // Audio files
      'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4',
      // Video files
      'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime', 'avi': 'video/x-msvideo'
    };

    this.maxFileSize = 10 * 1024 * 1024; // 10MB
    this.attachedFiles = [];
    this.initialize();
  }

  initialize() {
    this.attachButton = document.getElementById('attach-file-btn');
    this.fileInput = document.getElementById('file-input');
    this.previewsContainer = document.getElementById('file-previews-container');

    this.attachButton?.addEventListener('click', (event) => {
      event.preventDefault();
      this.fileInput.click();
    });

    this.fileInput?.addEventListener('change', (event) => {
      this.handleFileSelection(event);
    });
  }

  async uploadFileToSupabase(file) {
    await supabase.auth.refreshSession();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error("User not authenticated. Please log in again.");
    }

    const response = await fetch(`${BACKEND_URL}/api/generate-upload-url`, {
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
    if (!signedURL) throw new Error('The server did not return a valid signed URL.');

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

  async handleFileSelection(event) {
    const files = Array.from(event.target.files);
    if (files.length + this.attachedFiles.length > 10) {
      alert("You can attach a maximum of 10 files.");
      return;
    }

    for (const file of files) {
      if (file.size > this.maxFileSize) {
        alert(`File too large: ${file.name}`);
        continue;
      }

      const fileIndex = this.attachedFiles.length;
      const ext = file.name.split('.').pop().toLowerCase();
      const isText = file.type.startsWith('text/') ||
                     this.supportedFileTypes[ext] === 'text/plain';

      const fileObject = {
        id: `file_${Date.now()}_${fileIndex}`,
        name: file.name,
        type: file.type,
        status: 'uploading',
        isText,
        file,
      };

      this.attachedFiles.push(fileObject);
      this.renderPreviews(); // initial state

      try {
        if (fileObject.isText) {
          fileObject.content = await this.readFileAsText(file);
        } else {
          fileObject.path = await this.uploadFileToSupabase(file);
        }
        fileObject.status = 'completed';
      } catch (error) {
        console.error(`Failed to process ${file.name}:`, error);
        fileObject.status = 'failed';
      }

      this.renderPreviews(); // updated state
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

  renderPreviews() {
    if (!this.previewsContainer) return;
    this.previewsContainer.innerHTML = '';

    this.attachedFiles.forEach((fileObject, index) => {
      const previewElement = document.createElement('div');
      previewElement.className = 'file-preview-item';

      let statusIcon = '';
      if (fileObject.status === 'uploading') {
        statusIcon = '<i class="fas fa-spinner fa-spin"></i>';
      } else if (fileObject.status === 'failed') {
        statusIcon = '<i class="fas fa-exclamation-circle error-icon"></i>';
      } else {
        statusIcon = '<i class="fas fa-check-circle success-icon"></i>';
      }

      previewElement.innerHTML = `
        <span class="file-name">${fileObject.name}</span>
        <span class="file-status">${statusIcon}</span>
        <button class="remove-file-btn" data-index="${index}">×</button>
      `;

      this.previewsContainer.appendChild(previewElement);
    });

    this.previewsContainer.querySelectorAll('.remove-file-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const indexToRemove = parseInt(e.currentTarget.dataset.index, 10);
        this.removeFile(indexToRemove);
      });
    });
  }

  removeFile(index) {
    this.attachedFiles.splice(index, 1);
    this.renderPreviews();
  }

  getAttachedFiles() {
    return this.attachedFiles.filter(file => file.status === 'completed');
  }

  clearAttachedFiles() {
    this.attachedFiles = [];
    this.renderPreviews();
  }
}

export default FileAttachmentHandler;
