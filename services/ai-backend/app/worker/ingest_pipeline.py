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

    # 0.5. Generate Thumbnail (if video)
    has_video = False
    for stream in results.get("metadata", {}).get("streams", []):
        if stream.get("codec_type") == "video":
            has_video = True
            break

    if has_video:
        try:
            thumbnails_dir = os.path.join(settings.GENERATED_DIR, "thumbnails")
            os.makedirs(thumbnails_dir, exist_ok=True)
            thumb_path = os.path.join(thumbnails_dir, f"{asset_id}.jpg")
            
            try:
                duration = float(results.get("metadata", {}).get("format", {}).get("duration", 5.0))
            except:
                duration = 5.0
                
            seek = 1.0 if duration > 1.0 else 0.0
            
            # Extract frame at seek time using FFmpeg
            cmd = [
                "ffmpeg", "-y", "-ss", str(seek),
                "-i", file_path,
                "-vframes", "1",
                "-q:v", "3",
                thumb_path
            ]
            logger.info(f"Extracting thumbnail: {' '.join(cmd)}")
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.exists(thumb_path):
                results["thumbnail_url"] = f"{settings.BASE_URL.rstrip('/')}/generated/thumbnails/{asset_id}.jpg"
                logger.info(f"Thumbnail generated successfully: {results['thumbnail_url']}")
        except Exception as e:
            logger.error(f"Thumbnail extraction failed: {e}")

    # 0.6. Send early webhook notification for normalization & thumbnail
    try:
        resolved_webhook_url = webhook_url
        if "localhost:3100" in webhook_url:
            resolved_webhook_url = webhook_url.replace("localhost:3100", "web:3000")
        elif "127.0.0.1:3100" in webhook_url:
            resolved_webhook_url = webhook_url.replace("127.0.0.1:3100", "web:3000")
        elif "localhost:3000" in webhook_url:
            resolved_webhook_url = webhook_url.replace("localhost:3000", "web:3000")
        elif "127.0.0.1:3000" in webhook_url:
            resolved_webhook_url = webhook_url.replace("127.0.0.1:3000", "web:3000")

        logger.info(f"Sending early normalization webhook to {resolved_webhook_url}")
        early_results = {
            "asset_id": asset_id,
            "metadata": results["metadata"],
            "normalized_url": results["normalized_url"],
            "thumbnail_url": results.get("thumbnail_url"),
            "status": "processing"
        }
        with httpx.Client(timeout=30) as client:
            client.post(resolved_webhook_url, json=early_results)
    except Exception as e:
        logger.error(f"Early webhook failed: {e}")

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
        import math
        
        # Load model (downloads on first run if not present)
        model = YOLO("yolov8n.pt")
        
        # Determine stride (e.g. 1 frame every 1 second)
        # Using 30 as a safe default for ~30fps video if metadata fails
        try:
            fps_str = results["metadata"]["streams"][0].get("r_frame_rate", "30/1")
            num, den = map(int, fps_str.split('/'))
            fps = num / den if den != 0 else 30
        except:
            fps = 30
            
        vid_stride = max(1, math.floor(fps))  # 1 frame per second
        
        # Run inference on video
        detection_results = []
        # stream=True returns a generator, keeping memory low
        for i, res in enumerate(model(file_path, stream=True, vid_stride=vid_stride, verbose=False)):
            timestamp = i * (vid_stride / fps)
            
            # Extract unique classes found in this frame
            boxes = res.boxes
            if boxes is not None and len(boxes) > 0:
                class_ids = boxes.cls.int().tolist()
                class_names = [model.names[cid] for cid in class_ids]
                unique_classes = list(set(class_names))
                
                # Store frame level summary
                detection_results.append({
                    "timestamp": timestamp,
                    "classes": unique_classes
                })
        
        results["objects"] = detection_results
        logger.info(f"Object detection completed: {len(detection_results)} frames with objects.")
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
        resolved_webhook_url = webhook_url
        if "localhost:3100" in webhook_url:
            resolved_webhook_url = webhook_url.replace("localhost:3100", "web:3000")
        elif "127.0.0.1:3100" in webhook_url:
            resolved_webhook_url = webhook_url.replace("127.0.0.1:3100", "web:3000")
        elif "localhost:3000" in webhook_url:
            resolved_webhook_url = webhook_url.replace("localhost:3000", "web:3000")
        elif "127.0.0.1:3000" in webhook_url:
            resolved_webhook_url = webhook_url.replace("127.0.0.1:3000", "web:3000")

        logger.info(f"Sending webhook to {resolved_webhook_url}")
        with httpx.Client(timeout=30) as client:
            client.post(resolved_webhook_url, json=results)
    except Exception as e:
        logger.error(f"Webhook failed: {e}")

    if job:
        job.meta['progress'] = 'completed'
        job.save_meta()
    return results
