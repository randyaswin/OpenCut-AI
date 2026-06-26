from typing import Any, Optional
from pydantic import BaseModel

class EditorAction(BaseModel):
    type: str
    target: Optional[str] = None
    params: dict[str, Any] = {}

class CommandRequest(BaseModel):
    command: str
    timeline_state: Optional[dict[str, Any]] = None
    model: Optional[str] = None

class CommandResponse(BaseModel):
    actions: list[EditorAction]
    explanation: str
    confidence: float = 0.5
    needsClarification: Optional[bool] = False
    clarificationQuestion: Optional[str] = None
