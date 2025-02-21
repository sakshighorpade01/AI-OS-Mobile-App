import json
from pathlib import Path
from textwrap import dedent
from phi.tools import Toolkit
from phi.tools.calculator import Calculator
from phi.tools.duckduckgo import DuckDuckGo
from phi.tools.yfinance import YFinanceTools
from phi.tools.crawl4ai_tools import Crawl4aiTools
from phi.agent import Agent, AgentMemory
from phi.memory.classifier import MemoryClassifier
from phi.memory.summarizer import MemorySummarizer
from phi.model.google import Gemini
from phi.model.groq import Groq
from phi.memory.db.sqlite import SqliteMemoryDb
from phi.storage.agent.json import JsonFileAgentStorage
from typing import List, Optional

class CustomJsonFileAgentStorage(JsonFileAgentStorage):
    def serialize(self, data: dict) -> str:
        # Clean up Gemini's parts before serialization
        if data.get("agent_data", {}).get("model", {}).get("provider") == "Google":
            if "memory" in data:
                # Clean up runs' response messages
                if "runs" in data["memory"]:
                    for run in data["memory"]["runs"]:
                        if "response" in run and "messages" in run["response"]:
                            for m in run["response"]["messages"]:
                                if isinstance(m, dict):
                                    m.pop("parts", None)
                
                # Clean up top-level memory messages
                if "messages" in data["memory"]:
                    for m in data["memory"]["messages"]:
                        if isinstance(m, dict):
                            m.pop("parts", None)
        
        return super().serialize(data)
    
