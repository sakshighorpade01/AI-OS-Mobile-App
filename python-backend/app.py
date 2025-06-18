# app.py (Corrected, Final, and Definitive Version)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path
import threading # This will be removed, but keeping it for diff clarity
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import eventlet
import datetime

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
# eventlet.monkey_patch() # monkey_patch is often called by the server runner, but explicit is safe.

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
    Runs the agent in a background greenlet to stream responses.
    """
    def __init__(self, sid):
        self.sid = sid
        self.message_id = None
        self.current_response_content = ""  # Store the full response content

    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
        """Runs agent in an isolated greenlet, streams responses, and accumulates metrics in memory."""
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
                if 'images' in params and images:
                    supported_params['images'] = images
                if 'audio' in params and audio:
                    supported_params['audio'] = audio
                if 'videos' in params and videos:
                    supported_params['videos'] = videos

                logger.info(f"Calling agent.run for user {user.id} with params: {list(supported_params.keys())}")
                
                # Reset the accumulated content for this run
                self.current_response_content = ""
                
                # This loop streams responses directly to the client.
                for chunk in agent.run(**supported_params):
                    if chunk and chunk.content:
                        eventlet.sleep(0)
                        
                        # Check if this is a local execution request
                        try:
                            # Try to parse the content as JSON
                            import json
                            try:
                                content_obj = json.loads(chunk.content)
                                if isinstance(content_obj, dict) and content_obj.get("type") == "local_execution_request":
                                    # This is a local execution request, emit a special event
                                    logger.info(f"Detected local execution request: {content_obj}")
                                    # Instead of asking for user approval, directly execute the command
                                    socketio.emit("local_execution_request", {
                                        "request": content_obj,
                                        "message_id": self.message_id,
                                        "auto_approve": True  # Add flag to auto-approve the execution
                                    }, room=self.sid)
                                    # Skip adding this to the response content
                                    continue
                            except json.JSONDecodeError:
                                # Not JSON, treat as normal content
                                pass
                        except Exception as e:
                            logger.warning(f"Error checking for local execution request: {e}")
                            
                        # Accumulate the content
                        self.current_response_content += chunk.content
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

                # --- NEW: Log cumulative tokens to terminal after each run ---
                if hasattr(agent, 'session_metrics') and agent.session_metrics:
                    logger.info(
                        f"Run complete. Cumulative session tokens for SID {self.sid}: "
                        f"{agent.session_metrics.input_tokens} in, "
                        f"{agent.session_metrics.output_tokens} out."
                    )
                
                # --- NEW: Capture conversation turn in our own history list ---
                self._save_conversation_turn(complete_message)

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True, "done": True, "id": self.message_id,
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, user, context, images, audio, videos)
    
    def _save_conversation_turn(self, user_message):
        """Save the current conversation turn to the session history"""
        try:
            session_info = connection_manager.sessions.get(self.sid)
            if not session_info:
                logger.warning(f"Cannot save conversation turn: no session found for SID {self.sid}")
                return
                
            # Create a dictionary representing this turn
            turn_data = {
                "role": "user",
                "content": user_message,
                "timestamp": datetime.datetime.now().isoformat()
            }
            
            # Add user message to history
            if 'history' not in session_info:
                session_info['history'] = []
            session_info['history'].append(turn_data)
            
            # Add assistant response to history
            assistant_turn = {
                "role": "assistant",
                "content": self.current_response_content,
                "timestamp": datetime.datetime.now().isoformat()
            }
            session_info['history'].append(assistant_turn)
            
            logger.info(f"Added conversation turn to history for SID {self.sid}. History length: {len(session_info['history'])}")
        except Exception as e:
            logger.error(f"Error saving conversation turn: {e}")

    def terminate(self):
        pass

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        # A native threading.Lock is not needed in an eventlet environment.
        self.isolated_assistants = {}

    def create_session(self, sid: str, user_id: str, config: dict, is_deepsearch: bool = False) -> Agent:
        if sid in self.sessions:
            self.terminate_session(sid)

        logger.info(f"Creating new session for user: {user_id}")

        if is_deepsearch:
            agent = get_deepsearch(user_id=user_id, **config)
        else:
            agent = get_llm_os(user_id=user_id, **config)

        # Initialize session with agent, config, and empty history list
        self.sessions[sid] = {
            "agent": agent, 
            "config": config,
            "history": [],  # NEW: Our own history list that we control
            "user_id": user_id,  # Store user_id for easier access
            "created_at": datetime.datetime.now().isoformat()
        }
        
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
            history = session_info.get("history", [])
            user_id = session_info.get("user_id")

            # --- CRITICAL CHANGE: Implement cumulative logging on session termination ---
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
            
            # --- NEW: Save the full conversation history to the database ---
            if history and len(history) > 0:
                try:
                    # Create timestamp for the database
                    now = int(datetime.datetime.now().timestamp())
                    
                    # Prepare the payload for the database
                    # This mimics the structure that agno would normally create
                    payload = {
                        "session_id": sid,
                        "user_id": user_id,
                        "agent_id": "AI_OS",  # This is the name set in assistant.py
                        "created_at": now,
                        "updated_at": now,
                        "memory": {
                            "runs": history  # Our manually maintained history
                        },
                        "session_data": {}  # Initialize empty
                    }
                    
                    # Add token metrics if available
                    if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                        payload["session_data"]["metrics"] = {
                            "input_tokens": agent.session_metrics.input_tokens,
                            "output_tokens": agent.session_metrics.output_tokens,
                            "total_tokens": agent.session_metrics.input_tokens + agent.session_metrics.output_tokens
                        }
                    
                    # Save to database using upsert (will create or update)
                    logger.info(f"Saving complete conversation history for SID {sid} with {len(history)} turns")
                    result = supabase_client.from_('ai_os_sessions').upsert(payload).execute()
                    logger.info(f"Successfully saved conversation history to database for SID {sid}")
                    logger.debug(f"Database response: {result}")
                except Exception as e:
                    logger.error(f"Failed to save conversation history for SID {sid}: {e}\n{traceback.format_exc()}")
            
            # Now, clean up the session from memory
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
        files = data.get("files", [])
        is_deepsearch = data.get("is_deepsearch", False)

        if data.get("type") == "terminate_session":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            config = data.get("config", {})
            agent = connection_manager.create_session(
                sid,
                user_id=str(user.id),
                config=config,
                is_deepsearch=is_deepsearch
            )
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True}, room=sid)
            connection_manager.terminate_session(sid)
            return
        
        isolated_assistant.message_id = message_id

        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        # This is the original, working "fire-and-forget" streaming logic.
        isolated_assistant.run_safely(
            agent,
            combined_message,
            user=user,
            context=context,
            images=images or None,
            audio=audio or None,
            videos=videos or None
        )

    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)

@socketio.on("local_execution_result")
def on_local_execution_result(data):
    """Handle the result of a local execution from the frontend."""
    sid = request.sid
    logger.info(f"Received local execution result for SID {sid}")
    
    try:
        message_id = data.get("message_id")
        output = data.get("output", "")
        error = data.get("error", "")
        command_type = data.get("type", "")
        
        # Format the result as a response message
        result_content = ""
        if error:
            result_content = f"```\n{error}\n```"
        elif output:
            result_content = f"```\n{output}\n```"
        else:
            result_content = "Command executed successfully with no output."
            
        # Add a header based on the command type
        if command_type == "shell":
            result_content = f"**Shell Command Result:**\n\n{result_content}"
        elif command_type == "python":
            result_content = f"**Python Script Result:**\n\n{result_content}"
        
        # Send the result as a normal response
        socketio.emit("response", {
            "content": result_content,
            "streaming": False,
            "id": message_id,
        }, room=sid)
        
    except Exception as e:
        logger.error(f"Error handling local execution result: {e}\n{traceback.format_exc()}")
        socketio.emit("error", {"message": "Error handling command result", "reset": False}, room=sid)

@app.route('/healthz', methods=['GET'])
def health_check():
    """Standard health check endpoint for Render."""
    return "OK", 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)