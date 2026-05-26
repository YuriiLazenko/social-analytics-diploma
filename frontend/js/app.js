/* global Chart WordCloud */

const API_BASE = "";

let sentimentChart;
let trendChart;
let wordsChart;

function $(id) {
  return document.getElementById(id);
}

async function fetchHealth() {
  const el = $("healthStatus");
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    const j = await r.json();
    const nlp = j.ok ? "NLP OK" : "NLP";
    const reddit = j.reddit ? "Reddit: ключі" : "Reddit: —";
    const tg = j.telegram ? "TG: канали" : "TG: —";
    const rss = j.rss ? "RSS" : "RSS: —";
    const x = j.x ? "X" : "X: —";
    const q = j.redis_queue ? " · Redis→NLP" : "";
    const m = j.mock_fallback ? " · mock" : "";
    el.textContent = `${nlp} · ${reddit} · ${tg} · ${rss} · ${x}${q}${m}`;
  } catch {
    el.textContent = "Backend недоступний";
  }
}

function buildSourcesParam(form) {
  const parts = [];
  const ck = (name) => form.querySelector(`input[name="${name}"]`)?.checked;
  if (ck("src_reddit")) parts.push("reddit");
  if (ck("src_tg")) parts.push("telegram");
  if (ck("src_rss")) parts.push("rss");
  if (ck("src_x")) parts.push("x");
  if (ck("src_mock")) parts.push("mock_twitter");
  if (ck("src_fb")) parts.push("facebook_instagram");
  return parts.length ? parts.join(",") : "reddit,telegram,rss";
}

function renderEtl(etl) {
  const stages = $("etlStages");
  stages.innerHTML = "";
  for (const s of etl.stages || []) {
    const li = document.createElement("li");
    li.className = s.status;
    li.textContent = `${s.name}: ${s.status}${s.detail ? " — " + s.detail : ""}`;
    stages.appendChild(li);
  }
  const m = $("etlMetrics");
  m.innerHTML = "";
  const lines = [
    `Запитано записів: ${etl.extract_requested}`,
    `Після збору: ${etl.extracted}`,
    `Після дедуплікації: ${etl.after_dedup}`,
    `Lineage ID: ${etl.lineage_id || "—"}`,
  ];
  const br = etl.source_breakdown || {};
  lines.push(`Джерела: ${JSON.stringify(br)}`);
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    m.appendChild(div);
  }
}

function destroyCharts() {
  if (sentimentChart) sentimentChart.destroy();
  if (trendChart) trendChart.destroy();
  if (wordsChart) wordsChart.destroy();
}

function renderSentiment(summary) {
  const ctx = $("sentimentChart").getContext("2d");
  sentimentChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Позитивна", "Нейтральна", "Негативна"],
      datasets: [
        {
          data: [summary.positive, summary.neutral, summary.negative],
          backgroundColor: ["#3ecf8e", "#9aa3b5", "#f06666"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { color: "#c9d3e8" } },
      },
    },
  });
}

function renderEmotionSignals(signals) {
  const metrics = $("emotionMetrics");
  const top = $("emotionTop");
  const s = signals || {};
  const pos = Number(s.positive || 0);
  const neu = Number(s.neutral || 0);
  const neg = Number(s.negative || 0);
  const total = Number(s.total_hits || 0);

  const pct = (n) => (total > 0 ? `${((100 * n) / total).toFixed(1)}%` : "0%");
  metrics.innerHTML = `
    <div class="emotion-card positive">Позитив: <strong>${pos}</strong> (${pct(pos)})</div>
    <div class="emotion-card neutral">Нейтральні: <strong>${neu}</strong> (${pct(neu)})</div>
    <div class="emotion-card negative">Негатив: <strong>${neg}</strong> (${pct(neg)})</div>
    <div class="emotion-card">Усього емосигналів: <strong>${total}</strong></div>
  `;

  const tops = Array.isArray(s.top_emojis) ? s.top_emojis : [];
  if (!tops.length) {
    top.innerHTML = `<span class="muted">У вибірці мало емодзі/реакцій.</span>`;
    return;
  }
  top.innerHTML = tops
    .slice(0, 8)
    .map((x) => {
      const b = x.bucket || "neutral";
      return `<span class="emoji-chip ${b}">${escapeHtml(x.emoji || "")} ${Number(x.count || 0)}</span>`;
    })
    .join("");
}

function renderTrend(trend) {
  const ctx = $("trendChart").getContext("2d");
  const labels =
    trend.length > 0 ? trend.map((x) => x.date) : ["немає дат у вибірці"];
  const data = trend.length > 0 ? trend.map((x) => x.count) : [0];
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Пости",
          data,
          borderColor: "#5b8cff",
          backgroundColor: "rgba(91, 140, 255, 0.15)",
          fill: true,
          tension: 0.35,
        },
      ],
    },
    options: {
      scales: {
        x: { ticks: { color: "#8b96ad", maxRotation: 45, minRotation: 0 } },
        y: {
          ticks: { color: "#8b96ad" },
          beginAtZero: true,
        },
      },
      plugins: { legend: { labels: { color: "#c9d3e8" } } },
    },
  });
}

