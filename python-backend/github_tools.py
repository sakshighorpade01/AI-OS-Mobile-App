# python-backend/github_tools.py (Corrected Version)

import logging
from typing import List, Optional

# --- MODIFIED: Removed 'tool' from imports as it's no longer needed here ---
from agno.tools import Toolkit
from github import Github, GithubException

from supabase_client import supabase_client

logger = logging.getLogger(__name__)

class GitHubTools(Toolkit):
    """A toolkit for interacting with the GitHub API on behalf of the user."""

    def __init__(self, user_id: str):
        """
        Initializes the GitHubTools toolkit.
        """
        # This super().__init__ call correctly registers the methods below as tools.
        super().__init__(
            name="github_tools",
            tools=[
                self.list_repositories,
                self.create_issue,
            ],
        )
        self.user_id = user_id
        self._github_client: Optional[Github] = None
        self._access_token: Optional[str] = None
        self._token_fetched = False

    def _get_access_token(self) -> Optional[str]:
        """
        Fetches the user's GitHub access token from the database.
        Caches the result for the lifetime of this toolkit instance.
        """
        if self._token_fetched:
            return self._access_token

        try:
            logger.info(f"Fetching GitHub token for user_id: {self.user_id}")
            response = (
                supabase_client.from_("user_integrations")
                .select("access_token")
                .eq("user_id", self.user_id)
                .eq("service", "github")
                .single()
                .execute()
            )

            if response.data and response.data.get("access_token"):
                self._access_token = response.data["access_token"]
                logger.info(f"Successfully fetched GitHub token for user {self.user_id}.")
            else:
                logger.warning(f"No GitHub integration found for user {self.user_id}.")
                self._access_token = None

        except Exception as e:
            logger.error(f"Error fetching GitHub token for user {self.user_id}: {e}")
            self._access_token = None
        
        self._token_fetched = True
        return self._access_token

    def _get_client(self) -> Optional[Github]:
        """
        Initializes and returns the PyGithub client instance.
        Returns None if the user's access token cannot be found.
        """
        if self._github_client:
            return self._github_client

        access_token = self._get_access_token()
        if access_token:
            self._github_client = Github(access_token)
            return self._github_client
        
        return None

    # --- MODIFIED: Removed the @tool decorator ---
    def list_repositories(self) -> str:
        """
        Lists all public and private repositories the authenticated user has access to.
        
        Returns:
            A string containing a newline-separated list of repository full names (e.g., 'owner/repo'),
            or an error message if the GitHub account is not connected or the token is invalid.
        """
        client = self._get_client()
        if not client:
            return "GitHub account not connected. Please connect your GitHub account in the settings."

        try:
            repos = client.get_user().get_repos()
            repo_list = [repo.full_name for repo in repos]
            if not repo_list:
                return "No repositories found for your account."
            return "\n".join(repo_list)
        except GithubException as e:
            logger.error(f"GitHub API error while listing repositories for user {self.user_id}: {e}")
            return f"Error accessing GitHub API: {e.data.get('message', 'Invalid credentials or permissions')}. Please try reconnecting your account."

    # --- MODIFIED: Removed the @tool decorator ---
    def create_issue(self, repo_full_name: str, title: str, body: str) -> str:
        """
        Creates a new issue in a specified repository.

        Args:
            repo_full_name: The full name of the repository (e.g., 'owner/repo-name').
            title: The title of the new issue.
            body: The content of the issue. Can include markdown.

        Returns:
            A confirmation message with the URL of the new issue, or an error message.
        """
        client = self._get_client()
        if not client:
            return "GitHub account not connected. Please connect your GitHub account in the settings."

        try:
            repo = client.get_repo(repo_full_name)
            issue = repo.create_issue(title=title, body=body)
            return f"Successfully created issue #{issue.number} in {repo_full_name}. URL: {issue.html_url}"
        except GithubException as e:
            logger.error(f"GitHub API error while creating issue in '{repo_full_name}' for user {self.user_id}: {e}")
            if e.status == 404:
                return f"Error: Repository '{repo_full_name}' not found or you don't have access."
            return f"Error creating issue: {e.data.get('message', 'An unknown error occurred')}."