from pydantic import BaseModel
from typing import Optional

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "default"
    speed: Optional[float] = 1.0
