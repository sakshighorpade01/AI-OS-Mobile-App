const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class ContextHandler {
    constructor() {
        this.selectedContextSessions = null;
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.elements = {
            contextBtn: document.querySelector('[data-tool="context"]'),
            contextWindow: document.getElementById('context-window'),
            closeContextBtn: document.querySelector('.close-context-btn'),
            syncBtn: document.querySelector('.sync-context-btn'),
            indicator: document.querySelector('.context-active-indicator'),
            sessionsContainer: document.querySelector('.context-content'),
            contextViewer: document.getElementById('selected-context-viewer')
        };

        if (this.elements.indicator) {
            this.elements.indicator.classList.add('clickable');
            this.elements.indicator.style.cursor = 'pointer';
            this.elements.indicator.addEventListener('click', () => {
                console.log('Indicator clicked'); // Debug log
                this.toggleContextViewer();
            });
        }
    
        // Add close button listener for viewer
        const closeViewerBtn = document.querySelector('.close-viewer-btn');
        if (closeViewerBtn) {
            closeViewerBtn.addEventListener('click', () => this.hideContextViewer());
        }
    
    }

    toggleContextViewer() {
        if (!this.selectedContextSessions?.length) return;
        
        const viewer = this.elements.contextViewer;
        if (viewer.classList.contains('visible')) {
            this.hideContextViewer();
        } else {
            this.showContextViewer();
        }
    }

    showContextViewer() {
        const viewer = this.elements.contextViewer;
        const content = viewer.querySelector('.context-viewer-content');
        
        content.innerHTML = this.selectedContextSessions.map((session, index) => `
            <div class="session-block">
                <h4>Session ${index + 1}</h4>
                ${session.interactions.map(int => `
                    <div class="interaction">
                        <div class="user-message"><strong>User:</strong> ${int.user_input}</div>
                        <div class="assistant-message"><strong>Assistant:</strong> ${int.llm_output}</div>
                    </div>
                `).join('')}
            </div>
        `).join('');
    
        viewer.classList.add('visible');
    }
    
    hideContextViewer() {
        this.elements.contextViewer.classList.remove('visible');
    }
    

    bindEvents() {
        this.elements.contextBtn.addEventListener('click', () => {
            this.elements.contextWindow.classList.remove('hidden');
            this.loadSessions();
        });

        this.elements.closeContextBtn.addEventListener('click', () => {
            this.elements.contextWindow.classList.add('hidden');
        });

        if (this.elements.syncBtn) {
            this.elements.syncBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.syncSessions();
            });
        }
    }

    syncSessions() {
        const pythonProcess = spawn('python', ['python-backend/context_manager.py']);
        
        pythonProcess.stdout.on('data', (data) => {
            console.log(`Sync stdout: ${data}`);
        });
        
        pythonProcess.stderr.on('data', (data) => {
            console.error(`Sync stderr: ${data}`);
        });
        
        pythonProcess.on('close', (code) => {
            console.log(`Sync process exited with code ${code}`);
            this.showNotification('Sessions synced successfully!', 'info', 3000);
            this.loadSessions();
        });
    }

    loadSessions() {
        const contextPath = path.join(__dirname, 'context');
        this.elements.sessionsContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        this.elements.sessionsContainer.innerHTML = '';

        try {
            if (!fs.existsSync(contextPath)) {
                console.error('Context directory does not exist');
                this.elements.sessionsContainer.innerHTML = '<div class="session-item">No sessions directory found</div>';
                return;
            }

            const files = fs.readdirSync(contextPath)
                .filter(file => file.endsWith('.json'))
                .sort((a, b) => {
                    return fs.statSync(path.join(contextPath, b)).mtime.getTime() - 
                           fs.statSync(path.join(contextPath, a)).mtime.getTime();
                });
            
            if (files.length === 0) {
                this.elements.sessionsContainer.innerHTML = '<div class="session-item">No sessions found</div>';
                return;
            }

            this.addSelectionHeader();
            this.renderSessionItems(files, contextPath);
            this.initializeSelectionControls();

        } catch (err) {
            console.error('Error loading sessions:', err);
            this.elements.sessionsContainer.innerHTML = '<div class="session-item">Error loading sessions</div>';
        }
    }

    addSelectionHeader() {
        const selectionHeader = document.createElement('div');
        selectionHeader.className = 'selection-controls';
        selectionHeader.innerHTML = `
            <div class="selection-actions hidden">
                <span class="selected-count">0 selected</span>
                <button class="use-selected-btn">Use Selected</button>
                <button class="clear-selection-btn">Clear</button>
            </div>
        `;
        this.elements.sessionsContainer.appendChild(selectionHeader);
    }

    renderSessionItems(files, contextPath) {
        files.forEach(file => {
            try {
                const filePath = path.join(contextPath, file);
                const data = fs.readFileSync(filePath, 'utf8');
                const session = JSON.parse(data);
                
                const sessionItem = this.createSessionItem(file, filePath, session);
                this.elements.sessionsContainer.appendChild(sessionItem);
            } catch (err) {
                console.error(`Error loading session ${file}:`, err);
            }
        });
    }

    createSessionItem(file, filePath, session) {
        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item';
        sessionItem.dataset.filepath = filePath;
        
        const sessionName = file.replace('.json', '')
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        
        const creationDate = new Date(session.created_at || fs.statSync(filePath).mtime);
        const formattedDate = creationDate.toLocaleDateString() + ' ' + 
                            creationDate.toLocaleTimeString();
        
        sessionItem.innerHTML = this.getSessionItemHTML(sessionName, formattedDate, session);
        
        const checkbox = sessionItem.querySelector('.session-checkbox');
        const contentArea = sessionItem.querySelector('.session-content');
        
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            sessionItem.classList.toggle('selected', checkbox.checked);
            this.updateSelectionUI();
        });
        
        contentArea.onclick = () => this.showSessionDetails(filePath);
        
        return sessionItem;
    }

    getSessionItemHTML(sessionName, formattedDate, session) {
        return `
            <div class="session-select">
                <input type="checkbox" class="session-checkbox" />
            </div>
            <div class="session-content">
                <h3>${sessionName}</h3>
                <div class="session-meta">
                    <div class="meta-item">
                        <i class="far fa-clock"></i>
                        <span>${formattedDate}</span>
                    </div>
                    <div class="meta-item">
                        <i class="far fa-comments"></i>
                        <span>${session.interactions?.length || 0} messages</span>
                    </div>
                </div>
            </div>
        `;
    }

    initializeSelectionControls() {
        const selectionActions = document.querySelector('.selection-actions');
        const clearBtn = document.querySelector('.clear-selection-btn');
        const useSelectedBtn = document.querySelector('.use-selected-btn');

        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearSelectedContext());
        }

        if (useSelectedBtn) {
            useSelectedBtn.addEventListener('click', () => {
                const selectedSessions = this.getSelectedSessionsData();
                if (selectedSessions.length > 0) {
                    this.selectedContextSessions = selectedSessions;
                    this.elements.contextWindow.classList.add('hidden');
                    this.updateContextIndicator();
                    this.showNotification(`${selectedSessions.length} sessions selected as context`, 'info', 3000);
                }
            });
        }
    }

    updateSelectionUI() {
        const selectionActions = document.querySelector('.selection-actions');
        const selectedCount = document.querySelectorAll('.session-checkbox:checked').length;
        
        if (selectedCount > 0) {
            selectionActions.classList.remove('hidden');
            selectionActions.querySelector('.selected-count').textContent = 
                `${selectedCount} selected`;
        } else {
            selectionActions.classList.add('hidden');
        }
    }

    getSelectedSessionsData() {
        const selectedSessions = [];
        document.querySelectorAll('.session-checkbox:checked').forEach(checkbox => {
            const sessionItem = checkbox.closest('.session-item');
            const filePath = sessionItem.dataset.filepath;
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (data && data.interactions) {
                    selectedSessions.push({
                        interactions: data.interactions.map(interaction => ({
                            user_input: interaction.user_input,
                            llm_output: interaction.llm_output
                        }))
                    });
                }
            } catch (err) {
                console.error(`Error reading session data: ${filePath}`, err);
                this.showNotification(`Error reading session data: ${err.message}`, 'error');
            }
        });
        return selectedSessions;
    }

    showSessionDetails(filePath) {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            const session = JSON.parse(data);
            
            this.elements.sessionsContainer.style.gridTemplateColumns = '1fr';
            
            const sessionName = path.basename(filePath, '.json')
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            
            this.elements.sessionsContainer.innerHTML = this.getSessionDetailsHTML(sessionName, session);

            document.getElementById('back-to-sessions').addEventListener('click', (e) => {
                e.preventDefault();
                this.loadSessions();
            });
            
        } catch (err) {
            console.error('Error showing session details:', err);
            this.showSessionDetailsError();
        }
    }

    getSessionDetailsHTML(sessionName, session) {
        return `
            <div class="session-details-view">
                <div class="session-header">
                    <button class="back-button" id="back-to-sessions">
                        <i class="fas fa-arrow-left"></i>
                        Back
                    </button>
                    <h3>${sessionName}</h3>
                </div>
                
                <div class="conversation-history">
                    <div class="conversation-header">
                        <h3>Conversation History</h3>
                    </div>
                    <div class="conversation-messages">
                        ${session.interactions && session.interactions.length 
                            ? session.interactions.map(interaction => `
                                <div class="message-entry">
                                    <div class="message-content">
                                        <span class="message-label">User Input:</span>
                                        ${interaction.user_input}
                                        <br>
                                        <span class="message-label">Assistant:</span>
                                        ${interaction.llm_output[0]}
                                    </div>
                                </div>
                              `).join('')
                            : '<div class="message-entry">No messages in this session</div>'
                        }
                    </div>
                </div>
            </div>
        `;
    }

    showSessionDetailsError() {
        this.elements.sessionsContainer.innerHTML = `
            <div class="session-details-view">
                <button class="back-button" id="back-to-sessions">
                    <i class="fas fa-arrow-left"></i>
                    Back to Sessions
                </button>
                <div class="session-info">
                    <h3>Error</h3>
                    <p>Unable to load session details. Please try again.</p>
                </div>
            </div>
        `;
        
        document.getElementById('back-to-sessions').addEventListener('click', (e) => {
            e.preventDefault();
            this.loadSessions();
        });
    }

    clearSelectedContext() {
        document.querySelectorAll('.session-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });
        document.querySelectorAll('.session-item').forEach(item => {
            item.classList.remove('selected');
        });
        this.selectedContextSessions = null;
        this.updateContextIndicator();
        this.updateSelectionUI();
        this.hideContextViewer();
    }

    updateContextIndicator() {
        const sessionCount = this.selectedContextSessions?.length || 0;
        
        if (this.elements.indicator) {
            this.elements.indicator.classList.toggle('visible', sessionCount > 0);
            const countSpan = this.elements.indicator.querySelector('.context-count');
            if (countSpan) {
                countSpan.textContent = sessionCount > 0 ? `${sessionCount} sessions in context` : '';
            }
        }
    }

    showNotification(message, type = 'error', duration = 10000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        const icon = document.createElement('i');
        icon.className = type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-info-circle';
        
        const textDiv = document.createElement('div');
        textDiv.className = 'notification-text';
        textDiv.textContent = message;
        
        notification.appendChild(icon);
        notification.appendChild(textDiv);
        
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 100);
        
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

    getSelectedSessions() {
        return this.selectedContextSessions;
    }
}
export default ContextHandler;