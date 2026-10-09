"""In-memory sliding-window rate limiting.

Per process: fine for one API instance. Several instances would each keep their own
counts (a shared store such as Redis would be needed to make limits global).
"""

import threading
import time
from collections import deque
from collections.abc import Callable, Hashable


class SlidingWindowLimiter:
    def __init__(self, limit: Callable[[], int], window_seconds: Callable[[], float]):
        # Callables so limits follow the (cached, test-patchable) settings.
        self._limit = limit
        self._window = window_seconds
        self._hits: dict[Hashable, deque[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def _prune(self, key: Hashable, now: float) -> deque[float]:
        q = self._hits.setdefault(key, deque())
        cutoff = now - self._window()
        while q and q[0] <= cutoff:
            q.popleft()
        return q

    def retry_after(self, key: Hashable) -> int:
        """Seconds until `key` may try again (0 = allowed). Doesn't count an attempt."""
        with self._lock:
            now = time.monotonic()
            q = self._prune(key, now)
            if len(q) < self._limit():
                return 0
            return max(1, int(q[0] + self._window() - now) + 1)

    def hit(self, key: Hashable) -> int:
        """Counts an attempt. Returns 0 if it was allowed, else seconds to wait."""
        with self._lock:
            now = time.monotonic()
            q = self._prune(key, now)
            self._sweep(now)
            if len(q) >= self._limit():
                return max(1, int(q[0] + self._window() - now) + 1)
            q.append(now)
            return 0

    def reset(self, key: Hashable) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()

    def _sweep(self, now: float) -> None:
        # Drop idle keys now and then so memory stays bounded.
        self._calls += 1
        if self._calls % 1000:
            return
        cutoff = now - self._window()
        for key in [k for k, q in self._hits.items() if not q or q[-1] <= cutoff]:
            del self._hits[key]
