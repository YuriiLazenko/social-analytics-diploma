"""
Альтернативний вхід (Flask) — відповідає формулюванням пояснювальної записки
(Python/Flask для NLP). Логіка та ж, що у FastAPI (модуль analyzer).
Запуск: python flask_app.py  або  flask --app flask_app run --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

_BASE = Path(__file__).resolve().parent
load_dotenv(_BASE / ".env", override=True)
load_dotenv(_BASE.parent / ".env", override=True)

from analyzer import MODEL_DEFAULT, MODEL_UK, run_analyze_dict

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "framework": "flask",
            "models": {"default": MODEL_DEFAULT, "uk": MODEL_UK},
        }
    )


@app.post("/analyze")
def analyze():
    body = request.get_json(force=True, silent=True) or {}
    return jsonify(run_analyze_dict(body))


@app.post("/collect/telegram")
def collect_telegram():
    import asyncio

    from telegram_collect import collect_telegram_posts

    body = request.get_json(force=True, silent=True) or {}
    keyword = (body.get("keyword") or "").strip()
    limit = max(1, min(int(body.get("limit") or 100), 1000))
    if not keyword:
        return jsonify({"ok": False, "error": "keyword required"}), 400
    try:
        posts = asyncio.run(collect_telegram_posts(keyword, limit))
        return jsonify({"ok": True, "posts": posts})
    except RuntimeError as e:
        return jsonify({"ok": False, "detail": str(e)}), 503


if __name__ == "__main__":
    port = int(os.environ.get("FLASK_PORT", "8000"))
    app.run(host="127.0.0.1", port=port, threaded=True)
