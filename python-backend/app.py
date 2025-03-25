# app.py (Corrected)

import logging
import json
import uuid
from flask import Flask, request
from flask_socketio import SocketIO, emit
from assistant import get_llm_os
from deepsearch import get_deepsearch  
import threading
from concurrent.futures import ThreadPoolExecutor
import traceback
import eventlet  


logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class SocketIOHandler(logging.Handler):
    def emit(self, record):
        try:
            emit_log(record.levelname.lower(), record.getMessage())
        except Exception:
            pass

logger.addHandler(SocketIOHandler())

def emit_log(level, message):
    socketio.emit('log', {'level': level, 'message': message})

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

class IsolatedAssistant:
    def __init__(self, sid):  # Pass sid to the constructor
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.sid = sid  # Store the sid

    def run_safely(self, agent, message, context=None):
        """Runs agent in isolated thread and handles crashes"""

        def _run_agent(agent, message, context):
            try:
                if context:
                    complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}"
                else:
                    complete_message = message

                for chunk in agent.run(complete_message, stream=True):
                    if chunk and chunk.content:
                        eventlet.sleep(0) # VERY IMPORTANT: Yield to eventlet
                        socketio.emit("response", {
                            "content": chunk.content,
                            "streaming": True,
                            "id": self.message_id, # Use self.message_id here.
                        }, room=self.sid)

                socketio.emit("response", {
                    "content": "",
                    "done": True,
                    "id": self.message_id, # Use self.message_id here.
                }, room=self.sid)

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True,
                    "done": True,
                    "id": self.message_id, # Use self.message_id here.
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)


        # Use eventlet.spawn to run the agent in a greenlet
        eventlet.spawn(_run_agent, agent, message, context)


    def terminate(self):
        self.executor.shutdown(wait=False)

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
        self.isolated_assistants = {}

    def create_session(self, sid, config, is_deepsearch=False, is_browse_ai=False):
        with self.lock:
            if sid in self.sessions:
                self.terminate_session(sid)

            # Choose the agent based on the flags
            if is_deepsearch:
                agent = get_deepsearch(
                    ddg_search=config.get("ddg_search", False),
                    web_crawler=config.get("web_crawler", False),
                    investment_assistant=config.get("investment_assistant", False),
                    debug_mode=True
                )
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

            self.sessions[sid] = {
                "agent": agent,
                "config": config,
                "initialized": True,
                "is_deepsearch": is_deepsearch,
                "is_browse_ai": is_browse_ai
            }

            self.isolated_assistants[sid] = IsolatedAssistant(sid) # Pass sid

            logger.info(f"Created new session {sid} with config {config} (Deepsearch: {is_deepsearch}, BrowseAI: {is_browse_ai})")
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
        is_browse_ai = data.get("is_browse_ai", False)


        if message_type == "terminate_session" or message_type == "new_chat":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            config = data.get("config", {})
            agent = connection_manager.create_session(sid, config, is_deepsearch=is_deepsearch, is_browse_ai=is_browse_ai)
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)

        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True})
            connection_manager.terminate_session(sid)
            return
        
        isolated_assistant.message_id = message_id 

        combined_message = message
        for file_data in files:
            file_name = file_data.get('name', 'unnamed_file')
            file_header = f"\n\n--- File: {file_name} ---\n"
            
            if 'extractedText' in file_data and file_data['extractedText']:
                combined_message += file_header + file_data['extractedText']
            else:
                combined_message += file_header + file_data.get('content', '')

        isolated_assistant.run_safely(agent, combined_message, context)


    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)

if __name__ == "__main__":
    logger.info("Starting server on port 8765")
    socketio.run(app, host="0.0.0.0", port=8765)