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

                socketio.emit("response", {
                    "content": "",
                    "done": True,
                    "id": self.message_id, # Use self.message_id here.
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

            # Choose the agent based on the flags
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

            self.isolated_assistants[sid] = IsolatedAssistant(sid) # Pass sid

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
        
        logger.info(f"Processing file: {file_name}, type: {file_type}, path: {file_path}")
        
        if not file_path:
            logger.warning(f"Skipping file without path: {file_name}")
            continue
            
        # Handle path normalization
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
        
        try:
            # Categorize files based on their MIME type
            if file_type.startswith('image/'):
                try:
                    img = Image(filepath=file_path)
                    images.append(img)
                    logger.info(f"Added image: {file_path}")
                except Exception as img_err:
                    logger.error(f"Error creating Image object: {str(img_err)}")
                    # Try loading content as fallback
                    try:
                        with open(file_path, 'rb') as f:
                            content = f.read()
                        img = Image(content=content)
                        images.append(img)
                        logger.info(f"Added image using content: {file_path}")
                    except Exception as content_err:
                        logger.error(f"Error loading image content: {str(content_err)}")
            elif file_type.startswith('audio/'):
                try:
                    aud = Audio(filepath=file_path)
                    audio.append(aud)
                    logger.info(f"Added audio: {file_path}")
                except Exception as aud_err:
                    logger.error(f"Error creating Audio object: {str(aud_err)}")
            elif file_type.startswith('video/'):
                try:
                    vid = Video(filepath=file_path)
                    videos.append(vid)
                    logger.info(f"Added video: {file_path}")
                except Exception as vid_err:
                    logger.error(f"Error creating Video object: {str(vid_err)}")
            elif file_type.startswith('text/') or file_type == 'application/json':
                # For text files, read the content
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    text_content.append(f"--- File: {file_name} ---\n{content}")
                    logger.info(f"Read text content from file: {file_path}")
                except Exception as e:
                    logger.error(f"Error reading text file {file_path}: {e}")
            else:
                # For other non-media files (like PDF, DOCX), try to extract text if possible
                try:
                    if file_type == 'application/pdf':
                        # Just note that a PDF was attached - we'll handle it based on file path
                        text_content.append(f"--- PDF File: {file_name} --- (Attached at path: {file_path})")
                        logger.info(f"Added PDF reference: {file_path}")
                        # Optionally add as image for visual processing by advanced models
                        try:
                            img = Image(filepath=file_path)
                            images.append(img)
                            logger.info(f"Also added PDF as image for visual processing: {file_path}")
                        except Exception as pdf_img_err:
                            logger.error(f"Error adding PDF as image: {str(pdf_img_err)}")
                    else:
                        logger.info(f"File attached but content not processed: {file_path}")
                        text_content.append(f"--- File: {file_name} (attached at path: {file_path}) ---")
                except Exception as e:
                    logger.error(f"Error processing non-text file {file_path}: {str(e)}")
        except Exception as e:
            logger.error(f"Error processing file {file_path}: {str(e)}")
            logger.error(traceback.format_exc())
    
    # Log summary of processed files
    if images:
        logger.info(f"Processed {len(images)} images")
    if audio:
        logger.info(f"Processed {len(audio)} audio files")
    if videos:
        logger.info(f"Processed {len(videos)} video files")
    if text_content:
        logger.info(f"Processed {len(text_content)} text files")
    
    combined_text = "\n\n".join(text_content) if text_content else None
    return combined_text, images, audio, videos

@socketio.on("send_message")
def on_send_message(data):
    sid = request.sid
    try:
        data = json.loads(data)
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

        # Process files for multimodal input
        file_content, images, audio, videos = process_files(files)
        
        # Combine file content with user message if available
        combined_message = message
        if file_content:
            combined_message += f"\n\nContent from attached files:\n{file_content}"

        # Run the agent with multimodal inputs
        isolated_assistant.run_safely(
            agent, 
            combined_message, 
            context, 
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
    """
    A simple health check endpoint.
    Returns "OK" with a 200 status code if the application is up and running.
    """
    # For a basic health check, just returning 200 is often enough.
    # You could add more sophisticated checks here if needed, e.g.:
    # - Check database connectivity
    # - Check status of critical external services
    # If any of those fail, you could return a 503 Service Unavailable.
    # But start simple.
    logger.debug("Health check endpoint was hit.") # Optional: for seeing it in logs
    return "OK", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    # The debug=True for socketio.run is for Flask's development server.
    # Gunicorn, which you use in Docker, has its own way of handling debug/reloading.
    # For Render, Gunicorn will be run, and DEBUG should be False in your env.
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    
    # When running locally with `python app.py`, this is used.
    # On Render, Gunicorn from your Dockerfile's CMD is used.
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)
