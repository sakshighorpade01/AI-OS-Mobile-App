class ToDoList {
    constructor() {
        this.tasks = [];
        this.elements = {};
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.loadTasks();
        this.renderTasks();
    }

    cacheElements() {
        this.elements = {
            taskList: document.getElementById('task-list'),
            newTaskInput: document.getElementById('new-task-input'),
            addTaskBtn: document.getElementById('add-task-btn'),
        };
    }

    setupEventListeners() {
        this.elements.addTaskBtn.addEventListener('click', () => this.addTask());
        this.elements.newTaskInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                this.addTask();
            }
        });
    }

    addTask() {
        const taskText = this.elements.newTaskInput.value.trim();
        if (taskText !== '') {
            const newTask = {
                id: Date.now(),
                text: taskText,
                completed: false,
            };
            this.tasks.push(newTask);
            this.renderTasks();
            this.elements.newTaskInput.value = '';
            this.saveTasks();
        }
    }

renderTasks() {
    this.elements.taskList.innerHTML = '';
    this.tasks.forEach((task) => {
        const listItem = document.createElement('li');
        listItem.dataset.id = task.id;
        if (task.completed) {
            listItem.classList.add('completed');
        }

        // Checkbox (wrapper for styling)
        const checkboxWrapper = document.createElement('div');
        checkboxWrapper.classList.add('checkbox-wrapper');

        // Checkbox (input)
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkbox.id = `checkbox-${task.id}`; // Give each checkbox a unique ID
        checkboxWrapper.appendChild(checkbox);


        // Custom Checkmark (label) - Use a label!
        const checkmarkLabel = document.createElement('label');
        checkmarkLabel.classList.add('checkmark');
        checkmarkLabel.htmlFor = checkbox.id; // Associate label with the checkbox
        checkmarkLabel.innerHTML = '<i class="fas fa-check"></i>'; // Checkmark icon
        checkboxWrapper.appendChild(checkmarkLabel);

        listItem.appendChild(checkboxWrapper);

        // Task text (span)
        const taskTextSpan = document.createElement('span');
        taskTextSpan.textContent = task.text;
        taskTextSpan.classList.add('task-text');
        listItem.appendChild(taskTextSpan);


        // Button container (for positioning)
        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add('button-container');

        // Delete Button
        const deleteButton = document.createElement('button');
        deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
        deleteButton.classList.add('delete-btn');
        deleteButton.addEventListener('click', () => this.deleteTask(task.id));

        buttonContainer.appendChild(deleteButton);
        listItem.appendChild(buttonContainer);

        this.elements.taskList.appendChild(listItem);

        // *** Important: Add event listener *after* adding to DOM ***
        checkbox.addEventListener('change', () => this.toggleComplete(task.id));
    });
}


    toggleComplete(taskId) {
        this.tasks = this.tasks.map((task) => {
            if (task.id === taskId) {
                return { ...task, completed: !task.completed };
            }
            return task;
        });
        this.renderTasks(); // Re-render to update UI
        this.saveTasks();
    }

    deleteTask(taskId) {
        this.tasks = this.tasks.filter((task) => task.id !== taskId);
        this.renderTasks();
        this.saveTasks();
    }

    saveTasks() {
        localStorage.setItem('tasks', JSON.stringify(this.tasks));
    }

    loadTasks() {
        const savedTasks = localStorage.getItem('tasks');
        if (savedTasks) {
            this.tasks = JSON.parse(savedTasks);
        }
    }
}

window.todo = new ToDoList();