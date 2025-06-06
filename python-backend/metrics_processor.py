import os
import json
import glob
from typing import Dict, Any, Optional, List
import supabase_client

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
        
    def process_session_file(self, file_path: str) -> Dict[str, Any]:
        """
        Process a single session file and extract metrics
        
        Args:
            file_path: Path to the session file
            
        Returns:
            Dictionary containing session metrics
        """
        try:
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
            
            return {
                'user_id': user_id,
                'metrics': metrics,
                'session_id': session_data.get('session_id'),
                'processed': False
            }
        except Exception as e:
            print(f"Error processing session file {file_path}: {e}")
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
        session_files = glob.glob(f"{self.sessions_dir}/**/*.json", recursive=True)
        
        sessions = []
        for file_path in session_files:
            session_data = self.process_session_file(file_path)
            
            # Skip sessions without user_id or with no metrics
            if not session_data or not session_data.get('metrics'):
                continue
                
            # Filter by user_id if provided
            if user_id and session_data.get('user_id') != user_id:
                continue
                
            # Add file path to session data
            session_data['file_path'] = file_path
            sessions.append(session_data)
            
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
                
            return True
        except Exception as e:
            print(f"Error updating session file {file_path}: {e}")
            return False
    
    def process_user_metrics(self, user_id: str) -> bool:
        """
        Process all sessions for a user and update metrics in Supabase
        
        Args:
            user_id: User ID to process metrics for
            
        Returns:
            True if successful, False otherwise
        """
        # Get all unprocessed sessions for the user
        sessions = self.get_unprocessed_sessions(user_id)
        
        if not sessions:
            return True
            
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
        
        # Update metrics in Supabase
        success = supabase_client.update_user_metrics(user_id, total_metrics)
        
        if success:
            # Mark sessions as processed
            for session in sessions:
                self.update_session_processed(session.get('file_path'))
                
        return success
    
    def process_all_metrics(self) -> Dict[str, int]:
        """
        Process all unprocessed sessions for all users
        
        Returns:
            Dictionary with counts of processed and failed sessions
        """
        # Get all unprocessed sessions
        sessions = self.get_unprocessed_sessions()
        
        # Group sessions by user_id
        users = {}
        for session in sessions:
            user_id = session.get('user_id')
            if not user_id:
                continue
                
            if user_id not in users:
                users[user_id] = []
                
            users[user_id].append(session)
        
        # Process metrics for each user
        results = {
            'processed': 0,
            'failed': 0
        }
        
        for user_id, user_sessions in users.items():
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
            
            # Update metrics in Supabase
            success = supabase_client.update_user_metrics(user_id, total_metrics)
            
            if success:
                # Mark sessions as processed
                for session in user_sessions:
                    if self.update_session_processed(session.get('file_path')):
                        results['processed'] += 1
                    else:
                        results['failed'] += 1
            else:
                results['failed'] += len(user_sessions)
                
        return results 