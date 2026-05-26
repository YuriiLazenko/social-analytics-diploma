/**
 * Генерує демо-пости для роботи без API-ключів.
 * Підтримує окремі демо-джерела: reddit, x, facebook, instagram, telegram.
 */
const SOURCE_TEMPLATES = {
  reddit: {
    authors: ["r_ukr_reader", "r_market_watch", "r_tech_lens", "r_auto_ua"],
    permalinkPrefix: "https://reddit.com/r/demo/comments/",
    positive: [
      "[Discussion] {kw} виглядає сильно цього тижня, хто ще помітив?",
      "IMO, {kw} delivered better than expected this quarter.",
      "Upvote за {kw}: класна динаміка і хороші новини.",
    ],
    neutral: [
      "Thread: факти про {kw} без емоцій. Зібрав основні тези.",
      "Новий пост про {kw}: цифри змішані, чекаємо наступний звіт.",
      "Слідкую за {kw}, поки без явного тренду.",
    ],
    negative: [
      "Скептично до {kw}: занадто багато шуму, мало конкретики.",
      "Not bullish on {kw} right now, risk profile looks high.",
      "Питань до {kw} стало більше, ніж відповідей.",
    ],
  },
  x: {
    authors: ["x_marketpulse", "x_dailywire", "x_techfeeds", "x_alerts_ua"],
    permalinkPrefix: "https://x.com/demo/status/",
    positive: [
      "{kw} momentum is back {hashtag} huge upside potential.",
      "Позитив по {kw}: сильні сигнали від ринку.",
      "Love what {kw} is doing lately. Clean execution.",
    ],
    neutral: [
      "{kw} update: mixed sentiment, waiting for confirmation.",
      "Market digest: {kw} тримається в діапазоні.",
      "Tracking {kw} intraday. No breakout yet.",
    ],
    negative: [
      "{kw} pulled back again {hashtag} volatility is brutal.",
      "Негатив навколо {kw}: багато критики по стратегії.",
      "Not touching {kw} until trend stabilizes.",
    ],
  },
  facebook: {
    authors: ["fb.community.ua", "fb.newsroom.local", "fb.digest.group"],
    permalinkPrefix: "https://facebook.com/demo/posts/",
    positive: [
      "У групі активно підтримують {kw}: багато позитивних відгуків.",
      "{kw} отримав сильну реакцію в коментарях, тон позитивний.",
      "Пост про {kw} набрав велику залученість і лайки.",
    ],
    neutral: [
      "Обговорення {kw}: думки розділились, без домінуючої позиції.",
      "Інфопост про {kw}: факти, посилання, без оцінок.",
      "Локальна спільнота згадує {kw} у стрічці новин.",
    ],
    negative: [
      "Є хвиля критики щодо {kw}: користувачі незадоволені сервісом.",
      "У коментарях до {kw} переважає негативна реакція.",
      "З поста про {kw}: люди скаржаться на якість.",
    ],
  },
  instagram: {
    authors: ["insta.tech.daily", "insta.market.snap", "insta.ua.trends"],
    permalinkPrefix: "https://instagram.com/p/",
    positive: [
      "{kw} looks amazing in today's reel {hashtag}",
      "Stories про {kw}: багато позитиву та підтримки.",
      "Audience loves {kw} content this week.",
    ],
    neutral: [
      "Пост про {kw}: просто фактчек і короткий опис.",
      "Згадка {kw} в каруселі без чіткої оцінки.",
      "Reel про {kw} з нейтральним тоном дискусії.",
    ],
    negative: [
      "Під постом про {kw} багато критичних коментарів.",
      "Sentiment on {kw} drops in recent comments.",
      "Для {kw} у стрічці помітний відчутний негатив.",
    ],
  },
  telegram: {
    authors: ["@demo_channel_1", "@demo_channel_2", "@demo_channel_3"],
    permalinkPrefix: "https://t.me/demo/",
    positive: [
      "Канал: {kw} показує позитивні сигнали, тримаємо в фокусі.",
      "Оперативно: по {kw} сьогодні переважає позитив.",
      "Зведення: {kw} — добрий фон і конструктивна реакція.",
    ],
    neutral: [
      "Апдейт: {kw} згадується регулярно, але без чіткої домінанти.",
      "Коротко по {kw}: новий інфопривід, без різких оцінок.",
      "Моніторинг {kw}: нейтральний інфопотік.",
    ],
    negative: [
      "По {kw} у каналах більше критики, ніж підтримки.",
      "Зведення: негативні згадки {kw} зростають.",
      "Обережно з {kw}: багато тривожних сигналів у стрічці.",
    ],
  },
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateWithin(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  d.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
  return d.toISOString();
}

function normalizeMockSources(sources) {
  const out = [];
  for (const src of sources || []) {
    if (src === "facebook_instagram") {
      out.push("facebook", "instagram");
      continue;
    }
    if (src === "mock_twitter") {
      out.push("x");
      continue;
    }
    if (src in SOURCE_TEMPLATES) out.push(src);
  }
  return out.length ? out : ["x", "reddit", "facebook", "instagram"];
}

export function generateMockPosts(keyword, limit, sources) {
  const kw = keyword.trim() || "topic";
  const hashtag = `#${kw.replace(/\s+/g, "").slice(0, 20)}`;
  const list = [];
  const moodCycle = ["positive", "neutral", "negative"];
  const sourcePool = normalizeMockSources(sources);
  const moodEmoji = {
    positive: ["❤️", "🔥", "👍", "👏"],
    neutral: ["😐", "🤔", "😶", "👀"],
    negative: ["😡", "👎", "💔", "😤"],
  };

  for (let i = 0; i < limit; i++) {
    const mood = moodCycle[i % 3];
    const source = sourcePool[i % sourcePool.length];
    const profile = SOURCE_TEMPLATES[source] || SOURCE_TEMPLATES.x;
    const template = pick(profile[mood]);
    const text = template
      .replace(/\{kw\}/g, kw)
      .replace(/\{hashtag\}/g, hashtag);
    const emoji = moodEmoji[mood][i % moodEmoji[mood].length];
    const uniqueText = `${text} ${emoji} · demo-${source}-${i + 1}`;

    list.push({
      id: `mock-${source}-${i}-${Date.now()}`,
      text: uniqueText,
      created_at: randomDateWithin(30),
      source,
      permalink: `${profile.permalinkPrefix}${Date.now().toString(36)}${i}`,
      author: pick(profile.authors),
    });
  }

  return list;
}
