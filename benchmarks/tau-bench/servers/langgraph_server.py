"""
LangGraph reference server for the cross-framework τ-bench protocol.
See benchmarks/tau-bench/PROTOCOL.md.

Setup:
    pip install "langgraph>=0.2" "langchain-openai>=0.2" fastapi uvicorn
    export OPENAI_API_KEY=sk-...
    # optional: point at an OpenAI-compatible endpoint
    export OPENAI_BASE_URL=http://localhost:20128/v1
    export PF_IT_OPENAI_MODEL=gpt-4o-mini
    uvicorn benchmarks.tau_bench.servers.langgraph_server:app --port 8812

Endpoint: POST /tau-bench/run
"""

import os
import time
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_core.tools import StructuredTool
from langgraph.prebuilt import create_react_agent

MODEL = os.environ.get("PF_IT_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.environ.get("PF_IT_OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL")

app = FastAPI()


class ToolDescriptor(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any] = {}


class RunRequest(BaseModel):
    instruction: str
    tools: list[ToolDescriptor] = []
    maxSteps: int = 8


def _make_llm() -> ChatOpenAI:
    kwargs: dict[str, Any] = {"model": MODEL, "temperature": 0}
    if BASE_URL:
        kwargs["base_url"] = BASE_URL
    return ChatOpenAI(**kwargs)


@app.post("/tau-bench/run")
def run(req: RunRequest) -> dict[str, Any]:
    recorded: list[dict[str, Any]] = []

    def make_stub(descriptor: ToolDescriptor):
        props = (descriptor.parameters or {}).get("properties", {})
        arg_names = list(props.keys())

        def _fn(**kwargs: Any) -> dict[str, Any]:
            # Only keep declared args, in declared order.
            args = {k: kwargs.get(k) for k in arg_names if k in kwargs}
            result = {"ok": True, "echoed": args}
            recorded.append({"name": descriptor.name, "arguments": args, "result": result})
            return result

        # Build a JSON-schema-driven StructuredTool.
        return StructuredTool.from_function(
            func=_fn,
            name=descriptor.name,
            description=descriptor.description,
            args_schema=None,  # LangChain infers from **kwargs + schema below
        )

    try:
        tools = [make_stub(t) for t in req.tools]
        agent = create_react_agent(_make_llm(), tools)
        started = time.time()
        result = agent.invoke(
            {"messages": [("system", "Use the tools to satisfy the request. Call tools with correct arguments."),
                          ("user", req.instruction)]},
            config={"recursion_limit": max(4, req.maxSteps * 2)},
        )
        messages = result.get("messages", [])
        final_text = ""
        for m in reversed(messages):
            content = getattr(m, "content", "")
            if content:
                final_text = content
                break
        return {
            "framework": "langgraph",
            "text": final_text,
            "toolCalls": recorded,
            "steps": len([m for m in messages if getattr(m, "type", "") == "ai"]),
            "finishReason": "stop",
            "durationMs": (time.time() - started) * 1000.0,
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
