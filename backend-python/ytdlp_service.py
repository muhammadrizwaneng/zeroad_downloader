import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

EXTRACT_TIMEOUT_SEC = 90
MERGE_TIMEOUT_SEC = 300
YTDLP_BIN = os.environ.get("YTDLP_PATH", "yt-dlp")

FAST_ARGS = [
    "--no-playlist",
    "--no-warnings",
    "--extractor-retries",
    "2",
    "--socket-timeout",
    "20",
]

# Try alternate YouTube clients when the default is blocked on cloud IPs.
YOUTUBE_CLIENT_FALLBACKS: list[list[str]] = [
    [],
    ["--extractor-args", "youtube:player_client=android_vr"],
    ["--extractor-args", "youtube:player_client=tv,web"],
    ["--extractor-args", "youtube:player_client=web_embedded"],
    ["--extractor-args", "youtube:player_client=ios,web"],
]

_cookies_file_path: str | None = None


def _is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host.endswith("youtube.com") or host == "youtu.be" or host.endswith(".youtu.be")


def _ensure_cookies_file() -> str | None:
    """Write YTDLP_COOKIES env content to a temp Netscape cookie file for yt-dlp."""
    global _cookies_file_path

    configured_path = os.environ.get("YTDLP_COOKIES_PATH", "").strip()
    if configured_path and os.path.isfile(configured_path):
        return configured_path

    cookies_content = os.environ.get("YTDLP_COOKIES", "").strip()
    if not cookies_content:
        return None

    if _cookies_file_path and os.path.isfile(_cookies_file_path):
        return _cookies_file_path

    handle, path = tempfile.mkstemp(prefix="ytdlp-cookies-", suffix=".txt")
    with os.fdopen(handle, "w", encoding="utf-8") as cookies_file:
        cookies_file.write(cookies_content)
        if not cookies_content.endswith("\n"):
            cookies_file.write("\n")

    _cookies_file_path = path
    return path


def _base_ytdlp_args() -> list[str]:
    args = list(FAST_ARGS)
    cookies_path = _ensure_cookies_file()
    if cookies_path:
        args.extend(["--cookies", cookies_path])
    return args


def _youtube_pot_args() -> list[str]:
    pot_url = os.environ.get("YTDLP_POT_PROVIDER_URL", "http://127.0.0.1:4416").strip()
    if not pot_url:
        return []
    return ["--extractor-args", f"youtubepot-bgutilhttp:base_url={pot_url}"]


def _youtube_client_fallbacks() -> list[list[str]]:
    return YOUTUBE_CLIENT_FALLBACKS


def _is_youtube_bot_block(message: str) -> bool:
    lowered = message.lower()
    return "sign in to confirm" in lowered or "not a bot" in lowered


def _friendly_ytdlp_error(message: str) -> str:
    if _is_youtube_bot_block(message):
        return (
            "YouTube blocked this download from the server. "
            "Add fresh YouTube cookies to Render (see DEPLOY.md), or try TikTok/Instagram instead."
        )
    if len(message) > 280:
        return message[:277] + "..."
    return message

MERGE_HEIGHTS = [1080, 720, 480, 360]


def normalize_media_url(input_url: str) -> str:
    trimmed = input_url.strip()
    if not trimmed:
        return trimmed

    match = re.search(r"https?://[^\s<>\"{}|\\^`\[\]]+", trimmed, re.IGNORECASE)
    candidate = match.group(0) if match else trimmed

    parsed = urlparse(candidate)
    if not parsed.scheme:
        return candidate

    return urlunparse(parsed._replace(fragment=""))


def _format_quality(entry: dict[str, Any]) -> str:
    if entry.get("height"):
        return f"{entry['height']}p"
    resolution = entry.get("resolution")
    if resolution and resolution != "audio only":
        return str(resolution)
    return entry.get("format_note") or "Best available"


def _has_video_and_audio(entry: dict[str, Any]) -> bool:
    return bool(
        entry.get("vcodec")
        and entry["vcodec"] != "none"
        and entry.get("acodec")
        and entry["acodec"] != "none"
    )


def _is_video_only(entry: dict[str, Any]) -> bool:
    return bool(
        entry.get("vcodec")
        and entry["vcodec"] != "none"
        and (not entry.get("acodec") or entry["acodec"] == "none")
    )


