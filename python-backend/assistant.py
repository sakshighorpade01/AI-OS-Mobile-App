import os 
from pathlib import Path
from textwrap import dedent

from agno.agent import Agent, AgentSession
from agno.run.response import RunResponse, TeamRunResponse
from agno.utils.log import log_warning, log_debug
from agno.memory.v2.memory import UserMemory as UserMemoryV2, SessionSummary as SessionSummaryV2
from agno.memory.agent import AgentMemory, AgentRun
from agno.models.message import Message
from agno.agent.metrics import SessionMetrics
from agno.media import ImageArtifact, VideoArtifact, AudioArtifact
from agno.utils.merge_dict import merge_dictionaries
from agno.memory.v2.memory import Memory as AgnoMemoryV2

class AIOS_PatchedAgent(Agent):
    """
    This patched Agent class overrides the load_agent_session method to prevent
    the destructive reloading of active conversation history.
    """
    def load_agent_session(self, session: AgentSession):
        """Load the existing Agent from an AgentSession (from the database)"""

        # Get the agent_id, user_id and session_id from the database
        if self.agent_id is None and session.agent_id is not None:
            self.agent_id = session.agent_id
        if self.user_id is None and session.user_id is not None:
            self.user_id = session.user_id
        if self.session_id is None and session.session_id is not None:
            self.session_id = session.session_id

        # Read agent_data from the database
        if session.agent_data is not None:
            if self.name is None and "name" in session.agent_data:
                self.name = session.agent_data.get("name")

        # Read session_data from the database
        if session.session_data is not None:
            if self.session_name is None and "session_name" in session.session_data:
                self.session_name = session.session_data.get("session_name")
            if "session_state" in session.session_data:
                session_state_from_db = session.session_data.get("session_state")
                if (session_state_from_db is not None and isinstance(session_state_from_db, dict) and len(session_state_from_db) > 0):
                    if self.session_state is not None and len(self.session_state) > 0:
                        merge_dictionaries(self.session_state, session_state_from_db)
                    else:
                        self.session_state = session_state_from_db
            if "team_session_state" in session.session_data:
                team_session_state_from_db = session.session_data.get("team_session_state")
                if (team_session_state_from_db is not None and isinstance(team_session_state_from_db, dict) and len(team_session_state_from_db) > 0):
                    if self.team_session_state is not None and len(self.team_session_state) > 0:
                        merge_dictionaries(self.team_session_state, team_session_state_from_db)
                    else:
                        self.team_session_state = team_session_state_from_db
            if "session_metrics" in session.session_data:
                session_metrics_from_db = session.session_data.get("session_metrics")
                if session_metrics_from_db is not None and isinstance(session_metrics_from_db, dict):
                    self.session_metrics = SessionMetrics(**session_metrics_from_db)
            if "images" in session.session_data:
                images_from_db = session.session_data.get("images")
                if images_from_db is not None and isinstance(images_from_db, list):
                    if self.images is None: self.images = []
                    self.images.extend([ImageArtifact.model_validate(img) for img in images_from_db])
            if "videos" in session.session_data:
                videos_from_db = session.session_data.get("videos")
                if videos_from_db is not None and isinstance(videos_from_db, list):
                    if self.videos is None: self.videos = []
                    self.videos.extend([VideoArtifact.model_validate(vid) for vid in videos_from_db])
            if "audio" in session.session_data:
                audio_from_db = session.session_data.get("audio")
                if audio_from_db is not None and isinstance(audio_from_db, list):
                    if self.audio is None: self.audio = []
                    self.audio.extend([AudioArtifact.model_validate(aud) for aud in audio_from_db])

        if session.extra_data is not None:
            if self.extra_data is not None:
                merge_dictionaries(session.extra_data, self.extra_data)
            self.extra_data = session.extra_data

        if self.memory is None:
            self.memory = session.memory

        if not (isinstance(self.memory, AgentMemory) or isinstance(self.memory, AgnoMemoryV2)):
            if isinstance(self.memory, dict) and "create_user_memories" in self.memory:
                self.memory = AgentMemory(**self.memory)
            else:
                raise TypeError(f"Expected memory to be a dict or AgentMemory, but got {type(self.memory)}")

        if session.memory is not None:
            if isinstance(self.memory, AgentMemory):
                # This part is for the older memory system, which you are not using. No changes needed.
                pass
            elif isinstance(self.memory, AgnoMemoryV2):
                if "runs" in session.memory:
                    try:
                        if self.memory.runs is None: self.memory.runs = {}
                        
                        # --- THE FIX ---
                        # Only load runs from storage if the session isn't already active in memory.
                        if session.session_id not in self.memory.runs:
                            self.memory.runs[session.session_id] = []
                            for run in session.memory["runs"]:
                                run_session_id = run["session_id"]
                                if "team_id" in run:
                                    self.memory.runs[run_session_id].append(TeamRunResponse.from_dict(run))
                                else:
                                    self.memory.runs[run_session_id].append(RunResponse.from_dict(run))
                        # --- END FIX ---

                    except Exception as e:
                        log_warning(f"Failed to load runs from memory: {e}")
                if "memories" in session.memory:
                    try:
                        if self.memory.memories is None:
                            self.memory.memories = {
                                user_id: {
                                    memory_id: UserMemoryV2.from_dict(memory)
                                    for memory_id, memory in user_memories.items()
                                }
                                for user_id, user_memories in session.memory["memories"].items()
                            }
                    except Exception as e:
                        log_warning(f"Failed to load user memories: {e}")
                if "summaries" in session.memory:
                    try:
                        self.memory.summaries = {
                            user_id: {
                                session_id: SessionSummaryV2.from_dict(summary)
                                for session_id, summary in user_session_summaries.items()
                            }
                            for user_id, user_session_summaries in session.memory["summaries"].items()
                        }
                    except Exception as e:
                        log_warning(f"Failed to load session summaries: {e}")
        log_debug(f"-*- AgentSession loaded: {session.session_id}")

