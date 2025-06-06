import os
from typing import Dict, Any, Optional
from flask import request
import supabase_client

class UserAuth:
    """
    Handles user authentication and session management
    """
    
    def __init__(self):
        """Initialize the user authentication manager"""
        self.user_sessions = {}  # Map of session_id to user_id
    
    def authenticate_request(self) -> Optional[Dict[str, Any]]:
        """
        Authenticate a request using JWT token in Authorization header
        
        Returns:
            User data if authenticated, None otherwise
        """
        # Get Authorization header
        auth_header = request.headers.get('Authorization', '')
        
        if not auth_header or not auth_header.startswith('Bearer '):
            return None
            
        # Extract token
        token = auth_header.split(' ')[1]
        
        # Validate token with Supabase
        user = supabase_client.get_user_by_token(token)
        
        return user
    
    def get_user_id_from_request(self) -> Optional[str]:
        """
        Get user ID from request
        
        Returns:
            User ID if authenticated, None otherwise
        """
        user = self.authenticate_request()
        
        if user:
            return user.get('id')
            
        return None
    
    def associate_session_with_user(self, session_id: str, user_id: str):
        """
        Associate a session with a user
        
        Args:
            session_id: Session ID to associate
            user_id: User ID to associate with the session
        """
        self.user_sessions[session_id] = user_id
    
    def get_user_id_for_session(self, session_id: str) -> Optional[str]:
        """
        Get user ID for a session
        
        Args:
            session_id: Session ID to get user for
            
        Returns:
            User ID if session is associated with a user, None otherwise
        """
        return self.user_sessions.get(session_id)
    
    def remove_session(self, session_id: str):
        """
        Remove a session from the user sessions map
        
        Args:
            session_id: Session ID to remove
        """
        if session_id in self.user_sessions:
            del self.user_sessions[session_id]

# Create a singleton instance
user_auth = UserAuth() 