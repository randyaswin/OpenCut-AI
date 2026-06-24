"""AI command processing route -- natural language to editor actions."""

import json
import logging

from fastapi import APIRouter, HTTPException

from app.models.command import CommandRequest, CommandResponse, EditorAction
from app.services.model_backend import llm_backend
from app.services.stream_utils import streamed_llm_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/llm", tags=["command"])

COMMAND_SYSTEM_PROMPT = """\
You are an AI assistant for a video editor called OpenCut AI. The user gives you \
natural-language editing commands and you respond with a JSON object containing \
the actions to perform on the timeline.

Available action types:
- REMOVE_SEGMENTS: { segmentIds: number[] }
- REMOVE_FILLERS: { fillerWords: string[] }
- REMOVE_SILENCE: { threshold: number }
- ADD_CHAPTER_MARKERS: { chapters: { title: string, start: number, end: number, summary?: string }[] }
- ADD_SUBTITLE_TRACK: { preset: string, language: string }
- ADD_IMAGE_OVERLAY: { prompt: string, x: number, y: number }
- TRIM_CLIP: { start: number, end: number }
- ADD_TRANSITION: { transitionType: string, duration: number }
- SPLIT_CLIP: { time: number }
- ADD_TEXT_OVERLAY: { text: string, x: number, y: number, style: string }
- ADJUST_SPEED: { speed: number, clipId?: string }
- ADD_VOICEOVER: { text: string, voiceId?: string }
- DENOISE_AUDIO: { strength: number }
- GENERATE_IMAGE: { prompt: string, width: number, height: number }
- SET_CANVAS_SIZE: { width: number, height: number, label: string }
- ADD_MUSIC: { query: string, duration: number } // query should be keywords based on video mood/sentiment
- NORMALIZE_AUDIO: { targetLUFS: number }
- AUTO_DUCK: { duckAmount: number, fadeDuration: number }
- EXPORT_PROJECT: { format: string, quality: string }
- COLOR_CORRECT: { profile: string }

Respond with ONLY a JSON object in this format:
{
  "actions": [{"type": "...", "target": "clip_id or null", "params": {...}}],
  "explanation": "Human-readable explanation of what will happen",
  "confidence": 0.0 to 1.0
}
"""


@router.post("/command")
async def process_command(request: CommandRequest):
    """Process a natural-language editing command.

    Takes a command string and optional timeline state, uses the LLM to
    interpret the command, and returns structured editor actions.
    Streams keepalive pings to prevent timeouts.
    """
    available = await llm_backend.check_available()
    if not available:
        raise HTTPException(
            status_code=503,
            detail="No LLM backend available. Start Ollama or TurboQuant service.",
        )

    prompt_parts = [f"User command: {request.command}"]
    if request.timeline_state:
        prompt_parts.append(
            f"\nCurrent timeline state:\n{json.dumps(request.timeline_state, indent=2)}"
        )
    prompt = "\n".join(prompt_parts)

    async def _work():
        data = await llm_backend.generate_json(
            prompt=prompt,
            model=request.model,
            system=COMMAND_SYSTEM_PROMPT,
        )
        actions = [
            {"type": a.get("type"), "target": a.get("target"), "params": a.get("params", {})}
            for a in data.get("actions", [])
        ]
        return {
            "actions": actions,
            "explanation": data.get("explanation", ""),
            "confidence": data.get("confidence", 0.5),
            "raw_response": json.dumps(data),
        }

    return streamed_llm_response(_work, error_detail="Command processing failed.")
