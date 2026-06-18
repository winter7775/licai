"""Fetch Eastmoney public JSON endpoints for the local trading-system API."""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any


HEADERS = {
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://quote.eastmoney.com/",
    "User-Agent": "Mozilla/5.0 MingyuanTradingSystem/0.1",
}


def headers_for_url(url: str) -> dict[str, str]:
    headers = dict(HEADERS)
    if "finance.sina.com.cn" in url:
        headers["Referer"] = "https://finance.sina.com.cn/"
    elif "gtimg.cn" in url:
        headers["Referer"] = "https://gu.qq.com/"
    return headers


def fetch_json(url: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers=headers_for_url(url))
            with urllib.request.urlopen(request, timeout=45) as response:
                return {
                    "ok": True,
                    "data": json.loads(response.read().decode("utf-8")),
                }
        except Exception as error:  # noqa: BLE001 - returned to the local API
            last_error = error
            if attempt < 3:
                time.sleep(0.8 * (attempt + 1))
    return {"ok": False, "error": str(last_error)}


def main() -> None:
    payload = json.load(sys.stdin)
    urls = payload.get("urls", [])
    workers = min(max(int(payload.get("workers", 4)), 1), 6)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(fetch_json, urls))
    json.dump({"results": results}, sys.stdout, ensure_ascii=True)


if __name__ == "__main__":
    main()
