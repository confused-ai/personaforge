# personaforge — Python SDK client
#
# Communicates with personaforge HTTP server (createHttpService).
# Provides Pythonic API mirroring TypeScript createAgent / agent.run().
#
# Usage:
#   from personaforge import Agent
#   agent = Agent("http://localhost:3033", api_key="sk-...")
#   result = agent.run("What is the weather in London?")
#   print(result.text)

from .client import Agent, AsyncAgent, PersonaForgeError

__all__ = ["Agent", "AsyncAgent", "PersonaForgeError"]
__version__ = "0.1.0"