from agno.tools import Toolkit
from agno.tools.shell import ShellTools
from agno.tools.calculator import CalculatorTools
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.yfinance import YFinanceTools
from agno.tools.python import PythonTools
from agno.tools.crawl4ai import Crawl4aiTools
from agno.models.google import Gemini
from typing import List, Optional
from automation_tools import AutomationTools
from image_analysis_toolkit import ImageAnalysisTools
from agno.memory.v2.db.postgres import PostgresMemoryDb
from agno.storage.postgres import PostgresStorage

    
def get_llm_os(
    user_id: Optional[str] = None,
    calculator: bool = False,
    web_crawler: bool = False,
    ddg_search: bool = False,
    shell_tools: bool = False,
    python_assistant: bool = False,
    investment_assistant: bool = False,
    use_memory: bool = False, 
    debug_mode: bool = True,
    computer_use: bool = False,
    image_analysis: bool = False,
) -> Agent:
    tools: List[Toolkit] = []
    extra_instructions: List[str] = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set. Please set it in Render.")
    
    # Both classes use SQLAlchemy, which needs the driver name in the URL.
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    # Configure memory
    if use_memory:
    # 1. Create the database connector for long-term memory
        memory_db = PostgresMemoryDb(
            table_name="agent_memories",
            db_url=db_url_sqlalchemy,
            schema="public"  # <-- CRITICAL FIX: Tell agno to use the public schema
        )
        # 2. Create the V2 memory object
        memory = AgnoMemoryV2(db=memory_db)
        extra_instructions.append(
            "You have access to long-term memory. Use the `search_knowledge_base` tool to search your memory for relevant information."
        )
    else:
        memory = None


    if calculator:
        calc_tool = CalculatorTools(
            add=True,
            subtract=True,
            multiply=True,
            divide=True,
            exponentiate=True,
            factorial=True,
            is_prime=True,
            square_root=True,
        )
        tools.append(calc_tool)
        extra_instructions.append(
            "Use the Calculator tool for mathematical operations. Available functions: add, subtract, multiply, divide, exponentiate, factorial, is_prime, square_root"
        )

    if ddg_search:
        ddg_tool = DuckDuckGoTools(fixed_max_results=10)
        tools.append(ddg_tool)
        extra_instructions.append(
            "Use the DuckDuckGo search tool to find current information from the internet. Example: duckduckgo_search(query='your search query') and Always include sources"
        )

    if computer_use:
        computer_tool = AutomationTools()
        tools.append(computer_tool)
        extra_instructions.append(
            "To control the computer and analyze screen contents, delegate the task to the `Computer Use` assistant."
            "You don't have direct access to automation or screen analysis tools. To perform these actions, you MUST delegate to the `Computer Use` assistant using team delegation syntax."
        )

    if image_analysis:
        image_tool = ImageAnalysisTools()
        tools.append(image_tool)
        extra_instructions.append(
            "Use the image analysis tools to analyze images. Example: analyze_image(image_path='path/to/image.jpg')"
        )

    if shell_tools:
        shell_tool = ShellTools()
        tools.append(shell_tool)
        extra_instructions.append(
            "Use the shell_tools for system and file operations. Example: run_shell_command(args='ls -la') for directory contents"
        )

    team: List[Agent] = []
    if python_assistant:
        _python_assistant = Agent(
            name="Python Assistant",
            tools=[PythonTools()],
            role="Python agent",
            instructions=["You can write and run python code to fulfill users' requests"],
            model=Gemini(id="gemini-2.0-flash"),
            debug_mode=debug_mode
        )
        team.append(_python_assistant)
        extra_instructions.append("To write and run python code, delegate the task to the `Python Assistant`.")

    if web_crawler:
        _web_crawler = Agent(
            name="Web Crawler",
            role="Extract information from a given URL",
            model=Gemini(id="gemini-2.0-flash"),
            instructions=[
                "For a given URL, extract relevant information and summarize the content.",
                "Provide the user with the extracted information in a clear and concise manner.",
            ],
            tools=[Crawl4aiTools(max_length=None)],
            markdown=True,
            add_datetime_to_instructions=True,
            debug_mode=debug_mode,
        )
        team.append(_web_crawler)
        extra_instructions.extend([
            "To extract information from a URL, delegate the task to the `Web Crawler`.",
            "Provide the user with the extracted information in a clear and concise manner.",
        ])

    if investment_assistant:
        report_format = dedent("""\
        <report_format>
        ## [Company Name]: Investment Report

        ### **Overview**
        {give a brief introduction of the company and why the user should read this report}
        {make this section engaging and create a hook for the reader}

        ### Core Metrics
        {provide a summary of core metrics and show the latest data}
        - Current price: {current price}
        - 52-week high: {52-week high}
        - 52-week low: {52-week low}
        - Market Cap: {Market Cap} in billions
        - P/E Ratio: {P/E Ratio}
        - Earnings per Share: {EPS}
        - 50-day average: {50-day average}
        - 200-day average: {200-day average}
        - Analyst Recommendations: {buy, hold, sell} (number of analysts)

        ### Financial Performance
        {analyze the company's financial performance}

        ### Growth Prospects
        {analyze the company's growth prospects and future potential}

        ### News and Updates
        {summarize relevant news that can impact the stock price}

        ### [Summary]
        {give a summary of the report and what are the key takeaways}

        ### [Recommendation]
        {provide a recommendation on the stock along with a thorough reasoning}

        </report_format>
        """)
        
        _investment_assistant = Agent(
            name="Investment Assistant",
            role="Write investment reports on companies",
            model=Gemini(id="gemini-2.0-flash"),
            instructions=[
                "For a given stock symbol, get the stock price, company information, analyst recommendations, and company news",
                "Carefully read the research and generate a final - Goldman Sachs worthy investment report in the report format provided.",
                "Provide thoughtful insights and recommendations based on the research.",
                "When you share numbers, make sure to include the units (e.g., millions/billions) and currency.",
                "REMEMBER: This report is for a very important client, so the quality of the report is important.",
                report_format
            ],
            tools=[YFinanceTools(stock_price=True, company_info=True, analyst_recommendations=True, company_news=True)],
            markdown=True,
            add_datetime_to_instructions=True,
            debug_mode=debug_mode,
        )
        team.append(_investment_assistant)
        extra_instructions.extend([
            "To get an investment report on a stock, delegate the task to the `Investment Assistant`. "
            "Return the report in the <report_format> to the user without any additional text like 'here is the report'.",
            "Answer any questions they may have using the information in the report.",
            "Never provide investment advise without the investment report.",
        ])

    # Create the main AI_OS agent
    llm_os = AIOS_PatchedAgent(
        user_id=user_id,
        name="AI_OS",
        model=Gemini(id="gemini-2.0-flash"),
        description=dedent("""\
        You are AI-OS, an advanced AI system designed to be a helpful and efficient assistant. You have access to a suite of 
        tools and a team of specialized AI Assistants. Your primary goal is to understand the user's needs and leverage your 
        resources to fulfill them effectively. You are proactive, resourceful, and prioritize providing accurate and relevant
        information.\
        """),
        instructions=[
            "Your primary responsibility is to assist the user effectively and efficiently.",
            "**First, analyze the user's message and the conversation history to understand their intent and context.** Pay close attention to any specific requests, topics of interest, or information provided by the user.",
            "**When files, images, audio, or video are provided, analyze them carefully and include their content in your response.**",
            "**Prioritize using available tools to answer the user's query.**",
            "**Decision-Making Process (in order of priority):**",  
            "1. **Knowledge Base Search:** If the user asks about a specific topic, ALWAYS begin by searching your knowledge base using `search_knowledge_base` to see if relevant information is already available.",
            "2. **Direct Answer:** If the user's question can be answered directly based on your existing knowledge or after consulting the knowledge base, provide a clear and concise answer.",
            "3. **Internet Search:** If the knowledge base doesn't contain the answer, use `duckduckgo_search` to find current information on the internet.  **Always cite your sources.**",
            "4. **Tool Delegation:**  If a specific tool is required to fulfill the user's request (e.g., calculating a value, crawling a website), choose the appropriate tool and use it immediately.",
            "5. **Assistant Delegation:** If a task is best handled by a specialized AI Assistant (e.g., creating an investment report, writing and running python code), delegate the task to the appropriate assistant and relay their response to the user.",
            "6. **Clarification:** If the user's message is unclear or ambiguous, ask clarifying questions to obtain the necessary information before proceeding. **Do not make assumptions.**",
            "**Tool Usage Guidelines:**",
            "   - For mathematical calculations, use the `Calculator` tool if precision is required.",
            "   - For up-to-date information, use the `DuckDuckGo` tool.  **Always include the source URLs.**",
            "   - When the user provides a URL, IMMEDIATELY use the `Web Crawler` tool without any preliminary message.",
            "   - When the user asks about files, directories, or system information, IMMEDIATELY use `ShellTools` without any preliminary message.",
            "   - Delegate python coding tasks to the `Python Assistant`.",
            "   - Delegate investment report requests to the `Investment Assistant`.",
            "   - For image analysis, use the `Image Analysis` tools.",
            "When asked about screen contents or to perform actions, follow these steps:",
            "1. First, use the 'screenshot_and_analyze' tool to capture the current screen.",
            "2. Then, use the 'analyze_image' tool with the screenshot path to get detailed information.",
            "3. Based on the analysis, perform any necessary actions using the automation tools.",
            "4. Provide a clear explanation of what you did and what you found on screen.",
            "Always provide a step-by-step explanation of your actions.",
            "**Response Guidelines:**",
            "   - Provide clear, concise, and informative answers.",
            "   - Avoid phrases like 'based on my knowledge' or 'depending on the information' or 'based on our previous conversation'.",
            "   - Do not explain your reasoning or the steps you are taking unless the user specifically asks for it.", 
            "   - If you delegate a task to an AI Assistant, simply relay their response to the user without adding extra commentary (unless clarification is needed).",
            "**Memory Usage:**",
            "   - The `get_chat_history` tool should be used if the user explicitly asks you to summarize or reference your conversation.",
            "**Important Notes:**",
            "   - You have access to long-term memory. Use the `search_knowledge_base` tool to search your memory for relevant information.",
            "   - Do not explain what you're going to do - just use the appropriate tool or delegate the task right away.",
            "**File Handling:**",
            "   - When images, PDFs, word documents, audio, or video files are provided, analyze their content directly.",
            "   - For images, describe what you see in detail.",
            "   - For PDF and document files, summarize the content and answer questions about it.",
            "   - For audio files, describe what you hear.",
            "   - For video files, describe the scenes and content."
        ] + extra_instructions,
        
        # Add long-term memory to the LLM OS backed by JSON file storage
        storage=PostgresStorage(
            table_name="ai_os_sessions",
            db_url=db_url_sqlalchemy,
            schema="public",
            auto_upgrade_schema=True # Let agno manage this table's schema
        ),
        memory=memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        # Add selected tools to the LLM OS
        tools=tools,
        # Add selected team members to the LLM OS
        team=team,
        # Show tool calls in the chat
        show_tool_calls=False,
        # This setting gives the LLM a tool to search the knowledge base for information
        search_knowledge=use_memory,
        # This setting gives the LLM a tool to get chat history
        read_chat_history=True,
        # This setting adds chat history to the messages
        add_history_to_messages=True,
        num_history_responses=6,
        # This setting tells the LLM to format messages in markdown
        markdown=True,
        # This setting adds the current datetime to the instructions
        add_datetime_to_instructions=True,
        introduction=dedent("""\
        Hi, I'm your AI-OS.
        I have access to a set of tools and AI Assistants to assist you.
        Let's solve some problems together!\
        """),
        debug_mode=debug_mode,
    )
    return llm_os