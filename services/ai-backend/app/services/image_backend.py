"""Image generation backend routing — OpenAI vs local Stable Diffusion."""

import logging
import uuid
import httpx
from pathlib import Path

from app.config import settings
from app.utils.openai_client import OpenAIClient
from app.models.generation import ImageGenParams

logger = logging.getLogger(__name__)

class ImageBackend:
    """Unified image generation backend that routes to OpenAI or local image-service."""

    def _should_use_openai(self) -> bool:
        """Determine if we should route to OpenAI for image generation."""
        # For images, if the user provided an API key, we use OpenAI.
        return bool(settings.OPENAI_API_KEY)

    def _get_openai_client(self) -> OpenAIClient:
        return OpenAIClient(
            base_url=settings.OPENAI_BASE_URL,
            api_key=settings.OPENAI_API_KEY,
            model=settings.OPENAI_IMAGE_MODEL,
        )

    async def _download_and_save_image(self, url: str) -> str:
        """Download an image from a URL and save it locally."""
        output_name = f"gen_{uuid.uuid4().hex[:8]}.png"
        output_path = Path(settings.GENERATED_DIR) / output_name

        # Ensure the directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            output_path.write_bytes(resp.content)

        return f"/generated/{output_name}"

    async def _openai_generate(self, params: ImageGenParams) -> dict:
        client = self._get_openai_client()
        
        # OpenAI dall-e-3 expects sizes like "1024x1024", "1024x1792"
        aspect_ratio = params.width / params.height
        if aspect_ratio > 1.2:
            size_str = "1792x1024"
        elif aspect_ratio < 0.8:
            size_str = "1024x1792"
        else:
            size_str = "1024x1024"

        resp = await client.generate_image(
            prompt=params.prompt,
            size=size_str,
            n=1
        )

        data = resp.get("data", [])
        if not data:
            raise ValueError(f"OpenAI returned empty data for image generation: {resp}")

        url = data[0].get("url")
        if not url:
            raise ValueError("OpenAI image generation response missing URL")

        # Download the image so we can serve it from our own stable URL
        local_url = await self._download_and_save_image(url)

        return {
            "imageUrl": local_url,
            "seed": params.seed if params.seed is not None else 0,
            "prompt": params.prompt,
        }

    async def _local_generate(self, params: ImageGenParams) -> dict:
        """Proxy to the local image-service."""
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{settings.IMAGE_SERVICE_URL}/generate",
                json=params.model_dump(),
            )
            resp.raise_for_status()

            # The image-service returns a FileResponse. We need to save those bytes.
            output_name = f"gen_{uuid.uuid4().hex[:8]}.png"
            output_path = Path(settings.GENERATED_DIR) / output_name
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(resp.content)

            return {
                "imageUrl": f"/generated/{output_name}",
                "seed": params.seed if params.seed is not None else 0,
                "prompt": params.prompt,
            }

    async def generate(self, params: ImageGenParams) -> dict:
        """Generate an image from a text prompt.
        
        Returns dict matching ImageGenResult:
        { "imageUrl": "...", "seed": int, "prompt": "..." }
        """
        if self._should_use_openai():
            try:
                logger.debug("Routing image generation to OpenAI")
                return await self._openai_generate(params)
            except Exception as e:
                logger.warning("OpenAI image generation failed: %s, falling back to local image-service", e)
        
        # Fallback or default
        return await self._local_generate(params)

# Module-level singleton
image_backend = ImageBackend()
