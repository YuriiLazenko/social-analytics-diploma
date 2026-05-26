import fetch from "node-fetch";

/**
 * Публічні пости X (Twitter) через офіційний API v2 (recent search).
 * Потрібен Bearer Token із https://developer.twitter.com (проєкт з доступом до Search).
 *
 * Змінні: X_BEARER_TOKEN або TWITTER_BEARER_TOKEN
 * Опційно: X_LANG_FILTER=uk (додає lang:uk до запиту)
 */

function getBearer() {
  return (process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || "").trim();
}

export function xConfigured() {
  return Boolean(getBearer());
}

/** Побудова query для Recent Search (простий текст + без ретвітів). */
function buildQuery(keyword) {
  const raw = keyword.trim().replace(/[\r\n]+/g, " ").slice(0, 450);
  let q = `${raw} -is:retweet`;
  const lang = (process.env.X_LANG_FILTER || "").trim().toLowerCase();
  if (lang && /^[a-z]{2}$/.test(lang)) {
    q += ` lang:${lang}`;
  }
  return q.slice(0, 512);
}

export async function fetchXPosts(keyword, limit) {
  const bearer = getBearer();
  if (!bearer) {
    throw new Error("Не задано X_BEARER_TOKEN / TWITTER_BEARER_TOKEN у .env");
  }

  const q = buildQuery(keyword);
  const posts = [];
  let nextToken = null;

  while (posts.length < limit) {
    const remain = limit - posts.length;
    const maxResults = Math.min(100, Math.max(10, remain));

    const url = new URL("https://api.twitter.com/2/tweets/search/recent");
    url.searchParams.set("query", q);
    url.searchParams.set("max_results", String(maxResults));
    url.searchParams.set("tweet.fields", "created_at,author_id,lang");
    if (nextToken) {
      url.searchParams.set("next_token", nextToken);
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "User-Agent": process.env.X_USER_AGENT || "SocialAnalyticsDiploma/1.0",
      },
    });

    const rawBody = await res.text();
    let json;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new Error(`X API: не JSON відповідь (${res.status})`);
    }

    if (!res.ok) {
      const detail =
        json?.detail ||
        json?.title ||
        json?.errors?.[0]?.detail ||
        rawBody.slice(0, 240);
      const hint =
        res.status === 403
          ? "Перевірте тариф API та доступ до Recent Search у проєкті developer.twitter.com."
          : res.status === 401
            ? "Невірний або прострочений Bearer token."
            : "";
      throw new Error(`X API ${res.status}: ${detail}${hint ? " " + hint : ""}`);
    }

    const items = json?.data || [];
    const meta = json?.meta || {};
    if (!nextToken) {
      console.info(
        `[x] recent search query="${q}" tweets=${items.length} result_count=${meta.result_count ?? "?"}`,
      );
    }
    for (const t of items) {
      const text = (t.text || "").trim();
      if (!text) continue;
      posts.push({
        text,
        created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
        source: "x",
        author: t.author_id || "unknown",
        lang: t.lang || null,
      });
      if (posts.length >= limit) break;
    }

    nextToken = json?.meta?.next_token;
    if (!nextToken || items.length === 0) break;
  }

  return posts.slice(0, limit);
}
