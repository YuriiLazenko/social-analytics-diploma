"""
Ядро NLP: Ukr-RoBERTa-сумісна гілка для української, mBERT stars для інших мов,
лематизація (pymorphy3 для uk), KeyBERT, LDA-теми, TF-IDF як резерв.
"""

from __future__ import annotations

import os
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, List, Optional

import numpy as np
from pathlib import Path

from dotenv import load_dotenv
from langdetect import LangDetectException, detect
from sklearn.decomposition import LatentDirichletAllocation
from sklearn.feature_extraction.text import TfidfVectorizer
from transformers import pipeline

_BASE = Path(__file__).resolve().parent
load_dotenv(_BASE / ".env", override=True)
load_dotenv(_BASE.parent / ".env", override=True)

# Опційна лематизація української
try:
    from pymorphy3 import MorphAnalyzer

    _morph_uk: Optional[MorphAnalyzer] = None

    def _get_morph_uk() -> MorphAnalyzer:
        global _morph_uk
        if _morph_uk is None:
            _morph_uk = MorphAnalyzer(lang="uk")
        return _morph_uk
except ImportError:
    _get_morph_uk = None  # type: ignore

# Моделі (env для узгодження з пояснювальною запискою)
MODEL_DEFAULT = os.environ.get(
    "SENTIMENT_MODEL_DEFAULT",
    "nlptown/bert-base-multilingual-uncased-sentiment",
)
# Класифікатор на українськомовних соцданих (AutoTrain, RoBERTa-архітектура)
MODEL_UK = os.environ.get(
    "SENTIMENT_MODEL_UK",
    "dmytrobaida/autotrain-ukrainian-telegram-sentiment-analysis-70044138081",
)
KEYBERT_MODEL = os.environ.get(
    "KEYBERT_MODEL",
    "paraphrase-multilingual-MiniLM-L12-v2",
)

_pipeline_default = None
_pipeline_uk = None
_keybert_model = None


def get_pipe_default():
    global _pipeline_default
    if _pipeline_default is None:
        _pipeline_default = pipeline(
            "sentiment-analysis",
            model=MODEL_DEFAULT,
            truncation=True,
        )
    return _pipeline_default


def get_pipe_uk():
    global _pipeline_uk
    if _pipeline_uk is None:
        _pipeline_uk = pipeline(
            "text-classification",
            model=MODEL_UK,
            truncation=True,
        )
    return _pipeline_uk


def get_keybert():
    global _keybert_model
    if _keybert_model is None:
        from keybert import KeyBERT

        _keybert_model = KeyBERT(model=KEYBERT_MODEL)
    return _keybert_model


STOP = set(
    """
    the a an and or but in on at to for of is are was were be been being
    it this that these those with as by from into through during before after
    above below up down out off over under again further then once here there
    when where why how all both each few more most other some such no nor not
    only own same so than too very can will just don should now
    i me my we our you your he she they them his her their what which who whom
    та але щоб бо ще як або для про при від по із без над між уже також це цей ця
    не що як до де він вона вони ми ви ти нас вас їх й або ж би лише там тут уже
    http https www com ua ru
    """.split(),
)

EMOJI_BUCKETS: dict[str, str] = {
    # positive
    "❤️": "positive",
    "❤": "positive",
    "♥": "positive",
    "💕": "positive",
    "💖": "positive",
    "💚": "positive",
    "💙": "positive",
    "💛": "positive",
    "😍": "positive",
    "🥰": "positive",
    "😊": "positive",
    "😄": "positive",
    "😁": "positive",
    "😂": "positive",
    "🤣": "positive",
    "👍": "positive",
    "🔥": "positive",
    "👏": "positive",
    "🙏": "positive",
    "💯": "positive",
    "🎉": "positive",
    "✅": "positive",
    # neutral
    "😐": "neutral",
    "😶": "neutral",
    "🙂": "neutral",
    "🤔": "neutral",
    "😑": "neutral",
    "🫤": "neutral",
    "👀": "neutral",
    "🤷": "neutral",
    # negative
    "😡": "negative",
    "🤬": "negative",
    "😠": "negative",
    "👎": "negative",
    "💔": "negative",
    "😢": "negative",
    "😭": "negative",
    "😞": "negative",
    "😤": "negative",
    "😒": "negative",
    "😱": "negative",
    "💩": "negative",
    "❌": "negative",
}


