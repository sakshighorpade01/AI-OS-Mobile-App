import os
import json
import glob
from typing import Dict, Any, Optional, List
import supabase_client
import logging

logger = logging.getLogger(__name__)

class MetricsProcessor:
    """
    Process session data and update user metrics in Supabase
    """
    
    def __init__(self, sessions_dir: str = "data/sessions"):
        """
        Initialize the metrics processor
        
        Args:
            sessions_dir: Directory containing session data
        """
        self.sessions_dir = sessions_dir
        logger.info(f"MetricsProcessor initialized with sessions dir: {sessions_dir}")
        
    def process_session_file(self, file_path: str) -> Dict[str, Any]:
        """
        Process a single session file and extract metrics
        
        Args:
            file_path: Path to the session file
            
        Returns:
            Dictionary containing session metrics
        """
        try:
            logger.debug(f"Processing session file: {file_path}")
            with open(file_path, 'r') as f:
                session_data = json.load(f)
                
            # Extract user ID and metrics
            user_id = session_data.get('user_id')
            
            # Get metrics from session data
            metrics = {}
            if 'session_data' in session_data and 'session_metrics' in session_data['session_data']:
                session_metrics = session_data['session_data']['session_metrics']
                metrics = {
                    'input_tokens': session_metrics.get('input_tokens', 0),
                    'output_tokens': session_metrics.get('output_tokens', 0),
                    'total_tokens': session_metrics.get('total_tokens', 0),
                    'request_count': 1  # Count this as one request
                }
                logger.debug(f"Extracted metrics from session {session_data.get('session_id')}: {metrics}")
            else:
                logger.debug(f"No metrics found in session {session_data.get('session_id')}")
            
            # Check if this session has already been processed
            is_processed = False
            if 'extra_data' in session_data and session_data['extra_data'] and 'metrics_processed' in session_data['extra_data']:
                is_processed = session_data['extra_data']['metrics_processed']
                if is_processed:
                    logger.debug(f"Session {session_data.get('session_id')} already processed")
            
            return {
                'user_id': user_id,
                'metrics': metrics,
                'session_id': session_data.get('session_id'),
                'processed': is_processed
            }
        except Exception as e:
            logger.error(f"Error processing session file {file_path}: {e}")
            return {}
    
    def get_unprocessed_sessions(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get all unprocessed session files for a user
        
        Args:
            user_id: User ID to filter sessions by (optional)
            
        Returns:
            List of session data dictionaries
        """
        # Get all session files
        logger.info(f"Looking for session files in {self.sessions_dir}")
        session_files = glob.glob(f"{self.sessions_dir}/**/*.json", recursive=True)
        logger.info(f"Found {len(session_files)} session files")
        
        sessions = []
        for file_path in session_files:
            session_data = self.process_session_file(file_path)
            
            # Skip sessions without user_id or with no metrics
            if not session_data or not session_data.get('metrics'):
                continue
                
            # Skip sessions that have already been processed
            if session_data.get('processed', False):
                continue
                
            # Filter by user_id if provided
            if user_id and session_data.get('user_id') != user_id:
                continue
                
            # Add file path to session data
            session_data['file_path'] = file_path
            sessions.append(session_data)
            
        logger.info(f"Found {len(sessions)} unprocessed sessions" + (f" for user {user_id}" if user_id else ""))
        return sessions
    
    def update_session_processed(self, file_path: str) -> bool:
        """
        Mark a session as processed
        
        Args:
            file_path: Path to the session file
            
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.debug(f"Marking session as processed: {file_path}")
            with open(file_path, 'r') as f:
                session_data = json.load(f)
            
            # Mark as processed
            if 'extra_data' not in session_data:
                session_data['extra_data'] = {}
            
            if 'metrics_processed' not in session_data['extra_data']:
                session_data['extra_data']['metrics_processed'] = True
            
            # Write back to file
            with open(file_path, 'w') as f:
                json.dump(session_data, f, indent=2)
                
            logger.debug(f"Successfully marked session as processed: {file_path}")
            return True
        except Exception as e:
            logger.error(f"Error updating session file {file_path}: {e}")
            return False
    
    def process_user_metrics(self, user_id: str) -> bool:
        """
        Process all sessions for a user and update metrics in Supabase
        
        Args:
            user_id: User ID to process metrics for
            
        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Processing metrics for user {user_id}")
        
        # Get all unprocessed sessions for the user
        sessions = self.get_unprocessed_sessions(user_id)
        
        if not sessions:
            logger.info(f"No unprocessed sessions found for user {user_id}")
            return True
        
        logger.info(f"Found {len(sessions)} unprocessed sessions for user {user_id}")
            
        # Aggregate metrics
        total_metrics = {
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0,
            'request_count': 0
        }
        
        for session in sessions:
            metrics = session.get('metrics', {})
            total_metrics['input_tokens'] += metrics.get('input_tokens', 0)
            total_metrics['output_tokens'] += metrics.get('output_tokens', 0)
            total_metrics['total_tokens'] += metrics.get('total_tokens', 0)
            total_metrics['request_count'] += metrics.get('request_count', 0)
        
        logger.info(f"Aggregated metrics for user {user_id}: {total_metrics}")
        
        # Update metrics in Supabase
        success = supabase_client.update_user_metrics(user_id, total_metrics)
        
        if success:
            logger.info(f"Successfully updated metrics for user {user_id}")
            # Mark sessions as processed
            for session in sessions:
                self.update_session_processed(session.get('file_path'))
        else:
            logger.error(f"Failed to update metrics for user {user_id}")
                
        return success
    
    def process_all_metrics(self) -> Dict[str, int]:
        """
        Process all unprocessed sessions for all users
        
        Returns:
            Dictionary with counts of processed and failed sessions
        """
        logger.info("Processing metrics for all users")
        
        # Get all unprocessed sessions
        sessions = self.get_unprocessed_sessions()
        
        # Group sessions by user_id
        users = {}
        for session in sessions:
            user_id = session.get('user_id')
            if not user_id:
                logger.warning(f"Session {session.get('session_id')} has no user_id, skipping")
                continue
                
            if user_id not in users:
                users[user_id] = []
                
            users[user_id].append(session)
        
        logger.info(f"Found {len(users)} users with unprocessed sessions")
        
        # Process metrics for each user
        results = {
            'processed': 0,
            'failed': 0
        }
        
        for user_id, user_sessions in users.items():
            logger.info(f"Processing {len(user_sessions)} sessions for user {user_id}")
            
            # Aggregate metrics
            total_metrics = {
                'input_tokens': 0,
                'output_tokens': 0,
                'total_tokens': 0,
                'request_count': 0
            }
            
            for session in user_sessions:
                metrics = session.get('metrics', {})
                total_metrics['input_tokens'] += metrics.get('input_tokens', 0)
                total_metrics['output_tokens'] += metrics.get('output_tokens', 0)
                total_metrics['total_tokens'] += metrics.get('total_tokens', 0)
                total_metrics['request_count'] += metrics.get('request_count', 0)
            
            logger.info(f"Aggregated metrics for user {user_id}: {total_metrics}")
            
            # Update metrics in Supabase
            success = supabase_client.update_user_metrics(user_id, total_metrics)
            
            if success:
                logger.info(f"Successfully updated metrics for user {user_id}")
                # Mark sessions as processed
                for session in user_sessions:
                    if self.update_session_processed(session.get('file_path')):
                        results['processed'] += 1
                    else:
                        results['failed'] += 1
            else:
                logger.error(f"Failed to update metrics for user {user_id}")
                results['failed'] += len(user_sessions)
                
        logger.info(f"Metrics processing results: {results}")
        return results 