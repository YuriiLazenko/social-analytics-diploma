"""
Redis worker: забирає завдання NLP з черги (узгодження з архітектурою Redis/RabbitMQ у записці).
Потрібен Redis і змінна REDIS_URL. Запуск окремого процесу:
  REDIS_URL=redis://127.0.0.1:6379 python worker.py
"""

from __future__ import annotations

import json
import os
import sys
import time

import redis

from analyzer import run_analyze_dict

REDIS_URL = os.environ.get("REDIS_URL", "").strip()
QUEUE_KEY = os.environ.get("NLP_QUEUE_KEY", "social:nlp:jobs")
RESULT_PREFIX = os.environ.get("NLP_RESULT_PREFIX", "social:nlp:result:")


def main():
    if not REDIS_URL:
        print("Встановіть REDIS_URL для worker.py", file=sys.stderr)
        sys.exit(1)

    r = redis.from_url(REDIS_URL, decode_responses=True)
    print(f"NLP worker слухає {QUEUE_KEY} ({REDIS_URL})")

    while True:
        try:
            item = r.brpop(QUEUE_KEY, timeout=30)
            if item is None:
                continue
            _, raw = item
            job = json.loads(raw)
            job_id = job.get("job_id")
            body = job.get("body")
            if not job_id or body is None:
                continue
            t0 = time.time()
            result = run_analyze_dict(body)
            r.setex(
                f"{RESULT_PREFIX}{job_id}",
                3600,
                json.dumps(result, ensure_ascii=False),
            )
            dt = round(time.time() - t0, 2)
            print(f"job {job_id} готово за {dt}s")
        except redis.RedisError as e:
            print("Redis:", e, file=sys.stderr)
            time.sleep(2)
        except Exception as e:
            print("Помилка:", e, file=sys.stderr)
            time.sleep(1)


if __name__ == "__main__":
    main()
