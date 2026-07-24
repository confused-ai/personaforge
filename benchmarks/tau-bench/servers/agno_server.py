"""
Agno reference server for the cross-framework τ-bench protocol.
See benchmarks/tau-bench/PROTOCOL.md.

Setup:
    pip install "agno" fastapi uvicorn openai
    export OPENAI_API_KEY=sk-...
    export PF_IT_OPENAI_MODEL=gpt-4o-mini
    uvicorn benchmarks.tau_bench.servers.agno_server:app --port 8815

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
    from agno.agent import Agent
    from agno.models.openai import OpenAIChat

    recorded: list[dict[str, Any]] = []

    def make_stub(descriptor: ToolDescriptor):
        props = (descriptor.parameters or {}).get("properties", {})
        arg_names = list(props.keys())

        def _fn(**kwargs: Any) -> dict[str, Any]:
            args = {k: kwargs.get(k) for k in arg_names if k in kwargs}
            recorded.append({"name": descriptor.name, "arguments": args, "result": {"ok": True}})
            return {"ok": True, "echoed": args}

        _fn.__name__ = descriptor.name
        _fn.__doc__ = descriptor.description
        return _fn

    try:
        tools = [make_stub(t) for t in req.tools]
        agent = Agent(
            name="benchmark",
            model=OpenAIChat(id=MODEL),
            tools=tools,
            instructions="Use the tools to satisfy the request. Call tools with correct arguments.",
            markdown=False,
        )
        started = time.time()
        response = agent.run(req.instruction)
        text = getattr(response, "content", None) or str(response)
        return {
            "framework": "agno",
            "text": text,
            "toolCalls": recorded,
            "steps": len(recorded) + 1,
            "finishReason": "stop",
            "durationMs": (time.time() - started) * 1000.0,
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
