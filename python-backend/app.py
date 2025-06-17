# app.py (Final Version with Manual Serialization)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path
from dataclasses import asdict

from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import eventlet

# --- Local Module Imports ---
from assistant import get_llm_os, AIOS_PatchedAgent # Import the patched agent
from deepsearch import get_deepsearch
from supabase_client import supabase_client

# --- Agno Imports ---
from agno.agent import Agent
from agno.media import Image, Audio, Video
from agno.storage.session.agent import AgentSession # Needed for manual object creation
from gotrue.errors import AuthApiError

# --- Initial Setup ---
load_dotenv()

# --- Logging Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SocketIOHandler(logging.Handler):
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
    def __init__(self, sid):
        self.sid = sid
        self.message_id = None

    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
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
                    'user_id': str(user.id)
                }
                if 'images' in params and images: supported_params['images'] = images
                if 'audio' in params and audio: supported_params['audio'] = audio
                if 'videos' in params and videos: supported_params['videos'] = videos

                logger.info(f"Calling agent.run for user {user.id} with params: {list(supported_params.keys())}")
                
                # The agent.run() call now only updates the in-memory state.
                # The patched agent's write_to_storage() does nothing.
                for chunk in agent.run(**supported_params):
                    if chunk and chunk.content:
                        eventlet.sleep(0)
                        socketio.emit("response", {"content": chunk.content, "streaming": True, "id": self.message_id}, room=self.sid)

                socketio.emit("response", {"content": "", "done": True, "id": self.message_id}, room=self.sid)

                if hasattr(agent, 'session_metrics') and agent.session_metrics:
                    logger.info(
                        f"Run complete. Cumulative session tokens for SID {self.sid}: "
                        f"{agent.session_metrics.input_tokens} in, "
                        f"{agent.session_metrics.output_tokens} out."
                    )

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {"content": "An error occurred. Starting new session...", "error": True, "done": True, "id": self.message_id}, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, user, context, images, audio, videos)

    def terminate(self):
        pass

class ConnectionManager:
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
        if sid in self.sessions:
            session_info = self.sessions.get(sid)
            if not session_info: return

            agent = session_info.get("agent")
            if agent and isinstance(agent, AIOS_PatchedAgent):
                
                # ===================== START: MANUAL SERIALIZATION AND SAVE =====================
                try:
                    logger.info(f"Starting manual serialization for session {sid}.")
                    
                    # 1. Manually assemble the payload by directly accessing agent attributes.
                    # This bypasses the buggy agent.get_agent_session() method.
                    
                    # Get conversation history directly from the memory object
                    run_history = agent.memory.runs.get(sid, [])
                    serializable_runs = [run.to_dict() for run in run_history]

                    # Manually construct the final payload dictionary
                    final_payload = {
                        "session_id": sid,
                        "user_id": str(agent.user_id) if agent.user_id else None,
                        "agent_id": agent.agent_id,
                        "agent_data": {
                            "name": agent.name,
                            "agent_id": agent.agent_id,
                            "model": agent.model.to_dict() if agent.model else None
                        },
                        "session_data": {
                            "session_name": agent.session_name,
                            "session_state": agent.session_state,
                            "session_metrics": asdict(agent.session_metrics) if agent.session_metrics else None
                        },
                        "memory": {
                            "runs": serializable_runs,
                            "memories": agent.memory.memories if hasattr(agent.memory, 'memories') else {},
                            "summaries": agent.memory.summaries if hasattr(agent.memory, 'summaries') else {}
                        },
                        "extra_data": agent.extra_data
                    }

                    # 2. Create an AgentSession object from our manually built dictionary.
                    # The storage.upsert() method expects this object type.
                    session_to_save = AgentSession.from_dict(final_payload)

                    # 3. Call storage.upsert() directly with our reliable payload.
                    if agent.storage and session_to_save:
                        logger.info(f"Saving final session state for SID {sid} with {len(serializable_runs)} runs.")
                        agent.storage.upsert(session=session_to_save)
                        logger.info(f"Successfully saved final session state for SID {sid}.")
                    else:
                        logger.warning(f"Could not save session {sid}: No storage object or session payload.")

                except Exception as e:
                    logger.error(f"MANUAL SAVE FAILED for session {sid}: {e}\n{traceback.format_exc()}")
                # ====================== END: MANUAL SERIALIZATION AND SAVE ======================

                # --- Existing logic to log cumulative token usage (this part is working fine) ---
                if hasattr(agent, 'session_metrics') and agent.session_metrics:
                    try:
                        metrics = agent.session_metrics
                        if metrics.input_tokens > 0 or metrics.output_tokens > 0:
                            logger.info(f"Logging final usage to DB: {metrics.input_tokens} in, {metrics.output_tokens} out.")
                            supabase_client.from_('request_logs').insert({
                                'user_id': str(agent.user_id),
                                'input_tokens': metrics.input_tokens,
                                'output_tokens': metrics.output_tokens
                            }).execute()
                            logger.info(f"Successfully logged final tokens for session {sid}.")
                    except Exception as e:
                        logger.error(f"Failed to log usage metrics for session {sid}: {e}\n{traceback.format_exc()}")
            
            # Cleanup
            del self.sessions[sid]
            if sid in self.isolated_assistants:
                self.isolated_assistants[sid].terminate()
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
    images, audio, videos, text_content = [], [], [], []
    if not files: return None, [], [], []
    logger.info(f"Processing {len(files)} files")
    for file_data in files:
        file_path, file_type, file_name, is_text, file_content = file_data.get('path'), file_data.get('type', ''), file_data.get('name', 'unnamed_file'), file_data.get('isText', False), file_data.get('content')
        if not file_path and not (is_text and file_content): continue
        if is_text and file_content:
            text_content.append(f"--- File: {file_name} ---\n{file_content}")
            continue
        try:
            path_obj = Path(file_path)
            if not path_obj.exists():
                logger.warning(f"File does not exist at path: {file_path}")
                continue
            file_path = str(path_obj.absolute().resolve())
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
    sid = request.sid
    user = None
    try:
        data = json.loads(data)
        access_token = data.get("accessToken")
        if not access_token:
            emit("error", {"message": "Authentication token is missing.", "reset": True}, room=sid)
            return
        try:
            user = supabase_client.auth.get_user(jwt=access_token).user
            if not user: raise AuthApiError("User not found.", 401)
            logger.info(f"Request authenticated for user: {user.id}")
        except AuthApiError as e:
            logger.error(f"Invalid token for SID {sid}: {e.message}")
            emit("error", {"message": "Session expired. Please log in again.", "reset": True}, room=sid)
            return

        if data.get("type") == "terminate_session":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            agent = connection_manager.create_session(sid, str(user.id), data.get("config", {}), data.get("is_deepsearch", False))
        else:
            agent = session["agent"]

        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Please start a new chat.", "reset": True}, room=sid)
            connection_manager.terminate_session(sid)
            return
        
        isolated_assistant.message_id = str(uuid.uuid4())
        file_content, images, audio, videos = process_files(data.get("files", []))
        message = data.get("message", "")
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        isolated_assistant.run_safely(agent, combined_message, user, data.get("context", ""), images or None, audio or None, videos or None)

    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Please start a new chat.", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)


@app.route('/healthz', methods=['GET'])
def health_check():
    return "OK", 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)