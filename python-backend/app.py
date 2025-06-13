# app.py (Complete and Corrected Version)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path

from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import eventlet

# --- Local Module Imports ---
from assistant import get_llm_os
from deepsearch import get_deepsearch
from supabase_client import supabase_client

# --- Agno Imports ---
from agno.agent import Agent
from agno.media import Image, Audio, Video
from gotrue.errors import AuthApiError

# --- Initial Setup ---
load_dotenv()
eventlet.monkey_patch()

# --- Logging Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SocketIOHandler(logging.Handler):
    """Custom logging handler to emit logs over Socket.IO."""
    def emit(self, record):
        try:
            # Avoid logging loops
            if record.name != 'socketio' and record.name != 'engineio':
                log_message = self.format(record)
                socketio.emit('log', {'level': record.levelname.lower(), 'message': log_message})
        except Exception:
            # If this fails, we can't do much without causing a loop
            pass

# Add the custom handler to the root logger
logger.addHandler(SocketIOHandler())

# --- Flask & Socket.IO App Initialization ---
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")


class IsolatedAssistant:
    """
    Runs the agent in a separate thread to avoid blocking the server.
    This class is well-designed and requires no changes.
    """
    def __init__(self, sid):
        self.sid = sid
        self.message_id = None

    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
        """Runs agent in an isolated thread, handles crashes, and logs usage."""
        def _run_agent(agent, message, user, context, images, audio, videos):
            try:
                if context:
                    complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}"
                else:
                    complete_message = message

                import inspect
                params = inspect.signature(agent.run).parameters
                supported_params = {
                    'message': complete_message,
                    'stream': True,
                    'user_id': str(user.id) # Pass user_id for memory operations
                }
                if 'images' in params and images:
                    supported_params['images'] = images
                if 'audio' in params and audio:
                    supported_params['audio'] = audio
                if 'videos' in params and videos:
                    supported_params['videos'] = videos

                logger.info(f"Calling agent.run for user {user.id} with params: {list(supported_params.keys())}")
                for chunk in agent.run(**supported_params):
                    if chunk and chunk.content:
                        eventlet.sleep(0)
                        socketio.emit("response", {
                            "content": chunk.content,
                            "streaming": True,
                            "id": self.message_id,
                        }, room=self.sid)

                socketio.emit("response", {
                    "content": "",
                    "done": True,
                    "id": self.message_id,
                }, room=self.sid)

                # Metric logging for token usage
                if user and agent.memory and hasattr(agent.memory, 'runs') and agent.memory.runs:
                    try:
                        last_run_metrics = agent.memory.runs[-1].response.metrics
                        input_tokens = sum(last_run_metrics.get('input_tokens', [0]))
                        output_tokens = sum(last_run_metrics.get('output_tokens', [0]))
                        total_tokens = input_tokens + output_tokens

                        if total_tokens > 0:
                            logger.info(f"Logging usage for user {user.id}: {input_tokens} in, {output_tokens} out.")
                            supabase_client.from_('request_logs').insert({
                                'user_id': str(user.id),
                                'input_tokens': input_tokens,
                                'output_tokens': output_tokens
                            }).execute()
                    except Exception as metric_error:
                        logger.error(f"Failed to log usage metrics for user {user.id}: {metric_error}")

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True, "done": True, "id": self.message_id,
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, user, context, images, audio, videos)

    def terminate(self):
        pass

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
        self.isolated_assistants = {}

    def create_session(self, sid: str, user_id: str, config: dict, is_deepsearch: bool = False) -> Agent:
        with self.lock:
            if sid in self.sessions:
                self.terminate_session(sid)

            logger.info(f"Creating new session for user: {user_id}")

            if is_deepsearch:
                agent = get_deepsearch(
                    user_id=user_id,
                    ddg_search=config.get("ddg_search", False),
                    web_crawler=config.get("web_crawler", False),
                    investment_assistant=config.get("investment_assistant", False),
                    debug_mode=True
                )
            else:
                agent = get_llm_os(
                    user_id=user_id,
                    calculator=config.get("calculator", False),
                    web_crawler=config.get("web_crawler", False),
                    ddg_search=config.get("ddg_search", False),
                    shell_tools=config.get("shell_tools", False),
                    python_assistant=config.get("python_assistant", False),
                    investment_assistant=config.get("investment_assistant", False),
                    use_memory=config.get("use_memory", False),
                    debug_mode=True
                )

            self.sessions[sid] = {"agent": agent, "config": config}
            self.isolated_assistants[sid] = IsolatedAssistant(sid)
            logger.info(f"Created session {sid} for user {user_id} with config {config}")
            return agent

    def terminate_session(self, sid):
        with self.lock:
            if sid in self.sessions:
                del self.sessions[sid]
            if sid in self.isolated_assistants:
                self.isolated_assistants[sid].terminate()
                del self.isolated_assistants[sid]
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

