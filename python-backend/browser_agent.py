#python-backend/browser_agent.py
from phi.agent import Agent
from phi.model.google import Gemini
from phi.model.groq import Groq
# Import our custom toolkits
from automation_tools import AutomationTools
from web_analyzer import WebAnalyzerTools

class ResponseProcessor:
    """Helper class to process agent responses and extract navigation commands"""
    @staticmethod
    def process_response(response):
        """
        Processes the response from the agent and extracts any navigation commands
        Returns the processed response and any commands as a dict
        """
        result = {"content": response}
        
        # Look for URL navigation patterns in the response
        if "navigate to" in response.lower() or "go to" in response.lower() or "open url" in response.lower():
            # Simple extraction logic - could be enhanced with regex for better accuracy
            lines = response.split('\n')
            for line in lines:
                if "navigate to" in line.lower() or "go to" in line.lower() or "open url" in line.lower():
                    # Try to extract the URL
                    parts = line.split("http")
                    if len(parts) > 1:
                        url = "http" + parts[1].split()[0].strip()
                        if url.endswith('.') or url.endswith(',') or url.endswith(';') or url.endswith(')'):
                            url = url[:-1]
                        result["navigate_to"] = url
                        break
        
        return result

# Create instances of our toolkits
automation_toolkit = AutomationTools()
web_analyzer_toolkit = WebAnalyzerTools()

# Create the agent with our toolkits
class CustomBrowserAgent:
    def __init__(self):
        self.agent = Agent(
            #model=Gemini(id="gemini-2.0-flash"),
            model=Groq(id="llama-3.3-70b-versatile"),
            tools=[automation_toolkit, web_analyzer_toolkit],
            markdown=True,
            show_tool_calls=True,
            debug_mode=True,
            description="This agent is capable of automating tasks on the web and analyzing webpages in detail",
            instructions=[
                "Use the AutomationTools to complete tasks involving keyboard and mouse operations",
                "Use the WebAnalyzerTools to analyze webpages and extract information",
                "Some tasks may need multiple steps to complete",
                "Don't ask the user what to do, just do what you think is best based on their request",
                "When analyzing webpages, provide concise summaries of the information gained",
                "When you need to navigate to a URL, include a line with 'Navigate to: http://example.com' in your response",
            ],
        )
        self.processor = ResponseProcessor()

    def run(self, user_input, stream=False):
        """Run the agent with the given user input"""
        if stream:
            for chunk in self.agent.stream(user_input):
                if chunk and hasattr(chunk, 'content') and chunk.content:
                    # For streaming, we only process complete chunks
                    yield self.processor.process_response(chunk.content)
        else:
            response = self.agent.run(user_input)
            return self.processor.process_response(response)


# Create a *class instance* of the agent
BrowserAgent = CustomBrowserAgent() # Instance, NOT the class itself!