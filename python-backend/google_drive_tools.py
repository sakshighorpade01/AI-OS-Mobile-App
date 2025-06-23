# python-backend/google_drive_tools.py (Corrected and Final Version)

import io
import logging
import os
from typing import Optional

from agno.tools import Toolkit
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build, Resource
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload

from supabase_client import supabase_client

logger = logging.getLogger(__name__)

class GoogleDriveTools(Toolkit):
    """A toolkit for interacting with the Google Drive API."""

    def __init__(self, user_id: str):
        super().__init__(
            name="google_drive_tools",
            tools=[self.search_files, self.read_file_content],
        )
        self.user_id = user_id
        self._credentials: Optional[Credentials] = None
        self._drive_service: Optional[Resource] = None

    def _get_credentials(self) -> Optional[Credentials]:
        if self._credentials and self._credentials.valid:
            return self._credentials

        try:
            response = (
                supabase_client.from_("user_integrations")
                .select("access_token, refresh_token, scopes")
                .eq("user_id", self.user_id)
                .eq("service", "google")
                .single()
                .execute()
            )

            if not response.data:
                logger.warning(f"No Google integration found for user {self.user_id}.")
                return None

            creds_data = response.data
            creds = Credentials(
                token=creds_data.get('access_token'),
                refresh_token=creds_data.get('refresh_token'),
                token_uri='https://oauth2.googleapis.com/token',
                client_id=os.getenv("GOOGLE_CLIENT_ID"),
                client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
                scopes=creds_data.get('scopes')
            )

            # --- MODIFIED: More robust refresh logic ---
            if creds.expired:
                if creds.refresh_token:
                    logger.info(f"Google token expired for user {self.user_id}. Refreshing...")
                    creds.refresh(Request())
                    supabase_client.from_('user_integrations').update({
                        'access_token': creds.token,
                        'scopes': creds.scopes
                    }).eq('user_id', self.user_id).eq('service', 'google').execute()
                    logger.info(f"Successfully refreshed and saved new Google token for user {self.user_id}.")
                else:
                    logger.error(f"Google token for user {self.user_id} is expired and no refresh token is available.")
                    return None

            self._credentials = creds
            return self._credentials

        except Exception as e:
            logger.error(f"Error fetching/refreshing Google credentials for user {self.user_id}: {e}", exc_info=True)
            return None

    def _get_drive_service(self) -> Optional[Resource]:
        if self._drive_service:
            return self._drive_service
        credentials = self._get_credentials()
        if not credentials:
            return None
        try:
            service = build('drive', 'v3', credentials=credentials)
            self._drive_service = service
            return self._drive_service
        except HttpError as error:
            logger.error(f"An error occurred building the Google Drive service: {error}")
            return None

    def search_files(self, query: str, max_results: int = 10) -> str:
        service = self._get_drive_service()
        if not service:
            return "Google account not connected or credentials invalid. Please reconnect your Google account in the settings."
        # ... (rest of the function is unchanged)
        try:
            search_query = f"name contains '{query}' or fullText contains '{query}'"
            results = service.files().list(
                q=search_query,
                pageSize=max_results,
                fields="nextPageToken, files(id, name, mimeType)"
            ).execute()
            items = results.get('files', [])
            if not items:
                return f"No files found matching the query: '{query}'"
            file_summaries = [
                f"Name: {item['name']}\nType: {item['mimeType']}\nFile ID: {item['id']}\n---"
                for item in items
            ]
            return "\n".join(file_summaries)
        except HttpError as error:
            logger.error(f"An error occurred searching Google Drive: {error}")
            return f"An error occurred while searching your Google Drive: {error}"

    def read_file_content(self, file_id: str) -> str:
        service = self._get_drive_service()
        if not service:
            return "Google account not connected or credentials invalid. Please reconnect your Google account in the settings."
        # ... (rest of the function is unchanged)
        try:
            file_metadata = service.files().get(fileId=file_id, fields='mimeType').execute()
            mime_type = file_metadata.get('mimeType')
            request = None
            if mime_type == 'application/vnd.google-apps.document':
                request = service.files().export_media(fileId=file_id, mimeType='text/plain')
            elif mime_type and mime_type.startswith('text/'):
                request = service.files().get_media(fileId=file_id)
            else:
                return f"Cannot read content from this file type: {mime_type}. This tool can only read plain text files and Google Docs."
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
                logger.info(f"Download {int(status.progress() * 100)}%.")
            return fh.getvalue().decode('utf-8')
        except HttpError as error:
            logger.error(f"An error occurred reading file {file_id}: {error}")
            return f"An error occurred while reading the file: {error}"