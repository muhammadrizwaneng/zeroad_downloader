import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

EXTRACT_TIMEOUT_SEC = 240
MERGE_TIMEOUT_SEC = 300
YTDLP_BIN = os.environ.get("YTDLP_PATH", "yt-dlp")

FAST_ARGS = [
    "--no-playlist",
    "--no-warnings",
    "--extractor-retries",
    "1",
    "--socket-timeout",
    "15",
]

# One attempt — Render free CPU is too slow for multiple yt-dlp runs.
YOUTUBE_PLAYER_CLIENTS: list[str | None] = [None]

_cookies_file_path: str | None = None


def _is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host.endswith("youtube.com") or host == "youtu.be" or host.endswith(".youtu.be")


def _is_facebook_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return "facebook.com" in host or "fb.watch" in host


def _pot_provider_ready() -> bool:
    pot_url = os.environ.get("YTDLP_POT_PROVIDER_URL", "http://127.0.0.1:4416").strip()
    if not pot_url:
        return False
    if os.environ.get("YTDLP_DISABLE_POT", "").lower() in {"1", "true", "yes"}:
        return False
    try:
        request = urllib.request.Request(
            f"{pot_url.rstrip('/')}/get_pot",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=4) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


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


def _youtube_extractor_args(player_client: str | None = None) -> list[str]:
    args: list[str] = []
    # Skip slow/broken POT when cookies are available or provider is down.
    if _pot_provider_ready() and not _ensure_cookies_file():
        pot_url = os.environ.get("YTDLP_POT_PROVIDER_URL", "http://127.0.0.1:4416").strip()
        if pot_url:
            args.extend(["--extractor-args", f"youtubepot-bgutilhttp:base_url={pot_url}"])
    if player_client:
        args.extend(["--extractor-args", f"youtube:player_client={player_client}"])
    return args


def _youtube_player_clients() -> list[str | None]:
    return YOUTUBE_PLAYER_CLIENTS


def _youtube_client_fallbacks() -> list[str | None]:
    return _youtube_player_clients()


def _is_youtube_bot_block(message: str) -> bool:
    lowered = message.lower()
    return "sign in to confirm" in lowered or "not a bot" in lowered


def _is_youtube_format_error(message: str) -> bool:
    lowered = message.lower()
    return "requested format is not available" in lowered or "no video formats" in lowered


def _is_extract_timeout(message: str) -> bool:
    return "timed out" in message.lower()


def _is_retryable_youtube_error(message: str) -> bool:
    if _is_extract_timeout(message):
        return False
    return _is_youtube_bot_block(message) or _is_youtube_format_error(message)


def _is_facebook_error(message: str) -> bool:
    lowered = message.lower()
    return "[facebook]" in lowered or "cannot parse data" in lowered


