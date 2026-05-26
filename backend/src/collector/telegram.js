import fetch from "node-fetch";
import { NLP_SERVICE_URL, telegramConfigured } from "../config.js";

export { telegramConfigured };

/**
 * Збір реальних постів із каналів TELEGRAM_CHANNELS (обробляє NLP-сервіс / Telethon).
 */
export async function fetchTelegramPosts(keyword, limit) {
  const url = `${NLP_SERVICE_URL.replace(/\/$/, "")}/collect/telegram`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, limit }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const j = JSON.parse(text);
        detail = j.detail || j.message || text;
      } catch {
        /* raw */
      }
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }

    const data = JSON.parse(text);
    return Array.isArray(data.posts) ? data.posts : [];
  } finally {
    clearTimeout(timer);
  }
}
