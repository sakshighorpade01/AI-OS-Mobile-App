# app.py (Corrected)
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
from user_auth import user_auth
import supabase_client

load_dotenv()

# Ensure required directories exist
def ensure_directories():
    """Ensure required directories exist"""
    directories = [
        "data/sessions",
        "data/memory",
        "uploads"
    ]
    for directory in directories:
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)
            print(f"Created directory: {directory}")
        else:
            print(f"Directory exists: {directory}")

# Call at startup
ensure_directories()

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
    def __init__(self, sid):
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.sid = sid
        self.message_id = None

    def run_safely(self, agent, message, context=None, images=None, audio=None, videos=None):
        """Runs agent in isolated thread and handles crashes"""

        def _run_agent(agent, message, context, images, audio, videos):
            try:
                if context:
                    complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}"
                else:
                    complete_message = message

                import inspect
                params = inspect.signature(agent.run).parameters
                supported_params = {'message': complete_message, 'stream': True}
                
                if 'images' in params and images: supported_params['images'] = images
                if 'audio' in params and audio: supported_params['audio'] = audio
                if 'videos' in params and videos: supported_params['videos'] = videos

                # Stream response chunks to the client
                response_generator = agent.run(**supported_params)
                for chunk in response_generator:
                    if chunk and chunk.content:
                        eventlet.sleep(0)
                        socketio.emit("response", {
                            "content": chunk.content,
                            "streaming": True,
                            "id": self.message_id,
                        }, room=self.sid)

                # --- Direct & Correct Metrics Update ---
                user_id = user_auth.get_user_id_for_session(self.sid)
                if user_id and agent.memory.runs:
                    try:
                        latest_run = agent.memory.runs[-1]
                        metrics = latest_run.response.metrics
                        
                        # Sum all tokens used in this particular run for accuracy
                        total_input_tokens = sum(metrics.get('input_tokens', []))
                        total_output_tokens = sum(metrics.get('output_tokens', []))

                        if total_input_tokens > 0 or total_output_tokens > 0:
                            usage_data = {
                                'input_tokens': total_input_tokens,
                                'output_tokens': total_output_tokens,
                                'total_tokens': total_input_tokens + total_output_tokens,
                                'request_count': 1 
                            }
                            logger.info(f"Updating metrics for user {user_id}: {usage_data}")
                            supabase_client.update_user_metrics(user_id, usage_data)
                        else:
                            logger.info(f"No new tokens to report for run.")
                    except Exception as e:
                        logger.error(f"Error processing metrics for user {user_id}: {e}\n{traceback.format_exc()}")
                
                # Signal completion of the stream
                socketio.emit("response", {
                    "content": "",
                    "done": True,
                    "id": self.message_id,
                }, room=self.sid)

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True, "done": True, "id": self.message_id,
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, context, images, audio, videos)

    def terminate(self):
        self.executor.shutdown(wait=False)

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
        self.isolated_assistants = {}

    def create_session(self, sid, config, is_deepsearch=False):
        with self.lock:
            if sid in self.sessions:
                self.terminate_session(sid)
                
            user_id = user_auth.get_user_id_for_session(sid)
            agent_config = {
                "calculator": config.get("calculator", False),
                "web_crawler": config.get("web_crawler", False),
                "ddg_search": config.get("ddg_search", False),
                "shell_tools": config.get("shell_tools", False),
                "python_assistant": config.get("python_assistant", False),
                "investment_assistant": config.get("investment_assistant", False),
                "use_memory": config.get("use_memory", False),
                "debug_mode": True,
                "user_id": user_id
            }

            if is_deepsearch:
                agent = get_deepsearch(**agent_config)
            else:
                agent = get_llm_os(**agent_config)

            self.sessions[sid] = {"agent": agent, "user_id": user_id}
            self.isolated_assistants[sid] = IsolatedAssistant(sid)
            logger.info(f"Created new session {sid} for user {user_id}")
            return agent

    def terminate_session(self, sid):
        with self.lock:
            if sid in self.sessions:
                if sid in self.isolated_assistants:
                    self.isolated_assistants[sid].terminate()
                    del self.isolated_assistants[sid]
                user_auth.remove_session(sid)
                del self.sessions[sid]
                logger.info(f"Terminated session {sid}")

    def get_session(self, sid):
        return self.sessions.get(sid)

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
    connection_manager.terminate_session(sid)

@socketio.on("authenticate")
def on_authenticate(data):
    sid = request.sid
    token = data.get('token')
    if token:
        user = supabase_client.get_user_by_token(token)
        if user and user.id:
            user_id = str(user.id)
            user_auth.associate_session_with_user(sid, user_id)
            emit("auth_response", {"status": "authenticated", "user_id": user_id})
            logger.info(f"User {user_id} authenticated for session {sid}")
        else:
            emit("auth_response", {"status": "invalid_token"})
            logger.warning(f"Invalid token for session {sid}")
    else:
        emit("auth_response", {"status": "missing_token"})
        logger.warning(f"Missing token for session {sid}")