function renderWords(topWords) {
  const list = topWords?.length ? topWords : [{ word: "—", count: 0 }];
  const top = list.slice(0, 12);
  const ctx = $("wordsChart").getContext("2d");
  wordsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map((w) => w.word),
      datasets: [
        {
          label: "Кількість",
          data: top.map((w) => w.count),
          backgroundColor: "#3dd6c3",
        },
      ],
    },
    options: {
      indexAxis: "y",
      scales: {
        x: { ticks: { color: "#8b96ad" }, beginAtZero: true },
        y: { ticks: { color: "#8b96ad" } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderWordCloud(topWords) {
  const el = $("wordCloud");
  el.innerHTML = "";
  const list = topWords.map((w) => [w.word, w.count]);
  if (!list.length || typeof WordCloud === "undefined") return;
  WordCloud(el, {
    list,
    gridSize: Math.round((16 * el.offsetWidth) / 1024),
    weightFactor: function (size) {
      return Math.pow(size, 0.65) * (el.offsetWidth / 1024);
    },
    fontFamily: "IBM Plex Sans, system-ui, sans-serif",
    color: function (_word, weight) {
      return weight > 6 ? "#5b8cff" : weight > 3 ? "#3dd6c3" : "#8b96ad";
    },
    rotateRatio: 0.35,
    backgroundColor: "transparent",
  });
}

function renderKeywords(keywords, data) {
  const box = $("keywordChips");
  box.innerHTML = "";
  for (const kw of keywords || []) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = kw;
    box.appendChild(span);
  }
  const hint = $("keywordAltHint");
  const tfidf = data.keywords_tfidf || [];
  if (tfidf.length && JSON.stringify(tfidf.slice(0, 5)) !== JSON.stringify((keywords || []).slice(0, 5))) {
    hint.hidden = false;
    hint.textContent = `TF-IDF (порівняння): ${tfidf.slice(0, 12).join(", ")}`;
  } else {
    hint.hidden = true;
  }
}

function renderTopics(topics) {
  const block = $("topicsBlock");
  const list = $("topicsList");
  if (!topics?.length) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  list.innerHTML = "";
  for (const t of topics) {
    const li = document.createElement("li");
    const words = (t.words || []).join(", ");
    li.textContent = `${t.label || "Тема"}: ${words}`;
    list.appendChild(li);
  }
}

function renderTable(rows) {
  const body = $("postsBody");
  body.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    const s = r.sentiment || "neutral";
    tr.innerHTML = `
      <td>${escapeHtml(r.source || "")}</td>
      <td>${escapeHtml(r.lang || "")}</td>
      <td><span class="badge ${s}">${escapeHtml(s)}</span></td>
      <td>${escapeHtml((r.text || "").slice(0, 320))}</td>
    `;
    body.appendChild(tr);
  }
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fillResults(data) {
  renderEtl(data.etl);
  destroyCharts();

  const s = data.summary;
  $("summaryLine").textContent = `Тема «${data.keyword}»: ${s.total} дописів після фільтрів. Позитивні ${s.positive}% · нейтральні ${s.neutral}% · негативні ${s.negative}%.`;

  $("resultsPanel").hidden = false;
  renderSentiment(s);
  renderEmotionSignals(data.emotion_signals || {});
  renderTrend(data.trend || []);
  renderWords(data.top_words || []);
  renderWordCloud(data.top_words || []);
  renderKeywords(data.keywords || [], data);
  renderTopics(data.topics || []);
  renderTable(data.posts_sample || []);
}

document.addEventListener("DOMContentLoaded", () => {
  fetchHealth();

  $("analyzeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = $("submitBtn");
    const keyword = form.keyword.value.trim();
    const limit = form.limit.value;
    const lang = form.lang.value;
    const sources = buildSourcesParam(form);

    btn.disabled = true;
    $("statusPanel").hidden = false;
    $("resultsPanel").hidden = true;
    $("summaryLine").textContent = "Завантаження…";

    const useStream = typeof EventSource !== "undefined";

    if (useStream) {
      const streamUrl = new URL(`${API_BASE}/api/analyze/stream`, window.location.origin);
      streamUrl.searchParams.set("keyword", keyword);
      streamUrl.searchParams.set("limit", limit);
      streamUrl.searchParams.set("lang", lang);
      streamUrl.searchParams.set("sources", sources);

      const es = new EventSource(streamUrl.toString());

      es.addEventListener("etl", (ev) => {
        try {
          renderEtl(JSON.parse(ev.data));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("result", (ev) => {
        try {
          const data = JSON.parse(ev.data);
          fillResults(data);
        } catch (err) {
          alert(err.message || String(err));
        }
      });

      es.addEventListener("done", () => {
        btn.disabled = false;
        es.close();
      });

      es.addEventListener("fault", (ev) => {
        try {
          const j = JSON.parse(ev.data);
          alert(j.message || "Помилка");
          if (j.etl) renderEtl(j.etl);
        } catch {
          alert("Помилка аналізу");
        }
        btn.disabled = false;
        es.close();
      });

      return;
    }

    try {
      const url = new URL(`${API_BASE}/api/analyze`, window.location.origin);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("limit", limit);
      url.searchParams.set("lang", lang);
      url.searchParams.set("sources", sources);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Помилка");

      fillResults(data);
    } catch (err) {
      $("summaryLine").textContent = "";
      alert(err.message || String(err));
    } finally {
      btn.disabled = false;
    }
  });
});
