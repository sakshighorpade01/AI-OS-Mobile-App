import os
from typing import Dict, Any, Optional
import supabase
from dotenv import load_dotenv
import logging

# Configure logger
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv("SUPABASE_URL", "https://vpluyoknbywuhahcnlfx.supabase.co")
supabase_key = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwbHV5b2tuYnl3dWhhaGNubGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNjMwMDEsImV4cCI6MjA2MjYzOTAwMX0.7o8ICrbVdndxi_gLafKf9aqyDgkqNrisZvrJT3XEUfA")
logger.info(f"Initializing Supabase client with URL: {supabase_url}")
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
        logger.debug(f"Validating token: {jwt_token[:10]}...")
        # Get user data from token
        response = supabase_client.auth.get_user(jwt_token)
        user = response.user
        if user:
            logger.info(f"Token validated successfully for user: {user.id}")
        else:
            logger.warning("Token validation failed - no user found")
        return user
    except Exception as e:
        logger.error(f"Error validating token: {e}")
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
        logger.debug(f"Getting usage metrics for user: {user_id}")
        response = supabase_client.table('usage_metrics') \
            .select('*') \
            .eq('user_id', user_id) \
            .single() \
            .execute()
        
        if response.data:
            logger.info(f"Retrieved metrics for user {user_id}: {response.data}")
        else:
            logger.info(f"No metrics found for user {user_id}")
            
        return response.data or {}
    except Exception as e:
        logger.error(f"Error getting user metrics: {e}")
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
        logger.debug(f"Updating metrics for user {user_id}: {metrics}")
        # Check if user has metrics record
        user_metrics = get_user_usage_metrics(user_id)
        
        if not user_metrics:
            # Create new metrics record
            logger.info(f"Creating new metrics record for user {user_id}")
            response = supabase_client.table('usage_metrics').insert({
                'user_id': user_id,
                'input_tokens': metrics.get('input_tokens', 0),
                'output_tokens': metrics.get('output_tokens', 0),
                'total_tokens': metrics.get('total_tokens', 0),
                'request_count': metrics.get('request_count', 0)
            }).execute()
            
            if not response.data:
                logger.error(f"Failed to create metrics record for user {user_id}")
                return False
            
            logger.info(f"Successfully created metrics record for user {user_id}")
        else:
            # Update existing metrics
            logger.info(f"Updating existing metrics for user {user_id}")
            # Calculate new values
            new_input_tokens = user_metrics.get('input_tokens', 0) + metrics.get('input_tokens', 0)
            new_output_tokens = user_metrics.get('output_tokens', 0) + metrics.get('output_tokens', 0)
            new_total_tokens = user_metrics.get('total_tokens', 0) + metrics.get('total_tokens', 0)
            new_request_count = user_metrics.get('request_count', 0) + metrics.get('request_count', 0)
            
            logger.debug(f"New metrics values: input={new_input_tokens}, output={new_output_tokens}, total={new_total_tokens}, requests={new_request_count}")
            
            response = supabase_client.table('usage_metrics') \
                .update({
                    'input_tokens': new_input_tokens,
                    'output_tokens': new_output_tokens,
                    'total_tokens': new_total_tokens,
                    'request_count': new_request_count,
                    'updated_at': 'NOW()'
                }) \
                .eq('user_id', user_id) \
                .execute()
                
            if not response.data:
                logger.error(f"Failed to update metrics record for user {user_id}")
                return False
                
            logger.info(f"Successfully updated metrics for user {user_id}")
                
        return True
    except Exception as e:
        logger.error(f"Error updating user metrics: {e}")
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
        logger.info(f"No metrics found for user {user_id}, assuming within limits")
        return True
        
    total_tokens = metrics.get('total_tokens', 0)
    is_within_limits = total_tokens < limit
    
    if is_within_limits:
        logger.info(f"User {user_id} is within usage limits: {total_tokens}/{limit}")
    else:
        logger.warning(f"User {user_id} has exceeded usage limits: {total_tokens}/{limit}")
        
    return is_within_limits 