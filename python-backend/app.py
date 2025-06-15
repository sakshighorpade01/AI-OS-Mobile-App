# app.py (Corrected, Final, and Definitive Version)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path

# --- Use eventlet for concurrency, including its Queue ---
import eventlet
from eventlet.queue import Queue

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


class ConnectionManager:
    """Manages active agent sessions and handles persistence on termination."""
    def __init__(self):
        self.sessions = {}

    def create_session(self, sid: str, user_id: str, config: dict, is_deepsearch: bool = False) -> Agent:
        if sid in self.sessions:
            self.terminate_session(sid)

        logger.info(f"Creating new session for user: {user_id}")
        if is_deepsearch:
            agent = get_deepsearch(user_id=user_id, **config)
        else:
            agent = get_llm_os(user_id=user_id, **config)

        self.sessions[sid] = {"agent": agent, "config": config}
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

            del self.sessions[sid]
            logger.info(f"Terminated and cleaned up session {sid}")

    def get_session(self, sid):
        return self.sessions.get(sid)

    def remove_session(self, sid):
        self.terminate_session(sid)

connection_manager = ConnectionManager()

def agent_producer(queue, agent, message, user, context, images, audio, videos):
    """
    This function runs in a background greenlet.
    It runs the agent and puts all results (chunks) onto the eventlet-safe queue.
    It does NOT call socketio.emit.
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
        
        for chunk in agent.run(**supported_params):
            queue.put(chunk)

        if hasattr(agent, 'session_metrics') and agent.session_metrics:
            logger.info(
                f"Run complete. Cumulative session tokens: "
                f"{agent.session_metrics.input_tokens} in, "
                f"{agent.session_metrics.output_tokens} out."
            )

    except Exception as e:
        queue.put(e)
    finally:
        # Signal that the producer is done by putting None on the queue.
        queue.put(None)


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
    """Main message handler. Uses the robust producer/consumer pattern with eventlet.Queue."""
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
        
        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        # --- The Robust Eventlet Queue Pattern ---
        # 1. Create a queue that is safe for eventlet greenlets.
        q = Queue()

        # 2. Spawn the producer greenlet. It will start running the agent and putting results on the queue.
        eventlet.spawn(agent_producer, q, agent, combined_message, user, context, images, audio, videos)

        # 3. Consume results from the queue in the main handler.
        #    This loop is non-blocking in the eventlet world.
        while True:
            chunk = q.get()
            if chunk is None: # The producer is finished.
                break
            
            if isinstance(chunk, Exception):
                raise chunk

            if isinstance(chunk, RunResponse) and chunk.content:
                # Because this emit is in the original request handler, it has the correct
                # context and will be sent to the correct client.
                socketio.emit("response", {"content": chunk.content, "streaming": True, "id": message_id}, room=sid)

        # 4. After the loop, the stream is done. Send the final signal.
        socketio.emit("response", {"content": "", "done": True, "id": message_id}, room=sid)
        
        # The session is still active. The final logging will happen only when the client
        # sends a 'terminate_session' message or disconnects.

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