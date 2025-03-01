# app.py (Updated)

import logging
import json
import uuid
import os
from flask import Flask, request
from flask_socketio import SocketIO, emit
from assistant import get_llm_os
from deepsearch import get_deepsearch  # Import the deepsearch agent
from browser_agent import BrowserAgent  # Import the BrowserAgent
import threading
from concurrent.futures import ThreadPoolExecutor
import traceback
from queue import Queue

# Get log level from environment variable (default to INFO)
log_level = os.environ.get('LOGLEVEL', 'INFO').upper()
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger(__name__)

# Only send connection and error logs to the terminal
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
class ConnectionFilter(logging.Filter):
    def filter(self, record):
        # Only show important logs in the terminal
        return (record.levelno >= logging.ERROR or
                'connect' in record.getMessage().lower() or
                'socket' in record.getMessage().lower() or
                'server' in record.getMessage().lower())
console_handler.addFilter(ConnectionFilter())
logger.addHandler(console_handler)

class SocketIOHandler(logging.Handler):
    def emit(self, record):
        try:
            emit_log(record.levelname.lower(), record.getMessage())
        except Exception:
            pass

# Only add SocketIOHandler to send logs to the client
logger.addHandler(SocketIOHandler())

def emit_log(level, message):
    socketio.emit('log', {'level': level, 'message': message})

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

class IsolatedAssistant:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.response_queue = Queue()

    def run_safely(self, agent, message, context=None):
        """Runs agent in isolated thread and handles crashes"""
        try:
            if context:
                complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}"
            else:
                complete_message = message

            future = self.executor.submit(agent.run, complete_message, stream=True)
            for chunk in future.result():
                if chunk and isinstance(chunk, dict) and 'content' in chunk:
                    # This is a direct return from browser_agent
                    yield chunk
                elif chunk and hasattr(chunk, 'content') and chunk.content:
                    # This is a normal assistant response
                    yield {"content": chunk.content, "streaming": True}
            yield {"content": "", "done": True}

        except Exception as e:
            error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
            logger.error(error_msg)
            yield {"content": "An error occurred while processing your request. Starting a new session...",
                  "error": True, "done": True}
            yield {"reset_session": True}

    def terminate(self):
        self.executor.shutdown(wait=False)

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
        self.isolated_assistants = {}

    def create_session(self, sid, config, is_deepsearch=False, is_browser_agent=False):
        with self.lock:
            if sid in self.sessions:
                self.terminate_session(sid)

            # Choose the agent based on the flags
            if is_browser_agent:
                agent = BrowserAgent  # This is already an instance, not a class
                logger.info(f"Created new Browser Agent session {sid}")
            elif is_deepsearch:
                agent = get_deepsearch(
                    ddg_search=config.get("ddg_search", False),
                    web_crawler=config.get("web_crawler", False),
                    investment_assistant=config.get("investment_assistant", False),
                    debug_mode=True
                )
                logger.info(f"Created new DeepSearch session {sid}")
            else:
                agent = get_llm_os(
                    calculator=config.get("calculator", False),
                    web_crawler=config.get("web_crawler", False),
                    ddg_search=config.get("ddg_search", False),
                    shell_tools=config.get("shell_tools", False),
                    python_assistant=config.get("python_assistant", False),
                    investment_assistant=config.get("investment_assistant", False),
                    use_memory=config.get("use_memory", False),
                    debug_mode=True
                )
                logger.info(f"Created new LLM-OS session {sid}")

            self.sessions[sid] = {
                "agent": agent,
                "config": config,
                "initialized": True,
                "is_deepsearch": is_deepsearch,
                "is_browser_agent": is_browser_agent
            }

            self.isolated_assistants[sid] = IsolatedAssistant()

            return agent

    def terminate_session(self, sid):
        with self.lock:
            if sid in self.sessions:
                if sid in self.isolated_assistants:
                    self.isolated_assistants[sid].terminate()
                    del self.isolated_assistants[sid]
                del self.sessions[sid]
                logger.info(f"Terminated session {sid}")

    def get_session(self, sid):
        return self.sessions.get(sid)

    def remove_session(self, sid):
        self.terminate_session(sid)

connection_manager = ConnectionManager()

@socketio.on("connect")
def on_connect():
    sid = request.sid
    logger.info(f"Client connected: {sid}")
    emit("status", {"message": "Connected to server"})

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    logger.info(f"Client disconnected: {sid}")
    connection_manager.remove_session(sid)

@socketio.on("send_message")
def on_send_message(data):
    sid = request.sid
    try:
        data = json.loads(data)
        message = data.get("message", "")
        context = data.get("context", "")
        message_type = data.get("type", "")
        files = data.get("files", [])
        is_deepsearch = data.get("is_deepsearch", False)
        is_browser_agent = data.get("is_browser_agent", False) or message_type == "browser_request"

        if message_type == "terminate_session" or message_type == "new_chat":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            # Pass agent type flags to create_session
            config = data.get("config", {})
            agent = connection_manager.create_session(
                sid, 
                config, 
                is_deepsearch=is_deepsearch,
                is_browser_agent=is_browser_agent
            )
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)

        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True})
            connection_manager.terminate_session(sid)
            return

        combined_message = message
        for file_data in files:
            combined_message += f"\n\n--- File: {file_data['name']} ---\n{file_data['content']}"

        for response in isolated_assistant.run_safely(agent, combined_message, context):
            if response.get("reset_session"):
                connection_manager.terminate_session(sid)
                emit("error", {"message": "Session reset required", "reset": True})
                return

            # Add browser agent flag to outgoing responses if this is a browser agent session
            if is_browser_agent:
                response["is_browser_agent"] = True

            emit("response", {**response, "id": message_id}, room=sid)

    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True})
        connection_manager.terminate_session(sid)

if __name__ == "__main__":
    logger.info("Starting server on port 8765")
    socketio.run(app, host="0.0.0.0", port=8765)