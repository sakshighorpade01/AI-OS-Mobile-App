# AI-OS: An AI-Powered Desktop Assistant

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://your-build-system-url)  <!-- Replace with your actual build status badge -->
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) <!-- Add a LICENSE file if you haven't -->
![AI-OS Interface](home_dark.png)[](home_light.png)  <!-- Use a descriptive image; consider a GIF demonstrating key features -->

AI-OS is a powerful, extensible desktop application built with Electron.js and Python, designed to be an intelligent assistant that seamlessly integrates with your workflow.  It leverages multiple Large Language Models (LLMs) to perform a variety of tasks, incorporating natural language processing, web browsing, local file access, code execution, and more.

## Table of Contents

*   [Features](#features)
*   [Prerequisites](#prerequisites)
*   [Installation](#installation)
*   [Usage](#usage)
    *   [Starting the Application](#starting-the-application)
    *   [Chat Interface](#chat-interface)
    *   [Tools and Capabilities](#tools-and-capabilities)
    *   [Context Management](#context-management)
    *   [File Attachments](#file-attachments)
    *   [Web View](#web-view)
    *   [To-Do List](#to-do-list)
    *   [AIOS Settings](#aios-settings)
*   [Architecture](#architecture)
*   [Dependencies](#dependencies)
*   [Contributing](#contributing)
*   [Troubleshooting](#troubleshooting)
*   [License](#license)
*   [Roadmap](#roadmap)

## Features

*   **Conversational AI:** Interact with the assistant using natural language through a chat interface.
*   **Multiple LLM Agents:**
    *   **AI-OS (Main Agent):**  Handles core interactions, manages tools, and delegates tasks.  Powered by Gemini (default) or Groq.
    *   **DeepSearch:**  Provides in-depth research capabilities, combining knowledge base search, web search (DuckDuckGo), and tool/assistant delegation.  Powered by Gemini.
    *   **Web Crawler:** Extracts and summarizes information from provided URLs. Powered by Gemini.
    *   **Investment Assistant:** Generates investment reports for given stock symbols using YFinanceTools. Powered by Gemini.
    *   **Python Assistant:**  Writes and executes Python code, with support for installing pip packages. Powered by Groq.
    *  **BrowserAgent**: AI agent built to perform tasks on Browser.
*   **Tool Integration:**
    *   **Calculator:** Performs mathematical calculations.
    *   **DuckDuckGo Search:**  Retrieves information from the web.
    *   **YFinanceTools:** Accesses financial data (stock prices, company info, news, analyst recommendations).
    *   **Shell Tools:** Executes shell commands (for file system and system operations).
    *   **Crawl4aiTools:** Used by the Web Crawler for web content extraction.
    *   **Python Tools:** Executes Python code.
*   **Context Management:**
    *   Load and utilize previous chat sessions as context for ongoing conversations.
    *   Select and combine multiple sessions to create a richer context.
    *   Automatic synchronization of chat sessions using `context_manager.py`.
*   **File Attachments:**
    *   Attach various file types (text, images, PDFs, documents, audio, video).
    *   Automatic text extraction from PDFs (using PDF.js).
    *   OCR (Optical Character Recognition) for images (using Tesseract.js).
    *   Placeholder implementations for document, audio, and video transcription (suggesting integration with external services).
*   **Web View:** Open and interact with web pages within a dedicated, resizable, and draggable panel inside the application.
*   **To-Do List:** Manage tasks directly within the application, with features for descriptions, deadlines, priorities, and tags.
*   **User Context:** Customize AI-OS behavior with user preferences and settings (name, location, preferred language, working hours, API keys, etc.).
*   **Long-Term Memory (Optional):**
    *   Enable persistent memory using an SQLite database (`agent_memory.db`).
    *   Includes memory classification and summarization (using Groq).
    *   Searchable knowledge base (`search_knowledge_base` tool).
*   **Streamed Responses:**  See responses generated in real-time, providing a more interactive experience.
*   **Code and Diagram Viewers:**
    *   View code snippets with syntax highlighting (using highlight.js).
    *   Render Mermaid diagrams.
    *   Copy code/diagrams to clipboard.
    *   Download code/diagrams as files.
*   **Dark Mode:**  A visually appealing dark theme is enabled by default (toggleable).
*   **Error Handling:**  Robust error handling and reconnection logic to maintain a stable user experience.
*   **Window Controls:** Minimize, maximize/restore, and close the application window.
*  **Tasks Integration:** Access and manage local context files (`user_context.txt` and `tasklist.txt`) for task-oriented interactions.


## Prerequisites

*   **Python 3.7+:**  The backend server and agents are written in Python.
*   **Node.js and npm:** Required for the Electron.js frontend and JavaScript dependencies.
*   **pip:** Python's package installer, used to install backend dependencies.

## Installation

1.  **Clone the repository:**

    ```bash
    git clone <your_repository_url>
    cd <repository_name>
    ```

2.  **Install Python dependencies:**

    ```bash
    cd python-backend
    pip install -r requirements.txt
    ```
    It's highly recommended to use a virtual environment:
    ```bash
    python3 -m venv venv
    source venv/bin/activate  # On Linux/macOS
    venv\Scripts\activate  # On Windows
    pip install -r requirements.txt
    ```

3.  **Install Node.js dependencies:**

    ```bash
    cd ..  # Navigate back to the project root
    npm install
    ```

4. **Create necessary directories:**

    mkdir tmp
    mkdir tmp/agent_sessions_json
    mkdir context

    These directories are used for storing temporary data, agent session data, and extracted conversation data, respectively.

    ## Usage

    ### Starting the Application

    ```bash
    npm start

This command launches the Electron application. The Python backend server should start automatically. If there are issues with the Python server starting, see the Troubleshooting section.

## Chat Interface
Type your message in the input field at the bottom and press Enter or click the "Send" button.

**New Chat:** Click the "+" button to start a new conversation. This clears the current chat history and resets the agent.

**Minimize Chat:** Click the minimize button in the chat window header to hide the chat interface.

**Tools and Capabilities**
**Tools Menu:** Click the wrench icon to access the tools menu.

**AI-OS Checkbox:** Enables or disables the core set of tools (calculator, DuckDuckGo search, shell tools, etc.). When unchecked, the AI-OS agent will behave in a more limited, "vanilla" mode.

**DeepSearch Checkbox:** Enables the DeepSearch agent for comprehensive research. When enabled, other tools and agents are typically disabled.

**Browse AI Checkbox:** Enables the Browse AI agent for accessing specific web pages.

**Memory Checkbox:** Toggles the use of long-term memory (if enabled in your configuration).

**Tasks Checkbox:** Enable the use of local context files.

**Context Management**
Click the "Context" icon (network icon) in the chat tools area. This opens the context window, showing a list of previous chat sessions.

**Sync Sessions:** Click the "Sync" button in the context window to run context_manager.py. This script extracts conversation data from tmp/agent_sessions_json and creates individual JSON files for each session in the context folder. This step is crucial for making previous sessions available as context.

**Select Sessions:** Check the boxes next to the sessions you want to include in the context.

**Use Selected:** Click the "Use Selected" button. The selected sessions will be used to provide context for subsequent messages.

**Clear Selection:** Click "Clear" to remove the selected context.

**View Session Details:** Click on the session item to view details.

**File Attachments**
Click the "Attach" button (paperclip icon) in the input area.

Select files using the file dialog. Multiple files can be selected. Supported file types include text files, images, PDFs, and more.

**View attached files:** The attached files will be listed in a dedicated file attachment pane.

**Extracted Text:** Text content will be extracted from supported file types (text, PDF, and images) and sent to the LLM as additional context. You can view extracted text by clicking on the attached file.

## Web View
Clicking on a URL within a message from the assistant will automatically open the URL in a web view panel within the application.

**Web View Controls:**

**Close:** Click the close button to close the web view.

**Drag:** Drag the web view header to reposition the panel.

**Resize:** Use the resize handles (corners) to adjust the panel's size.

## To-Do List
**Open the To-Do List:** Click the "Tasks" icon (list icon) in the taskbar.

**Add a Task:** Click the "+" button in the To-Do List input area.

**Enter Task Details:** Fill in the task name (required), description, priority, deadline, and tags.

**Save Task:** Click "Add Task" to save the new task.

**Mark as Complete/Incomplete:** Click the checkbox next to a task to toggle its completion status.

**Delete Task:** Click the trash can icon to delete a task.

**User Context:** Click the "Context" button to access a form where you can provide personal information, preferences, and system access settings.

## AIOS Settings
**Open the Settings:** Click the "AIOS" icon (atom icon) in the taskbar.

**Profile:** Change Full Name, Nickname, and Occupation.

**Account:** Displays Email and options to Log out or Delete Account.

**About:** Displays version and description. Links to Privacy Policy, Terms of Service, and Documentation.

**Support:** Submit feedback/issues.

## Architecture
**The application follows a client-server architecture:**

## Frontend (Electron.js):

Provides the user interface (chat, to-do list, settings, web view).

Handles user input and displays responses.

Communicates with the backend via Socket.IO.

Uses renderer.js for UI management and chat.js for chat-specific logic.

Uses aios.js for account settings.

Uses to-do-list.js for to-do list functionalities.

Uses message-formatter.js for handling and formatting messages.

Uses context-handler.js for managing chat session context.

Uses add-files.js to handle files.

## Backend (Python):

**app.py:** The main Flask-SocketIO server. Manages client connections, creates and manages AI agent sessions, and handles message routing.

**assistant.py:** Defines the get_llm_os function, which creates and configures the main AI-OS agent, including its tools, team members, and memory.

**deepsearch.py:** Defines the get_deepsearch function which creates and configures the DeepSearch agent.

**context_manager.py:** A utility script that extracts conversation data from agent session files and saves each session to a separate JSON file for context management.

**python-bridge.js:** A Node.js module that manages the Python process (starting, stopping, restarting) and facilitates communication between the Electron frontend and the Python backend via Socket.IO.

## Dependencies
Frontend (Node.js):

electron: Framework for building cross-platform desktop applications with JavaScript, HTML, and CSS.

socket.io-client: Real-time communication library for bidirectional event-based communication.

highlight.js: Syntax highlighting for code blocks.

mermaid: Generation of diagrams and flowcharts from text in a similar manner to Markdown.

marked: Markdown parser and compiler.

prismjs: Lightweight, robust, and elegant syntax highlighting.

KaTeX: Fast math typesetting library for the web.

dompurify: DOM-only, super-fast, and robust HTML sanitization library.

turndown: HTML to Markdown converter.

@mozilla/pdf.js: Library to handle and extract pdf content.

tesseract.js: Library to perform OCR.

Backend (Python):

Flask: Micro web framework for building web applications.

Flask-SocketIO: Socket.IO integration for Flask, enabling real-time communication.

python-dotenv: Loads environment variables from a .env file.

eventlet: Concurrent networking library. Crucially important for asynchronous I/O with Flask-SocketIO.

phi-agent: (This appears to be a custom or local package. Make sure it's accessible to your Python environment.) This is the core AI agent library, providing the Agent, AgentMemory, Toolkit, and various tools.

Other dependencies listed in python-backend/requirements.txt

Contributing
Contributions are welcome! Please follow these steps:

Fork the repository.

Create a new branch for your feature or bug fix: git checkout -b feature/your-feature-name

Make your changes and commit them with clear messages: git commit -m "Add: Implemented awesome feature"

Push your branch to your fork: git push origin feature/your-feature-name

Create a pull request to the main branch of the original repository.

Please ensure your code adheres to the project's coding style and includes appropriate tests.

Troubleshooting
Python server fails to start:

Ensure all Python dependencies are installed correctly.

Check for errors in the console output (both Electron's main process and renderer process).

Verify that port 8765 is not in use by another application.

If you're seeing a "startup timeout" error, try increasing this.serverStartTimeout in python-bridge.js.

Socket.IO connection issues:

Ensure the Python server is running and listening on the correct port (8765).

Check for network connectivity problems.

Examine console logs for connection errors.

"Module not found" errors (Python): Double-check that you've activated your Python virtual environment and that all dependencies are installed.

Chat doesn't respond: If the agent stops responding, check the console for any python errors, check if your selected context is valid and not corrupted.

UI Issues: Use the developer tools (usually opened with Ctrl+Shift+I or Cmd+Option+I) to inspect elements and debug JavaScript code.

Roadmap
This section outlines potential future enhancements and is based on features and improvements inferred from the code and existing functionalities:

Improved User Context Management:

UI enhancements for managing context (e.g., editing/deleting context files).

More sophisticated context selection mechanisms (e.g., keyword search, automatic relevance ranking).

Enhanced Task Management:

Recurring tasks.

Subtasks.

Integration with external calendar or task management systems.

Customizable Agents:

Allow users to create and configure their own agents with specific tools, instructions, and models.

A UI for managing agent configurations.

Plugin System:

Enable the development and integration of third-party plugins to extend functionality.

Voice Input/Output:

Integrate speech recognition and text-to-speech for voice interaction.

Improved Web View:

Browser-like features (back/forward navigation, URL bar). This has been partially implemented, but could be significantly expanded.

Content extraction and summarization directly from the web view.

Knowledge Base Editor:

A dedicated UI for managing and editing the agent's knowledge base.

More Robust Error Handling:

More specific error messages and guidance to the user.

Automatic recovery from certain types of errors.

User Authentication:

Implement secure user authentication and account management.

Cloud Sync:

Synchronize tasks, settings, and context across multiple devices.

Improved Logging:

More detailed logging of backend events, LLM calls and responses to enable better troubleshooting and debugging.

Testing: Add unit and integration tests to increase project stability.