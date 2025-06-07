import os
from typing import Dict, Any, Optional
from flask import request
import supabase_client
import logging

logger = logging.getLogger(__name__)

class UserAuth:
    """
    Handles user authentication and session management
    """
    
    def __init__(self):
        """Initialize the user authentication manager"""
        self.user_sessions = {}  # Map of session_id to {'user_id': str, 'user_email': str}
        logger.info("UserAuth initialized")
    
    def authenticate_request(self) -> Optional[Dict[str, Any]]:
        """
        Authenticate a request using JWT token in Authorization header
        
        Returns:
            User data if authenticated, None otherwise
        """
        # Get Authorization header
        auth_header = request.headers.get('Authorization', '')
        
        if not auth_header or not auth_header.startswith('Bearer '):
            logger.debug("No valid Authorization header found")
            return None
            
        # Extract token
        token = auth_header.split(' ')[1]
        logger.debug(f"Extracted token from Authorization header: {token[:10]}...")
        
        # Validate token with Supabase
        user = supabase_client.get_user_by_token(token)
        
        if user:
            logger.info(f"User authenticated: {user.id}")
        else:
            logger.warning("Invalid token provided")
            
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
    
    def associate_session_with_user(self, session_id: str, user_id: str, user_email: str):
        """
        Associate a session with a user and their email.
        """
        self.user_sessions[session_id] = {'user_id': user_id, 'user_email': user_email}
        logger.info(f"Associated session {session_id} with user {user_id} ({user_email})")
        logger.debug(f"Current sessions: {self.user_sessions}")
    
    def get_user_id_for_session(self, session_id: str) -> Optional[str]:
        """
        Get user ID for a session
        
        Args:
            session_id: Session ID to get user for
            
        Returns:
            User ID if session is associated with a user, None otherwise
        """
        session_info = self.user_sessions.get(session_id)
        if session_info:
            return session_info.get('user_id')
        return None

    def get_user_email_for_session(self, session_id: str) -> Optional[str]:
        """
        Get user email for a session

        Args:
            session_id: Session ID to get user for

        Returns:
            User email if session is associated with a user, None otherwise
        """
        session_info = self.user_sessions.get(session_id)
        if session_info:
            return session_info.get('user_email')
        return None
    
    def remove_session(self, session_id: str):
        """
        Remove a session from the user sessions map
        
        Args:
            session_id: Session ID to remove
        """
        if session_id in self.user_sessions:
            user_id = self.user_sessions[session_id].get('user_id')
            del self.user_sessions[session_id]
            logger.info(f"Removed session {session_id} for user {user_id}")
        else:
            logger.debug(f"Attempted to remove non-existent session: {session_id}")

# Create a singleton instance
user_auth = UserAuth() 