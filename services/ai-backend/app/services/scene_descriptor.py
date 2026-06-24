import os
import tempfile
import subprocess
import base64
import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

def encode_image(image_path: str) -> str:
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def generate_scene_descriptions(file_path: str, interval_sec: int = 5) -> list:
    """
    Extracts frames from the video at the given interval and uses OpenAI Vision
    to generate scene descriptions for each frame.
    """
    if not settings.OPENAI_VISION_CAPABLE:
        logger.info("OpenAI vision is not enabled. Skipping scene description.")
        return []
    if not settings.OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY is missing. Skipping scene description.")
        return []

    scenes = []
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            # Extract frames using ffmpeg at 1 frame per interval_sec
            fps_str = f"1/{interval_sec}"
            output_pattern = os.path.join(temp_dir, "frame_%04d.jpg")
            
            cmd = [
                "ffmpeg", "-i", file_path,
                "-vf", f"fps={fps_str},scale=512:-1", # Resize to 512px width to save tokens/bandwidth
                "-q:v", "2",
                output_pattern
            ]
            
            logger.info(f"Extracting frames: {' '.join(cmd)}")
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # Read extracted frames
            frames = sorted([f for f in os.listdir(temp_dir) if f.endswith(".jpg")])
            logger.info(f"Extracted {len(frames)} frames for scene description.")
            
            with httpx.Client(timeout=settings.OPENAI_TIMEOUT) as client:
                headers = {
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                }
                
                for idx, frame_file in enumerate(frames):
                    timestamp = idx * interval_sec
                    frame_path = os.path.join(temp_dir, frame_file)
                    base64_image = encode_image(frame_path)
                    
                    payload = {
                        "model": settings.OPENAI_MODEL,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "Describe this scene in a short, comma-separated list of visual keywords (e.g., 'outdoor, dog playing, sunny, park, grass'). Keep it under 10 words."
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:image/jpeg;base64,{base64_image}"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 50
                    }
                    
                    try:
                        resp = client.post(
                            f"{settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
                            headers=headers,
                            json=payload
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            description = data['choices'][0]['message']['content'].strip()
                            scenes.append({
                                "start_time": timestamp,
                                "end_time": timestamp + interval_sec,
                                "description": description
                            })
                            logger.info(f"Scene at {timestamp}s: {description}")
                        else:
                            logger.error(f"Vision API error: {resp.status_code} {resp.text}")
                    except Exception as e:
                        logger.error(f"Error calling Vision API for frame {idx}: {e}")
                        
    except Exception as e:
        logger.error(f"Error in generate_scene_descriptions: {e}")
        
    return scenes
