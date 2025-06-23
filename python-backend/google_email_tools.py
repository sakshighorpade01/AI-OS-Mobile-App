# python-backend/google_email_tools.py

import base64
import logging
from email.mime.text import MIMEText
from typing import List, Optional, Dict, Any

from agno.tools import Toolkit
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build, Resource
from googleapiclient.errors import HttpError

from supabase_client import supabase_client

# Set up a logger for this module
logger = logging.getLogger(__name__)

class GoogleEmailTools(Toolkit):
    """A toolkit for reading, searching, and sending emails via the Gmail API."""

    def __init__(self, user_id: str):
        """
        Initializes the GoogleEmailTools toolkit.

        Args:
            user_id: The UUID of the user to perform actions for.
        """
        super().__init__(
            name="google_email_tools",
            tools=[
                self.read_latest_emails,
                self.send_email,
            ],
        )
        self.user_id = user_id
        self._credentials = None
        self._gmail_service: Optional[Resource] = None

    def _get_credentials(self) -> Optional[Credentials]:
        """
        Fetches the user's Google OAuth credentials from the database.
        Handles token refresh if the access token is expired.
        """
        if self._credentials and self._credentials.valid:
            return self._credentials

        try:
            logger.info(f"Fetching Google credentials for user_id: {self.user_id}")
            response = (
                supabase_client.from_("user_integrations")
                .select("access_token, refresh_token")
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
                scopes=['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']
            )

            # If the token is expired, refresh it
            if creds.expired and creds.refresh_token:
                logger.info(f"Google token expired for user {self.user_id}. Refreshing...")
                creds.refresh(Request()) # The Request object is automatically handled by the library
                # Persist the new credentials
                supabase_client.from_('user_integrations').update({
                    'access_token': creds.token
                }).eq('user_id', self.user_id).eq('service', 'google').execute()
                logger.info(f"Successfully refreshed and saved new token for user {self.user_id}.")

            self._credentials = creds
            return self._credentials

        except Exception as e:
            logger.error(f"Error fetching/refreshing Google credentials for user {self.user_id}: {e}", exc_info=True)
            return None

    def _get_gmail_service(self) -> Optional[Resource]:
        """Initializes and returns the Gmail API service resource."""
        if self._gmail_service:
            return self._gmail_service

        credentials = self._get_credentials()
        if not credentials:
            return None

        try:
            service = build('gmail', 'v1', credentials=credentials)
            self._gmail_service = service
            return self._gmail_service
        except HttpError as error:
            logger.error(f"An error occurred building the Gmail service: {error}")
            return None

    def read_latest_emails(self, max_results: int = 5, only_unread: bool = True) -> str:
        """
        Reads the most recent emails from the user's inbox.

        Args:
            max_results: The maximum number of emails to retrieve. Defaults to 5.
            only_unread: If True, fetches only unread emails. Defaults to True.

        Returns:
            A formatted string summarizing the latest emails, or an error message.
        """
        service = self._get_gmail_service()
        if not service:
            return "Google account not connected or credentials invalid. Please connect your Google account in the settings."

        try:
            query = 'is:unread' if only_unread else ''
            results = service.users().messages().list(userId='me', maxResults=max_results, q=query).execute()
            messages = results.get('messages', [])

            if not messages:
                return "No new emails found."

            email_summaries = []
            for msg in messages:
                msg_data = service.users().messages().get(userId='me', id=msg['id']).execute()
                headers = msg_data['payload']['headers']
                subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
                sender = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown Sender')
                snippet = msg_data['snippet']
                email_summaries.append(f"From: {sender}\nSubject: {subject}\nSnippet: {snippet}\n---")

            return "\n".join(email_summaries)
        except HttpError as error:
            logger.error(f"An error occurred reading emails: {error}")
            return f"An error occurred while trying to read your emails: {error}"

    def send_email(self, to: str, subject: str, body: str) -> str:
        """
        Sends an email on the user's behalf.

        Args:
            to: The recipient's email address.
            subject: The subject of the email.
            body: The plain text content of the email.

        Returns:
            A confirmation message or an error message.
        """
        service = self._get_gmail_service()
        if not service:
            return "Google account not connected or credentials invalid. Please connect your Google account in the settings."

        try:
            message = MIMEText(body)
            message['to'] = to
            message['subject'] = subject
            encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
            create_message = {'raw': encoded_message}

            send_message = service.users().messages().send(userId="me", body=create_message).execute()
            return f"Email sent successfully to {to}. Message ID: {send_message['id']}"
        except HttpError as error:
            logger.error(f"An error occurred sending email: {error}")
            return f"An error occurred while trying to send the email: {error}"