# python-backend/app.py

import os
import logging
import json
import uuid
import traceback
import requests
from pathlib import Path
from flask import Flask, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import eventlet
import datetime
from typing import Union, Dict, Any

from authlib.integrations.flask_client import OAuth

from assistant import get_llm_os
from deepsearch import get_deepsearch
from supabase_client import supabase_client

# --- MODIFICATION: Import all necessary event and response types ---
from agno.agent import Agent
from agno.team import Team
from agno.media import Image, Audio, Video, File
from agno.run.response import RunEvent, RunResponse
from agno.run.team import TeamRunEvent, TeamRunResponse
from gotrue.errors import AuthApiError

load_dotenv()

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

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")
if not app.secret_key:
    raise ValueError("FLASK_SECRET_KEY is not set. Please set it in your environment variables.")

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

oauth = OAuth(app)

oauth.register(
    name='github',
    client_id=os.getenv("GITHUB_CLIENT_ID"),
    client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
    access_token_url='https://github.com/login/oauth/access_token',
    access_token_params=None,
    authorize_url='https://github.com/login/oauth/authorize',
    authorize_params=None,
    api_base_url='https://api.github.com/',
    client_kwargs={'scope': 'repo user:email'},
)

oauth.register(
    name='google',
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    authorize_params=None,
    access_token_url='https://accounts.google.com/o/oauth2/token',
    access_token_params=None,
    refresh_token_url=None,
    api_base_url='https://www.googleapis.com/oauth2/v1/',
    client_kwargs={
        'scope': 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive',
        'access_type': 'offline',
        'prompt': 'consent'
    }
)