def _friendly_ytdlp_error(message: str) -> str:
    if _is_youtube_bot_block(message):
        return (
            "YouTube blocked this download from the server. "
            "Add fresh YouTube cookies to Render (YTDLP_COOKIES), or try TikTok/Instagram."
        )
    if _is_facebook_error(message):
        return (
            "Facebook video could not be read. Use a public video link, or add "
            "Facebook cookies to Render (YTDLP_COOKIES)."
        )
    if _is_youtube_format_error(message):
        return "YouTube formats could not be read for this video. Try again or use a different link."
    if _is_extract_timeout(message):
        return (
            "Extraction timed out. On Render free tier the server may be waking up — "
            "wait a few seconds and tap Extract again."
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
        entry for entry in formats if entry.get("format_id") and _is_audio_only(entry)
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
        if not entry.get("format_id"):
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


def _add_youtube_quality_presets(
    data: dict[str, Any],
    api_base_url: str,
    formats: dict[str, dict[str, Any]],
) -> None:
    """Offer yt-dlp format strings when individual stream IDs are unavailable (common on cloud IPs)."""
    page_url = data.get("webpage_url") or ""
    title = data.get("title") or "video"
    presets: list[tuple[str, str, bool]] = [
        ("Best available", "best[ext=mp4]/best", False),
        ("1080p", "best[height<=1080][ext=mp4]/best[ext=mp4]/best", False),
        ("720p", "best[height<=720][ext=mp4]/best[ext=mp4]/best", False),
        ("480p", "best[height<=480][ext=mp4]/best[ext=mp4]/best", False),
    ]

    for quality, format_id, needs_merge in presets:
        _upsert_format(
            formats,
            {
                "formatId": format_id,
                "ext": "mp4",
                "quality": quality,
                "url": _build_download_url(api_base_url, page_url, format_id, title),
                "vcodec": "auto",
                "acodec": "auto",
                "type": "video",
                "needsMerge": needs_merge,
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
            "formatId": "best",
            "ext": "mp4",
            "quality": "Best available",
            "url": _build_download_url(api_base_url, page_url, "best", title),
            "vcodec": "auto",
            "acodec": "auto",
            "type": "video",
            "needsMerge": False,
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
        if not entry.get("format_id") or not _has_video_and_audio(entry):
            continue

        if entry.get("url") and _is_direct_url(entry):
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

    if _is_youtube_url(data.get("webpage_url") or ""):
        _add_youtube_quality_presets(data, api_base_url, formats)

    _add_universal_fallback(data, api_base_url, formats)

    return formats


def _finalize_formats(formats: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    def sort_key(item: dict[str, Any]) -> tuple[bool, int]:
        digits = int("".join(ch for ch in item["quality"] if ch.isdigit()) or 0)
        # Prefer direct / non-merge formats first (fast CDN download).
        return (bool(item.get("needsMerge")), -digits)

    return sorted(formats.values(), key=sort_key)[:8]


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
        parsed = json.loads(_run_ytdlp(args))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Failed to parse yt-dlp output.") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Requested format is not available.")
    return parsed


def _extract_ytdlp_json(url: str, player_client: str | None = None) -> dict[str, Any]:
    youtube_args = _youtube_extractor_args(player_client) if _is_youtube_url(url) else []
    extra: list[str] = []
    if _is_youtube_url(url):
        extra.append("--ignore-no-formats-error")
    args = [*_base_ytdlp_args(), *youtube_args, *extra, "--dump-single-json", url]
    return _run_ytdlp_json(args)


def extract_media(url: str, api_base_url: str) -> dict[str, Any]:
    normalized_url = normalize_media_url(url)
    client_fallbacks = _youtube_client_fallbacks() if _is_youtube_url(normalized_url) else [None]

    data: dict[str, Any] | None = None
    last_error: RuntimeError | None = None

    for player_client in client_fallbacks:
        try:
            data = _extract_ytdlp_json(normalized_url, player_client)
            break
        except RuntimeError as exc:
            last_error = exc
            if not _is_youtube_url(normalized_url) or not _is_retryable_youtube_error(str(exc)):
                raise

    if data is None:
        raise RuntimeError(_friendly_ytdlp_error(str(last_error or "YouTube extraction failed.")))

    formats = _build_format_map(data, api_base_url)

    if not formats:
        formats = _collect_from_selected_metadata(data, api_base_url)
        _collect_merged_formats(data, api_base_url, formats)
        _collect_stream_combined_formats(data, api_base_url, formats)
        if _is_youtube_url(normalized_url):
            _add_youtube_quality_presets(data, api_base_url, formats)
        _add_universal_fallback(data, api_base_url, formats)

    if _is_youtube_url(normalized_url):
        _attach_youtube_direct_urls(
            formats,
            data.get("webpage_url") or normalized_url,
            data,
        )

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


def _url_is_api_download(url: str) -> bool:
    return "/api/download" in url


def _pick_direct_url_from_formats(
    formats: list[dict[str, Any]],
    format_selector: str,
) -> str | None:
    """Pick a progressive CDN URL already returned by extract — no extra yt-dlp/POT."""
    normalized = _normalize_download_format(format_selector)

    for entry in formats:
        if entry.get("format_id") == format_selector and entry.get("url") and _is_direct_url(entry):
            return entry["url"]

    height_limit: int | None = None
    height_match = re.search(r"height<=(\d+)", normalized)
    if height_match:
        height_limit = int(height_match.group(1))

    require_mp4 = "ext=mp4" in normalized.lower()

    candidates: list[dict[str, Any]] = []
    for entry in formats:
        if not entry.get("url") or not entry.get("format_id"):
            continue
        if not _has_video_and_audio(entry) or not _is_direct_url(entry):
            continue
        height = entry.get("height") or 0
        if height_limit is not None and height > height_limit:
            continue
        ext = (entry.get("ext") or "").lower()
        if require_mp4 and ext not in {"mp4", "m4a", "3gp"}:
            continue
        candidates.append(entry)

    if not candidates:
        return None

    best_entry = max(
        candidates,
        key=lambda entry: (
            entry.get("height") or 0,
            entry.get("filesize") or entry.get("filesize_approx") or 0,
        ),
    )
    return best_entry["url"]


def _youtube_format_fallbacks(format_selector: str) -> list[str]:
    normalized = _normalize_download_format(format_selector)
    fallbacks = [normalized]
    height_match = re.search(r"height<=(\d+)", normalized)
    if height_match:
        height = height_match.group(1)
        fallbacks.append(f"best[height<={height}]/best")
        fallbacks.append(f"best[height<={height}]")
    fallbacks.extend(["best[ext=mp4]/best", "best", "18", "22", "b"])

    seen: set[str] = set()
    unique: list[str] = []
    for item in fallbacks:
        if item not in seen:
            seen.add(item)
            unique.append(item)
    return unique


def _normalize_download_format(format_selector: str) -> str:
    """Convert legacy merge selectors to single-file mp4 formats."""
    if "+" in format_selector or "bestvideo" in format_selector.lower():
        height_match = re.search(r"height<=(\d+)", format_selector)
        if height_match:
            height = height_match.group(1)
            return f"best[height<={height}][ext=mp4]/best[ext=mp4]/best"
        return "best[ext=mp4]/best"
    return format_selector


def _get_direct_url_once(url: str, format_selector: str) -> str | None:
    """Resolve CDN URL via yt-dlp -g with progressive format fallbacks."""
    youtube_args = _youtube_extractor_args(None) if _is_youtube_url(url) else []
    extra: list[str] = []
    if _is_youtube_url(url):
        extra.append("--ignore-no-formats-error")

    for selector in _youtube_format_fallbacks(format_selector):
        try:
            stdout = _run_ytdlp(
                [
                    *_base_ytdlp_args(),
                    *youtube_args,
                    *extra,
                    "-f",
                    selector,
                    "-g",
                    "--no-playlist",
                    url,
                ],
                timeout_sec=90,
            )
            lines = [line.strip() for line in stdout.splitlines() if line.strip().startswith("http")]
            if lines:
                mp4_line = next(
                    (line for line in lines if "googlevideo.com/videoplayback" in line),
                    None,
                )
                return mp4_line or lines[0]
        except RuntimeError:
            continue
    return None


def _attach_youtube_direct_urls(
    formats: dict[str, dict[str, Any]],
    page_url: str,
    extract_data: dict[str, Any],
) -> None:
    """Resolve CDN URLs at extract time — prefer JSON URLs, minimal extra yt-dlp calls."""
    raw_formats = extract_data.get("formats") or []
    pending_selectors: dict[str, list[dict[str, Any]]] = {}

    for fmt in formats.values():
        current_url = fmt.get("url") or ""
        if current_url and not _url_is_api_download(current_url):
            fmt["needsMerge"] = False
            continue

        format_id = fmt.get("formatId") or "best[ext=mp4]/best"
        direct = _pick_direct_url_from_formats(raw_formats, format_id)
        if direct:
            fmt["url"] = direct
            fmt["needsMerge"] = False
            continue

        pending_selectors.setdefault(format_id, []).append(fmt)

    for format_id, targets in pending_selectors.items():
        direct = _get_direct_url_once(page_url, format_id)
        if not direct:
            continue
        for target in targets:
            target["url"] = direct
            target["needsMerge"] = False


def _safe_filename(title: str) -> str:
    cleaned = re.sub(r"[^\w\s.-]", "", title).strip()[:80]
    return cleaned or "video"


def resolve_direct_download_url(url: str, format_selector: str) -> str | None:
    """Get a direct CDN URL — try -g first, then reuse extract JSON as fallback."""
    direct = _get_direct_url_once(url, format_selector)
    if direct:
        return direct

    if _is_youtube_url(url):
        try:
            data = _extract_ytdlp_json(url, None)
            return _pick_direct_url_from_formats(data.get("formats") or [], format_selector)
        except RuntimeError:
            return None
    return None


def _friendly_download_error(message: str) -> str:
    if _is_youtube_format_error(message):
        return (
            "Download failed — this quality is not available for this video. "
            "Go back and try another format (e.g. 720p or Best available)."
        )
    if _is_extract_timeout(message):
        return "Download timed out. Try again or pick a lower quality."
    return _friendly_ytdlp_error(message)


def _run_ytdlp_merge(
    url: str,
    format_selector: str,
    output_template: str,
    player_client: str | None = None,
) -> None:
    youtube_args = _youtube_extractor_args(player_client) if _is_youtube_url(url) else []
    extra: list[str] = []
    if _is_youtube_url(url):
        extra.append("--ignore-no-formats-error")
    _run_ytdlp(
        [
            *_base_ytdlp_args(),
            *youtube_args,
            *extra,
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


def merge_and_get_path(url: str, format_selector: str, title: str) -> tuple[Path, tempfile.TemporaryDirectory[str]]:
    tmp_dir = tempfile.TemporaryDirectory(prefix="zeroads-")
    output_template = str(Path(tmp_dir.name) / "download.%(ext)s")

    selector = _normalize_download_format(format_selector)
    last_error: RuntimeError | None = None

    for candidate in _youtube_format_fallbacks(selector):
        try:
            _run_ytdlp_merge(url, candidate, output_template, None)
            files = [path for path in Path(tmp_dir.name).iterdir() if not path.name.endswith(".part")]
            if files:
                return files[0], tmp_dir
            raise RuntimeError("Merge finished but no output file was created.")
        except RuntimeError as exc:
            last_error = exc
            if candidate == _youtube_format_fallbacks(selector)[-1]:
                break

    tmp_dir.cleanup()
    raise last_error or RuntimeError("Download failed.")
