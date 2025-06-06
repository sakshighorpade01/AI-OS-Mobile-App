import os
from typing import Dict, Any, Optional
import supabase
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv("SUPABASE_URL", "https://vpluyoknbywuhahcnlfx.supabase.co")
supabase_key = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwbHV5b2tuYnl3dWhhaGNubGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNjMwMDEsImV4cCI6MjA2MjYzOTAwMX0.7o8ICrbVdndxi_gLafKf9aqyDgkqNrisZvrJT3XEUfA")
supabase_client = supabase.create_client(supabase_url, supabase_key)

def get_user_by_token(jwt_token: str) -> Optional[Dict[str, Any]]:
    """
    Validate JWT token and return user data
    
    Args:
        jwt_token: The JWT token to validate
        
    Returns:
        User data if token is valid, None otherwise
    """
    try:
        # Get user data from token
        response = supabase_client.auth.get_user(jwt_token)
        return response.user
    except Exception as e:
        print(f"Error validating token: {e}")
        return None

def get_user_usage_metrics(user_id: str) -> Dict[str, Any]:
    """
    Get usage metrics for a user
    
    Args:
        user_id: The user ID to get metrics for
        
    Returns:
        User metrics data
    """
    try:
        response = supabase_client.table('usage_metrics') \
            .select('*') \
            .eq('user_id', user_id) \
            .single() \
            .execute()
        
        return response.data
    except Exception as e:
        print(f"Error getting user metrics: {e}")
        return {}

def update_user_metrics(user_id: str, metrics: Dict[str, int]) -> bool:
    """
    Update usage metrics for a user
    
    Args:
        user_id: The user ID to update metrics for
        metrics: Dictionary containing metrics to update
            {
                'input_tokens': int,
                'output_tokens': int,
                'total_tokens': int,
                'request_count': int
            }
            
    Returns:
        True if successful, False otherwise
    """
    try:
        # Check if user has metrics record
        user_metrics = get_user_usage_metrics(user_id)
        
        if not user_metrics:
            # Create new metrics record
            response = supabase_client.table('usage_metrics').insert({
                'user_id': user_id,
                'input_tokens': metrics.get('input_tokens', 0),
                'output_tokens': metrics.get('output_tokens', 0),
                'total_tokens': metrics.get('total_tokens', 0),
                'request_count': metrics.get('request_count', 0)
            }).execute()
        else:
            # Update existing metrics
            response = supabase_client.table('usage_metrics') \
                .update({
                    'input_tokens': user_metrics.get('input_tokens', 0) + metrics.get('input_tokens', 0),
                    'output_tokens': user_metrics.get('output_tokens', 0) + metrics.get('output_tokens', 0),
                    'total_tokens': user_metrics.get('total_tokens', 0) + metrics.get('total_tokens', 0),
                    'request_count': user_metrics.get('request_count', 0) + metrics.get('request_count', 0),
                    'updated_at': 'NOW()'
                }) \
                .eq('user_id', user_id) \
                .execute()
                
        return True
    except Exception as e:
        print(f"Error updating user metrics: {e}")
        return False

def check_usage_limits(user_id: str, limit: int = 1000000) -> bool:
    """
    Check if user has exceeded usage limits
    
    Args:
        user_id: The user ID to check limits for
        limit: Maximum allowed tokens (default: 1,000,000)
        
    Returns:
        True if user is within limits, False otherwise
    """
    metrics = get_user_usage_metrics(user_id)
    
    if not metrics:
        return True
        
    total_tokens = metrics.get('total_tokens', 0)
    return total_tokens < limit 