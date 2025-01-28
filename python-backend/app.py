import logging
import json
import uuid
from flask import Flask, request
from flask_socketio import SocketIO, emit
from assistant import get_llm_os
import threading

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Flask and SocketIO setup
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
        
    def create_session(self, sid, config):
        """Creates a new agent session with the given config"""
        with self.lock:
            if sid in self.sessions:
                self.terminate_session(sid)
                
            agent = self.create_agent(config)
            self.sessions[sid] = {
                "agent": agent,
                "config": config,
                "initialized": True
            }
            logging.info(f"Created new session {sid} with config {config}")
            return agent
            
    def create_agent(self, config):
        return get_llm_os(
            calculator=config.get("calculator", False),
            web_crawler=config.get("web_crawler", False),
            ddg_search=config.get("ddg_search", False),
            shell_tools=config.get("shell_tools", False),
            python_assistant=config.get("python_assistant", False),
            investment_assistant=config.get("investment_assistant", False),
            use_memory=config.get("use_memory", False),
            debug_mode=False
        )

    def terminate_session(self, sid):
        """Terminates an existing session and cleans up resources"""
        with self.lock:
            if sid in self.sessions:
                # Clean up agent resources if needed
                agent = self.sessions[sid].get("agent")
                if agent:
                    # Add any cleanup needed for agent
                    pass
                del self.sessions[sid]
                logging.info(f"Terminated session {sid}")

    def get_session(self, sid):
        """Gets the session for a given sid"""
        return self.sessions.get(sid)

    def remove_session(self, sid):
        """Removes a session on disconnect"""
        self.terminate_session(sid)

connection_manager = ConnectionManager()

@socketio.on("connect")
def on_connect():
    sid = request.sid
    logging.info(f"Client connected: {sid}")
    # Only send connection confirmation, don't create session
    emit("status", {"message": "Connected to server"})

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    logging.info(f"Client disconnected: {sid}")
    connection_manager.remove_session(sid)

@socketio.on("send_message")
def on_send_message(data):
    sid = request.sid
    try:
        data = json.loads(data)
        message = data.get("message", "")
        
        # Check if this is a new chat request
        if data.get("type") == "new_chat":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            # Only create session if we have a real message
            if not message:
                return
                
            config = data.get("config", {})
            agent = connection_manager.create_session(sid, config)
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        
        responses = []
        stream = agent.run(message, stream=True)
        for chunk in stream:
            if chunk and chunk.content:
                responses.append({
                    "id": message_id, 
                    "content": chunk.content,
                    "streaming": True
                })
        responses.append({"id": message_id, "content": "", "done": True})
        
        for response in responses:
            emit("response", response, room=sid)
                
    except Exception as e:
        logging.error(f"Error processing message: {e}")
        emit("error", {"message": str(e)}, room=sid)

if __name__ == "__main__":
    logging.info("Starting server on port 8765")
    socketio.run(app, host="0.0.0.0", port=8765)