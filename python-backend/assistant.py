import os 
from pathlib import Path
from textwrap import dedent
from typing import Optional, List

from agno.agent import Agent, AgentSession
from agno.utils.log import log_debug
from agno.memory.v2.memory import Memory as AgnoMemoryV2
from agno.tools import Toolkit
from agno.tools.calculator import CalculatorTools
from agno.tools.googlesearch import GoogleSearchTools
from agno.tools.yfinance import YFinanceTools
from agno.tools.crawl4ai import Crawl4aiTools
from agno.models.google import Gemini
from agno.memory.v2.db.postgres import PostgresMemoryDb
from agno.storage.postgres import PostgresStorage

# --- Local Tool Import ---
# Replaced ShellTools and PythonTools with our custom toolkit for local execution.
from local_tools import LocalExecutionToolkit

class AIOS_PatchedAgent(Agent):
    def write_to_storage(self, session_id: str, user_id: Optional[str] = None) -> Optional[AgentSession]:
        """
        Patched Method: Override the default behavior to do nothing.
        This prevents the agent from saving its state after every single turn.
        The session will be saved manually and correctly in app.py upon termination.
        """
        log_debug(f"Turn-by-turn write_to_storage for session {session_id} is disabled by patch.")
        pass

def get_llm_os(
    user_id: Optional[str] = None,
    calculator: bool = False,
    web_crawler: bool = False,
    internet_search: bool = False,
    shell_tools: bool = False,
    python_assistant: bool = False,
    investment_assistant: bool = False,
    use_memory: bool = False, 
    debug_mode: bool = True,
) -> Agent:
    tools: List[Toolkit] = []
    extra_instructions: List[str] = []
    team: List[Agent] = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set. Please set it in Render.")
    
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    # Configure memory
    if use_memory:
        memory_db = PostgresMemoryDb(
            table_name="agent_memories",
            db_url=db_url_sqlalchemy,
            schema="public"
        )
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
            "Use the Calculator tool for mathematical operations."
        )

    if internet_search:
        # Corrected parameter from 'fixed_max_results' to 'max_results'
        internet_tool = GoogleSearchTools(max_results=15)
        tools.append(internet_tool)
        extra_instructions.append(
            "Use the internet search tool to find current information from the internet. Always include sources at the end of your response."
        )

    # --- MODIFICATION: Replaced ShellTools and PythonTools with LocalExecutionToolkit ---
    # This single toolkit handles both shell and python execution by delegating to the client.
    if shell_tools or python_assistant:
        local_exec_tools = LocalExecutionToolkit()
        tools.append(local_exec_tools)
        extra_instructions.extend([
            "To run shell commands on the user's local machine, use the `run_local_shell` tool.",
            "To write and execute Python scripts on the user's local machine, use the `run_local_python` tool."
        ])
    # --- END MODIFICATION ---

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
            "**First, analyze the user's message and the conversation history to understand their intent and context.** Pay close attention to any specific requests, topics of interest, or information provided by the user.",
            "**When files, images, audio, or video are provided, analyze them carefully and include their content in your response.**",
            "**Prioritize using available tools to answer the user's query.**",
            "**Decision-Making Process (in order of priority):**",  
            "1. **Knowledge Base Search:** If the user asks about a specific topic, ALWAYS begin by searching your knowledge base using `search_knowledge_base` to see if relevant information is already available.",
            "2. **Direct Answer:** If the user's question can be answered directly based on your existing knowledge or after consulting the knowledge base, provide a clear and concise answer.",
            "3. **Internet Search:** If the knowledge base doesn't contain the answer, use `internet_search` to find current information on the internet.  **Always include sources at the end of your response.**",
            "4. **Tool Delegation:**  If a specific tool is required to fulfill the user's request (e.g., calculating a value, crawling a website), choose the appropriate tool and use it immediately.",
            "5. **Assistant Delegation:** If a task is best handled by a specialized AI Assistant (e.g., creating an investment report), delegate the task to the appropriate assistant and relay their response to the user.",
            "6. **Clarification:** If the user's message is unclear or ambiguous, ask clarifying questions to obtain the necessary information before proceeding. **Do not make assumptions.**",
            "**Tool Usage Guidelines:**",
            "   - For mathematical calculations, use the `Calculator` tool if precision is required.",
            "   - For up-to-date information, use the `internet_search` tool.  **Always include sources URL's at the end of your response.**",
            "   - When the user provides a URL, IMMEDIATELY use the `Web Crawler` tool without any preliminary message.",
            # --- MODIFICATION: Updated instructions for new local execution tools ---
            "   - When the user asks about files, directories, or system information on their local machine, IMMEDIATELY use the `run_local_shell` tool.",
            "   - To write and execute Python code on the user's local machine, use the `run_local_python` tool. You must provide both the filename and the code.",
            # --- END MODIFICATION ---
            "   - Delegate investment report requests to the `Investment Assistant`.",
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
        ] + extra_instructions,
        
        storage=PostgresStorage(
            table_name="ai_os_sessions",
            db_url=db_url_sqlalchemy,
            schema="public",
            auto_upgrade_schema=True
        ),
        memory=memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        tools=tools,
        team=team,
        show_tool_calls=False,
        search_knowledge=use_memory,
        read_chat_history=True,
        add_history_to_messages=True,
        num_history_responses=6,
        markdown=True,
        add_datetime_to_instructions=True,
        introduction=dedent("""\
        Hi, I'm your AI-OS.
        I have access to a set of tools and AI Assistants to assist you.
        Let's solve some problems together!\
        """),
        debug_mode=debug_mode,
    )
    return llm_os