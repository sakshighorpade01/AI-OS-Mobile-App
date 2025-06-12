# app.py
import os
import logging
import json
import uuid
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
from assistant import get_llm_os
from deepsearch import get_deepsearch  
import threading
from concurrent.futures import ThreadPoolExecutor
import traceback
from dotenv import load_dotenv 
import eventlet  
from agno.media import Image, Audio, Video
from pathlib import Path
import werkzeug.utils

from gotrue.errors import AuthApiError
from agno.agent import Agent
from supabase_client import supabase_client

load_dotenv()
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# --- SocketIOHandler, emit_log, IsolatedAssistant classes are unchanged ---
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
    def __init__(self, sid):
        self.executor = ThreadPoolExecutor(max_workers=1)
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
                supported_params = {}
                supported_params['message'] = complete_message
                supported_params['stream'] = True
                if 'images' in params and images: supported_params['images'] = images
                if 'audio' in params and audio: supported_params['audio'] = audio
                if 'videos' in params and videos: supported_params['videos'] = videos

                logger.info(f"Calling agent.run with params: {list(supported_params.keys())}")
                for chunk in agent.run(**supported_params):
                    if chunk and chunk.content:
                        eventlet.sleep(0)
                        socketio.emit("response", {"content": chunk.content, "streaming": True, "id": self.message_id}, room=self.sid)

                socketio.emit("response", {"content": "", "done": True, "id": self.message_id}, room=self.sid)

                if user and agent.memory and agent.memory.runs:
                    try:
                        last_run_metrics = agent.memory.runs[-1].response.metrics
                        input_tokens_used = sum(last_run_metrics['input_tokens'])
                        output_tokens_used = sum(last_run_metrics['output_tokens'])
                        total_tokens_used = input_tokens_used + output_tokens_used

                        if total_tokens_used > 0:
                            logger.info(f"Logging usage for user {user.id}: {input_tokens_used} in, {output_tokens_used} out.")
                            try:
                                supabase_client.from_('request_logs').insert({'user_id': str(user.id), 'input_tokens': input_tokens_used, 'output_tokens': output_tokens_used}).execute()
                                logger.info(f"Successfully logged {total_tokens_used} tokens for user {user.id}.")
                            except Exception as db_error:
                                logger.error(f"DATABASE LOGGING FAILED for user {user.id}: {db_error}")
                        else:
                            logger.info(f"No token usage to log for user {user.id}.")
                    except Exception as metric_error:
                        logger.error(f"Failed to log usage metrics for user {user.id}: {metric_error}")
            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {"content": "An error occurred while processing your request. Starting a new session...", "error": True, "done": True, "id": self.message_id}, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, user, context, images, audio, videos)

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
            
            # Use dictionary unpacking to pass the config, including the user_id
            if is_deepsearch:
                agent = get_deepsearch(**config, debug_mode=True)
            else:
                agent = get_llm_os(**config, debug_mode=True)
                
            self.sessions[sid] = {"agent": agent, "config": config, "initialized": True, "is_deepsearch": is_deepsearch, "is_browse_ai": is_browse_ai}
            self.isolated_assistants[sid] = IsolatedAssistant(sid)
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

# --- API endpoints for session history are correct and unchanged ---
@app.route('/sessions', methods=['GET'])
def get_user_sessions():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"error": "Missing or invalid authorization token"}), 401

    jwt = auth_header.split(' ')[1]
    try:
        user_response = supabase_client.auth.get_user(jwt=jwt)
        user = user_response.user
        if not user:
            return jsonify({"error": "Invalid token"}), 401

        query = supabase_client.from_('ai_os_sessions').select('id, title, updated_at').eq('user_id', str(user.id)).order('updated_at', desc=True)
        response = query.execute()
        return jsonify(response.data), 200

    except Exception as e:
        logger.error(f"Error fetching sessions for user {user.id if 'user' in locals() else 'unknown'}: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

@app.route('/sessions/<session_id>', methods=['GET'])
def get_single_session(session_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"error": "Missing or invalid authorization token"}), 401

    jwt = auth_header.split(' ')[1]
    try:
        user_response = supabase_client.auth.get_user(jwt=jwt)
        user = user_response.user
        if not user:
            return jsonify({"error": "Invalid token"}), 401

        query = supabase_client.from_('ai_os_sessions').select('session_data').eq('id', session_id).eq('user_id', str(user.id)).single()
        response = query.execute()

        if not response.data:
            return jsonify({"error": "Session not found or access denied"}), 404
        return jsonify(response.data['session_data']), 200

    except Exception as e:
        logger.error(f"Error fetching session {session_id}: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

# --- Socket handlers ---
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

# --- process_files function is unchanged ---
def process_files(files):
    # ... (your existing process_files logic)
    pass

# --- CORRECTED on_send_message handler ---
@socketio.on("send_message")
def on_send_message(data):
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
            # This is the correct way to pass the user_id to the agent factory.
            # The official PostgresStorage class uses the user_id passed to the Agent constructor.
            config['user_id'] = str(user.id) 
            
            agent = connection_manager.create_session(sid, config, is_deepsearch=is_deepsearch, is_browse_ai=is_browse_ai)
        else:
            agent = session["agent"]
            # Fallback to ensure user_id is set on existing agents
            if agent.user_id is None:
                agent.user_id = str(user.id)

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)

        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True})
            connection_manager.terminate_session(sid)
            return
        
        isolated_assistant.message_id = message_id 

        file_content, images, audio, videos = process_files(files)
        
        combined_message = message
        if file_content:
            combined_message += f"\n\nContent from attached files:\n{file_content}"

        isolated_assistant.run_safely(agent, combined_message, user=user, context=context, images=images, audio=audio, videos=videos)

    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)

# --- Health check and main execution block are unchanged ---
@app.route('/healthz', methods=['GET'])
def health_check():
    logger.debug("Health check endpoint was hit.")
    return "OK", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)