class IsolatedAssistant:
    def __init__(self, sid):
        self.sid = sid
        self.message_id = None
        self.final_assistant_response = ""

    # --- MODIFICATION START: This recursive function is the core of the fix ---
    def _process_and_emit_response(self, response: Union[RunResponse, TeamRunResponse], is_top_level: bool = True):
        """
        Recursively processes a response object and emits socket events.
        This handles the nested structure of team responses.
        """
        if not response:
            return

        owner_name = getattr(response, 'agent_name', None) or getattr(response, 'team_name', None)

        # Aetheria_AI is the top-level coordinator. Only its direct output is the "final answer".
        # All other content, including from sub-teams or nested agents, is a "log".
        is_final_content = is_top_level and owner_name == "Aetheria_AI"

        if response.content:
            socketio.emit("response", {
                "content": response.content,
                "streaming": True,
                "id": self.message_id,
                "agent_name": owner_name,
                "team_name": owner_name,
                # ADD THIS NEW FLAG: True for intermediate steps, False for the final answer.
                "is_log": not is_final_content,
            }, room=self.sid)

        # If it's a team response, recursively process each member's response
        if hasattr(response, 'member_responses') and response.member_responses:
            for member_response in response.member_responses:
                # For all nested calls, is_top_level is False.
                self._process_and_emit_response(member_response, is_top_level=False)
    # --- MODIFICATION END ---

    def run_safely(self, agent: Union[Agent, Team], message: str, user, context=None, images=None, audio=None, videos=None, files=None):
        def _run_agent(agent, message, user, context, images, audio, videos, files):
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
                    'stream_intermediate_steps': True,
                    'user_id': str(user.id)
                }
                if 'images' in params and images: supported_params['images'] = images
                if 'audio' in params and audio: supported_params['audio'] = audio
                if 'videos' in params and videos: supported_params['videos'] = videos
                if 'files' in params and files: supported_params['files'] = files

                logger.info(f"Calling agent.run for user {user.id} with params: {list(supported_params.keys())}")
                
                self.final_assistant_response = ""
                
                for chunk in agent.run(**supported_params):
                    if not chunk or not hasattr(chunk, 'event'):
                        continue

                    eventlet.sleep(0)
                    
                    # --- MODIFICATION START: Use the correct event and the recursive handler ---
                    if (chunk.event == RunEvent.run_response_content.value or
                        chunk.event == TeamRunEvent.run_response_content.value):
                        # The initial call is the top level
                        self._process_and_emit_response(chunk, is_top_level=True)
                        
                        # Aggregate the final response for history.
                        # The final response is the content from the top-level agent "Aetheria_AI"
                        # that does not have further nested member responses.
                        owner_name = getattr(chunk, 'agent_name', None) or getattr(chunk, 'team_name', None)
                        is_final_chunk = owner_name == "Aetheria_AI" and (not hasattr(chunk, 'member_responses') or not chunk.member_responses)

                        if chunk.content and is_final_chunk:
                            self.final_assistant_response += chunk.content
                    # --- MODIFICATION END ---

                    elif (chunk.event == RunEvent.tool_call_started.value or
                          chunk.event == TeamRunEvent.tool_call_started.value) and hasattr(chunk, 'tool'):
                        socketio.emit("agent_step", {
                            "type": "tool_start",
                            "name": chunk.tool.tool_name,
                            # Get agent/team name from the parent chunk, not the tool object
                            "agent_name": getattr(chunk, 'agent_name', None),
                            "team_name": getattr(chunk, 'team_name', None),
                            "id": self.message_id
                        }, room=self.sid)

                    elif (chunk.event == RunEvent.tool_call_completed.value or
                          chunk.event == TeamRunEvent.tool_call_completed.value) and hasattr(chunk, 'tool'):
                        socketio.emit("agent_step", {
                            "type": "tool_end",
                            "name": chunk.tool.tool_name,
                            # Get agent/team name from the parent chunk, not the tool object
                            "agent_name": getattr(chunk, 'agent_name', None),
                            "team_name": getattr(chunk, 'team_name', None),
                            "id": self.message_id
                        }, room=self.sid)

                socketio.emit("response", {
                    "content": "",
                    "done": True,
                    "id": self.message_id,
                }, room=self.sid)

                if hasattr(agent, 'session_metrics') and agent.session_metrics:
                    logger.info(
                        f"Run complete. Cumulative session tokens for SID {self.sid}: "
                        f"{agent.session_metrics.input_tokens} in, "
                        f"{agent.session_metrics.output_tokens} out."
                    )
                
                self._save_conversation_turn(complete_message)

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True, "done": True, "id": self.message_id,
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, user, context, images, audio, videos, files)
    
    def _save_conversation_turn(self, user_message):
        try:
            session_info = connection_manager.sessions.get(self.sid)
            if not session_info:
                logger.warning(f"Cannot save conversation turn: no session found for SID {self.sid}")
                return
                
            turn_data = {
                "role": "user",
                "content": user_message,
                "timestamp": datetime.datetime.now().isoformat()
            }
            
            if 'history' not in session_info:
                session_info['history'] = []
            session_info['history'].append(turn_data)
            
            assistant_turn = {
                "role": "assistant",
                "content": self.final_assistant_response,
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
        self.isolated_assistants = {}

    def create_session(self, sid: str, user_id: str, config: dict, is_deepsearch: bool = False) -> Union[Agent, Team]:
        if sid in self.sessions:
            self.terminate_session(sid)

        logger.info(f"Creating new session for user: {user_id}")
        config['enable_github'] = True 
        config['enable_google_email'] = True
        config['enable_google_drive'] = True

        session_info = {
            "agent": None,
            "config": config,
            "history": [],
            "user_id": user_id,
            "created_at": datetime.datetime.now().isoformat(),
            "sandbox_ids": set(),
            "active_sandbox_id": None
        }
        
        if is_deepsearch:
            agent = get_deepsearch(user_id=user_id, session_info=session_info, **config)
        else:
            agent = get_llm_os(user_id=user_id, session_info=session_info, **config)

        session_info["agent"] = agent
        self.sessions[sid] = session_info
        
        self.isolated_assistants[sid] = IsolatedAssistant(sid)
        logger.info(f"Created session {sid} for user {user_id} with config {config}")
        return agent

    def terminate_session(self, sid):
        if sid in self.sessions:
            session_info = self.sessions.pop(sid)
            if not session_info: return
            
            agent = session_info.get("agent")
            history = session_info.get("history", [])
            user_id = session_info.get("user_id")

            sandbox_ids_to_clean = session_info.get("sandbox_ids", set())
            if sandbox_ids_to_clean:
                logger.info(f"Cleaning up {len(sandbox_ids_to_clean)} sandbox sessions for SID {sid}.")
                sandbox_api_url = os.getenv("SANDBOX_API_URL")
                for sandbox_id in sandbox_ids_to_clean:
                    try:
                        requests.delete(f"{sandbox_api_url}/sessions/{sandbox_id}", timeout=10)
                        logger.info(f"Successfully terminated sandbox {sandbox_id}.")
                    except requests.RequestException as e:
                        logger.error(f"Failed to clean up sandbox {sandbox_id}: {e}")

            if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                try:
                    final_metrics = agent.session_metrics
                    input_tokens, output_tokens = final_metrics.input_tokens, final_metrics.output_tokens
                    if input_tokens > 0 or output_tokens > 0:
                        user_id_str = str(agent.user_id) if hasattr(agent, 'user_id') else user_id
                        supabase_client.from_('request_logs').insert({
                            'user_id': user_id_str, 'input_tokens': input_tokens, 'output_tokens': output_tokens
                        }).execute()
                except Exception as e:
                    logger.error(f"Failed to log usage metrics for session {sid} on termination: {e}\n{traceback.format_exc()}")
            
            if history and len(history) > 0:
                try:
                    now = int(datetime.datetime.now().timestamp())
                    payload = {
                        "session_id": sid, "user_id": user_id, "agent_id": "AI_OS",
                        "created_at": now, "updated_at": now, "memory": { "runs": history }, "session_data": {}
                    }
                    if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                        payload["session_data"]["metrics"] = {
                            "input_tokens": agent.session_metrics.input_tokens,
                            "output_tokens": agent.session_metrics.output_tokens,
                            "total_tokens": agent.session_metrics.input_tokens + agent.session_metrics.output_tokens
                        }
                    supabase_client.from_('ai_os_sessions').upsert(payload).execute()
                except Exception as e:
                    logger.error(f"Failed to save conversation history for SID {sid}: {e}\n{traceback.format_exc()}")
            
            if sid in self.isolated_assistants:
                self.isolated_assistants[sid].terminate()
                del self.isolated_assistants[sid]
            logger.info(f"Terminated and cleaned up session {sid}")

    def get_session(self, sid):
        return self.sessions.get(sid)

    def remove_session(self, sid):
        self.terminate_session(sid)

connection_manager = ConnectionManager()

@app.route('/login/<provider>')
def login_provider(provider):
    token = request.args.get('token')
    if not token:
        return "Authentication token is missing.", 400
    session['supabase_token'] = token
    
    redirect_uri = url_for('auth_callback', provider=provider, _external=True)
    
    if provider not in oauth._clients:
        return "Invalid provider specified.", 404
    
    if provider == 'google':
        return oauth.google.authorize_redirect(
            redirect_uri,
            access_type='offline',
            prompt='consent'
        )
        
    return oauth.create_client(provider).authorize_redirect(redirect_uri)

@app.route('/auth/<provider>/callback')
def auth_callback(provider):
    try:
        supabase_token = session.get('supabase_token')
        if not supabase_token:
            return "Your session has expired. Please try connecting again.", 400
        
        try:
            user_response = supabase_client.auth.get_user(jwt=supabase_token)
            user = user_response.user
            if not user:
                raise AuthApiError("User not found for the provided token.", 401)
        except AuthApiError as e:
            logger.error(f"Invalid token during {provider} auth callback: {e.message}")
            return "Your session is invalid. Please log in and try again.", 401
        
        client = oauth.create_client(provider)
        token = client.authorize_access_token()

        logger.info(f"Received token data from {provider}: {token}")
        
        integration_data = {
            'user_id': str(user.id),
            'service': provider,
            'access_token': token.get('access_token'),
            'refresh_token': token.get('refresh_token'),
            'scopes': token.get('scope', '').split(' '),
        }
        
        integration_data = {k: v for k, v in integration_data.items() if v is not None}

        supabase_client.from_('user_integrations').upsert(integration_data).execute()
        
        logger.info(f"Successfully saved {provider} integration for user {user.id}")

        return f"""
            <h1>Authentication Successful!</h1>
            <p>You have successfully connected your {provider.capitalize()} account. You can now close this window.</p>
        """
    except Exception as e:
        logger.error(f"Error in {provider} auth callback: {e}\n{traceback.format_exc()}")
        return "An error occurred during authentication. Please try again.", 500


def get_user_from_token(request):
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, ('Authorization header is missing or invalid', 401)
    
    jwt = auth_header.split(' ')[1]
    try:
        user_response = supabase_client.auth.get_user(jwt=jwt)
        if not user_response.user:
            raise AuthApiError("User not found for token.", 401)
        return user_response.user, None
    except AuthApiError as e:
        logger.error(f"API authentication error: {e.message}")
        return None, ('Invalid or expired token', 401)

@app.route('/api/integrations', methods=['GET'])
def get_integrations_status():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        response = supabase_client.from_('user_integrations').select('service').eq('user_id', str(user.id)).execute()
        connected_services = [item['service'] for item in response.data]
        return jsonify({"integrations": connected_services})
    except Exception as e:
        logger.error(f"Failed to get integration status for user {user.id}: {e}")
        return jsonify({"error": "Failed to retrieve integration status"}), 500

@app.route('/api/integrations/disconnect', methods=['POST'])
def disconnect_integration():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    data = request.get_json()
    service_to_disconnect = data.get('service')
    if not service_to_disconnect:
        return jsonify({"error": "Service name not provided"}), 400

    try:
        supabase_client.from_('user_integrations').delete().eq('user_id', str(user.id)).eq('service', service_to_disconnect).execute()
        logger.info(f"User {user.id} disconnected from {service_to_disconnect}")
        return jsonify({"message": f"Successfully disconnected from {service_to_disconnect}"}), 200
    except Exception as e:
        logger.error(f"Failed to disconnect {service_to_disconnect} for user {user.id}: {e}")
        return jsonify({"error": "Failed to disconnect integration"}), 500

@app.route('/api/sessions', methods=['GET'])
def get_user_sessions():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        response = supabase_client.from_('ai_os_sessions') \
            .select('session_id, created_at, memory') \
            .eq('user_id', str(user.id)) \
            .order('created_at', desc=True) \
            .limit(50) \
            .execute()
        return jsonify(response.data), 200
    except Exception as e:
        logger.error(f"Failed to get sessions for user {user.id}: {e}")
        return jsonify({"error": "Failed to retrieve session history"}), 500

@app.route('/api/generate-upload-url', methods=['POST'])
def generate_upload_url():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    data = request.get_json()
    file_name = data.get('fileName')
    if not file_name:
        return jsonify({"error": "fileName is required"}), 400

    file_path = f"{user.id}/{file_name}"
    
    try:
        upload_details = supabase_client.storage.from_('media-uploads').create_signed_upload_url(file_path)
        response_data = {
            "signedURL": upload_details['signed_url'],
            "path": upload_details['path']
        }
        return jsonify(response_data), 200
    except Exception as e:
        logger.error(f"Failed to create signed URL for user {user.id}: {e}\n{traceback.format_exc()}")
        return jsonify({"error": "Could not create signed URL"}), 500

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

def process_files(files_data):
    images, audio, videos, other_files, text_content = [], [], [], [], []
    logger.info(f"Processing {len(files_data)} files")

    for file_data in files_data:
        file_name = file_data.get('name', 'unnamed_file')
        file_type = file_data.get('type', '')
        
        if 'path' in file_data:
            file_path_in_bucket = file_data['path']
            try:
                file_bytes = supabase_client.storage.from_('media-uploads').download(file_path_in_bucket)
                
                if file_type.startswith('image/'):
                    images.append(Image(content=file_bytes))
                elif file_type.startswith('audio/'):
                    audio.append(Audio(content=file_bytes, format=file_type))
                elif file_type.startswith('video/'):
                    videos.append(Video(content=file_bytes))
                else:
                    other_files.append(File(content=file_bytes, mime_type=file_type))
            except Exception as e:
                logger.error(f"Error downloading file from Supabase Storage at path {file_path_in_bucket}: {str(e)}")
            continue

        if file_data.get('isText') and 'content' in file_data:
            text_content.append(f"--- File: {file_name} ---\n{file_data['content']}")
            continue

    combined_text = "\n\n".join(text_content) if text_content else None
    
    return combined_text, images, audio, videos, other_files

@socketio.on("send_message")
def on_send_message(data: str):
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
        session_data = connection_manager.get_session(sid)
        if not session_data:
            config = data.get("config", {})
            agent = connection_manager.create_session(
                sid, user_id=str(user.id), config=config, is_deepsearch=is_deepsearch
            )
        else:
            agent = session_data["agent"]
        message_id = data.get("id") or str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True}, room=sid)
            connection_manager.terminate_session(sid)
            return
        isolated_assistant.message_id = message_id
        
        file_content, images, audio, videos, other_files = process_files(files)
        
        combined_message = f"{message}\n\n{file_content}" if file_content else message
        
        isolated_assistant.run_safely(
            agent, combined_message, user=user, context=context,
            images=images or None, 
            audio=audio or None, 
            videos=videos or None,
            files=other_files or None
        )
    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)

@app.route('/healthz', methods=['GET'])
def health_check():
    return "OK", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)