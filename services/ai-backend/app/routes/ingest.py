import os
import uuid
import logging
import shutil
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from rq import Queue
from redis import Redis

from app.config import settings
from app.worker.ingest_pipeline import run_ingest_pipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ingest"])

# We must use a synchronous redis client for RQ
# We'll instantiate it on demand or lazily
_redis_conn = None
_rq_queue = None

def get_rq_queue():
    global _redis_conn, _rq_queue
    if _rq_queue is None:
        try:
            # We assume REDIS_URL is like redis://redis:6379 or similar
            # REDIS_URL from aioredis might be used, we can parse it
            _redis_conn = Redis.from_url(settings.REDIS_URL)
            _rq_queue = Queue("ingest", connection=_redis_conn)
        except Exception as e:
            logger.error(f"Failed to connect to Redis for RQ: {e}")
    return _rq_queue

@router.post("/ingest")
async def ingest_asset(
    asset_id: str = Form(...),
    webhook_url: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Accepts a media file, saves it to the shared volume, and enqueues an ingest job.
    """
    q = get_rq_queue()
    if not q:
        raise HTTPException(status_code=503, detail="Job queue is not available")

    # Create ingest_data dir if it doesn't exist
    ingest_dir = "/app/ingest_data"
    os.makedirs(ingest_dir, exist_ok=True)

    # Save file
    file_path = os.path.join(ingest_dir, f"{asset_id}_{file.filename}")
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save uploaded file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save file")

    # Enqueue job
    try:
        job = q.enqueue(
            run_ingest_pipeline,
            args=(asset_id, file_path, webhook_url),
            job_timeout=3600 # 1 hour max
        )
        return {"job_id": job.get_id()}
    except Exception as e:
        logger.error(f"Failed to enqueue job: {e}")
        raise HTTPException(status_code=500, detail="Failed to enqueue job")

@router.get("/ingest/{job_id}")
async def get_ingest_status(job_id: str):
    """
    Returns the status of an ingest job.
    """
    q = get_rq_queue()
    if not q:
        raise HTTPException(status_code=503, detail="Job queue is not available")

    try:
        job = q.fetch_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        return {
            "job_id": job.get_id(),
            "status": job.get_status(),
            "progress": job.meta.get("progress", "queued"),
            "result": job.result
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job status: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch job status")
