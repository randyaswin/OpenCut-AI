import os
import json
import logging
import subprocess
import httpx
import shutil
from rq import get_current_job
from app.config import settings

logger = logging.getLogger(__name__)

def extract_metadata(file_path: str) -> dict:
    try:
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)
    except Exception as e:
        logger.error(f"Error extracting metadata: {e}")
        return {}

def needs_normalization(metadata: dict, file_path: str) -> bool:
    # Check if format is mov or codec is hevc/h265 or has gpmd
    format_name = metadata.get("format", {}).get("format_name", "").lower()
    if "mov" in format_name:
        return True
    
    for stream in metadata.get("streams", []):
        codec_name = stream.get("codec_name", "").lower()
        if codec_name in ["hevc", "h265"]:
            return True
        if codec_name == "gpmd" or stream.get("codec_tag_string") == "gpmd":
            return True
    return False

def normalize_video(file_path: str, asset_id: str) -> str:
    # Convert to standard MP4 (h264, aac)
    normalized_dir = os.path.join(settings.GENERATED_DIR, "normalized")
    os.makedirs(normalized_dir, exist_ok=True)
    
    # We will use the asset_id as the filename
    output_filename = f"{asset_id}.mp4"
    output_path = os.path.join(normalized_dir, output_filename)
    
    cmd = [
        "ffmpeg", "-y", "-i", file_path,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path
    ]
    logger.info(f"Normalizing video: {' '.join(cmd)}")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output_path

def run_ingest_pipeline(asset_id: str, file_path: str, webhook_url: str):
    """
    RQ worker function that runs the full ingest pipeline for an asset.
    """
    job = get_current_job()
    if job:
        job.meta['progress'] = 'starting'
        job.save_meta()

    logger.info(f"Starting ingest pipeline for asset {asset_id} at {file_path}")

    results = {
        "asset_id": asset_id,
        "metadata": {},
        "normalized_url": None,
        "transcripts": None,
        "objects": [],
        "scenes": []
    }

    # 1. Extract EXIF/Metadata
    if job:
        job.meta['progress'] = 'extracting_metadata'
        job.save_meta()
    results["metadata"] = extract_metadata(file_path)

    # 0. Format Normalization (if needed)
    if job:
        job.meta['progress'] = 'normalizing'
        job.save_meta()
    try:
        if needs_normalization(results["metadata"], file_path):
            normalized_path = normalize_video(file_path, asset_id)
            # Update the file_path so the rest of the pipeline uses the normalized MP4
            file_path = normalized_path
            # The URL to access this normalized file
            results["normalized_url"] = f"{settings.BASE_URL.rstrip('/')}/generated/normalized/{asset_id}.mp4"
            logger.info(f"Normalized video available at {results['normalized_url']}")
            # Also re-extract metadata for the new normalized file so the frontend gets correct duration/codecs
            results["metadata"] = extract_metadata(file_path)
    except Exception as e:
        logger.error(f"Normalization failed: {e}")

    # 2. Transcription
    if job:
        job.meta['progress'] = 'transcribing'
        job.save_meta()
    try:
        with open(file_path, "rb") as f:
            with httpx.Client(timeout=300) as client:
                files = {"file": (os.path.basename(file_path), f, "video/mp4")}
                resp = client.post(f"{settings.WHISPER_SERVICE_URL}/transcribe", files=files)
                if resp.status_code == 200:
                    results["transcripts"] = resp.json()
    except Exception as e:
        logger.error(f"Transcription failed: {e}")

    # 3. Object Detection (YOLO)
    if job:
        job.meta['progress'] = 'object_detection'
        job.save_meta()
    try:
        from ultralytics import YOLO
        model = YOLO("yolov8n.pt") 
        # results["objects"] = ...
    except Exception as e:
        logger.error(f"Object detection failed: {e}")

    # 4. Scene Description (Vision)
    if job:
        job.meta['progress'] = 'scene_description'
        job.save_meta()
    try:
        from app.services.scene_descriptor import generate_scene_descriptions
        results["scenes"] = generate_scene_descriptions(file_path, interval_sec=5)
    except Exception as e:
        logger.error(f"Scene description failed: {e}")

    # 5. Send Webhook
    if job:
        job.meta['progress'] = 'sending_webhook'
        job.save_meta()
    try:
        with httpx.Client(timeout=30) as client:
            client.post(webhook_url, json=results)
    except Exception as e:
        logger.error(f"Webhook failed: {e}")

    if job:
        job.meta['progress'] = 'completed'
        job.save_meta()
    return results
