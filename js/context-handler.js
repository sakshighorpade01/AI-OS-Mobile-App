// context-handler.js (Updated with improved session titles)

class ContextHandler {
    constructor() {
        this.loadedSessions = []; 
        this.selectedContextSessions = []; 
        
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        const contextWindow = document.getElementById('context-window');

        this.elements = {
            contextBtn: document.querySelector('[data-tool="context"]'),
            contextWindow: contextWindow,
            closeContextBtn: contextWindow?.querySelector('.close-context-btn'),
            syncBtn: contextWindow?.querySelector('.sync-context-btn'),
            sessionsContainer: contextWindow?.querySelector('.context-content'),
            indicator: document.querySelector('.context-active-indicator'),
            contextViewer: document.getElementById('selected-context-viewer')
        };

        if (this.elements.indicator) {
            this.elements.indicator.classList.add('clickable');
            this.elements.indicator.style.cursor = 'pointer';
            this.elements.indicator.addEventListener('click', () => {
                if (window.unifiedPreviewHandler) {
                    window.unifiedPreviewHandler.showViewer();
                }
            });
        }
    
        const closeViewerBtn = document.querySelector('.close-viewer-btn');
        if (closeViewerBtn) {
            closeViewerBtn.addEventListener('click', () => this.hideContextViewer());
        }
    }

