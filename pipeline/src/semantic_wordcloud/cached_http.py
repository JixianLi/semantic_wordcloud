import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

USER_AGENT = "semantic-wordcloud-research/0.1 (academic word-cloud project)"
RETRY_STATUSES = {429, 503}
FIRST_BACKOFF_SECONDS = 30.0
MAX_ATTEMPTS = 5   # 30 + 60 + 120 + 240 s of waiting before giving up


class NotFoundError(Exception):
    """A 404, live or remembered: the cache keeps a marker so a missing page is not requested again."""


class CachedHttpClient:
    """GET with a permanent on-disk cache and a minimum interval between requests to the same host.

    Cache layout: <cache_dir>/<host>/<sha256(url)>.body plus a .json sidecar holding the url and status, so a cached
    response is never fetched again and the raw corpus stays inspectable.
    """

    def __init__(self, cache_dir: Path, seconds_between_requests_by_host: dict[str, float], default_seconds: float = 1.0):
        self.cache_dir = cache_dir
        self.seconds_between_requests_by_host = seconds_between_requests_by_host
        self.default_seconds = default_seconds
        self.last_request_time_by_host: dict[str, float] = {}
        self.client = httpx.Client(headers={"User-Agent": USER_AGENT}, follow_redirects=True, timeout=60)

    def _paths(self, url: str) -> tuple[Path, Path]:
        host = urlparse(url).netloc
        digest = hashlib.sha256(url.encode()).hexdigest()
        directory = self.cache_dir / host
        return directory / f"{digest}.body", directory / f"{digest}.json"

    def _wait_for_host(self, host: str) -> None:
        interval = self.seconds_between_requests_by_host.get(host, self.default_seconds)
        elapsed = time.monotonic() - self.last_request_time_by_host.get(host, float("-inf"))
        if elapsed < interval:
            time.sleep(interval - elapsed)
        self.last_request_time_by_host[host] = time.monotonic()

    def get(self, url: str) -> bytes:
        body_path, meta_path = self._paths(url)
        if body_path.exists():
            return body_path.read_bytes()
        not_found_path = body_path.with_suffix(".404")
        if not_found_path.exists():
            raise NotFoundError(url)
        response = self._get_with_backoff(url)
        if response.status_code == 404:
            not_found_path.parent.mkdir(parents=True, exist_ok=True)
            not_found_path.write_text(url)
            raise NotFoundError(url)
        response.raise_for_status()
        body_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps({"url": url, "status": response.status_code, "fetched_at": time.time()}))
        # Write-then-rename: an interrupted run must not leave a truncated body that later reads as a cache hit.
        partial_path = body_path.with_suffix(".partial")
        partial_path.write_bytes(response.content)
        partial_path.replace(body_path)
        return response.content

    def _get_with_backoff(self, url: str) -> httpx.Response:
        """A 429 (too many requests) or 503 is retried after Retry-After seconds when the server gives them, else after
        FIRST_BACKOFF_SECONDS doubling per attempt, up to MAX_ATTEMPTS. Neither status is ever cached."""
        host = urlparse(url).netloc
        for attempt in range(MAX_ATTEMPTS):
            self._wait_for_host(host)
            response = self.client.get(url)
            if response.status_code not in RETRY_STATUSES:
                return response
            retry_after = response.headers.get("retry-after", "")
            delay = float(retry_after) if retry_after.isdigit() else FIRST_BACKOFF_SECONDS * 2 ** attempt
            if attempt < MAX_ATTEMPTS - 1:
                print(f"{response.status_code} from {host}; retrying in {delay:.0f} s")
                time.sleep(delay)
        return response

    def get_text(self, url: str) -> str:
        return self.get(url).decode("utf-8", errors="replace")

    def get_json(self, url: str):
        return json.loads(self.get(url))