def process_files(files):
    images = []
    audio = []
    videos = []
    text_content = []
    
    logger.info(f"Processing {len(files)} files")
    
    for file_data in files:
        file_path = file_data.get('path')
        file_type = file_data.get('type', '')
        file_name = file_data.get('name', 'unnamed_file')
        is_text = file_data.get('isText', False)
        file_content = file_data.get('content')
        
        logger.info(f"Processing file: {file_name}, type: {file_type}, path: {file_path}, isText: {is_text}")
        
        if not file_path and not (is_text and file_content):
            logger.warning(f"Skipping file without path or content: {file_name}")
            continue
            
        if is_text and file_content:
            text_content.append(f"--- File: {file_name} ---\n{file_content}")
            logger.info(f"Using provided text content for file: {file_name}")
            continue
            
        try:
            path_obj = Path(file_path)
            file_path = str(path_obj.absolute().resolve())
            logger.info(f"Normalized path: {file_path}")
            
            if not path_obj.exists():
                logger.warning(f"File does not exist at path: {file_path}")
                continue
        except Exception as e:
            logger.error(f"Path normalization error for {file_path}: {str(e)}")
            continue
        
        try:
            if file_type.startswith('image/'):
                images.append(Image(filepath=file_path))
            elif file_type.startswith('audio/'):
                audio.append(Audio(filepath=file_path))
            elif file_type.startswith('video/'):
                videos.append(Video(filepath=file_path))
            elif file_type.startswith('text/') or file_type == 'application/json':
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    text_content.append(f"--- File: {file_name} ---\n{content}")
                except Exception as e:
                    logger.error(f"Error reading text file {file_path}: {e}")
            else:
                text_content.append(f"--- File: {file_name} (attached at path: {file_path}) ---")
        except Exception as e:
            logger.error(f"Error processing file {file_path}: {str(e)}")
    
    combined_text = "\n\n".join(text_content) if text_content else None
    return combined_text, images, audio, videos


@socketio.on("send_message")
def on_send_message(data: str):
    """Main message handler. Authenticates user and dispatches to the agent."""
    sid = request.sid
    user = None

    try:
        data = json.loads(data)
        access_token = data.get("accessToken")

        if not access_token:
            emit("error", {"message": "Authentication token is missing. Please log in again.", "reset": True}, room=sid)
            return

        try:
            user_response = supabase_client.auth.get_user(jwt=access_token)
            user = user_response.user
            if not user:
                raise AuthApiError("User not found for the provided token.", 401)
            logger.info(f"Request authenticated for user: {user.id}")
        except AuthApiError as e:
            logger.error(f"Invalid token for SID {sid}: {e.message}")
            emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
            return

        message = data.get("message", "")
        context = data.get("context", "")
        files = data.get("files", [])
        is_deepsearch = data.get("is_deepsearch", False)

        if data.get("type") == "terminate_session":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            config = data.get("config", {})
            # --- CRITICAL FIX: Pass the authenticated user.id when creating a new session ---
            agent = connection_manager.create_session(
                sid,
                user_id=str(user.id),
                config=config,
                is_deepsearch=is_deepsearch
            )
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True}, room=sid)
            connection_manager.terminate_session(sid)
            return
        
        isolated_assistant.message_id = message_id

        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        isolated_assistant.run_safely(
            agent,
            combined_message,
            user=user,
            context=context,
            images=images or None,
            audio=audio or None,
            videos=videos or None
        )

    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)


@app.route('/healthz', methods=['GET'])
def health_check():
    """Standard health check endpoint for Render."""
    return "OK", 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)
