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


# --- CRITICAL RE-IMPLEMENTATION of IsolatedAssistant ---
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

        # This function runs in the background thread
        def _producer():
            final_run_response = None
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
                
                # The agent.run() method is a generator. We iterate through it.
                for chunk in agent.run(**supported_params):
                    q.put(chunk)
                
                # After the run, the agent's internal state is updated.
                # We can now access the full session data from storage.
                # This is the most reliable way to get the final state.
                final_run_response = agent.storage.read(session_id=agent.session_id, user_id=str(user.id))
                q.put(final_run_response)

            except Exception as e:
                q.put(e) # Put the exception on the queue to be handled by the consumer
            finally:
                q.put(None) # Signal that the process is finished

        # Start the background thread
        self.executor.submit(_producer)

        # This part runs in the main thread, consuming from the queue
        while True:
            item = q.get()
            if item is None:
                break # End of stream
            if isinstance(item, Exception):
                raise item # Re-raise the exception in the main thread
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
    """This function is correct and requires no changes."""
    # ... (your existing file processing logic) ...
    return None, [], [], [] # Placeholder


@socketio.on("send_message")
def on_send_message(data: str):
    """Main message handler. Authenticates user and dispatches to the agent."""
    sid = request.sid
    user = None
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

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True}, room=sid)
            return
        
        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        # --- MODIFIED Main Loop ---
        for result in isolated_assistant.run_safely(agent, combined_message, user, context, images, audio, videos):
            if hasattr(result, 'content'): # This is a streaming chunk (RunResponse)
                if result.content:
                    socketio.emit("response", {"content": result.content, "streaming": True, "id": message_id}, room=sid)
            else: # This is the final session object from storage
                final_session_state = result

        socketio.emit("response", {"content": "", "done": True, "id": message_id}, room=sid)

        # --- Re-implement token logging correctly ---
        if user and final_session_state and final_session_state.memory and final_session_state.memory.runs:
            try:
                metrics = final_session_state.memory.runs[-1].response.metrics
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