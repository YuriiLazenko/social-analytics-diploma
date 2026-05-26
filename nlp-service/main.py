"""
NLP-мікросервіс (FastAPI): проксує до analyzer.run_analyze_dict.
Збір Telegram — окремий маршрут.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

_BASE = Path(__file__).resolve().parent
# override=True — інакше shell/IDE можуть залишити старий TELEGRAM_CHANNELS без перезапису з .env.
load_dotenv(_BASE / ".env", override=True)
load_dotenv(_BASE.parent / ".env", override=True)

from analyzer import MODEL_DEFAULT, MODEL_UK, run_analyze_dict

app = FastAPI(title="Social Analytics NLP", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PostIn(BaseModel):
    text: str
    created_at: Optional[str] = None
    source: Optional[str] = "unknown"


class Options(BaseModel):
    top_keywords: int = 12
    top_words: int = 25
    lang_filter: str = "all"


class AnalyzeBody(BaseModel):
    keyword: str = ""
    posts: List[PostIn] = Field(default_factory=list)
    options: Options = Field(default_factory=Options)


class TelegramCollectIn(BaseModel):
    keyword: str = Field(min_length=1, max_length=400)
    limit: int = Field(default=100, ge=1, le=1000)


@app.get("/health")
def health():
    return {
        "ok": True,
        "framework": "fastapi",
        "models": {"default": MODEL_DEFAULT, "uk": MODEL_UK},
    }


@app.post("/analyze")
def analyze(body: AnalyzeBody) -> dict[str, Any]:
    payload = {
        "keyword": body.keyword,
        "posts": [p.model_dump() for p in body.posts],
        "options": body.options.model_dump(),
    }
    return run_analyze_dict(payload)


@app.post("/collect/telegram")
async def collect_telegram_route(body: TelegramCollectIn) -> dict[str, Any]:
    from telegram_collect import collect_telegram_posts

    try:
        lim = max(1, min(body.limit, 1000))
        posts = await collect_telegram_posts(body.keyword.strip(), lim)
        return {"ok": True, "posts": posts}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
