import os
import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, HttpUrl
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.background import BackgroundTask

from extract_jobs import create_job, get_job
from ytdlp_service import (
    _friendly_download_error,
    _friendly_ytdlp_error,
    _safe_filename,
    extract_media,
    merge_and_get_path,
    normalize_media_url,
    resolve_direct_download_url,
)

PORT = int(os.environ.get("PORT", "8000"))
CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "*")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="ZeroAds Backend", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

if CORS_ORIGIN == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in CORS_ORIGIN.split(",")],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


class ExtractRequest(BaseModel):
    url: str


def _api_base_url(request: Request) -> str:
    configured = os.environ.get("PUBLIC_API_URL")
    if configured:
        return configured.rstrip("/")
    return str(request.base_url).rstrip("/")


@app.get("/health")
def health():
    return {"status": "ok", "service": "zeroads-backend-python"}


@app.post("/api/extract")
@limiter.limit("30/minute")
def extract(request: Request, body: ExtractRequest):
    normalized = normalize_media_url(body.url)
    try:
        HttpUrl(normalized)
    except Exception:
        return JSONResponse(status_code=400, content={"error": "A valid URL is required."})

    job_id = create_job(extract_media, normalized, _api_base_url(request))
    return {"jobId": job_id, "status": "pending"}


@app.get("/api/extract/status/{job_id}")
@limiter.limit("60/minute")
def extract_status(job_id: str):
    job = get_job(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"error": "Job not found or expired."})

    status = job.get("status", "pending")
    if status == "done":
        return {"status": "done", "result": job["result"]}
    if status == "error":
        return JSONResponse(
            status_code=422,
            content={"status": "error", "error": _friendly_ytdlp_error(str(job.get("error", "")))},
        )
    return {"status": status}


@app.get("/api/download")
@limiter.limit("10/minute")
def download(request: Request, url: HttpUrl, format: str, title: str = "video"):
    if not format or len(format) > 200:
        return JSONResponse(status_code=400, content={"error": "Invalid format selector."})

    tmp_dir = None
    try:
        # Fast path: redirect phone straight to the CDN (no server merge, no timeout).
        direct_url = resolve_direct_download_url(str(url), format)
        if direct_url:
            return RedirectResponse(direct_url, status_code=302)

        file_path, tmp_dir = merge_and_get_path(str(url), format, title)
        filename = f"{_safe_filename(title)}.mp4"
        return FileResponse(
            path=file_path,
            media_type="video/mp4",
            filename=filename,
            background=BackgroundTask(tmp_dir.cleanup),
        )
    except RuntimeError as exc:
        if tmp_dir is not None:
            tmp_dir.cleanup()
        return JSONResponse(status_code=422, content={"error": _friendly_download_error(str(exc))})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