def get_deepsearch(
    calculator: bool = False,
    web_crawler: bool = False,
    ddg_search: bool = False,
    investment_assistant: bool = False,
    use_memory: bool = False, 
    user_id: Optional[str] = None,
    run_id: Optional[str] = None,
    debug_mode: bool = True,
) -> Agent:
    tools: List[Toolkit] = []
    extra_instructions: List[str] = []

     # Configure memory
    if use_memory:
        memory = AgentMemory(
            classifier=MemoryClassifier(model=Groq(id="llama-3.3-70b-versatile")),
            summarizer=MemorySummarizer(model=Groq(id="llama-3.3-70b-versatile")),
            db=SqliteMemoryDb(
                table_name="agent_memory",
                db_file="tmp/agent_memory.db",
            ),
            create_user_memories=True,
            update_user_memories_after_run=True,
            create_session_summary=True,
            update_session_summary_after_run=True,
        )
        extra_instructions.append(
            "You have access to long-term memory. Use the `search_knowledge_base` tool to search your memory for relevant information."
        )
    else:
        memory = AgentMemory(
            create_user_memories=False,
            update_user_memories_after_run=False,
            create_session_summary=False,
            update_session_summary_after_run=False,
        )

    if calculator:
        calc_tool = Calculator(
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
        ddg_tool = DuckDuckGo(fixed_max_results=10)
        tools.append(ddg_tool)
        extra_instructions.append(
            "Use the DuckDuckGo search tool to find current information from the internet. Example: duckduckgo_search(query='your search query') and Always include sources"
        )

    team: List[Agent] = []
    if web_crawler:
        _web_crawler = Agent(
            name="Web Crawler",
            role="Extract information from a given URL",
            model=Gemini(id="gemini-2.0-flash-exp"),
            description="You are a web crawler that can extract information from a given URL.",
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
        extra_instructions.extend(
            [
                "To extract information from a URL, delegate the task to the `Web Crawler`.",
                "Provide the user with the extracted information in a clear and concise manner.",
            ]
        )

    if investment_assistant:
        _investment_assistant = Agent(
            name="Investment Assistant",
            role="Write a investment report on a given company (stock) symbol",
            model=Gemini(id="gemini-2.0-flash-exp"),
            description="You are a Senior Investment Analyst for Goldman Sachs tasked with writing an investment report for a very important client.",
            instructions=[
                "For a given stock symbol, get the stock price, company information, analyst recommendations, and company news",
                "Carefully read the research and generate a final - Goldman Sachs worthy investment report in the <report_format> provided below.",
                "Provide thoughtful insights and recommendations based on the research.",
                "When you share numbers, make sure to include the units (e.g., millions/billions) and currency.",
                "REMEMBER: This report is for a very important client, so the quality of the report is important.",
            ],
            expected_output=dedent(
                """\
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
            """
            ),
            tools=[YFinanceTools(stock_price=True, company_info=True, analyst_recommendations=True, company_news=True)],
            # This setting tells the LLM to format messages in markdown
            markdown=True,
            add_datetime_to_instructions=True,
            debug_mode=debug_mode,
        )
        team.append(_investment_assistant)
        extra_instructions.extend(
            [
                "To get an investment report on a stock, delegate the task to the `Investment Assistant`. "
                "Return the report in the <report_format> to the user without any additional text like 'here is the report'.",
                "Answer any questions they may have using the information in the report.",
                "Never provide investment advise without the investment report.",
            ]
        )

    deepsearch = Agent(
        name="DeepSearch",
        run_id=run_id,
        user_id=user_id,
        model=Gemini(id="gemini-2.0-pro-exp-02-05", stream=True),
        #model=Groq(id="llama-3.3-70b-versatile"),
        description=dedent(
            """\
        You are DeepSearch, an advanced AI agent from AI-OS. Your purpose is to provide users with comprehensive and 
        insightful answers by deeply researching their questions and leveraging available tools and specialized AI assistants. 
        You prioritize accuracy, thoroughness, and actionable information.\
        """
        ),
        instructions=[
            "Your primary goal is to deeply understand the user's needs and provide comprehensive and well-researched answers.",

            "**First, analyze the user's message and the conversation history to understand their intent and context.** Pay close attention to any specific requests, topics of interest, or information provided by the user.",

            "**Employ a systematic approach to answer the user's query, prioritizing thoroughness and accuracy.**",

            "**Decision-Making Process (in order of priority):**",
            "1. **Clarification:** If the user's question is unclear or requires further information, ask clarifying questions. Avoid making assumptions.",
            "2. **Knowledge Base Search:** ALWAYS begin by searching your knowledge base using `search_knowledge_base` to identify any relevant existing information. Summarize relevant findings from your knowledge base.",
            "3. **Internet Search:** If the knowledge base doesn't contain a sufficient answer, use `duckduckgo_search` to conduct a thorough internet search.  Consolidate findings from multiple reputable sources and **always cite your sources with URLs.**",
            "4. **Tool Delegation:** If a specific tool is required to fulfill the user's request (e.g., performing calculations), use the appropriate tool immediately.",
            "5. **Assistant Delegation:** If a task is best handled by a specialized AI Assistant (e.g., creating an investment report, extracting information from a URL), delegate the task to the appropriate assistant and synthesize their response for the user.",
            "6. **Synthesis and Reporting:**  Compile the information gathered from all sources (knowledge base, internet search, tools, and assistants) into a coherent and comprehensive answer for the user.  Organize your response logically and provide sufficient context and detail.",

            "**Tool Usage Guidelines:**",
            "   - For mathematical calculations, use the `Calculator` tool if precision is required.",
            "   - For up-to-date information, use the `DuckDuckGo` tool.  **Always include the source URLs.**",
            "   - When the user provides a URL, IMMEDIATELY use the `Web Crawler` tool without any preliminary message.",
            "   - Delegate investment report requests to the `Investment Assistant`.",

            "**Response Guidelines:**",
            "   - Provide clear, concise, and informative answers.  Avoid ambiguity and jargon.",
            "   - Explain your reasoning and the steps you took to arrive at your answer.  This demonstrates transparency and helps the user understand your process.",
            "   - If you delegate a task to an AI Assistant, summarize their response and integrate it into your overall answer.  Provide additional context and analysis as needed.",
            "   - Tailor your response to the user's level of understanding.  Provide more detail for complex topics or for users who are unfamiliar with the subject matter.",
            "   - Consider potential follow-up questions the user might have and proactively address them in your response.",

            "**Memory Usage:**",
            "   - Use the `get_chat_history` tool if the user explicitly asks you to summarize or reference your conversation.",

            "**Important Notes:**",
            "   - You have access to long-term memory. Use the `search_knowledge_base` tool to search your memory for relevant information.",
            "   - Focus on providing detailed and insightful answers. Do not simply provide a surface-level response. Dig deep and explore all relevant aspects of the user's question.",
            "   - Think critically and evaluate the information you gather from different sources. Do not simply repeat information without considering its validity and reliability.",
        ],
        extra_instructions=extra_instructions,
        # Add long-term memory to the LLM OS backed by a PostgreSQL database
        storage=CustomJsonFileAgentStorage(dir_path="tmp/agent_sessions_json"),
        memory=memory,
        # Add a knowledge base to the LLM OS
        # Add selected tools to the LLM OS
        tools=tools,
        # Add selected team members to the LLM OS
        team=team,
        # Show tool calls in the chat
        show_tool_calls=False,
        # This setting gives the LLM a tool to search the knowledge base for information
        tool_choice="auto",    # Important: This allows the model to choose when to use tools
        search_knowledge=use_memory,
        # This setting gives the LLM a tool to get chat history
        read_chat_history=True,
        # This setting adds chat history to the messages
        add_chat_history_to_messages=True,
        # This setting adds 6 previous messages from chat history to the messages sent to the LLM
        num_history_messages=6,
        # This setting tells the LLM to format messages in markdown
        markdown=True,
        # This setting adds the current datetime to the instructions
        add_datetime_to_instructions=True,
        introduction=dedent(
            """\
        Hi, I'm DeepSearch from AI-OS. I'm here to provide you with comprehensive and insightful answers to your questions. 
        I have access to various tools and specialized AI assistants to help me in my research. 
        Let's delve deep and find the best possible solutions together!\
        """
        ),
        debug_mode=debug_mode,
    )
    return deepsearch