# app.py (Corrected, Final, and Complete Version)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path

# --- Use eventlet for concurrency ---
import eventlet

from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

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
    This class runs the agent in a background greenlet, restoring the original,
    working streaming behavior. It also handles the in-run accumulation of metrics.
    """
    def __init__(self, sid):
        self.sid = sid
        self.message_id = None

    def run_in_greenlet(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
        """
        This function is the target for eventlet.spawn. It runs the agent,
        streams responses, and lets the agent object accumulate metrics.
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

            logger.info(f"Calling agent.run in background greenlet for user {user.id}")
            
            # The agent.run() method will stream response chunks and update its own state.
            for chunk in agent.run(**supported_params):
                if isinstance(chunk, RunResponse) and chunk.content:
                    socketio.emit("response", {"content": chunk.content, "streaming": True, "id": self.message_id}, room=self.sid)
            
            # After the stream is done, send the final "done" signal.
            socketio.emit("response", {"content": "", "done": True, "id": self.message_id}, room=self.sid)

            # Log the *cumulative* session tokens after this run
            if hasattr(agent, 'session_metrics') and agent.session_metrics:
                logger.info(
                    f"Run complete. Cumulative session tokens for SID {self.sid}: "
                    f"{agent.session_metrics.input_tokens} in, "
                    f"{agent.session_metrics.output_tokens} out."
                )

        except Exception as e:
            logger.error(f"Error in background greenlet: {e}\n{traceback.format_exc()}")
            socketio.emit("response", {"content": "An error occurred in the agent.", "error": True, "done": True, "id": self.message_id}, room=self.sid)


class ConnectionManager:
    """Manages active agent sessions and handles persistence on termination."""
    def __init__(self):
        self.sessions = {}
        self.isolated_assistants = {}

    def create_session(self, sid: str, user_id: str, config: dict, is_deepsearch: bool = False) -> Agent:
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
        """
        Terminates a session, logs its final cumulative metrics to the database, and cleans up.
        """
        if sid in self.sessions:
            session_info = self.sessions.get(sid)
            if not session_info:
                return

            agent = session_info.get("agent")

            if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                try:
                    final_metrics = agent.session_metrics
                    input_tokens = final_metrics.input_tokens
                    output_tokens = final_metrics.output_tokens

                    if input_tokens > 0 or output_tokens > 0:
                        logger.info(
                            f"TERMINATE_SESSION FOR SID {sid}. "
                            f"Logging final cumulative usage to DB: {input_tokens} in, {output_tokens} out."
                        )
                        supabase_client.from_('request_logs').insert({
                            'user_id': str(agent.user_id),
                            'input_tokens': input_tokens,
                            'output_tokens': output_tokens
                        }).execute()
                        logger.info(f"Successfully logged final tokens for session {sid}.")
                    else:
                        logger.info(f"Session {sid} terminated with no cumulative token usage to log.")
                except Exception as e:
                    logger.error(f"Failed to log usage metrics for session {sid} on termination: {e}\n{traceback.format_exc()}")

            # Now, clean up the session from memory
            del self.sessions[sid]
            if sid in self.isolated_assistants:
                del self.isolated_assistants[sid]
            logger.info(f"Terminated and cleaned up session {sid}")

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
        
        isolated_assistant.message_id = message_id
        
        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        # This is now a non-blocking, "fire-and-forget" call that restores streaming.
        eventlet.spawn(
            isolated_assistant.run_in_greenlet,
            agent, combined_message, user, context, images, audio, videos
        )

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