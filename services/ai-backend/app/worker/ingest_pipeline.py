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

def run_normalization_pipeline(asset_id: str, file_path: str, webhook_url: str):
    """
    RQ worker function that runs format normalization and thumbnail generation.
    """
    job = get_current_job()
    if job:
        job.meta['progress'] = 'starting'
        job.save_meta()

    logger.info(f"Starting normalization pipeline for asset {asset_id} at {file_path}")

    results = {
        "asset_id": asset_id,
        "metadata": {},
        "normalized_url": None,
        "thumbnail_url": None,
    }

    # 1. Extract EXIF/Metadata
    if job:
        job.meta['progress'] = 'extracting_metadata'
        job.save_meta()
    results["metadata"] = extract_metadata(file_path)

    # Format Normalization
    if job:
        job.meta['progress'] = 'normalizing_format'
        job.save_meta()

    needs_normalization = False
    format_name = results.get("metadata", {}).get("format", {}).get("format_name", "").lower()
    
    has_hevc_or_incompatible = False
    has_gpmd = False
    for stream in results.get("metadata", {}).get("streams", []):
        codec_name = stream.get("codec_name", "").lower()
        if codec_name in ["hevc", "h265", "prores", "dnxhd"]:
            has_hevc_or_incompatible = True
        if stream.get("codec_type") == "data" and "gpmd" in stream.get("codec_tag_string", "").lower():
            has_gpmd = True

    if "mov" in format_name or has_hevc_or_incompatible or has_gpmd:
        needs_normalization = True

    if needs_normalization:
        try:
            normalized_dir = os.path.join(settings.GENERATED_DIR, "normalized")
            os.makedirs(normalized_dir, exist_ok=True)
            norm_path = os.path.join(normalized_dir, f"{asset_id}.mp4")
            
            logger.info(f"Normalizing incompatible video {file_path} to H.264 MP4 at {norm_path}")
            cmd = [
                "ffmpeg", "-y",
                "-i", file_path,
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-preset", "fast",
                norm_path
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.exists(norm_path):
                results["normalized_url"] = f"{settings.BASE_URL.rstrip('/')}/generated/normalized/{asset_id}.mp4"
                logger.info(f"Video normalized successfully: {results['normalized_url']}")
        except Exception as e:
            logger.error(f"Format normalization failed: {e}")

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

    # Send early webhook notification for normalization & thumbnail
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

        logger.info(f"Sending normalization webhook to {resolved_webhook_url}")
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
        logger.error(f"Normalization webhook failed: {e}")

    # Enqueue heavy AI analysis job
    if job and job.connection:
        from rq import Queue
        q = Queue("ingest", connection=job.connection)
        q.enqueue(
            run_analysis_pipeline,
            args=(asset_id, file_path, webhook_url, results["metadata"], is_image),
            job_id=f"analyze-{asset_id}",
            job_timeout=3600
        )

    if job:
        job.meta['progress'] = 'completed'
        job.save_meta()
    return results


def run_analysis_pipeline(asset_id: str, file_path: str, webhook_url: str, metadata: dict, is_image: bool):
    """
    RQ worker function that runs heavy AI processes: transcription, object detection, and scene descriptions.
    """
    job = get_current_job()
    if job:
        job.meta['progress'] = 'starting_analysis'
        job.save_meta()

    logger.info(f"Starting AI analysis pipeline for asset {asset_id}")

    results = {
        "asset_id": asset_id,
        "metadata": metadata,
        "transcripts": None,
        "objects": [],
        "scenes": []
    }

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
        try:
            fps_str = metadata["streams"][0].get("r_frame_rate", "30/1")
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

        logger.info(f"Sending final analysis webhook to {resolved_webhook_url}")
        with httpx.Client(timeout=30) as client:
            client.post(resolved_webhook_url, json={
                **results,
                "status": "completed"
            })
    except Exception as e:
        logger.error(f"Webhook failed: {e}")

    if job:
        job.meta['progress'] = 'completed'
        job.save_meta()
    return results
