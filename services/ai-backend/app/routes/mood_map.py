"""Mood-to-music mapping service.

Converts abstract mood/energy descriptions into Freesound-compatible
search parameters so the agent can auto-select background music
without requiring explicit genre/tempo knowledge from the user.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/mood-map", tags=["mood-map"])

# ---------------------------------------------------------------------------
# Mood → Freesound tag / tempo-range mapping
# Derived from common video-editing mood labels (see AGENTS.md §Goal 9).
# ---------------------------------------------------------------------------
MOOD_TABLE: dict[str, dict] = {
    "calm":        {"tags": ["ambient", "soft", "meditation", "piano", "peaceful"],          "bpm_min": 50,  "bpm_max": 90,  "duration_max": 300},
    "energetic":   {"tags": ["electronic", "upbeat", "driving", "dance", "epic"],            "bpm_min": 110, "bpm_max": 160, "duration_max": 240},
    "dramatic":    {"tags": ["cinematic", "orchestral", "suspense", "powerful", "intense"],  "bpm_min": 70,  "bpm_max": 130, "duration_max": 180},
    "playful":     {"tags": ["ukulele", "whimsical", "light", "fun", "happy"],               "bpm_min": 90,  "bpm_max": 140, "duration_max": 180},
    "professional": {"tags": ["corporate", "motivational", "inspirational", "ambient", "business"],
                                                                                             "bpm_min": 80,  "bpm_max": 120, "duration_max": 300},
    "upbeat":      {"tags": ["pop", "happy", "cheerful", "summer", "feelgood"],              "bpm_min": 100, "bpm_max": 150, "duration_max": 240},
    "melancholic": {"tags": ["sad", "piano", "strings", "slow", "emotional"],               "bpm_min": 40,  "bpm_max": 80,  "duration_max": 300},
    "neutral":     {"tags": ["ambient", "background", "underground", "film", "soundtrack"],  "bpm_min": 60,  "bpm_max": 120, "duration_max": 600},
}

# Map energy level (1-10) → tempo multiplier
ENERGY_TEMPO_MAP = {
    1: 0.7, 2: 0.75, 3: 0.85,
    4: 0.9, 5: 1.0,  6: 1.0,
    7: 1.1, 8: 1.15, 9: 1.2, 10: 1.3,
}

DEFAULT_MOOD = "neutral"
MAX_ENERGY = 10
MIN_ENERGY = 1


@router.get("")
@router.get("/")
async def map_mood(mood: str = DEFAULT_MOOD, energy: int = 5):
    """Return Freesound search params for a given mood + energy level."""
    mood_key = mood.strip().lower()
    entry = MOOD_TABLE.get(mood_key, MOOD_TABLE[DEFAULT_MOOD]).copy()

    # Clamp energy to valid range
    energy = max(MIN_ENERGY, min(MAX_ENERGY, energy))

    # Scale tempo by energy multiplier
    mult = ENERGY_TEMPO_MAP.get(energy, 1.0)
    bpm_min = int(entry["bpm_min"] * mult)
    bpm_max = int(entry["bpm_max"] * mult)

    # Combine tags into a single search query
    tags = entry["tags"]
    query = " ".join(tags)

    return {
        "query": query,
        "tags": tags,
        "bpm_min": bpm_min,
        "bpm_max": bpm_max,
        "duration_max": entry["duration_max"],
        "mapped_mood": mood_key,
        "energy": energy,
    }
