# app.py (Corrected, Final, and Complete Version)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path
import threading
from concurrent.futures import ThreadPoolExecutor
from queue import Queue

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
# eventlet.monkey_patch() # Disabling as it can conflict with ThreadPoolExecutor

# --- Logging Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SocketIOHandler(logging.Handler):
    """Custom logging handler to emit logs over Socket.IO."""
    def emit(self, record):
        try:
            if record.name != 'socketio' and record.name != 'engineio':
                log_message = self.format(record)
                socketio.emit('log', {'level': record.levelname.lower(), 'message': log_message})
        except Exception:
            pass

logger.addHandler(SocketIOHandler())

# --- Flask & Socket.IO App Initialization ---
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")


class IsolatedAssistant:
    """
    Runs the agent in a background thread and streams results back via a queue.
    This robustly handles streaming while capturing the final metrics.
    """
    def __init__(self, sid):
        self.sid = sid
        self.executor = ThreadPoolExecutor(max_workers=1)

    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
        """Yields results from the agent as they are produced in the background thread."""
        q = Queue()

        def _producer():
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
                    'user_id': str(user.id)
                }
                if 'images' in params and images: supported_params['images'] = images
                if 'audio' in params and audio: supported_params['audio'] = audio
                if 'videos' in params and videos: supported_params['videos'] = videos

                logger.info(f"Calling agent.run in background for user {user.id}")
                
                for chunk in agent.run(**supported_params):
                    q.put(chunk)
                
                final_run_response = agent.storage.read(session_id=agent.session_id, user_id=str(user.id))
                q.put(final_run_response)

            except Exception as e:
                q.put(e)
            finally:
                q.put(None)

        self.executor.submit(_producer)

        while True:
            item = q.get()
            if item is None:
                break
            if isinstance(item, Exception):
                raise item
            yield item

    def terminate(self):
        self.executor.shutdown(wait=False, cancel_futures=True)


class ConnectionManager:
    """Manages active agent sessions. This class is now correct."""
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
                agent = get_deepsearch(user_id=user_id, **config)
            else:
                agent = get_llm_os(user_id=user_id, **config)

            self.sessions[sid] = {"agent": agent, "config": config}
            self.isolated_assistants[sid] = IsolatedAssistant(sid)
            logger.info(f"Created session {sid} for user {user_id} with config {config}")
            return agent

    def terminate_session(self, sid):
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
    message_id = str(uuid.uuid4())
    final_session_state = None

    try:
        data = json.loads(data)
        access_token = data.get("accessToken")

        if not access_token:
            emit("error", {"message": "Authentication token missing.", "reset": True}, room=sid)
            return

        try:
            user_response = supabase_client.auth.get_user(jwt=access_token)
            user = user_response.user
            if not user: raise AuthApiError("User not found.", 401)
            logger.info(f"Request authenticated for user: {user.id}")
        except AuthApiError as e:
            logger.error(f"Invalid token for SID {sid}: {e.message}")
            emit("error", {"message": "Session expired. Please log in again.", "reset": True}, room=sid)
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
            agent = connection_manager.create_session(sid, str(user.id), config, is_deepsearch)
        else:
            agent = session["agent"]

        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True}, room=sid)
            return
        
        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        for result in isolated_assistant.run_safely(agent, combined_message, user, context, images, audio, videos):
            if hasattr(result, 'content'):
                if result.content:
                    socketio.emit("response", {"content": result.content, "streaming": True, "id": message_id}, room=sid)
            else:
                final_session_state = result

        socketio.emit("response", {"content": "", "done": True, "id": message_id}, room=sid)

        # --- CRITICAL FIX: Use dictionary access for the deserialized session state ---
        if user and final_session_state:
            try:
                # Use .get() to safely access nested dictionary keys
                memory_dict = final_session_state.memory if hasattr(final_session_state, 'memory') else {}
                runs_list = memory_dict.get('runs', [])
                
                if runs_list:
                    last_run = runs_list[-1]
                    metrics = last_run.get('response', {}).get('metrics', {})
                    
                    input_tokens = sum(metrics.get('input_tokens', [0]))
                    output_tokens = sum(metrics.get('output_tokens', [0]))
                    
                    if input_tokens > 0 or output_tokens > 0:
                        logger.info(f"Logging token usage for user {user.id}: {input_tokens} in, {output_tokens} out.")
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
        socketio.emit("response", {"content": "An error occurred.", "error": True, "done": True, "id": message_id}, room=sid)
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