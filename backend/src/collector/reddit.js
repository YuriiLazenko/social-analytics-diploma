import fetch from "node-fetch";
import { REDDIT } from "../config.js";

async function getAccessToken() {
  const auth = Buffer.from(
    `${REDDIT.clientId}:${REDDIT.clientSecret}`,
  ).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Reddit auth failed: ${res.status} ${t}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Пошук постів Reddit за ключовим словом (публічні дані через OAuth app).
 */
export async function fetchRedditPosts(keyword, limit) {
  const token = await getAccessToken();
  const q = encodeURIComponent(keyword.trim());
  const perReq = Math.min(limit, 100);
  const posts = [];
  let after = null;

  while (posts.length < limit) {
    const remain = limit - posts.length;
    const batch = Math.min(perReq, remain);
    const url = new URL("https://oauth.reddit.com/search");
    url.searchParams.set("q", keyword.trim());
    url.searchParams.set("limit", String(batch));
    url.searchParams.set("sort", "new");
    url.searchParams.set("restrict_sr", "false");
    url.searchParams.set("type", "link");
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": REDDIT.userAgent,
      },
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Reddit search failed: ${res.status} ${t}`);
    }

    const data = await res.json();
    const children = data?.data?.children || [];

    for (const c of children) {
      const p = c.data;
      const text = [p.title, p.selftext].filter(Boolean).join("\n").trim();
      if (!text) continue;

      posts.push({
        id: p.name || p.id,
        text,
        created_at: new Date((p.created_utc || 0) * 1000).toISOString(),
        source: "reddit",
        permalink: p.url || `https://reddit.com${p.permalink || ""}`,
        author: p.author || "unknown",
      });
      if (posts.length >= limit) break;
    }

    after = data?.data?.after;
    if (!after || children.length === 0) break;
  }

  return posts;
}

export function redditConfigured() {
  return Boolean(REDDIT.clientId && REDDIT.clientSecret);
}
