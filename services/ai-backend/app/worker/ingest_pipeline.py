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

    # Format Normalization is now handled purely on the client side via proxy generation.
    # The frontend uploads the proxy file which is already a normalized MP4.

    is_image = False
    format_name = results.get("metadata", {}).get("format", {}).get("format_name", "")
    if "image" in format_name or "png" in format_name or "mjpeg" in format_name or "jpeg" in format_name:
        is_image = True

    # 0.5. Generate Thumbnail (if video)
    has_video = False
    for stream in results.get("metadata", {}).get("streams", []):
        if stream.get("codec_type") == "video":
            has_video = True
            break

    if is_image:
        # For images, we can just use the original file as the thumbnail, or let the frontend handle it
        # Or copy it to thumbnails dir to have a consistent URL
        try:
            thumbnails_dir = os.path.join(settings.GENERATED_DIR, "thumbnails")
            os.makedirs(thumbnails_dir, exist_ok=True)
            thumb_path = os.path.join(thumbnails_dir, f"{asset_id}.jpg")
            shutil.copy2(file_path, thumb_path)
            results["thumbnail_url"] = f"{settings.BASE_URL.rstrip('/')}/generated/thumbnails/{asset_id}.jpg"
        except Exception as e:
            logger.error(f"Thumbnail generation for image failed: {e}")
    elif has_video:
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
    if not is_image:
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
        
        # Run inference on video or image
        detection_results = []
        if is_image:
            res = model(file_path, verbose=False)[0]
            boxes = res.boxes
            if boxes is not None and len(boxes) > 0:
                class_ids = boxes.cls.int().tolist()
                class_names = [model.names[cid] for cid in class_ids]
                unique_classes = list(set(class_names))
                detection_results.append({
                    "timestamp": 0.0,
                    "classes": unique_classes
                })
        else:
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
        from app.services.scene_descriptor import generate_scene_descriptions, describe_image
        if is_image:
            results["scenes"] = describe_image(file_path)
        else:
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
