# app.py (Modified for Local Execution)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import eventlet
import datetime

# --- Local Module Imports ---
from assistant import get_llm_os
from supabase_client import supabase_client

# --- Agno Imports ---
from agno.agent import Agent
from agno.media import Image, Audio, Video
from agno.run.response import RunEvent
from agno.models.message import Message
from gotrue.errors import AuthApiError

# --- Initial Setup ---
load_dotenv()
# eventlet.monkey_patch() # Often called by the server runner, but explicit is safe.

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
    Runs the agent in a background greenlet to stream responses and handle external tool execution.
    """
    def __init__(self, sid):
        self.sid = sid
        self.message_id = None
        self.current_response_content = ""

    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None, messages=None):
        """Runs agent in an isolated greenlet, handles external execution, and streams responses."""
        def _run_agent(agent, message, user, context, images, audio, videos, messages):
            try:
                # If a raw message is passed, it's a new turn.
                # If `messages` are passed, it's a continuation (e.g., a tool result).
                if message:
                    complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}" if context else message
                else:
                    complete_message = None # No new user message text

                import inspect
                params = inspect.signature(agent.run).parameters
                supported_params = { 'stream': True, 'user_id': str(user.id) }
                
                if complete_message:
                    supported_params['message'] = complete_message
                if messages:
                    supported_params['messages'] = messages
                if 'images' in params and images:
                    supported_params['images'] = images
                if 'audio' in params and audio:
                    supported_params['audio'] = audio
                if 'videos' in params and videos:
                    supported_params['videos'] = videos

                logger.info(f"Calling agent.run for user {user.id} with params: {list(supported_params.keys())}")
                
                self.current_response_content = ""
                
                for chunk in agent.run(**supported_params):
                    # --- MODIFICATION: Handle External Execution ---
                    # Check if the agent wants to run a tool that requires client-side execution.
                    if chunk.event == RunEvent.tool_call_started.value and chunk.tools:
                        tool_call = chunk.tools[0]  # Assuming one tool call per turn for simplicity
                        tool_name = tool_call.get("tool_name")
                        
                        # Check if the tool is defined in the agent's model functions
                        tool_func = agent.model._functions.get(tool_name) if agent.model else None

                        if tool_func and getattr(tool_func, 'external_execution', False):
                            logger.info(f"Delegating external tool '{tool_name}' to client {self.sid}")
                            
                            payload = {
                                "tool_name": tool_name,
                                "tool_args": tool_call.get("tool_args"),
                                "tool_call_id": tool_call.get("tool_call_id")
                            }
                            socketio.emit("local_execution_request", payload, room=self.sid)
                            
                            # Inform the user that we are waiting for their action
                            waiting_msg = f"Waiting for permission to run the command: `{tool_name}`"
                            socketio.emit("response", {
                                "content": f"\n*System: {waiting_msg}*\n",
                                "streaming": True,
                                "id": self.message_id,
                            }, room=self.sid)
                            
                            # IMPORTANT: Stop this execution thread. The backend's job is done for now.
                            # It will be resumed when the client sends back a 'local_execution_result'.
                            return
                    # --- END MODIFICATION ---

                    if chunk and chunk.content:
                        eventlet.sleep(0)
                        self.current_response_content += chunk.content
                        socketio.emit("response", {
                            "content": chunk.content,
                            "streaming": True,
                            "id": self.message_id,
                        }, room=self.sid)

                socketio.emit("response", {"content": "", "done": True, "id": self.message_id}, room=self.sid)

                if hasattr(agent, 'session_metrics') and agent.session_metrics:
                    logger.info(
                        f"Run complete. Cumulative session tokens for SID {self.sid}: "
                        f"{agent.session_metrics.input_tokens} in, "
                        f"{agent.session_metrics.output_tokens} out."
                    )
                
                if complete_message: # Only save turn if it was a new user message
                    self._save_conversation_turn(complete_message)

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True, "done": True, "id": self.message_id,
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, user, context, images, audio, videos, messages)
    
    def _save_conversation_turn(self, user_message):
        """Save the current conversation turn to the session history"""
        try:
            session_info = connection_manager.get_session(self.sid)
            if not session_info:
                logger.warning(f"Cannot save conversation turn: no session found for SID {self.sid}")
                return
                
            turn_data = {"role": "user", "content": user_message, "timestamp": datetime.datetime.now().isoformat()}
            if 'history' not in session_info:
                session_info['history'] = []
            session_info['history'].append(turn_data)
            
            assistant_turn = {"role": "assistant", "content": self.current_response_content, "timestamp": datetime.datetime.now().isoformat()}
            session_info['history'].append(assistant_turn)
            
            logger.info(f"Added conversation turn to history for SID {self.sid}. History length: {len(session_info['history'])}")
        except Exception as e:
            logger.error(f"Error saving conversation turn: {e}")

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
        
        # Pass the shell_tools and python_assistant flags to get_llm_os
        agent_config = {
            'use_memory': config.get('use_memory', False),
            'calculator': config.get('calculator', True),
            'internet_search': config.get('internet_search', True),
            'shell_tools': config.get('shell_tools', True),
            'python_assistant': config.get('python_assistant', True),
            'investment_assistant': config.get('investment_assistant', True),
            'web_crawler': config.get('web_crawler', True),
        }

        if is_deepsearch:
            # Deepsearch is not defined in the provided files, assuming it's a separate flow
            # agent = get_deepsearch(user_id=user_id, **config)
            pass
        else:
            agent = get_llm_os(user_id=user_id, **agent_config)

        self.sessions[sid] = {
            "agent": agent, 
            "config": config,
            "history": [],
            "user_id": user_id,
            "created_at": datetime.datetime.now().isoformat()
        }
        
        self.isolated_assistants[sid] = IsolatedAssistant(sid)
        logger.info(f"Created session {sid} for user {user_id} with config {config}")
        return agent

    def terminate_session(self, sid):
        if sid in self.sessions:
            session_info = self.sessions.pop(sid, None)
            if not session_info: return

            agent = session_info.get("agent")
            history = session_info.get("history", [])
            user_id = session_info.get("user_id")

            if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                try:
                    metrics = agent.session_metrics
                    if metrics.input_tokens > 0 or metrics.output_tokens > 0:
                        logger.info(f"TERMINATE_SESSION FOR SID {sid}. Logging usage: {metrics.input_tokens} in, {metrics.output_tokens} out.")
                        supabase_client.from_('request_logs').insert({
                            'user_id': str(agent.user_id),
                            'input_tokens': metrics.input_tokens,
                            'output_tokens': metrics.output_tokens
                        }).execute()
                except Exception as e:
                    logger.error(f"Failed to log usage metrics for session {sid}: {e}\n{traceback.format_exc()}")
            
            if history:
                try:
                    now = int(datetime.datetime.now().timestamp())
                    payload = {
                        "session_id": sid, "user_id": user_id, "agent_id": "AI_OS",
                        "created_at": now, "updated_at": now, "memory": {"runs": history},
                        "session_data": {}
                    }
                    if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                        metrics = agent.session_metrics
                        payload["session_data"]["metrics"] = {
                            "input_tokens": metrics.input_tokens, "output_tokens": metrics.output_tokens,
                            "total_tokens": metrics.input_tokens + metrics.output_tokens
                        }
                    logger.info(f"Saving conversation history for SID {sid} with {len(history)} turns")
                    supabase_client.from_('ai_os_sessions').upsert(payload).execute()
                except Exception as e:
                    logger.error(f"Failed to save conversation history for SID {sid}: {e}\n{traceback.format_exc()}")
            
            if sid in self.isolated_assistants:
                self.isolated_assistants.pop(sid).terminate()
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
    try:
        data = json.loads(data)
        access_token = data.get("accessToken")
        if not access_token:
            emit("error", {"message": "Authentication token is missing.", "reset": True}, room=sid)
            return

        try:
            user_response = supabase_client.auth.get_user(jwt=access_token)
            user = user_response.user
            if not user: raise AuthApiError("User not found.", 401)
        except AuthApiError as e:
            logger.error(f"Invalid token for SID {sid}: {e.message}")
            emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
            return

        if data.get("type") == "terminate_session":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            config = data.get("config", {})
            agent = connection_manager.create_session(sid, str(user.id), config)
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Please reconnect.", "reset": True}, room=sid)
            connection_manager.terminate_session(sid)
            return
        
        isolated_assistant.message_id = message_id
        message = data.get("message", "")
        file_content, images, audio, videos = process_files(data.get("files", []))
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        isolated_assistant.run_safely(
            agent, combined_message, user, context=data.get("context"),
            images=images or None, audio=audio or None, videos=videos or None
        )
    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "An internal server error occurred.", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)

# --- NEW: Handler for Local Execution Results ---
@socketio.on("local_execution_result")
def on_local_execution_result(data: dict):
    """
    Handles the result of a command executed on the client-side.
    This resumes the agent's execution loop by feeding the tool's output back to it.
    """
    sid = request.sid
    logger.info(f"Received local execution result from client {sid}: {data.get('tool_call_id')}")

    session = connection_manager.get_session(sid)
    if not session:
        logger.warning(f"No session found for SID {sid} to handle local execution result.")
        return

    # We need to re-authenticate this request to get the user object
    access_token = data.get("accessToken")
    if not access_token:
        emit("error", {"message": "Authentication token missing for tool result.", "reset": True}, room=sid)
        return
    try:
        user = supabase_client.auth.get_user(jwt=access_token).user
        if not user: raise AuthApiError("User not found.", 401)
    except AuthApiError as e:
        logger.error(f"Invalid token for tool result from SID {sid}: {e.message}")
        emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
        return

    agent = session["agent"]
    isolated_assistant = connection_manager.isolated_assistants.get(sid)
    if not isolated_assistant:
        logger.error(f"Could not find isolated assistant for SID {sid}")
        return

    tool_call_id = data.get("tool_call_id")
    output = data.get("output", "")
    error = data.get("error", "")
    
    # Format the result into a string that the agent can understand.
    result_content = f"Command executed on the user's machine.\n--- STDOUT ---\n{output}\n\n--- STDERR ---\n{error}"

    # Create a tool result message that Agno can process.
    tool_result_message = Message(
        role="tool",
        content=result_content,
        tool_call_id=tool_call_id
    )
    
    # Resume the agent's execution by passing the tool result message.
    # Note: `message` is None because this is not a new user turn.
    isolated_assistant.run_safely(
        agent=agent,
        message=None,
        user=user,
        messages=[tool_result_message]
    )
# --- END NEW HANDLER ---

@app.route('/healthz', methods=['GET'])
def health_check():
    """Standard health check endpoint for Render."""
    return "OK", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=False)