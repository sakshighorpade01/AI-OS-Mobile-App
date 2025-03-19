from browser_use import Agent
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
load_dotenv()

import asyncio

# Use Google's Gemini model through LangChain's wrapper
llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash")

async def main():
    agent = Agent(
        task="search google.com and open youtube and search nothings new then play the song",
        llm=llm,
    )
    result = await agent.run()
    print(result)

asyncio.run(main())