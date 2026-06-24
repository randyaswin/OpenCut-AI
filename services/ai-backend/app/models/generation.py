from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class EnhancePromptRequest(BaseModel):
    prompt: str
    style: Optional[str] = "photorealistic"

class ImageGenParams(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = ""
    width: int = 1024
    height: int = 1024

class InfographicRequest(BaseModel):
    topic: str
    data_points: List[Dict[str, Any]]
    width: int = 1080
    height: int = 1920
    background_color: str = "transparent"