def clean_word(w: str) -> str:
    w = w.lower().strip()
    w = re.sub(r"^[^\w]+|[^\w]+$", "", w, flags=re.UNICODE)
    return w


def lemmatize_token(token: str, lang: str) -> str:
    if _get_morph_uk is None:
        return token
    if lang.startswith("uk"):
        try:
            p = _get_morph_uk().parse(token)[0]
            return p.normal_form if p.normal_form else token
        except Exception:
            return token
    return token


def tokenize_for_freq(text: str, lang_hint: str = "") -> List[str]:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[@#]", " ", text)
    parts = re.findall(r"[\w']+", text.lower(), flags=re.UNICODE)
    lf = lang_hint.lower()
    out = []
    for p in parts:
        p = clean_word(p)
        if len(p) < 2:
            continue
        if p.isdigit():
            continue
        p = lemmatize_token(p, lf)
        if len(p) < 2:
            continue
        if p in STOP:
            continue
        out.append(p)
    return out


def bucket_from_stars(label: str, _score: float) -> str:
    s = (label or "").lower()
    m = re.search(r"([1-5])", s)
    if m:
        n = int(m.group(1))
        if n <= 2:
            return "negative"
        if n == 3:
            return "neutral"
        return "positive"
    if "neg" in s or "bad" in s:
        return "negative"
    return "neutral"


def bucket_from_uk_classifier(output: dict[str, Any]) -> str:
    """Бінарний класифікатор UA → три класи за порогами впевненості."""
    label = (output.get("label") or "").lower()
    score = float(output.get("score", 0.5))
    if "neutral" in label:
        return "neutral"
    if "positive" in label or label == "pos" or label.endswith("+") or "good" in label:
        return "positive" if score >= 0.45 else "neutral"
    if "negative" in label or label == "neg" or "bad" in label:
        return "negative" if score >= 0.45 else "neutral"
    # LABEL_0 / LABEL_1 — підтягуємо з id2label після першого прогону в метаданих
    if "neg" in label or label.endswith("_0"):
        return "negative" if score >= 0.55 else "neutral"
    if "pos" in label or label.endswith("_1"):
        return "positive" if score >= 0.55 else "neutral"
    return "neutral"


def safe_detect_lang(text: str) -> str:
    try:
        if not text or len(text.strip()) < 8:
            return "und"
        return detect(text[:4000])
    except LangDetectException:
        return "und"


def extract_emoji_signals(text: str) -> tuple[dict[str, int], Counter]:
    bucket_counts = {"positive": 0, "neutral": 0, "negative": 0}
    emoji_counter: Counter = Counter()
    if not text:
        return bucket_counts, emoji_counter

    normalized = unicodedata.normalize("NFKC", text)
    for ch in normalized:
        bucket = EMOJI_BUCKETS.get(ch)
        if not bucket:
            continue
        bucket_counts[bucket] += 1
        emoji_counter[ch] += 1
    return bucket_counts, emoji_counter


def blend_model_and_emoji_sentiment(model_bucket: str, emoji_counts: dict[str, int]) -> str:
    total = sum(emoji_counts.values())
    if total == 0:
        return model_bucket

    dominant = max(
        ("positive", "neutral", "negative"),
        key=lambda x: emoji_counts.get(x, 0),
    )
    dominant_count = emoji_counts.get(dominant, 0)
    second = sorted(emoji_counts.values(), reverse=True)[1] if total >= 2 else 0

    # Якщо модель нейтральна і є явний емоційний сигнал — довіряємо емоції.
    if model_bucket == "neutral" and dominant != "neutral" and dominant_count >= 1:
        return dominant

    # Якщо емодзі сильно переважають (на 2+), коригуємо навіть модель.
    if dominant_count >= second + 2 and dominant_count >= 2:
        return dominant

    return model_bucket


def parse_day(iso: Optional[str]) -> Optional[str]:
    if not iso:
        return None
    try:
        s = iso.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _use_uk_model(lang: str, text: str) -> bool:
    if lang.startswith("uk"):
        return True
    # Кирилиця + типові UA морфеми (дуже груба підказка)
    sample = text[:200]
    if re.search(r"[іїєґ]", sample, re.I):
        return True
    return False


def run_lda_topics(texts: List[str], n_topics: int = 5, n_words: int = 6) -> List[dict]:
    if len(texts) < 4:
        return []
    n_topics = max(2, min(n_topics, 8))
    try:
        vec = TfidfVectorizer(
            max_df=0.95,
            min_df=2,
            max_features=2000,
            ngram_range=(1, 2),
            token_pattern=r"(?u)\b\w\w+\b",
        )
        X = vec.fit_transform(texts)
        if X.shape[0] < n_topics:
            return []
        lda = LatentDirichletAllocation(
            n_components=n_topics,
            max_iter=15,
            learning_method="batch",
            random_state=42,
        )
        lda.fit(X)
        feats = np.array(vec.get_feature_names_out())
        topics_out = []
        for idx, topic in enumerate(lda.components_):
            top = np.argsort(topic)[::-1][:n_words]
            words = [str(feats[i]) for i in top if topic[i] > 0]
            topics_out.append({"id": idx, "label": f"Тема {idx + 1}", "words": words})
        return topics_out
    except ValueError:
        return []


def extract_keybert_phrases(texts: List[str], top_n: int = 15) -> List[str]:
    try:
        kb = get_keybert()
        blob = "\n".join(t[:500] for t in texts[:80])
        if len(blob.strip()) < 20:
            return []
        kws = kb.extract_keywords(
            blob,
            keyphrase_ngram_range=(1, 2),
            stop_words=list(STOP)[:80],
            top_n=top_n,
            use_mmr=True,
            diversity=0.45,
        )
        out = []
        for item in kws:
            if isinstance(item, tuple):
                out.append(str(item[0]))
            else:
                out.append(str(item))
        return out[:top_n]
    except Exception:
        return []


def run_analyze_dict(body: dict[str, Any]) -> dict[str, Any]:
    """Головна точка входу для FastAPI, Flask і Redis worker."""
    posts_raw = body.get("posts") or []
    opts = body.get("options") or {}
    top_keywords = int(opts.get("top_keywords", 12))
    top_words_n = int(opts.get("top_words", 25))
    lf = (opts.get("lang_filter") or "all").lower()

    posts = []
    for p in posts_raw:
        if isinstance(p, dict):
            posts.append(p)

    langs_raw: List[str] = []
    for p in posts:
        langs_raw.append(safe_detect_lang(p.get("text") or ""))

    kept_idx: List[int] = []
    for i, lab in enumerate(langs_raw):
        if lf == "all":
            kept_idx.append(i)
            continue
        if lab == "und":
            kept_idx.append(i)
            continue
        if lab.startswith(lf):
            kept_idx.append(i)

    filtered_posts = [posts[i] for i in kept_idx]
    filtered_langs = [langs_raw[i] for i in kept_idx]

    texts = [p.get("text") or "" for p in filtered_posts]
    if not texts:
        return {
            "summary": {
                "positive": 0,
                "neutral": 0,
                "negative": 0,
                "total": 0,
            },
            "keywords": [],
            "keywords_keybert": [],
            "topics": [],
            "top_words": [],
            "trend": [],
            "sentiment_breakdown": {"positive": 0, "neutral": 0, "negative": 0},
            "emotion_signals": {
                "positive": 0,
                "neutral": 0,
                "negative": 0,
                "total_hits": 0,
                "top_emojis": [],
            },
            "per_post": [],
            "records": [],
            "meta": {
                "models": {
                    "default": MODEL_DEFAULT,
                    "ukrainian_branch": MODEL_UK,
                    "keybert": KEYBERT_MODEL,
                },
                "note": "empty after language filter",
            },
        }

    pipe_def = get_pipe_default()
    pipe_uk = get_pipe_uk()

    per_post: List[dict[str, Any]] = []
    records: List[dict[str, Any]] = []
    counts = {"positive": 0, "neutral": 0, "negative": 0}
    emoji_bucket_totals = {"positive": 0, "neutral": 0, "negative": 0}
    emoji_totals: Counter = Counter()

    def _one(out: Any) -> dict[str, Any]:
        if isinstance(out, list) and out:
            return out[0]  # type: ignore[return-value]
        return out  # type: ignore[return-value]

    # Пакетні прогони змішані (uk / non-uk) — по одному посту для вибору пайплайна
    for p, lang in zip(filtered_posts, filtered_langs):
        text = p.get("text") or ""
        use_uk = _use_uk_model(lang, text)
        if use_uk:
            ro = _one(pipe_uk(text[:2048]))
            model_bucket = bucket_from_uk_classifier(ro)
            lbl = ro.get("label", "")
            score = float(ro.get("score", 0.0))
            model_used = MODEL_UK
        else:
            ro = _one(pipe_def(text[:2048]))
            lbl = ro.get("label") or ""
            score = float(ro.get("score", 0.0))
            model_bucket = bucket_from_stars(str(lbl), score)
            model_used = MODEL_DEFAULT

        emoji_counts, emoji_counter = extract_emoji_signals(text)
        bucket = blend_model_and_emoji_sentiment(model_bucket, emoji_counts)
        for b in ("positive", "neutral", "negative"):
            emoji_bucket_totals[b] += emoji_counts[b]
        emoji_totals.update(emoji_counter)

        counts[bucket] += 1
        row = {
            "sentiment": bucket,
            "model_sentiment": model_bucket,
            "label": lbl,
            "score": score,
            "lang": lang,
            "source": p.get("source") or "unknown",
            "snippet": text[:180],
            "sentiment_model": model_used,
            "emoji_signals": emoji_counts,
        }
        per_post.append(row)
        records.append(
            {
                "text": text[:400],
                "created_at": p.get("created_at"),
                "source": p.get("source") or "unknown",
                "lang": lang,
                "sentiment": bucket,
                "model_sentiment": model_bucket,
                "label": lbl,
                "score": score,
                "emoji_signals": emoji_counts,
            }
        )

    total = len(texts)
    pct = {k: round(100.0 * v / total, 1) for k, v in counts.items()}

    # TF-IDF (резерв і порівняння з KeyBERT)
    kw_n = max(3, min(top_keywords, 40))
    keywords_tfidf: List[str] = []
    if total >= 2:
        vec = TfidfVectorizer(
            max_df=0.85,
            min_df=1,
            ngram_range=(1, 2),
            token_pattern=r"(?u)\b\w\w+\b",
        )
        try:
            X = vec.fit_transform(texts)
            scores = np.asarray(X.mean(axis=0)).ravel()
            feats = np.array(vec.get_feature_names_out())
            top = np.argsort(scores)[::-1][:kw_n]
            keywords_tfidf = [str(feats[i]) for i in top if scores[i] > 0]
        except ValueError:
            pass

    keywords_keybert = extract_keybert_phrases(texts, top_n=kw_n)

    # Частоти слів з лематизацією для uk
    wc = Counter()
    for t, lang in zip(texts, filtered_langs):
        wc.update(tokenize_for_freq(t, lang_hint=lang))

    top_words = [{"word": w, "count": c} for w, c in wc.most_common(top_words_n)]

    by_day: dict[str, int] = defaultdict(int)
    for p in filtered_posts:
        d = parse_day(p.get("created_at"))
        if d:
            by_day[d] += 1
    trend = [{"date": d, "count": by_day[d]} for d in sorted(by_day.keys())]

    topics = run_lda_topics(texts, n_topics=5, n_words=7)
    top_emojis = []
    for em, count in emoji_totals.most_common(10):
        top_emojis.append(
            {"emoji": em, "count": count, "bucket": EMOJI_BUCKETS.get(em, "neutral")}
        )

    lineage = {
        "transform": {
            "lemmatization": "pymorphy3 (uk)" if _get_morph_uk else "disabled",
            "stopwords": "multilingual list",
            "keybert": bool(keywords_keybert),
            "lda_topics": len(topics),
        }
    }

    return {
        "summary": {
            "positive": pct["positive"],
            "neutral": pct["neutral"],
            "negative": pct["negative"],
            "total": total,
        },
        "keywords": keywords_keybert or keywords_tfidf,
        "keywords_tfidf": keywords_tfidf,
        "keywords_keybert": keywords_keybert,
        "topics": topics,
        "top_words": top_words,
        "trend": trend,
        "sentiment_breakdown": {
            "positive": counts["positive"],
            "neutral": counts["neutral"],
            "negative": counts["negative"],
        },
        "emotion_signals": {
            "positive": emoji_bucket_totals["positive"],
            "neutral": emoji_bucket_totals["neutral"],
            "negative": emoji_bucket_totals["negative"],
            "total_hits": sum(emoji_bucket_totals.values()),
            "top_emojis": top_emojis,
        },
        "per_post": per_post,
        "records": records,
        "meta": {
            "models": {
                "multilingual_stars": MODEL_DEFAULT,
                "ukrainian_classifier": MODEL_UK,
                "keybert_embedding": KEYBERT_MODEL,
            },
            "lang_filter_applied": lf,
            "pipeline_note": "Українська гілка: fine-tuned класифікатор на українських соцданих; інші мови: mBERT sentiment stars.",
            "lineage": lineage,
        },
    }


