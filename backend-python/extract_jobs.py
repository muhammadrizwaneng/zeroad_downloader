import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()
_JOB_TTL_SEC = 600


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - _JOB_TTL_SEC
    stale = [job_id for job_id, job in _jobs.items() if job.get("created", 0) < cutoff]
    for job_id in stale:
        _jobs.pop(job_id, None)


def create_job(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> str:
    job_id = str(uuid.uuid4())
    with _lock:
        _cleanup_old_jobs()
        _jobs[job_id] = {"status": "pending", "created": time.time()}

    def runner() -> None:
        with _lock:
            if job_id in _jobs:
                _jobs[job_id]["status"] = "running"
        try:
            result = fn(*args, **kwargs)
            with _lock:
                _jobs[job_id] = {"status": "done", "result": result, "created": time.time()}
        except Exception as exc:
            with _lock:
                _jobs[job_id] = {
                    "status": "error",
                    "error": str(exc),
                    "created": time.time(),
                }

    threading.Thread(target=runner, daemon=True).start()
    return job_id


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        return _jobs.get(job_id)
