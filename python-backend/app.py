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

# Connection Manager to manage agent sessions
class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def initialize_session(self, sid, config):
        with self.lock:
            self.sessions[sid] = {
                "agent": self.create_agent(config),
                "config": config
            }
            logging.info(f"Initialized session {sid} with config {config}")

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

    def reset_session(self, sid, config):
        with self.lock:
            if sid in self.sessions:
                self.sessions[sid]["agent"] = self.create_agent(config)
                self.sessions[sid]["config"] = config
                logging.info(f"Session {sid} reinitialized with new config {config}")

    def get_agent(self, sid):
        return self.sessions.get(sid, {}).get("agent")

    def remove_session(self, sid):
        with self.lock:
            if sid in self.sessions:
                del self.sessions[sid]
                logging.info(f"Session {sid} removed")

connection_manager = ConnectionManager()

# WebSocket Event Handlers
@socketio.on("connect")
def on_connect():
    sid = request.sid
    logging.info(f"Client connected: {sid}")
    connection_manager.initialize_session(sid, config={})
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
        msg_type = data.get("type", "message")
        config = data.get("config", {})
        agent = connection_manager.get_agent(sid)

        if msg_type == "reinitialize":
            connection_manager.reset_session(sid, config)
            emit("status", {"message": "Session reinitialized"}, room=sid)
        elif msg_type == "message" and agent:
            message_id = str(uuid.uuid4())
            user_message = data.get("message", "")

            responses = []
            stream = agent.run(user_message, stream=True)
            for chunk in stream:
                if chunk and chunk.content:
                    responses.append({"id": message_id, "content": chunk.content, "streaming": True})
            responses.append({"id": message_id, "content": "", "done": True})

            for response in responses:
                emit("response", response, room=sid)
        else:
            emit("error", {"message": "Agent not initialized"}, room=sid)
    except Exception as e:
        logging.error(f"Error processing message: {e}")
        emit("error", {"message": str(e)}, room=sid)

if __name__ == "__main__":
    logging.info("Starting server on port 8765")
    socketio.run(app, host="0.0.0.0", port=8765)
