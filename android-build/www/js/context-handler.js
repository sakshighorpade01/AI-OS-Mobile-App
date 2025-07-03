// js/context-handler.js
import { supabase } from './supabase-client.js';

class ContextHandler {
    constructor() {
        this.loadedSessions = [];
        this.selectedContextSessions = [];
        this.elements = {};
    }

    initializeElements() {
        this.elements.contextWindow = document.getElementById('context-window');
        if (!this.elements.contextWindow) return;

        this.elements.closeContextBtn = this.elements.contextWindow.querySelector('.close-context-btn');
        this.elements.syncBtn = this.elements.contextWindow.querySelector('.sync-context-btn');
        this.elements.sessionsContainer = this.elements.contextWindow.querySelector('.context-content');
        this.elements.contextBtn = document.querySelector('[data-tool="context"]');
    }

    bindEvents() {
        if (!this.elements.contextWindow) return;

        // Button that opens the context window (tool-btn)
        this.elements.contextBtn?.addEventListener('click', () => this.toggleWindow(true));

        // Modal close logic
        this.elements.closeContextBtn?.addEventListener('click', () => this.toggleWindow(false));
        this.elements.contextWindow.addEventListener('click', (e) => {
            if (e.target === this.elements.contextWindow) {
                this.toggleWindow(false);
            }
        });

        // Sync/reload sessions
        this.elements.syncBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.loadSessions();
        });

        // Checkbox selection handler
        this.elements.sessionsContainer?.addEventListener('change', (e) => {
            if (e.target.matches('.session-checkbox')) {
                const sessionItem = e.target.closest('.session-item');
                if (sessionItem) {
                    sessionItem.classList.toggle('selected', e.target.checked);
                }
                this.updateSelectionUI();
            }
        });
    }

    toggleWindow(show) {
        if (this.elements.contextWindow) {
            this.elements.contextWindow.classList.toggle('hidden', !show);
            if (show) this.loadSessions();
        }
    }

    async loadSessions() {
        if (!this.elements.sessionsContainer) return;

        this.elements.sessionsContainer.innerHTML = '<div class="session-item-loading">Loading sessions...</div>';

        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) {
            this.elements.sessionsContainer.innerHTML = '<div class="empty-state">Please log in to view chat history.</div>';
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
            this.elements.sessionsContainer.innerHTML = `<div class="empty-state">Error loading sessions: ${err.message}</div>`;
        }
    }

    showSessionList(sessions) {
        this.elements.sessionsContainer.innerHTML = '';
        this.elements.sessionsContainer.style.display = 'grid';

        if (sessions.length === 0) {
            this.elements.sessionsContainer.innerHTML = '<div class="empty-state">No sessions found.</div>';
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
            </div>`;
        this.elements.sessionsContainer.appendChild(selectionHeader);
    }

    renderSessionItems(sessions) {
        sessions.forEach(sessionData => {
            this.elements.sessionsContainer.appendChild(this.createSessionItem(sessionData));
        });
    }

    createSessionItem(session) {
        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item';
        sessionItem.dataset.sessionId = session.session_id;

        let sessionName = `Session ${session.session_id.substring(0, 8)}...`;
        if (session.memory?.runs?.length > 0) {
            const firstUserRun = session.memory.runs.find(run => run.role === 'user' && run.content.trim() !== '');
            if (firstUserRun) {
                let title = firstUserRun.content.split('\n')[0].trim();
                if (title.length > 45) title = title.substring(0, 45) + '...';
                sessionName = title;
            }
        }

        const creationDate = new Date(session.created_at * 1000);
        const formattedDate = creationDate.toLocaleDateString() + ' ' + creationDate.toLocaleTimeString();
        const messageCount = session.memory?.runs?.length || 0;

        sessionItem.innerHTML = this.getSessionItemHTML(session, sessionName, formattedDate, messageCount);

        const contentArea = sessionItem.querySelector('.session-content');
        contentArea.onclick = (e) => {
            if (!['input', 'label'].includes(e.target.tagName.toLowerCase())) {
                this.showSessionDetails(session.session_id);
            }
        };

        return sessionItem;
    }

    getSessionItemHTML(session, sessionName, formattedDate, messageCount) {
        const checkboxId = `session-check-${session.session_id}`;
        return `
            <div class="session-select">
                <input type="checkbox" class="session-checkbox" id="${checkboxId}" />
                <label for="${checkboxId}" class="checkbox-label"><i class="fas fa-check"></i></label>
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

        useSelectedBtn?.addEventListener('click', () => {
            const selectedData = this.getSelectedSessionsData();
            if (selectedData.length > 0) {
                this.selectedContextSessions = selectedData;
                this.toggleWindow(false);
                this.showNotification(`${selectedData.length} sessions selected as context`, 'info');
            }
        });

        clearBtn?.addEventListener('click', () => this.clearSelectedContext());
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
            console.error('Session detail template not found!');
            return;
        }

        const view = template.content.cloneNode(true);
        view.querySelector('h3').textContent = `Session ${session.session_id.substring(0, 8)}...`;

        const conversationContainer = view.querySelector('.conversation-messages');
        session.memory.runs.forEach(run => {
            const msgDiv = document.createElement('div');
            msgDiv.className = `message-block ${run.role}`;
            msgDiv.innerHTML = `<strong>${run.role}</strong>: ${run.content}`;
            conversationContainer.appendChild(msgDiv);
        });

        this.elements.sessionsContainer.innerHTML = '';
        this.elements.sessionsContainer.appendChild(view);

        const backButton = this.elements.sessionsContainer.querySelector('.back-button');
        backButton?.addEventListener('click', () => this.showSessionList(this.loadedSessions));
    }

    clearSelectedContext() {
        this.elements.sessionsContainer?.querySelectorAll('.session-checkbox:checked').forEach(cb => cb.checked = false);
        this.elements.sessionsContainer?.querySelectorAll('.session-item.selected').forEach(item => item.classList.remove('selected'));
        this.selectedContextSessions = [];
        this.updateSelectionUI();
    }

    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.classList.add('show'), 10);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    getSelectedSessions() {
        return this.selectedContextSessions;
    }
}

export default ContextHandler;