    bindEvents() {
        this.elements.contextBtn?.addEventListener('click', () => {
            this.elements.contextWindow?.classList.remove('hidden');
            this.loadSessions();
        });

        this.elements.closeContextBtn?.addEventListener('click', () => {
            this.elements.contextWindow?.classList.add('hidden');
        });

        this.elements.syncBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.loadSessions();
        });
    }

    async loadSessions() {
        if (!this.elements.sessionsContainer) return;
        this.elements.sessionsContainer.innerHTML = '<div class="session-item">Loading sessions...</div>';
        
        const session = await window.electron.auth.getSession();
        if (!session || !session.access_token) {
            this.elements.sessionsContainer.innerHTML = '<div class="session-item">Please log in to view your chat history.</div>';
            return;
        }

        try {
            const response = await fetch('https://ai-os-yjbb.onrender.com/api/sessions', {
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const sessions = await response.json();
            this.loadedSessions = sessions;
            this.showSessionList(sessions);

        } catch (err) {
            console.error('Error loading sessions:', err);
            this.elements.sessionsContainer.innerHTML = `<div class="session-item">Error loading sessions: ${err.message}</div>`;
        }
    }

    showSessionList(sessions) {
        this.elements.sessionsContainer.innerHTML = '';
        this.elements.sessionsContainer.style.display = 'grid';

        if (sessions.length === 0) {
            this.elements.sessionsContainer.innerHTML = '<div class="session-item">No sessions found.</div>';
            return;
        }

        this.addSelectionHeader();
        this.renderSessionItems(sessions);
        this.initializeSelectionControls();
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

    renderSessionItems(sessions) {
        sessions.forEach(sessionData => {
            const sessionItem = this.createSessionItem(sessionData);
            this.elements.sessionsContainer.appendChild(sessionItem);
        });
    }

    createSessionItem(session) {
        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item';
        sessionItem.dataset.sessionId = session.session_id;
        
        // --- MODIFICATION FOR BETTER UX ---
        // Generate a title from the first user message, with a fallback.
        let sessionName = `Session ${session.session_id.substring(0, 8)}...`; // Fallback title
        if (session.memory?.runs?.length > 0) {
            const firstUserRun = session.memory.runs.find(run => run.role === 'user' && run.content.trim() !== '');
            if (firstUserRun) {
                // Use the first line of the user's message as the title
                let title = firstUserRun.content.split('\n')[0].trim();
                // Truncate if it's too long
                if (title.length > 45) {
                    title = title.substring(0, 45) + '...';
                }
                sessionName = title;
            }
        }
        // --- END MODIFICATION ---
        
        const creationDate = new Date(session.created_at * 1000);
        const formattedDate = creationDate.toLocaleDateString() + ' ' + creationDate.toLocaleTimeString();
        const messageCount = session.memory?.runs?.length || 0;

        sessionItem.innerHTML = this.getSessionItemHTML(sessionName, formattedDate, messageCount);
        
        const checkbox = sessionItem.querySelector('.session-checkbox');
        const contentArea = sessionItem.querySelector('.session-content');
        
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            sessionItem.classList.toggle('selected', checkbox.checked);
            this.updateSelectionUI();
        });
        
        contentArea.onclick = () => this.showSessionDetails(session.session_id);
        
        return sessionItem;
    }

    getSessionItemHTML(sessionName, formattedDate, messageCount) {
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
                        <span>${messageCount} messages</span>
                    </div>
                </div>
            </div>
        `;
    }

    initializeSelectionControls() {
        const useSelectedBtn = this.elements.sessionsContainer.querySelector('.use-selected-btn');
        const clearBtn = this.elements.sessionsContainer.querySelector('.clear-selection-btn');

        if (useSelectedBtn) {
            useSelectedBtn.addEventListener('click', () => {
                const selectedData = this.getSelectedSessionsData();
                if (selectedData.length > 0) {
                    this.selectedContextSessions = selectedData;
                    this.elements.contextWindow.classList.add('hidden');
                    this.updateContextIndicator();
                    this.showNotification(`${selectedData.length} sessions selected as context`, 'info', 3000);
                }
            });
        }
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearSelectedContext());
        }
    }

    updateSelectionUI() {
        const selectionActions = this.elements.sessionsContainer.querySelector('.selection-actions');
        if (!selectionActions) return;
            
        const selectedCount = this.elements.sessionsContainer.querySelectorAll('.session-checkbox:checked').length;
        
        selectionActions.classList.toggle('hidden', selectedCount === 0);
        if (selectedCount > 0) {
            selectionActions.querySelector('.selected-count').textContent = `${selectedCount} selected`;
        }
    }

    getSelectedSessionsData() {
        const selectedIds = new Set();
        this.elements.sessionsContainer.querySelectorAll('.session-checkbox:checked').forEach(checkbox => {
            selectedIds.add(checkbox.closest('.session-item').dataset.sessionId);
        });

        return this.loadedSessions
            .filter(session => selectedIds.has(session.session_id))
            .map(session => ({
                interactions: session.memory.runs.map(run => ({
                    user_input: run.role === 'user' ? run.content : '',
                    llm_output: run.role === 'assistant' ? run.content : ''
                }))
            }));
    }

    showSessionDetails(sessionId) {
        const session = this.loadedSessions.find(s => s.session_id === sessionId);
        if (!session) {
            this.showNotification('Could not find session details.', 'error');
            return;
        }

        const template = document.getElementById('session-detail-template');
        if (!template) {
            console.error("Session detail template not found in chat.html!");
            return;
        }

        const view = template.content.cloneNode(true);
        
        // --- Use the same title generation logic for consistency ---
        let sessionName = `Session ${session.session_id.substring(0, 8)}...`;
        if (session.memory?.runs?.length > 0) {
            const firstUserRun = session.memory.runs.find(run => run.role === 'user' && run.content.trim() !== '');
            if (firstUserRun) {
                let title = firstUserRun.content.split('\n')[0].trim();
                if (title.length > 45) {
                    title = title.substring(0, 45) + '...';
                }
                sessionName = title;
            }
        }

        view.querySelector('h3').textContent = sessionName;
        const messagesContainer = view.querySelector('.conversation-messages');
        messagesContainer.innerHTML = '';

        if (session.memory?.runs?.length > 0) {
            session.memory.runs.forEach(run => {
                const messageEntry = document.createElement('div');
                messageEntry.className = `message-entry role-${run.role}`;
                messageEntry.innerHTML = `
                    <div class="message-content">
                        <span class="message-label">${run.role.charAt(0).toUpperCase() + run.role.slice(1)}:</span>
                        <div class="message-text">${run.content}</div>
                    </div>
                `;
                messagesContainer.appendChild(messageEntry);
            });
        } else {
            messagesContainer.innerHTML = '<div class="message-entry">No messages in this session.</div>';
        }

        view.querySelector('.back-button').addEventListener('click', () => {
            this.showSessionList(this.loadedSessions);
        });

        this.elements.sessionsContainer.innerHTML = '';
        this.elements.sessionsContainer.style.display = 'block';
        this.elements.sessionsContainer.appendChild(view);
    }

    clearSelectedContext() {
        this.elements.sessionsContainer.querySelectorAll('.session-checkbox:checked').forEach(cb => cb.checked = false);
        this.elements.sessionsContainer.querySelectorAll('.session-item.selected').forEach(item => item.classList.remove('selected'));
        this.selectedContextSessions = [];
        this.updateSelectionUI();
        this.updateContextIndicator();
    }

    updateContextIndicator() {
        if (window.unifiedPreviewHandler) {
            window.unifiedPreviewHandler.updateContextIndicator();
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        const container = document.querySelector('.notification-container') || document.body;
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `<i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i><div class="notification-text">${message}</div>`;
        container.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 10);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    getSelectedSessions() {
        return this.selectedContextSessions;
    }
    
    hideContextViewer() {
        if (this.elements.contextViewer) {
            this.elements.contextViewer.classList.remove('visible');
        }
    }
}

export default ContextHandler;