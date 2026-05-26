import Parser from "rss-parser";

function stripHtml(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemToPost(item, feedLabel) {
  const rawTitle = stripHtml(item.title || "");
  const rawBody =
    item.contentSnippet ||
    stripHtml(item.content || "") ||
    stripHtml(item.summary || "") ||
    stripHtml(item["content:encoded"] || "");
  const text = `${rawTitle}. ${rawBody}`.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (text.length < 8) return null;
  const rawDate = item.isoDate || item.pubDate || item.date;
  let created_at = null;
  if (rawDate) {
    const d = new Date(rawDate);
    if (!Number.isNaN(d.getTime())) created_at = d.toISOString();
  }
  return {
    text,
    created_at,
    baseSource: feedLabel.slice(0, 40),
  };
}

/**
 * Збір дописів із RSS/Atom стрічок (новини, блоги) за ключовим словом у заголовку/описі.
 * RSS_FEEDS — список URL через кому у .env
 *
 * Якщо за ключем нічого не знайдено (часто заголовки без цього слова), за замовчуванням
 * беруться останні новини зі стрічок — інакше інтерфейс показує «0 записів».
 * RSS_STRICT_KEYWORD=1 — не падати в такий резерв, лишати порожньо.
 */
export function rssConfigured() {
  const raw = process.env.RSS_FEEDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length > 0;
}

export function getRssFeedUrls() {
  return (process.env.RSS_FEEDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function strictKeywordOnly() {
  const v = (process.env.RSS_STRICT_KEYWORD || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function fetchRssPosts(keyword, limit) {
  const urls = getRssFeedUrls();
  if (!urls.length || limit < 1) return [];

  const parser = new Parser({
    timeout: 20000,
    headers: {
      "User-Agent":
        process.env.RSS_USER_AGENT ||
        "SocialAnalyticsDiploma/1.0 (educational RSS reader)",
    },
  });

  const kw = (keyword || "").toLowerCase().trim();
  const matched = [];
  const fallback = [];

  for (const url of urls) {
    if (matched.length >= limit) break;
    try {
      const feed = await parser.parseURL(url);
      const label = feed.title || url;
      for (const item of feed.items || []) {
        const post = itemToPost(item, label);
        if (!post) continue;

        const hay = post.text.toLowerCase();
        const hit = kw.length === 0 || hay.includes(kw);

        const row = {
          text: post.text,
          created_at: post.created_at,
          source: hit
            ? `rss:${post.baseSource}`
            : `rss:${post.baseSource}·без_ключового_збігу`,
        };

        if (hit) {
          matched.push(row);
        } else if (fallback.length < Math.max(limit * 50, 400)) {
          fallback.push(row);
        }

        if (matched.length >= limit) break;
      }
    } catch (e) {
      console.warn("[rss]", url, e.message);
    }
  }

  if (matched.length > 0) {
    return matched.slice(0, limit);
  }

  if (strictKeywordOnly()) {
    return [];
  }

  if (fallback.length > 0) {
    console.warn(
      `[rss] за ключем «${keyword}» збігів у заголовках/описах немає; показуємо останні новини зі стрічок (${fallback.length}). RSS_STRICT_KEYWORD=1 щоб вимкнути.`,
    );
    return fallback.slice(0, limit);
  }

  return [];
}
