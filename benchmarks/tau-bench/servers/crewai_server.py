"""
CrewAI reference server for the cross-framework τ-bench protocol.
See benchmarks/tau-bench/PROTOCOL.md.

Setup:
    pip install "crewai>=0.70" fastapi uvicorn
    export OPENAI_API_KEY=sk-...
    export PF_IT_OPENAI_MODEL=gpt-4o-mini
    uvicorn benchmarks.tau_bench.servers.crewai_server:app --port 8813

Endpoint: POST /tau-bench/run
"""

import os
import time
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

MODEL = os.environ.get("PF_IT_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

app = FastAPI()


class ToolDescriptor(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any] = {}


class RunRequest(BaseModel):
    instruction: str
    tools: list[ToolDescriptor] = []
    maxSteps: int = 8


@app.post("/tau-bench/run")
def run(req: RunRequest) -> dict[str, Any]:
    from crewai import Agent, Crew, Task
    from crewai.tools import BaseTool

    recorded: list[dict[str, Any]] = []

    def make_tool(descriptor: ToolDescriptor) -> BaseTool:
        props = (descriptor.parameters or {}).get("properties", {})
        arg_names = list(props.keys())

        class _Stub(BaseTool):
            name: str = descriptor.name
            description: str = descriptor.description

            def _run(self, **kwargs: Any) -> str:
                args = {k: kwargs.get(k) for k in arg_names if k in kwargs}
                recorded.append({"name": descriptor.name, "arguments": args, "result": {"ok": True}})
                return f"ok: {args}"

        return _Stub()

    try:
        tools = [make_tool(t) for t in req.tools]
        agent = Agent(
            role="benchmark agent",
            goal="Complete the task by calling tools with correct arguments.",
            backstory="You are a precise tool-using agent.",
            tools=tools,
            llm=MODEL,
            verbose=False,
            max_iter=max(3, req.maxSteps),
        )
        task = Task(description=req.instruction, expected_output="A concise final answer.", agent=agent)
        crew = Crew(agents=[agent], tasks=[task], verbose=False)
        started = time.time()
        output = crew.kickoff()
        return {
            "framework": "crewai",
            "text": str(output),
            "toolCalls": recorded,
            "steps": len(recorded) + 1,
            "finishReason": "stop",
            "durationMs": (time.time() - started) * 1000.0,
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
