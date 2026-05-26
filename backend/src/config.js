import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config();

export const NLP_SERVICE_URL =
  process.env.NLP_SERVICE_URL || "http://127.0.0.1:8000";

/** Черга NLP у Redis (узгоджено з nlp-service/worker.py) */
export const REDIS_URL = process.env.REDIS_URL || "";
export const NLP_QUEUE_KEY =
  process.env.NLP_QUEUE_KEY || "social:nlp:jobs";
export const NLP_RESULT_PREFIX =
  process.env.NLP_RESULT_PREFIX || "social:nlp:result:";
export const NLP_JOB_TIMEOUT_MS = parseInt(
  process.env.NLP_JOB_TIMEOUT_MS || "120000",
  10,
);

/** Демо-дані лише якщо ALLOW_MOCK=1 (за замовчуванням вимкнено — як у описі ІС) */
export function allowMock() {
  const v = (process.env.ALLOW_MOCK || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const REDDIT = {
  clientId: process.env.REDDIT_CLIENT_ID || "",
  clientSecret: process.env.REDDIT_CLIENT_SECRET || "",
  userAgent: process.env.REDDIT_USER_AGENT || "SocialAnalyticsDiploma/1.0 (educational)",
};

export const FRONTEND_DIR = path.join(__dirname, "../../frontend");

export const MAX_POSTS = Math.min(
  parseInt(process.env.MAX_POSTS || "500", 10) || 500,
  1000,
);

/** Реальний Telegram: api_id/hash з my.telegram.org + список каналів у TELEGRAM_CHANNELS */
export function telegramConfigured() {
  const id = (process.env.TELEGRAM_API_ID || "").trim();
  const hash = (process.env.TELEGRAM_API_HASH || "").trim();
  const ch = (process.env.TELEGRAM_CHANNELS || "").trim();
  return Boolean(id && hash && ch);
}
