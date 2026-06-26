"""Text-to-speech backend routing — OpenAI vs local Coqui TTS."""

import logging
import httpx
from app.config import settings
from app.utils.openai_client import OpenAIClient
from app.models.audio import TTSRequest

logger = logging.getLogger(__name__)

class TTSBackend:
    """Unified Text-to-speech backend that routes to OpenAI or local tts-service."""

    def _should_use_openai(self) -> bool:
        """Determine if we should route to OpenAI for TTS."""
        if settings.TTS_BACKEND == "openai":
            return True
        if settings.TTS_BACKEND == "local":
            return False
        # "auto" or other
        return bool(settings.OPENAI_API_KEY)

    def _get_openai_client(self) -> OpenAIClient:
        return OpenAIClient(
            base_url=settings.OPENAI_BASE_URL,
            api_key=settings.OPENAI_API_KEY,
            model=settings.OPENAI_TTS_MODEL,
        )

    async def _openai_generate(self, request: TTSRequest) -> bytes:
        client = self._get_openai_client()
        # Fall back to configured voice if voice is empty/default
        voice = request.voice if request.voice and request.voice != "default" else settings.OPENAI_TTS_VOICE
        # Call generate_speech. OpenAI supports audio/speech endpoint returning MP3/WAV/etc.
        # Default response format mp3 or wav
        return await client.generate_speech(text=request.text, voice=voice, response_format="mp3")

    async def _local_generate(self, request: TTSRequest) -> bytes:
        """Proxy to the local tts-service."""
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{settings.TTS_SERVICE_URL}/generate",
                json=request.model_dump(),
            )
            resp.raise_for_status()
            return resp.content

    async def generate(self, request: TTSRequest) -> tuple[bytes, str]:
        """Generate speech from text.
        
        Returns a tuple of (audio_bytes, content_type)
        """
        if self._should_use_openai():
            try:
                logger.debug("Routing TTS generation to OpenAI")
                audio_bytes = await self._openai_generate(request)
                return audio_bytes, "audio/mpeg"
            except Exception as e:
                if settings.TTS_BACKEND == "openai":
                    # If explicitly requested, fail instead of falling back
                    raise e
                logger.warning("OpenAI TTS generation failed: %s, falling back to local tts-service", e)
        
        # Local generation fallback
        audio_bytes = await self._local_generate(request)
        return audio_bytes, "audio/wav"

# Module-level singleton
tts_backend = TTSBackend()
