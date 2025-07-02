export class ToDoList {
    constructor() {
        this.tasks = [];
        this.elements = {};
    }

    async init() {
        this.cacheElements();
        this.setupEventListeners();
        await this.loadData();
        this.renderTasks();
    }

    async loadData() {
        const data = localStorage.getItem('aios_tasks');
        this.tasks = data ? JSON.parse(data) : [];
    }

    saveData() {
        localStorage.setItem('aios_tasks', JSON.stringify(this.tasks));
    }

    cacheElements() {
        this.elements = {
            container: document.getElementById('to-do-list-container'),
            taskList: document.getElementById('task-list'),
            addTaskBtn: document.getElementById('add-task-btn'),
            newTaskModal: document.getElementById('new-task-modal'),
            taskNameInput: document.getElementById('task-name'),
            saveTaskBtn: document.getElementById('save-task-btn'),
            cancelTaskBtn: document.getElementById('cancel-task-btn'),
            contextBtn: document.getElementById('context-btn'),
            userContextModal: document.getElementById('user-context-modal'),
            saveContextBtn: document.getElementById('save-context-btn'),
            cancelContextBtn: document.getElementById('cancel-context-btn'),
        };
    }

    setupEventListeners() {
        this.elements.addTaskBtn?.addEventListener('click', () => this.openNewTaskModal());
        this.elements.saveTaskBtn?.addEventListener('click', () => this.saveNewTask());
        this.elements.cancelTaskBtn?.addEventListener('click', () => this.closeNewTaskModal());
        
        this.elements.contextBtn?.addEventListener('click', () => this.openUserContextModal());
        this.elements.saveContextBtn?.addEventListener('click', () => this.saveUserContext());
        this.elements.cancelContextBtn?.addEventListener('click', () => this.closeUserContextModal());
    }

    openNewTaskModal() {
        this.elements.newTaskModal?.classList.remove('hidden');
    }

    closeNewTaskModal() {
        this.elements.newTaskModal?.classList.add('hidden');
        const form = this.elements.newTaskModal?.querySelector('form');
        if (form) form.reset();
    }

    saveNewTask() {
        const taskName = this.elements.taskNameInput.value.trim();
        if (!taskName) {
            alert('Task name is required.');
            return;
        }

        const newTask = {
            id: Date.now(),
            text: taskName,
            description: document.getElementById('task-description').value.trim(),
            priority: document.getElementById('task-priority').value,
            deadline: document.getElementById('task-deadline').value,
            tags: document.getElementById('task-tags').value.split(',').map(tag => tag.trim()),
            completed: false
        };

        this.tasks.push(newTask);
        this.saveData();
        this.renderTasks();
        this.closeNewTaskModal();
    }

    renderTasks() {
        if (!this.elements.taskList) return;
        this.elements.taskList.innerHTML = '';
        this.tasks.forEach(task => {
            const listItem = document.createElement('li');
            listItem.dataset.id = task.id;
            listItem.className = `task-item priority-${task.priority} ${task.completed ? 'completed' : ''}`;
            
            listItem.innerHTML = `
                <div class="task-checkbox">
                    <input type="checkbox" id="task-${task.id}" ${task.completed ? 'checked' : ''}>
                    <label for="task-${task.id}"></label>
                </div>
                <div class="task-details">
                    <span class="task-text">${task.text}</span>
                    ${task.description ? `<p class="task-desc">${task.description}</p>` : ''}
                </div>
                <div class="task-actions">
                    <button class="delete-task-btn"><i class="fas fa-trash-alt"></i></button>
                </div>
            `;

            listItem.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                this.toggleTaskCompletion(task.id, e.target.checked);
            });
            listItem.querySelector('.delete-task-btn').addEventListener('click', () => {
                this.deleteTask(task.id);
            });

            this.elements.taskList.appendChild(listItem);
        });
    }
    
    toggleTaskCompletion(taskId, isCompleted) {
        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            task.completed = isCompleted;
            this.saveData();
            this.renderTasks();
        }
    }

    deleteTask(taskId) {
        if (confirm('Are you sure you want to delete this task?')) {
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            this.saveData();
            this.renderTasks();
        }
    }

    openUserContextModal() {
        this.elements.userContextModal?.classList.remove('hidden');
    }

    closeUserContextModal() {
        this.elements.userContextModal?.classList.add('hidden');
    }
    
    saveUserContext() {
        const userContext = {
            name: document.getElementById('user-name').value,
            email: document.getElementById('user-email').value,
            location: document.getElementById('user-location').value,
            timezone: document.getElementById('user-timezone').value,
            language: document.getElementById('user-language').value,
            workingHours: document.getElementById('working-hours').value,
            communicationPreference: document.getElementById('communication-preference').value,
            notificationPreference: document.getElementById('notification-preference').value,
            taskPrioritization: document.getElementById('task-prioritization').value,
            allowedActions: document.getElementById('allowed-actions').value,
            restrictedDomains: document.getElementById('restricted-domains').value,
            apiKeys: document.getElementById('api-keys').value,
            tools: document.getElementById('tools').value,
            shortTermGoals: document.getElementById('short-term-goals').value,
            longTermGoals: document.getElementById('long-term-goals').value,
            constraints: document.getElementById('constraints').value,
            filesystemAccess: document.getElementById('filesystem-access').checked,
            networkAccess: document.getElementById('network-access').checked,
            apiAccess: document.getElementById('api-access').checked,
            credentials: document.getElementById('credentials').value,
        };
        localStorage.setItem('aios_userContext', JSON.stringify(userContext));
        alert('User context saved to browser storage!');
        this.closeUserContextModal();
    }

    toggleWindow() {
        this.elements.container?.classList.toggle('hidden');
    }
}