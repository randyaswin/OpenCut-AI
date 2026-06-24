import os
import json
import logging
import subprocess
import httpx
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
        "transcripts": None,
        "objects": [],
        "scenes": []
    }

    # 1. Extract EXIF/Metadata
    if job:
        job.meta['progress'] = 'extracting_metadata'
        job.save_meta()
    results["metadata"] = extract_metadata(file_path)

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
