"""
Agno benchmark server — used by examples/agno-vs-personaforge.ts

Setup:
    uv pip install 'agno[os]' openai
    export OPENAI_API_KEY=sk-...
    fastapi dev examples/agno_server.py

Server starts at http://localhost:8000
Run endpoint: POST /agents/benchmark/runs
"""

import os

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.openai import OpenAIChat
from agno.os import AgentOS

_model_id = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

benchmark = Agent(
    name="benchmark",
    id="benchmark",
    model=OpenAIChat(id=_model_id),
    instructions="You are a helpful assistant. Be concise and accurate.",
    num_history_messages=20,
)

agent_os = AgentOS(
    agents=[benchmark],
    db=SqliteDb(db_file="agno.db"),
)

app = agent_os.get_app()
