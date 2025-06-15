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
from agno.run.response import RunResponse
from agno.media import Image, Audio, Video
from gotrue.errors import AuthApiError

# --- Initial Setup ---
load_dotenv()

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
    This architecture is designed to be robust and avoid race conditions.
    """
    def __init__(self, sid):
        self.sid = sid
        self.executor = ThreadPoolExecutor(max_workers=1)

    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
        """
        Yields streaming results from the agent. Does NOT yield a final state object.
        """
        q = Queue()

        def _producer():
            """
            This function runs in a background thread.
            Its only job is to stream agent responses to the queue.
            The `agent` object's state is mutated directly by the `agent.run` method.
            """
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
                
                # The agent.run() method will mutate the agent object in this thread.
                # It will stream response chunks, which we put on the queue.
                for chunk in agent.run(**supported_params):
                    q.put(chunk)

            except Exception as e:
                q.put(e)
            finally:
                # Signal that the producer is done.
                q.put(None)

        self.executor.submit(_producer)

        # This is the consumer loop, running in the main thread.
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
    # This function is correct and does not need changes.
    images, audio, videos, text_content = [], [], [], []
    logger.info(f"Processing {len(files)} files")
    for file_data in files:
        file_path, file_type, file_name, is_text, file_content = file_data.get('path'), file_data.get('type', ''), file_data.get('name', 'unnamed_file'), file_data.get('isText', False), file_data.get('content')
        if not file_path and not (is_text and file_content): continue
        if is_text and file_content:
            text_content.append(f"--- File: {file_name} ---\n{file_content}")
            continue
        try:
            path_obj = Path(file_path)
            file_path = str(path_obj.absolute().resolve())
            if not path_obj.exists():
                logger.warning(f"File does not exist at path: {file_path}")
                continue
        except Exception as e:
            logger.error(f"Path normalization error for {file_path}: {str(e)}")
            continue
        try:
            if file_type.startswith('image/'): images.append(Image(filepath=file_path))
            elif file_type.startswith('audio/'): audio.append(Audio(filepath=file_path))
            elif file_type.startswith('video/'): videos.append(Video(filepath=file_path))
            elif file_type.startswith('text/') or file_type == 'application/json':
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f: text_content.append(f"--- File: {file_name} ---\n{f.read()}")
            else: text_content.append(f"--- File: {file_name} (attached at path: {file_path}) ---")
        except Exception as e: logger.error(f"Error processing file {file_path}: {str(e)}")
    return "\n\n".join(text_content) if text_content else None, images, audio, videos


@socketio.on("send_message")
def on_send_message(data: str):
    """Main message handler. Authenticates user and dispatches to the agent."""
    sid = request.sid
    user = None
    message_id = str(uuid.uuid4())
    
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

        session_info = connection_manager.get_session(sid)
        if not session_info:
            config = data.get("config", {})
            agent = connection_manager.create_session(sid, str(user.id), config, is_deepsearch)
        else:
            agent = session_info["agent"]

        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True}, room=sid)
            return
        
        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        # Consume the streaming generator from run_safely
        for result in isolated_assistant.run_safely(agent, combined_message, user, context, images, audio, videos):
            # This is a streaming chunk of the response.
            if isinstance(result, RunResponse) and result.content:
                socketio.emit("response", {"content": result.content, "streaming": True, "id": message_id}, room=sid)

        # Signal to the client that the text stream is finished.
        socketio.emit("response", {"content": "", "done": True, "id": message_id}, room=sid)

        # --- ALL DATABASE I/O IS NOW HANDLED HERE, IN THE MAIN THREAD ---
        # The `agent` object in the connection_manager has been updated by the background thread.
        # We can now safely access its final state.
        
        # 1. Save the final session state to the database using the agent's own storage handler.
        # This will create the table if it doesn't exist.
        try:
            logger.info(f"Writing final session {agent.session_id} to storage.")
            # write_to_storage is a built-in method that calls storage.upsert() correctly.
            agent.write_to_storage(user_id=str(user.id), session_id=agent.session_id)
            logger.info("Session write successful.")
        except Exception as e:
            logger.error(f"DATABASE SESSION SAVE FAILED for user {user.id}: {e}\n{traceback.format_exc()}")
            return # Stop if we can't save the session

        # 2. Log the token usage from the agent's final run_response object.
        if hasattr(agent, 'run_response') and agent.run_response:
            try:
                metrics_dict = agent.run_response.metrics or {}
                
                # The metrics are already aggregated in the final RunResponse
                input_tokens = sum(metrics_dict.get('input_tokens', [0]))
                output_tokens = sum(metrics_dict.get('output_tokens', [0]))
                
                if input_tokens > 0 or output_tokens > 0:
                    logger.info(f"Logging token usage for user {user.id}: {input_tokens} in, {output_tokens} out.")
                    supabase_client.from_('request_logs').insert({
                        'user_id': str(user.id),
                        'input_tokens': input_tokens,
                        'output_tokens': output_tokens
                    }).execute()
                    logger.info(f"Successfully logged tokens for user {user.id}.")
                else:
                    logger.info("No token usage to log for this run (metrics were empty).")
            except Exception as metric_error:
                logger.error(f"Failed to log usage metrics for user {user.id}: {metric_error}\n{traceback.format_exc()}")
        else:
            logger.warning("Agent object did not have a 'run_response' attribute to log metrics from.")

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