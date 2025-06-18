# local_tools.py

from agno.tools import Toolkit, tool
from typing import List

"""
This module defines a custom Agno Toolkit for executing commands on the end-user's 
local machine. It uses the `external_execution=True` flag to ensure that the Agno 
framework does not run these tools on the server. Instead, it packages the tool 
call to be sent to a client (like an Electron app), which is responsible for the 
actual execution and returning the result.
"""

class LocalExecutionToolkit(Toolkit):
    """A toolkit for running shell commands and Python scripts on the user's local machine."""

    def __init__(self, **kwargs):
        """Initializes the toolkit and registers the local execution tools."""
        super().__init__(
            name="local_execution_tools",
            tools=[self.run_local_shell, self.run_local_python],
            **kwargs
        )

    @tool(external_execution=True)
    def run_local_shell(self, command: str) -> None:
        """
        Executes a shell command on the user's local machine.

        This tool is for interacting with the user's file system, running system commands,
        or executing other command-line operations directly on their computer.

        Args:
            command (str): The complete shell command to be executed (e.g., 'ls -l /home/user').
        
        Returns:
            None: This function does not return a value on the backend. The result of the
                  command execution is expected to be sent back by the client application.
        """
        # The body of this function is intentionally empty.
        # Because `external_execution=True`, the Agno framework will not execute this code.
        # Its purpose is to provide a schema for the LLM to call.
        return None

    @tool(external_execution=True)
    def run_local_python(self, filename: str, code: str) -> None:
        """
        Writes a Python script to a file and executes it on the user's local machine.

        This tool is for generating and running Python code to perform tasks that require
        scripting, such as data manipulation, complex calculations, or interacting with
        local APIs.

        Args:
            filename (str): The name of the file to save the Python code to (e.g., 'my_script.py').
            code (str): The complete Python code to be written to the file and then executed.
        
        Returns:
            None: This function does not return a value on the backend. The result of the
                  script execution (stdout/stderr) is expected to be sent back by the client.
        """
        # The body of this function is also intentionally empty for the same reason as above.
        return None