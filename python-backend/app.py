# app.py (Corrected and Updated for Usage Tracking)
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

# --- NEW IMPORTS ---
from gotrue.errors import AuthApiError
from agno.agent import Agent
from supabase_client import supabase_client # Import your initialized Supabase client

load_dotenv()

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

    # MODIFIED: Added 'user' parameter to accept the verified user object
    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
        """Runs agent in isolated thread, handles crashes, and logs usage."""

        # MODIFIED: This internal function now also handles metric logging
        def _run_agent(self, agent, message, user, context, images, audio, videos):
            try:
                if context:
                    complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}"
                else:
                    complete_message = message

                # --- This block remains the same ---
                import inspect
                params = inspect.signature(agent.run).parameters
                supported_params = {}
                supported_params['message'] = complete_message
                supported_params['stream'] = True
                if 'images' in params and images:
                    supported_params['images'] = images
                if 'audio' in params and audio:
                    supported_params['audio'] = audio
                if 'videos' in params and videos:
                    supported_params['videos'] = videos
                # --- End of block ---

                logger.info(f"Calling agent.run with params: {list(supported_params.keys())}")
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

                # --- NEW: METRIC EXTRACTION AND LOGGING ---
                if user and agent.memory and agent.memory.runs:
                    try:
                        # Get the metrics from the very last run
                        last_run_metrics = agent.memory.runs[-1].response.metrics
                        
                        # Sum up tokens used in this specific interaction
                        input_tokens_used = sum(last_run_metrics['input_tokens'])
                        output_tokens_used = sum(last_run_metrics['output_tokens'])

                        if input_tokens_used > 0 or output_tokens_used > 0:
                            logger.info(f"Logging usage for user {user.id}: {input_tokens_used} in, {output_tokens_used} out.")
                            
                            # Call the Supabase RPC function to atomically update metrics
                            supabase_client.rpc('update_usage_metrics', {
                                'p_user_id': str(user.id),
                                'p_input_tokens_increment': input_tokens_used,
                                'p_output_tokens_increment': output_tokens_used
                            }).execute()
                        else:
                            logger.info(f"No token usage to log for user {user.id}.")

                    except KeyError as ke:
                        logger.error(f"Metric key not found: {ke}. Available keys: {last_run_metrics.keys()}")
                    except Exception as metric_error:
                        logger.error(f"Failed to log usage metrics for user {user.id}: {metric_error}")
                        logger.error(traceback.format_exc())
                # --- END: METRIC EXTRACTION AND LOGGING ---

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True,
                    "done": True,
                    "id": self.message_id,
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        # MODIFIED: Pass the 'user' object to the greenlet
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

            if is_deepsearch:
                agent = get_deepsearch(
                    ddg_search=config.get("ddg_search", False),
                    web_crawler=config.get("web_crawler", False),
                    investment_assistant=config.get("investment_assistant", False),
                    debug_mode=True
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
                    debug_mode=True
                )

            self.sessions[sid] = {
                "agent": agent,
                "config": config,
                "initialized": True,
                "is_deepsearch": is_deepsearch,
                "is_browse_ai": is_browse_ai
            }
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

# This function remains unchanged
def process_files(files):
    # ... (your existing process_files logic)
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
def on_send_message(data):
    sid = request.sid
    user = None # Will hold the verified user object

    try:
        data = json.loads(data)
        access_token = data.get("accessToken")

        # --- TOKEN VERIFICATION STEP ---
        if not access_token:
            emit("error", {"message": "Authentication token is missing. Please log in again.", "reset": True}, room=sid)
            return

        try:
            # Verify the token using the Supabase client
            user_response = supabase_client.auth.get_user(jwt=access_token)
            user = user_response.user
            if not user:
                raise AuthApiError("User not found for the provided token.", 401)
            logger.info(f"Request authenticated for user: {user.id}")
        except AuthApiError as e:
            logger.error(f"Invalid token for SID {sid}: {e.message}")
            emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
            return
        # --- END TOKEN VERIFICATION ---

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
            agent = connection_manager.create_session(sid, config, is_deepsearch=is_deepsearch, is_browse_ai=is_browse_ai)
        else:
            agent = session["agent"]

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

        # MODIFIED: Pass the verified 'user' object to the run_safely method
        isolated_assistant.run_safely(
            agent, 
            combined_message, 
            user=user, # Pass the user object here
            context=context, 
            images=images if images else None,
            audio=audio if audio else None,
            videos=videos if videos else None
        )

    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)

@app.route('/healthz', methods=['GET'])
def health_check():
    logger.debug("Health check endpoint was hit.")
    return "OK", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)