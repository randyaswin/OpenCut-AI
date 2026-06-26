from typing import Any, Optional, Dict, List
from pydantic import BaseModel, Field

class CuriosityScore(BaseModel):
    composite: float = 0.0

class EmotionalArcScore(BaseModel):
    composite: float = 0.0

class EnhancementSuggestion(BaseModel):
    description: str = ""

class EnergyScore(BaseModel):
    composite: float = 0.0

class AudioSyncScore(BaseModel):
    composite: float = 0.0

class FacePresenceScore(BaseModel):
    composite: float = 0.0
    early_face_present: bool = False

class HookScore(BaseModel):
    composite: float = 0.0

class ViralityScore(BaseModel):
    composite: float = 0.0

class ScoredClip(BaseModel):
    clip_index: int = 0
    start: float = 0.0
    end: float = 0.0


class YouTubeVideoMeta(BaseModel):
    title: str = ""
    duration_seconds: float = 0.0

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: float = 0.0
    message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class ScoreClipRequest(BaseModel):
    audio_path: Optional[str] = None
    video_path: Optional[str] = None
    transcript_text: str = ""
    start: float = 0.0
    end: float = 30.0

class ScoreBatchRequest(BaseModel):
    clips: list[ScoreClipRequest] = []

class EngagementScore(BaseModel):
    composite: float = 0.0
    grade: str = "F"
    hook: HookScore = Field(default_factory=HookScore)
    curiosity: CuriosityScore = Field(default_factory=CuriosityScore)
    energy: EnergyScore = Field(default_factory=EnergyScore)
    audio_sync: AudioSyncScore = Field(default_factory=AudioSyncScore)
    face_presence: FacePresenceScore = Field(default_factory=FacePresenceScore)
    emotional_arc: EmotionalArcScore = Field(default_factory=EmotionalArcScore)
    virality: ViralityScore = Field(default_factory=ViralityScore)
    suggestions: List[EnhancementSuggestion] = Field(default_factory=list)
    
    def to_response(self) -> Dict[str, Any]:
        return self.model_dump()
