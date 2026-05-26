import crypto from "crypto";
import path from "path";
import cors from "cors";
import express from "express";

import {
  FRONTEND_DIR,
  MAX_POSTS,
  REDIS_URL,
  allowMock,
  telegramConfigured,
} from "./config.js";
import { generateMockPosts } from "./collector/mock.js";
import { fetchRedditPosts, redditConfigured } from "./collector/reddit.js";
import {
  fetchRssPosts,
  rssConfigured,
} from "./collector/rss.js";
import { fetchTelegramPosts } from "./collector/telegram.js";
import { fetchXPosts, xConfigured } from "./collector/x.js";
import { appendLineageRecord, ensureDataDir } from "./lineage.js";
import { analyzeTexts } from "./nlpClient.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(cors());
app.use(express.json({ limit: "12mb" }));
ensureDataDir();

function normalizeText(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupePosts(posts) {
  const seen = new Set();
  const out = [];
  for (const p of posts) {
    const key = normalizeText(p.text).slice(0, 500);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function parseSources(sourcesParam) {
  return sourcesParam
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function sseWrite(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function collectPosts(keyword, limit, sources) {
  const wantReddit = sources.includes("reddit");
  const wantTelegram = sources.includes("telegram");
  const wantMockTwitter = sources.includes("mock_twitter");
  const wantFb = sources.includes("facebook_instagram");
  const wantRss = sources.includes("rss");
  const wantX = sources.includes("x");

  const realReddit = redditConfigured() && wantReddit;
  const realTg = telegramConfigured() && wantTelegram;
  const realRss = rssConfigured() && wantRss;
  const realX = xConfigured() && wantX;

  const nReal =
    (realReddit ? 1 : 0) +
    (realTg ? 1 : 0) +
    (realRss ? 1 : 0) +
    (realX ? 1 : 0);
  const share =
    nReal > 0 ? Math.max(1, Math.floor(limit / nReal)) : limit;

  let posts = [];
  /** Короткі підказки для UI (чому джерело пусте / помилка). */
  const fetchNotes = [];

  if (realReddit) {
    try {
      posts = posts.concat(await fetchRedditPosts(keyword, share));
    } catch (e) {
      fetchNotes.push(`Reddit: ${e.message}`);
      console.warn("[reddit]", e.message);
    }
  }

  if (realTg) {
    try {
      const tgBatch = await fetchTelegramPosts(keyword, share);
      posts = posts.concat(tgBatch);
      if (wantTelegram && tgBatch.length === 0) {
        fetchNotes.push(
          "Telegram: 0 збігів за ключем у недавніх повідомленнях каналів (пошук підрядка в тексті). Перевірте написання або оберіть інше ключове слово.",
        );
      }
    } catch (e) {
      fetchNotes.push(`Telegram: ${e.message}`);
      console.warn("[telegram]", e.message);
    }
  }

  if (realRss) {
    try {
      posts = posts.concat(await fetchRssPosts(keyword, share));
    } catch (e) {
      fetchNotes.push(`RSS: ${e.message}`);
      console.warn("[rss]", e.message);
    }
  }

  if (realX) {
    try {
      const batch = await fetchXPosts(keyword, share);
      posts = posts.concat(batch);
      if (batch.length === 0) {
        const lang = (process.env.X_LANG_FILTER || "").trim();
        if (lang) {
          fetchNotes.push(
            `X: 0 твітів при X_LANG_FILTER=${lang} — для англомовних тем приберіть змінну або X_LANG_FILTER=en`,
          );
        } else {
          fetchNotes.push(
            "X: 0 твітів (recent search ~7 днів; перевірте тариф API / доступ до Search)",
          );
        }
      }
    } catch (e) {
      fetchNotes.push(`X: ${e.message}`);
      console.warn("[x]", e.message);
    }
  }

  const shortfall = limit - posts.length;
  const mockPlatforms = [];
  if (wantMockTwitter) mockPlatforms.push("mock_twitter");
  if (wantFb) mockPlatforms.push("facebook_instagram");
  if (wantTelegram && !realTg) mockPlatforms.push("telegram");
  if (wantReddit && !realReddit) mockPlatforms.push("reddit");
  if (wantX && (!realX || fetchNotes.some((x) => x.startsWith("X:")))) {
    mockPlatforms.push("x");
  }

  if (shortfall > 0 && mockPlatforms.length > 0 && allowMock()) {
    const uniquePlatforms = [...new Set(mockPlatforms)];
    posts = posts.concat(generateMockPosts(keyword, shortfall, uniquePlatforms));
    fetchNotes.push(`Демо: додано ${shortfall} записів (${uniquePlatforms.join(", ")})`);
  }

  if (posts.length === 0 && allowMock()) {
    const requested = sources.length
      ? sources
      : ["reddit", "x", "facebook_instagram", "telegram"];
    /** Не підміняти демо там, де реально налаштований колектор (інакше здається, ніби це справжні пости). */
    const fallbackSources = requested.filter((s) => {
      if (s === "telegram") return !realTg;
      if (s === "reddit") return !realReddit;
      if (s === "rss") return !realRss;
      if (s === "x") return !realX;
      return true;
    });
    if (fallbackSources.length > 0) {
      posts = generateMockPosts(
        keyword,
        Math.min(limit, 120),
        fallbackSources,
      );
      fetchNotes.push(
        `Демо: порожній збір — підставлено лише для джерел без реального API (${fallbackSources.join(", ")})`,
      );
    } else {
      fetchNotes.push(
        "Демо не застосовано: усі обрані джерела мають реальне підключення, але записів не знайдено.",
      );
    }
  }

  return {
    posts: dedupePosts(posts).slice(0, limit),
    fetchNotes,
  };
}

async function runAnalyzePipeline(keyword, limit, sourcesParam, langFilter) {
  const sources = parseSources(sourcesParam);
  const etl = {
    extract_requested: limit,
    extracted: 0,
    after_dedup: 0,
    source_breakdown: {},
    stages: [
      { name: "extract", status: "pending", detail: "" },
      { name: "clean_dedupe", status: "pending", detail: "" },
      { name: "nlp", status: "pending", detail: "" },
    ],
    lineage_id: crypto.randomUUID(),
  };

  etl.stages[0].status = "running";
  const { posts, fetchNotes } = await collectPosts(keyword, limit, sources);
  etl.extracted = posts.length;
  etl.stages[0].status = "done";
  const extractBits = [`отримано ${posts.length} записів`];
  if (fetchNotes.length) extractBits.push(fetchNotes.join("; "));
  etl.stages[0].detail = extractBits.join(" · ");

  if (posts.length === 0) {
    etl.stages[1].status = "skipped";
    etl.stages[2].status = "skipped";
    let hint =
      allowMock()
        ? "Увімкніть джерела або додайте Reddit/Telegram/RSS у .env"
        : "Немає даних: налаштуйте Reddit, Telegram, RSS_FEEDS, X (TWITTER_BEARER_TOKEN) або ALLOW_MOCK=1 для демо.";
    if (fetchNotes.length) {
      hint += ` ${fetchNotes.join(" ")}`;
    }
    throw Object.assign(new Error(hint), { etl, statusCode: 404 });
  }

  etl.stages[1].status = "running";
  etl.after_dedup = posts.length;
  for (const p of posts) {
    etl.source_breakdown[p.source] =
      (etl.source_breakdown[p.source] || 0) + 1;
  }
  etl.stages[1].status = "done";
  etl.stages[1].detail =
    "лематизація/stopwords у NLP; дедуплікація на gateway";

  etl.stages[2].status = "running";
  let analysis;
  try {
    analysis = await analyzeTexts({
      keyword,
      posts: posts.map((p) => ({
        text: p.text,
        created_at: p.created_at,
        source: p.source,
      })),
      options: {
        top_keywords: 15,
        top_words: 35,
        lang_filter: langFilter,
      },
    });
  } catch (e) {
    etl.stages[2].status = "error";
    etl.stages[2].detail = e.message || String(e);
    throw Object.assign(e, { etl });
  }
  etl.stages[2].status = "done";
  etl.stages[2].detail =
    (analysis.meta?.models && JSON.stringify(analysis.meta.models)) ||
    analysis.meta?.pipeline_note ||
    "NLP";

  const postsSample = (analysis.records || []).slice(0, 40);

  const payload = {
    keyword,
    summary: analysis.summary,
    keywords: analysis.keywords,
    keywords_tfidf: analysis.keywords_tfidf,
    keywords_keybert: analysis.keywords_keybert,
    topics: analysis.topics,
    top_words: analysis.top_words,
    trend: analysis.trend,
    sentiment_breakdown: analysis.sentiment_breakdown,
    emotion_signals: analysis.emotion_signals || {},
    per_post: analysis.per_post,
    posts_sample: postsSample,
    etl,
    filters: { lang: langFilter, sources: sourcesParam },
    meta: analysis.meta,
  };

  appendLineageRecord({
    lineage_id: etl.lineage_id,
    keyword,
    sources: sourcesParam,
    post_count: posts.length,
    etl_stages: etl.stages,
    nlp_meta: analysis.meta,
  });

  return payload;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    reddit: redditConfigured(),
    telegram: telegramConfigured(),
    rss: rssConfigured(),
    x: xConfigured(),
    redis_queue: Boolean((REDIS_URL || "").trim()),
    mock_fallback: allowMock(),
    nlpUrl: process.env.NLP_SERVICE_URL || "http://127.0.0.1:8000",
  });
});

app.get("/api/analyze", async (req, res) => {
  const keyword = String(req.query.keyword || "").trim();
  if (!keyword) {
    return res.status(400).json({ error: "Параметр keyword обов'язковий" });
  }

  const limit = Math.min(
    parseInt(req.query.limit || "150", 10) || 150,
    MAX_POSTS,
  );
  const sourcesParam = String(
    req.query.sources || "reddit,telegram,rss",
  );
  const langFilter = String(req.query.lang || "all").toLowerCase();

  try {
    const payload = await runAnalyzePipeline(
      keyword,
      limit,
      sourcesParam,
      langFilter,
    );
    return res.json(payload);
  } catch (err) {
    console.error(err);
    const etl = err.etl;
    if (etl) {
      const stage = etl.stages.find((s) => s.status === "running");
      if (stage) {
        stage.status = "error";
        stage.detail = String(err.message || err);
      }
    }
    const code = err.statusCode || 502;
    return res.status(code).json({
      error: err.message || "Помилка збору або NLP",
      etl: err.etl,
    });
  }
});

/** SSE: етапи ETL + фінальний результат (альтернатива до WebSocket у записці) */
app.get("/api/analyze/stream", async (req, res) => {
  const keyword = String(req.query.keyword || "").trim();
  if (!keyword) {
    res.status(400).json({ error: "keyword required" });
    return;
  }

  const limit = Math.min(
    parseInt(req.query.limit || "150", 10) || 150,
    MAX_POSTS,
  );
  const sourcesParam = String(
    req.query.sources || "reddit,telegram,rss",
  );
  const langFilter = String(req.query.lang || "all").toLowerCase();

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    sseWrite(res, "status", { message: "extract: старт" });
    const payload = await runAnalyzePipeline(
      keyword,
      limit,
      sourcesParam,
      langFilter,
    );
    sseWrite(res, "etl", payload.etl);
    sseWrite(res, "result", payload);
    sseWrite(res, "done", { ok: true });
    res.end();
  } catch (err) {
    console.error(err);
    sseWrite(res, "fault", {
      message: err.message || String(err),
      etl: err.etl || null,
    });
    res.end();
  }
});

app.use(express.static(FRONTEND_DIR));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(FRONTEND_DIR, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.listen(PORT, () => {
  console.log(`Backend http://localhost:${PORT}`);
  console.log(`Frontend: ${FRONTEND_DIR}`);
});
