import crypto from "crypto";
import { createClient } from "redis";
import fetch from "node-fetch";
import {
  NLP_QUEUE_KEY,
  NLP_RESULT_PREFIX,
  NLP_SERVICE_URL,
  NLP_JOB_TIMEOUT_MS,
  REDIS_URL,
} from "./config.js";

/**
 * Виклик NLP: якщо задано REDIS_URL — асинхронна черга + worker.py;
 * інакше прямий HTTP до FastAPI/Flask.
 */
export async function analyzeTexts(payload) {
  const redisUrl = (REDIS_URL || "").trim();
  if (redisUrl) {
    const client = createClient({ url: redisUrl });
    client.on("error", () => {});
    await client.connect();
    const jobId = crypto.randomUUID();
    const resultKey = `${NLP_RESULT_PREFIX}${jobId}`;
    await client.lPush(
      NLP_QUEUE_KEY,
      JSON.stringify({ job_id: jobId, body: payload }),
    );
    const deadline = Date.now() + NLP_JOB_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        const r = await client.get(resultKey);
        if (r) return JSON.parse(r);
        await new Promise((x) => setTimeout(x, 120));
      }
      throw new Error(
        "NLP: тайм-аут черги Redis. Запустіть worker: cd nlp-service && REDIS_URL=... python worker.py",
      );
    } finally {
      try {
        await client.quit();
      } catch {
        /* ignore */
      }
    }
  }

  const url = `${NLP_SERVICE_URL.replace(/\/$/, "")}/analyze`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`NLP service error ${res.status}: ${t}`);
  }

  return res.json();
}