def _is_audio_only(entry: dict[str, Any]) -> bool:
    return bool(
        entry.get("acodec")
        and entry["acodec"] != "none"
        and (not entry.get("vcodec") or entry["vcodec"] == "none")
    )


def _is_direct_url(entry: dict[str, Any]) -> bool:
    url = entry.get("url")
    if not url:
        return False
    proto = (entry.get("protocol") or "").lower()
    return "m3u8" not in proto and "dash" not in proto


def _is_stream_url(entry: dict[str, Any]) -> bool:
    url = entry.get("url")
    if not url:
        return False
    proto = (entry.get("protocol") or "").lower()
    return "m3u8" in proto or "dash" in proto


def _build_download_url(api_base_url: str, page_url: str, format_id: str, title: str) -> str:
    params = urlencode(
        {
            "url": page_url,
            "format": format_id,
            "title": title[:120],
        }
    )
    return f"{api_base_url.rstrip('/')}/api/download?{params}"


def _upsert_format(
    formats: dict[str, dict[str, Any]],
    item: dict[str, Any],
    prefer_direct: bool = False,
) -> None:
    key = item["quality"].lower()
    current = formats.get(key)
    if not current:
        formats[key] = item
        return

    if prefer_direct and current.get("needsMerge") and not item.get("needsMerge"):
        formats[key] = item
        return

    if not current.get("needsMerge") and item.get("needsMerge"):
        return

    if (item.get("filesize") or 0) > (current.get("filesize") or 0):
        formats[key] = item