@socketio.on("send_message")
def on_send_message(data):
    sid = request.sid
    try:
        data = json.loads(data)
    except (json.JSONDecodeError, TypeError):
        logger.error("Failed to parse JSON message")
        return

    # Handle session termination request from frontend (e.g., "New Chat" button)
    if data.get("type") == "terminate_session":
        logger.info(f"Received terminate request for session: {sid}")
        connection_manager.terminate_session(sid)
        return

    message = data.get('message', '')
    context = data.get('context', '')
    files = data.get('files', [])
    config = data.get('config', {})
    is_deepsearch = data.get('is_deepsearch', False)
    message_id = data.get('id', str(uuid.uuid4()))

    images, audio, videos, text_content = process_files(files)
    if text_content:
        message += "\n\n" + "\n\n".join(text_content)
        
    session = connection_manager.get_session(sid)
    if not session:
        agent = connection_manager.create_session(sid, config, is_deepsearch)
    else:
        agent = session["agent"]
    
    isolated_assistant = connection_manager.isolated_assistants[sid]
    isolated_assistant.message_id = message_id
    isolated_assistant.run_safely(agent, message, context, images, audio, videos)

def process_files(files):
    """Process files and categorize them for Agno's multimodal capabilities"""
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
            
        # Handle text files with content directly provided
        if is_text and file_content:
            text_content.append(f"--- File: {file_name} ---\n{file_content}")
            logger.info(f"Using provided text content for file: {file_name}")
            continue
            
        # Handle path normalization for files that need path access
        try:
            # Create a Path object to handle different path formats correctly
            path_obj = Path(file_path)
            # Convert to absolute path and normalize
            file_path = str(path_obj.absolute().resolve())
            logger.info(f"Normalized path: {file_path}")
            
            # Make sure the file exists
            if not path_obj.exists():
                logger.warning(f"File does not exist at path: {file_path}")
                continue
        except Exception as e:
            logger.error(f"Path normalization error for {file_path}: {str(e)}")
            continue
        
        # Categorize files based on MIME type or extension
        if file_type.startswith('image/') or file_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
            images.append(Image(filepath=file_path))
            logger.info(f"Added image: {file_path}")
        elif file_type.startswith('audio/') or file_name.lower().endswith(('.mp3', '.wav', '.ogg', '.m4a')):
            audio.append(Audio(filepath=file_path))
            logger.info(f"Added audio: {file_path}")
        elif file_type.startswith('video/') or file_name.lower().endswith(('.mp4', '.mov', '.avi', '.webm')):
            videos.append(Video(filepath=file_path))
            logger.info(f"Added video: {file_path}")
        else:
            # For text and other files, read and add to message
            try:
                with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                    file_content = f.read()
                    text_content.append(f"--- File: {file_name} ---\n{file_content}")
                    logger.info(f"Added text content from file: {file_path}")
            except Exception as e:
                logger.error(f"Error reading file {file_path}: {str(e)}")
                text_content.append(f"--- File: {file_name} ---\nUnable to read file content: {str(e)}")
    
    return images, audio, videos, text_content

@app.route('/healthz', methods=['GET'])
def health_check():
    """
    Simple health check endpoint for container health monitoring
    """
    return "OK", 200

@app.route('/api/usage', methods=['GET'])
def get_user_usage():
    """
    Get usage statistics for the authenticated user
    """
    # Get user ID from request
    user_id = user_auth.get_user_id_from_request()
    
    if not user_id:
        return jsonify({
            "error": "Unauthorized",
            "message": "You must be logged in to view usage statistics"
        }), 401
    
    # Get usage metrics from Supabase
    metrics = supabase_client.get_user_usage_metrics(user_id)
    
    if not metrics:
        return jsonify({
            "error": "Not found",
            "message": "No usage metrics found for this user"
        }), 404
    
    # Return metrics
    return jsonify({
        "user_id": user_id,
        "metrics": {
            "input_tokens": metrics.get('input_tokens', 0),
            "output_tokens": metrics.get('output_tokens', 0),
            "total_tokens": metrics.get('total_tokens', 0),
            "request_count": metrics.get('request_count', 0)
        }
    })

@app.route('/api/process-metrics', methods=['POST'])
def process_metrics():
    """
    Process metrics for all users
    """
    # Get user ID from request
    user_id = user_auth.get_user_id_from_request()
    
    if not user_id:
        return jsonify({
            "error": "Unauthorized",
            "message": "You must be logged in to process metrics"
        }), 401
    
    # Process metrics
    metrics_processor = MetricsProcessor()
    results = metrics_processor.process_all_metrics()
    
    # Return results
    return jsonify({
        "success": True,
        "results": results
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    logger.info(f"Starting server on port {port}")
    socketio.run(app, debug=True, host='0.0.0.0', port=port)
