"""personaforge Python SDK — HTTP client for personaforge server.

Maps TypeScript createAgent() / agent.run() to Python.
Requires a running personaforge HTTP server (createHttpService).
"""

import json
import time
import logging
from typing import Any, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

logger = logging.getLogger("personaforge")


class PersonaForgeError(Exception):
    """Raised on personaforge server errors."""
    def __init__(self, message: str, status_code: Optional[int] = None,
                 response: Optional[dict] = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class AgentResult:
    """Result of an agent.run() call."""
    def __init__(self, data: dict):
        self.text: str = data.get("text", "")
        self.structured_output: Any = data.get("structuredOutput")
        self.messages: list[dict] = data.get("messages", [])
        self.raw: dict = data

    def __repr__(self) -> str:
        return f"AgentResult(text={self.text[:60]!r}...)"


class Agent:
    """Synchronous personaforge agent client.

    Args:
        base_url: personaforge HTTP server URL (e.g. http://localhost:3033)
        api_key: Optional API key for Authorization header
        agent_name: Default agent name to use for runs
        timeout: Request timeout in seconds
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3033",
        api_key: Optional[str] = None,
        agent_name: Optional[str] = None,
        timeout: float = 60.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.agent_name = agent_name
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _request(self, method: str, path: str, body: Optional[dict] = None
                 ) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        req = Request(url, data=data, headers=self._headers(),
                      method=method)
        try:
            resp = urlopen(req, timeout=self.timeout)
            return json.loads(resp.read().decode())
        except HTTPError as e:
            resp_body = e.read().decode()
            try:
                resp_json = json.loads(resp_body)
            except json.JSONDecodeError:
                resp_json = {"raw": resp_body}
            raise PersonaForgeError(
                f"HTTP {e.code}: {resp_body[:200]}",
                status_code=e.code,
                response=resp_json,
            )
        except URLError as e:
            raise PersonaForgeError(f"Connection failed: {e.reason}")

    def list_agents(self) -> list[dict]:
        """List registered agents."""
        return self._request("GET", "/api/agents").get("agents", [])

    def list_sessions(self) -> list[dict]:
        """List active sessions."""
        return self._request("GET", "/api/sessions").get("sessions", [])

    def run(
        self,
        prompt: str,
        agent_name: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> AgentResult:
        """Run an agent with the given prompt.

        Args:
            prompt: Input text prompt
            agent_name: Agent name (defaults to instance default or first agent)
            session_id: Optional session ID for stateful conversations

        Returns:
            AgentResult with .text, .structured_output, .messages
        """
        body = {
            "prompt": prompt,
            "agent": agent_name or self.agent_name,
        }
        if session_id:
            body["sessionId"] = session_id
        data = self._request("POST", "/api/chat", body)
        return AgentResult(data)

    def get_session(self, session_id: str) -> dict:
        """Get session details."""
        return self._request(
            "GET", f"/api/sessions/detail?id={session_id}"
        )

    def health(self) -> dict:
        """Health check."""
        try:
            return self._request("GET", "/api/health")
        except PersonaForgeError:
            return {"status": "unreachable"}


class AsyncAgent:
    """Async personaforge agent client.

    Requires `httpx` (pip install httpx).
    Same API as Agent but async.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3033",
        api_key: Optional[str] = None,
        agent_name: Optional[str] = None,
        timeout: float = 60.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.agent_name = agent_name
        self.timeout = timeout
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import httpx
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self._client = httpx.Client(
                base_url=self.base_url,
                headers=headers,
                timeout=self.timeout,
            )
        return self._client

    async def run(
        self,
        prompt: str,
        agent_name: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> AgentResult:
        import httpx
        body = {"prompt": prompt, "agent": agent_name or self.agent_name}
        if session_id:
            body["sessionId"] = session_id
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
        ) as c:
            h = {"Content-Type": "application/json"}
            if self.api_key:
                h["Authorization"] = f"Bearer {self.api_key}"
            resp = await c.post("/api/chat", json=body, headers=h)
            resp.raise_for_status()
            return AgentResult(resp.json())

    async def stream(
        self,
        prompt: str,
        agent_name: Optional[str] = None,
        session_id: Optional[str] = None,
    ):
        """Stream agent response via SSE."""
        import httpx
        body = {
            "prompt": prompt,
            "agent": agent_name or self.agent_name,
            "stream": True,
        }
        if session_id:
            body["sessionId"] = session_id
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
        ) as c:
            h = {"Content-Type": "application/json"}
            if self.api_key:
                h["Authorization"] = f"Bearer {self.api_key}"
            async with c.stream("POST", "/api/chat", json=body,
                                headers=h) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield json.loads(line[6:])

    def close(self):
        if self._client:
            self._client.close()
