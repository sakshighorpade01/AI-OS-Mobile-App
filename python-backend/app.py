#app.py
import logging
import json
import uuid
from flask import Flask, request
from flask_socketio import SocketIO, emit
from assistant import get_llm_os
import threading
from concurrent.futures import ThreadPoolExecutor
import traceback
from queue import Queue
from logging.handlers import RotatingFileHandler
import re
import os  # Import the 'os' module

# --- Logging Configuration ---
LOG_FORMAT = '%(asctime)s - %(levelname)s - %(name)s - %(message)s'

# Create the 'logs' directory if it doesn't exist
log_dir = 'logs'
if not os.path.exists(log_dir):
    os.makedirs(log_dir)


# Create a custom logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)  # Set the root logger level

# Create a file handler for debug logs, with rotation
debug_handler = RotatingFileHandler(os.path.join(log_dir, 'debug.log'), maxBytes=1024*1024*5, backupCount=5)  # 5MB files, keep 5 backups
debug_handler.setLevel(logging.DEBUG)
debug_formatter = logging.Formatter(LOG_FORMAT)
debug_handler.setFormatter(debug_formatter)
logger.addHandler(debug_handler)

# Create a file handler for info logs
info_handler = RotatingFileHandler(os.path.join(log_dir, 'info.log'), maxBytes=1024*1024*5, backupCount=5)
info_handler.setLevel(logging.INFO)
info_formatter = logging.Formatter(LOG_FORMAT)
info_handler.setFormatter(info_formatter)
logger.addHandler(info_handler)


# Create a file handler for error logs
error_handler = RotatingFileHandler(os.path.join(log_dir, 'error.log'), maxBytes=1024*1024*5, backupCount=5)
error_handler.setLevel(logging.ERROR)
error_formatter = logging.Formatter(LOG_FORMAT)
error_handler.setFormatter(error_formatter)
logger.addHandler(error_handler)


def sanitize_log_message(message):
    """Removes potentially sensitive data from log messages."""
    # Example: Remove API keys (replace with your actual patterns)
    message = re.sub(r'sk-[a-zA-Z0-9]+', '[REDACTED API KEY]', message)
    return message


class SocketIOHandler(logging.Handler):
    def emit(self, record):
        try:
            log_message = self.format(record)
            log_message = sanitize_log_message(log_message)
            emit_log(record.levelname.lower(), log_message)
        except Exception:
            self.handleError(record)  # Prevent logging errors from crashing the app


def emit_log(level, message, source='system'):
    """Sends log messages through SocketIO."""
    socketio.emit('response', {'type': 'log', 'level': level, 'message': message, 'source': source}, room=request.sid if request else None)


# --- Flask and SocketIO Setup ---
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet", logger=False, engineio_logger=False)  # Disable extra logging
logger.addHandler(SocketIOHandler()) # Add SocketIO handler to the logger

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
                if chunk and chunk.content:
                    yield {"content": chunk.content, "streaming": True, "type": "response"}
            yield {"content": "", "done": True, "type": "response"}
            
        except Exception as e:
            error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
            logger.error(error_msg)
            yield {"content": "An error occurred while processing your request. Starting a new session...", 
                  "error": True, "done": True, "type": "response"}
            yield {"reset_session": True, "type": "response"}

    def terminate(self):
        self.executor.shutdown(wait=False)

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
        self.isolated_assistants = {}
        
    def create_session(self, sid, config):
        with self.lock:
            if sid in self.sessions:
                self.terminate_session(sid)
            
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
            
            self.sessions[sid] = {
                "agent": agent,
                "config": config,
                "initialized": True
            }
            
            self.isolated_assistants[sid] = IsolatedAssistant()
            
            logger.info(f"Created new session {sid} with config {config}")
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
    emit("status", {"message": "Connected to server", "type": "response"})

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

        if message_type == "terminate_session" or message_type == "new_chat":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated", "type": "response"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            if not message:
                return
            config = data.get("config", {})
            agent = connection_manager.create_session(sid, config)
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True, "type":"response"})
            connection_manager.terminate_session(sid)
            return
        
        for response in isolated_assistant.run_safely(agent, message, context):
            if response.get("reset_session"):
                connection_manager.terminate_session(sid)
                emit("error", {"message": "Session reset required", "reset": True, "type":"response"})
                return
                
            emit("response", {**response, "id": message_id}, room=sid)
                
    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True, "type":"response"})
        connection_manager.terminate_session(sid)

if __name__ == "__main__":
    logger.info("Starting server on port 8765")
    socketio.run(app, host="0.0.0.0", port=8765)