def _collect_direct_combined_formats(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_quality: dict[str, dict[str, Any]] = {}

    for entry in formats:
        if not entry.get("url") or not entry.get("format_id"):
            continue
        if not _has_video_and_audio(entry) or not _is_direct_url(entry):
            continue

        candidate = {
            "formatId": entry["format_id"],
            "ext": entry.get("ext") or "mp4",
            "quality": _format_quality(entry),
            "filesize": entry.get("filesize") or entry.get("filesize_approx"),
            "url": entry["url"],
            "vcodec": entry.get("vcodec") or "none",
            "acodec": entry.get("acodec") or "none",
            "type": "video",
        }
        _upsert_format(by_quality, candidate, prefer_direct=True)

    return sorted(
        by_quality.values(),
        key=lambda item: int("".join(ch for ch in item["quality"] if ch.isdigit()) or 0),
        reverse=True,
    )


def _pick_best_audio(formats: list[dict[str, Any]]) -> dict[str, Any] | None:
    audio_formats = [
        entry for entry in formats if entry.get("format_id") and entry.get("url") and _is_audio_only(entry)
    ]
    if not audio_formats:
        return None

    return sorted(
        audio_formats,
        key=lambda entry: (_is_direct_url(entry), entry.get("abr") or 0),
        reverse=True,
    )[0]


def _pick_best_video_at_height(formats: list[dict[str, Any]], height: int) -> dict[str, Any] | None:
    videos = [
        entry
        for entry in formats
        if entry.get("format_id")
        and entry.get("url")
        and _is_video_only(entry)
        and entry.get("height") == height
    ]
    if not videos:
        return None

    return sorted(
        videos,
        key=lambda entry: (_is_direct_url(entry), entry.get("filesize") or entry.get("filesize_approx") or 0),
        reverse=True,
    )[0]


def _collect_merged_formats(
    data: dict[str, Any],
    api_base_url: str,
    formats: dict[str, dict[str, Any]],
) -> None:
    entries = data.get("formats") or []
    audio = _pick_best_audio(entries)
    if not audio or not audio.get("format_id"):
        return

    page_url = data.get("webpage_url") or ""
    title = data.get("title") or "video"

    for height in MERGE_HEIGHTS:
        quality = f"{height}p"
        current = formats.get(quality.lower())
        if current and not current.get("needsMerge"):
            continue

        video = _pick_best_video_at_height(entries, height)
        if not video or not video.get("format_id"):
            continue

        format_id = f"{video['format_id']}+{audio['format_id']}"
        filesize = (video.get("filesize") or video.get("filesize_approx") or 0) + (
            audio.get("filesize") or audio.get("filesize_approx") or 0
        )

        _upsert_format(
            formats,
            {
                "formatId": format_id,
                "ext": "mp4",
                "quality": quality,
                "filesize": filesize or None,
                "url": _build_download_url(api_base_url, page_url, format_id, title),
                "vcodec": video.get("vcodec") or "none",
                "acodec": audio.get("acodec") or "none",
                "type": "video",
                "needsMerge": True,
            },
        )


def _collect_stream_combined_formats(
    data: dict[str, Any],
    api_base_url: str,
    formats: dict[str, dict[str, Any]],
) -> None:
    page_url = data.get("webpage_url") or ""
    title = data.get("title") or "video"

    for entry in data.get("formats") or []:
        if not entry.get("url") or not entry.get("format_id"):
            continue
        if not _has_video_and_audio(entry) or not _is_stream_url(entry):
            continue

        _upsert_format(
            formats,
            {
                "formatId": entry["format_id"],
                "ext": entry.get("ext") or "mp4",
                "quality": _format_quality(entry),
                "filesize": entry.get("filesize") or entry.get("filesize_approx"),
                "url": _build_download_url(api_base_url, page_url, entry["format_id"], title),
                "vcodec": entry.get("vcodec") or "none",
                "acodec": entry.get("acodec") or "none",
                "type": "video",
                "needsMerge": True,
            },
        )


def _add_universal_fallback(
    data: dict[str, Any],
    api_base_url: str,
    formats: dict[str, dict[str, Any]],
) -> None:
    if formats:
        return

    page_url = data.get("webpage_url") or ""
    title = data.get("title") or "video"

    _upsert_format(
        formats,
        {
            "formatId": "bestvideo+bestaudio/b",
            "ext": "mp4",
            "quality": "Best available",
            "url": _build_download_url(api_base_url, page_url, "bestvideo+bestaudio/b", title),
            "vcodec": "auto",
            "acodec": "auto",
            "type": "video",
            "needsMerge": True,
        },
    )


def _collect_from_selected_metadata(data: dict[str, Any], api_base_url: str) -> dict[str, dict[str, Any]]:
    formats: dict[str, dict[str, Any]] = {}
    page_url = data.get("webpage_url") or ""
    title = data.get("title") or "video"

    if data.get("url") and data.get("format_id") and _has_video_and_audio(data):
        if _is_direct_url(data):
            _upsert_format(
                formats,
                {
                    "formatId": data["format_id"],
                    "ext": data.get("ext") or "mp4",
                    "quality": _format_quality(data),
                    "filesize": data.get("filesize") or data.get("filesize_approx"),
                    "url": data["url"],
                    "vcodec": data.get("vcodec") or "none",
                    "acodec": data.get("acodec") or "none",
                    "type": "video",
                },
                prefer_direct=True,
            )
        else:
            _upsert_format(
                formats,
                {
                    "formatId": data["format_id"],
                    "ext": data.get("ext") or "mp4",
                    "quality": _format_quality(data),
                    "filesize": data.get("filesize") or data.get("filesize_approx"),
                    "url": _build_download_url(api_base_url, page_url, data["format_id"], title),
                    "vcodec": data.get("vcodec") or "none",
                    "acodec": data.get("acodec") or "none",
                    "type": "video",
                    "needsMerge": True,
                },
            )

    for entry in data.get("formats") or []:
        if not entry.get("url") or not entry.get("format_id") or not _has_video_and_audio(entry):
            continue

        if _is_direct_url(entry):
            _upsert_format(
                formats,
                {
                    "formatId": entry["format_id"],
                    "ext": entry.get("ext") or "mp4",
                    "quality": _format_quality(entry),
                    "filesize": entry.get("filesize") or entry.get("filesize_approx"),
                    "url": entry["url"],
                    "vcodec": entry.get("vcodec") or "none",
                    "acodec": entry.get("acodec") or "none",
                    "type": "video",
                },
                prefer_direct=True,
            )
            continue

        _upsert_format(
            formats,
            {
                "formatId": entry["format_id"],
                "ext": entry.get("ext") or "mp4",
                "quality": _format_quality(entry),
                "filesize": entry.get("filesize") or entry.get("filesize_approx"),
                "url": _build_download_url(api_base_url, page_url, entry["format_id"], title),
                "vcodec": entry.get("vcodec") or "none",
                "acodec": entry.get("acodec") or "none",
                "type": "video",
                "needsMerge": True,
            },
        )

    return formats


def _build_format_map(data: dict[str, Any], api_base_url: str) -> dict[str, dict[str, Any]]:
    formats: dict[str, dict[str, Any]] = {}

    for item in _collect_direct_combined_formats(data.get("formats") or []):
        _upsert_format(formats, item, prefer_direct=True)

    _collect_merged_formats(data, api_base_url, formats)
    _collect_stream_combined_formats(data, api_base_url, formats)
    _add_universal_fallback(data, api_base_url, formats)

    return formats


def _finalize_formats(formats: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        formats.values(),
        key=lambda item: int("".join(ch for ch in item["quality"] if ch.isdigit()) or 0),
        reverse=True,
    )[:8]


def _run_ytdlp(args: list[str], timeout_sec: int = EXTRACT_TIMEOUT_SEC) -> str:
    if not shutil.which(YTDLP_BIN):
        raise RuntimeError("yt-dlp is not installed on the server.")

    try:
        result = subprocess.run(
            [YTDLP_BIN, *args],
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Extraction timed out. Try again or use a different URL.") from exc

    if result.returncode != 0:
        message = (result.stderr or result.stdout or f"yt-dlp exited with code {result.returncode}").strip()
        raise RuntimeError(message)

    return result.stdout


def _run_ytdlp_json(args: list[str]) -> dict[str, Any]:
    try:
        return json.loads(_run_ytdlp(args))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Failed to parse yt-dlp output.") from exc


def _extract_ytdlp_json(url: str, extra_args: list[str] | None = None) -> dict[str, Any]:
    youtube_args = _youtube_pot_args() if _is_youtube_url(url) else []
    args = [*_base_ytdlp_args(), *youtube_args, *(extra_args or []), "--dump-single-json", url]
    return _run_ytdlp_json(args)


def extract_media(url: str, api_base_url: str) -> dict[str, Any]:
    normalized_url = normalize_media_url(url)
    client_fallbacks = _youtube_client_fallbacks() if _is_youtube_url(normalized_url) else [[]]

    data: dict[str, Any] | None = None
    last_error: RuntimeError | None = None

    for client_args in client_fallbacks:
        try:
            data = _extract_ytdlp_json(normalized_url, client_args)
            break
        except RuntimeError as exc:
            last_error = exc
            if not _is_youtube_url(normalized_url) or not _is_youtube_bot_block(str(exc)):
                raise

    if data is None:
        raise RuntimeError(_friendly_ytdlp_error(str(last_error or "YouTube extraction failed.")))

    formats = _build_format_map(data, api_base_url)

    if not formats:
        data = _extract_ytdlp_json(normalized_url, ["-f", "b"])
        formats = _collect_from_selected_metadata(data, api_base_url)
        _add_universal_fallback(data, api_base_url, formats)

    result_formats = _finalize_formats(formats)
    if not result_formats:
        raise RuntimeError("No downloadable formats found. Try another link or platform.")

    return {
        "id": data.get("id") or "",
        "title": data.get("title") or "Untitled",
        "thumbnail": data.get("thumbnail"),
        "duration": data.get("duration"),
        "uploader": data.get("uploader"),
        "webpageUrl": data.get("webpage_url") or normalized_url,
        "formats": result_formats,
    }


def _safe_filename(title: str) -> str:
    cleaned = re.sub(r"[^\w\s.-]", "", title).strip()[:80]
    return cleaned or "video"


def merge_and_get_path(url: str, format_selector: str, title: str) -> tuple[Path, tempfile.TemporaryDirectory[str]]:
    tmp_dir = tempfile.TemporaryDirectory(prefix="zeroads-")
    output_template = str(Path(tmp_dir.name) / "download.%(ext)s")

    _run_ytdlp(
        [
            *_base_ytdlp_args(),
            *(_youtube_pot_args() if _is_youtube_url(url) else []),
            "-f",
            format_selector,
            "--merge-output-format",
            "mp4",
            "-o",
            output_template,
            url,
        ],
        timeout_sec=MERGE_TIMEOUT_SEC,
    )

    files = [path for path in Path(tmp_dir.name).iterdir() if not path.name.endswith(".part")]
    if not files:
        tmp_dir.cleanup()
        raise RuntimeError("Merge finished but no output file was created.")

    return files[0], tmp_dir
