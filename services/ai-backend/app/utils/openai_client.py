import asyncio
import json
import logging
from typing import Any, AsyncGenerator

import httpx

logger = logging.getLogger(__name__)

class OpenAIClient:
    """A shared client for OpenAI-compatible APIs (chat, vision, images, tts)."""

    def __init__(self, base_url: str, api_key: str, model: str):
        # Ensure base_url has no trailing slash to avoid double-slashes in paths
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        
        # Determine extra headers for OpenRouter or specific providers
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        
        # OpenRouter-specific headers (safe to include for all, mostly ignored by others)
        if "openrouter" in self.base_url.lower():
            self.headers["HTTP-Referer"] = "https://github.com/Ekaanth/OpenCut-AI"
            self.headers["X-Title"] = "OpenCut-AI"

    async def _post(self, path: str, payload: dict[str, Any], stream: bool = False, max_retries: int = 3) -> httpx.Response:
        url = f"{self.base_url}{path}"
        timeout = httpx.Timeout(60.0, connect=10.0, read=300.0)
        
        logger.debug(f"Sending POST to {url} with payload keys: {list(payload.keys())}")
        
        for attempt in range(max_retries):
            client = httpx.AsyncClient(timeout=timeout)
            try:
                if stream:
                    request = client.build_request("POST", url, headers=self.headers, json=payload)
                    response = await client.send(request, stream=True)
                else:
                    response = await client.post(url, headers=self.headers, json=payload)
                    response.raise_for_status()
                
                logger.debug(f"Response from {url}: status_code={response.status_code}")
                return response
            except (httpx.HTTPError, httpx.NetworkError) as e:
                if attempt == max_retries - 1:
                    logger.exception(f"OpenAI API request failed after {max_retries} attempts: {url}")
                    raise e
                wait_time = 2 ** attempt
                logger.warning(f"OpenAI API request failed (attempt {attempt + 1}/{max_retries}): {e}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
            except Exception as e:
                logger.exception(f"Unexpected error during OpenAI API request to {url}")
                raise e

    async def chat_completion(
        self, 
        messages: list[dict[str, Any]], 
        temperature: float = 0.7, 
        response_format: dict | None = None
    ) -> dict[str, Any]:
        """Call the /chat/completions endpoint synchronously (returns dict)."""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if response_format:
            payload["response_format"] = response_format
            
        resp = await self._post("/chat/completions", payload)
        text = resp.text
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse OpenAI API response as JSON. Status: {resp.status_code}. Raw: {text[:500]}")
            if not text.strip():
                raise ValueError(f"Empty response from API (HTTP {resp.status_code})") from e
            raise ValueError(f"Invalid JSON response from API: {text[:100]}") from e

    async def chat_completion_stream(
        self, 
        messages: list[dict[str, Any]], 
        temperature: float = 0.7,
        max_retries: int = 3
    ) -> AsyncGenerator[str, None]:
        """Stream the /chat/completions endpoint."""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        
        url = f"{self.base_url}/chat/completions"
        timeout = httpx.Timeout(60.0, connect=10.0, read=300.0)
        
        logger.debug(f"Streaming chat completion from {url} with payload keys: {list(payload.keys())}")
        
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    async with client.stream("POST", url, headers=self.headers, json=payload) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line:
                                continue
                            if line.startswith("data: "):
                                data = line[6:]
                                if data == "[DONE]":
                                    break
                                try:
                                    chunk = json.loads(data)
                                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                                    content = delta.get("content")
                                    if content:
                                        yield content
                                except json.JSONDecodeError:
                                    logger.warning(f"Failed to parse OpenAI stream chunk: {data}")
                        return
            except (httpx.HTTPError, httpx.NetworkError) as e:
                if attempt == max_retries - 1:
                    logger.exception(f"OpenAI streaming failed after {max_retries} attempts: {url}")
                    raise e
                wait_time = 2 ** attempt
                logger.warning(f"OpenAI streaming failed (attempt {attempt + 1}/{max_retries}): {e}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)

    async def generate_image(self, prompt: str, size: str = "1024x1024", n: int = 1) -> dict[str, Any]:
        """Call the /images/generations endpoint."""
        payload = {
            "model": self.model,
            "prompt": prompt,
            "size": size,
            "n": n,
        }
        resp = await self._post("/images/generations", payload)
        return resp.json()

    async def generate_speech(self, text: str, voice: str = "alloy", response_format: str = "mp3") -> bytes:
        """Call the /audio/speech endpoint to generate TTS audio bytes."""
        payload = {
            "model": self.model,
            "input": text,
            "voice": voice,
            "response_format": response_format,
        }
        resp = await self._post("/audio/speech", payload)
        return resp.content

