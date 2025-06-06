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
from metrics_processor import MetricsProcessor
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
    def __init__(self, sid):  # Pass sid to the constructor
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.sid = sid  # Store the sid
        self.message_id = None

    def run_safely(self, agent, message, context=None, images=None, audio=None, videos=None):
        """Runs agent in isolated thread and handles crashes"""

        def _run_agent(agent, message, context, images, audio, videos):
            try:
                if context:
                    complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}"
                else:
                    complete_message = message

                # Get supported parameters for agent.run method
                import inspect
                params = inspect.signature(agent.run).parameters
                supported_params = {}

                # Basic parameters that should always be supported
                supported_params['message'] = complete_message
                supported_params['stream'] = True
                
                # Only add parameters that are supported by the agent's run method
                # This ensures compatibility with different versions of the library
                if 'images' in params and images:
                    supported_params['images'] = images
                    logger.info(f"Adding {len(images)} images to agent.run")
                if 'audio' in params and audio:
                    supported_params['audio'] = audio
                    logger.info(f"Adding {len(audio)} audio files to agent.run")
                if 'videos' in params and videos:
                    supported_params['videos'] = videos
                    logger.info(f"Adding {len(videos)} video files to agent.run")

                # If we couldn't add media through parameters, add file paths to the message
                if (images or audio or videos) and len(supported_params) <= 2:  # only message and stream params
                    file_paths = []
                    if images:
                        for img in images:
                            if hasattr(img, 'filepath') and img.filepath:
                                file_paths.append(f"Image file: {img.filepath}")
                    if audio:
                        for aud in audio:
                            if hasattr(aud, 'filepath') and aud.filepath:
                                file_paths.append(f"Audio file: {aud.filepath}")
                    if videos:
                        for vid in videos:
                            if hasattr(vid, 'filepath') and vid.filepath:
                                file_paths.append(f"Video file: {vid.filepath}")
                    
                    if file_paths:
                        file_paths_str = "\n".join(file_paths)
                        supported_params['message'] = f"{supported_params['message']}\n\nAttached files:\n{file_paths_str}"
                        logger.info("Added file paths to message text as fallback")

                # Call agent.run with supported parameters
                logger.info(f"Calling agent.run with params: {list(supported_params.keys())}")
                for chunk in agent.run(**supported_params):
                    if chunk and chunk.content:
                        eventlet.sleep(0) # VERY IMPORTANT: Yield to eventlet
                        socketio.emit("response", {
                            "content": chunk.content,
                            "streaming": True,
                            "id": self.message_id, # Use self.message_id here.
                        }, room=self.sid)

                # Get metrics from the agent response if available
                metrics = {}
                if hasattr(chunk, 'metrics'):
                    metrics = chunk.metrics
                
                # Get user ID from session if available
                session = connection_manager.get_session(self.sid)
                if session and "user_id" in session:
                    user_id = session["user_id"]
                    
                    # Update metrics in Supabase if user is authenticated
                    if user_id and metrics:
                        try:
                            tokens_metrics = {
                                'input_tokens': metrics.get('input_tokens', 0),
                                'output_tokens': metrics.get('output_tokens', 0),
                                'total_tokens': metrics.get('total_tokens', 0),
                                'request_count': 1
                            }
                            logger.info(f"Updating metrics for user {user_id}: {tokens_metrics}")
                            supabase_client.update_user_metrics(user_id, tokens_metrics)
                        except Exception as e:
                            logger.error(f"Error updating metrics for user {user_id}: {e}")
                
                socketio.emit("response", {
                    "content": "",
                    "done": True,
                    "id": self.message_id, # Use self.message_id here.
                    "metrics": metrics if metrics else None
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
        eventlet.spawn(_run_agent, agent, message, context, images, audio, videos)


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
                
            # Get user ID from request if authenticated
            user_id = user_auth.get_user_id_for_session(sid)
            
            # Check usage limits if user is authenticated
            if user_id:
                # Verify user hasn't exceeded limits
                if not supabase_client.check_usage_limits(user_id):
                    logger.warning(f"User {user_id} has exceeded usage limits")
                    # We'll continue but log this - later we can block if needed
            
            # Choose the agent based on the flags
            if is_deepsearch:
                agent = get_deepsearch(
                    ddg_search=config.get("ddg_search", False),
                    web_crawler=config.get("web_crawler", False),
                    investment_assistant=config.get("investment_assistant", False),
                    debug_mode=True,
                    user_id=user_id  # Pass user_id to associate with session
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
                    debug_mode=True,
                    user_id=user_id  # Pass user_id to associate with session
                )

            self.sessions[sid] = {
                "agent": agent,
                "config": config,
                "initialized": True,
                "is_deepsearch": is_deepsearch,
                "is_browse_ai": is_browse_ai,
                "user_id": user_id  # Store user_id in session data
            }

            self.isolated_assistants[sid] = IsolatedAssistant(sid) # Pass sid
            
            # Associate session with user if authenticated
            if user_id:
                user_auth.associate_session_with_user(sid, user_id)
                logger.info(f"Associated session {sid} with user {user_id}")

            logger.info(f"Created new session {sid} with config {config} (Deepsearch: {is_deepsearch}, BrowseAI: {is_browse_ai})")
            return agent

    def terminate_session(self, sid):
        with self.lock:
            if sid in self.sessions:
                # Get user_id before removing session
                session_data = self.sessions.get(sid, {})
                user_id = session_data.get("user_id")
                
                # Process metrics if user is authenticated
                if user_id:
                    try:
                        # Process metrics for the user
                        metrics_processor = MetricsProcessor()
                        metrics_processor.process_user_metrics(user_id)
                        logger.info(f"Processed metrics for user {user_id}")
                    except Exception as e:
                        logger.error(f"Error processing metrics for user {user_id}: {e}")
                
                if sid in self.isolated_assistants:
                    self.isolated_assistants[sid].terminate()
                    del self.isolated_assistants[sid]
                
                # Remove session from user auth
                user_auth.remove_session(sid)
                
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

@socketio.on("authenticate")
def on_authenticate(data):
    sid = request.sid
    token = data.get('token')
    logger.info(f"Authentication request from {sid}")
    
    if token:
        user = supabase_client.get_user_by_token(token)
        if user:
            user_id = user.get('id')
            logger.info(f"User authenticated: {user_id}")
            
            # Associate this socket session with the user
            user_auth.associate_session_with_user(sid, user_id)
            
            # Update the existing session if it exists
            session = connection_manager.get_session(sid)
            if session:
                session['user_id'] = user_id
                logger.info(f"Updated existing session with user ID: {user_id}")
                
            emit("auth_response", {"status": "authenticated", "user_id": user_id})
        else:
            logger.warning(f"Invalid token provided by {sid}")
            emit("auth_response", {"status": "invalid_token"})
    else:
        logger.warning(f"Missing token in authentication request from {sid}")
        emit("auth_response", {"status": "missing_token"})

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

@socketio.on("send_message")
def on_send_message(data):
    sid = request.sid
    message_id = str(uuid.uuid4())

    # Parse data - may be JSON string or already an object
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            logger.error("Failed to parse JSON message")
            emit("response", {
                "content": "Error: Failed to parse message",
                "error": True,
                "done": True,
                "id": message_id
            })
            return

    # Extract auth token if present
    auth_token = data.get('auth_token')
    
    # If auth token is provided, authenticate the user
    if auth_token:
        user = supabase_client.get_user_by_token(auth_token)
        if user:
            user_id = user.get('id')
            logger.info(f"User authenticated via message token: {user_id}")
            
            # Associate this socket session with the user
            user_auth.associate_session_with_user(sid, user_id)
            
            # Update the existing session if it exists
            session = connection_manager.get_session(sid)
            if session:
                session['user_id'] = user_id
    
    # Get user_id from the session if available
    user_id = user_auth.get_user_id_for_session(sid)
    if user_id:
        logger.info(f"Processing message for authenticated user: {user_id}")
    else:
        logger.info("Processing message for anonymous session")

    # Continue with the existing message handling...
    message = data.get('message', '')
    context = data.get('context', '')
    files = data.get('files', [])
    config = data.get('config', {})
    is_deepsearch = data.get('is_deepsearch', False)

    # Process any files attached to the message
    images, audio, videos, text_content = process_files(files)
    
    # Add text content from files to the message
    if text_content:
        if message:
            message += "\n\n"
        message += "\n\n".join(text_content)
        
    # Set message_id for the assistant's response tracking
    message_id = data.get('id') or message_id
    
    session = connection_manager.get_session(sid)
    
    # Create a new session if one doesn't exist or if this is a special message
    if not session:
        connection_manager.create_session(sid, config, is_deepsearch=is_deepsearch)
        session = connection_manager.get_session(sid)
    
    if not session:
        logger.error("Failed to create session")
        emit("response", {
            "content": "Error: Failed to create session",
            "error": True,
            "done": True,
            "id": message_id
        })
        return
    
    # Set message_id to track streaming responses
    connection_manager.isolated_assistants[sid].message_id = message_id
    
    # Get agent from the session
    agent = session["agent"]
    
    # Run the agent in a separate thread to avoid blocking
    isolated_assistant = connection_manager.isolated_assistants[sid]
    isolated_assistant.run_safely(agent, message, context, images, audio, videos)

def process_metrics_task():
    """Process metrics for all users periodically"""
    while True:
        try:
            metrics_processor = MetricsProcessor()
            results = metrics_processor.process_all_metrics()
            logger.info(f"Periodic metrics processing results: {results}")
        except Exception as e:
            logger.error(f"Error in periodic metrics processing: {e}")
        eventlet.sleep(300)  # Process every 5 minutes

# Start the background task for metrics processing
eventlet.spawn(process_metrics_task)

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
