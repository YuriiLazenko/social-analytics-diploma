# Інформаційна система: аналітика соцмереж + текстова аналітика

Стек: **Node.js (Express)** — збір і оркестрація, **Python** — NLP (**FastAPI** і опційно **Flask** у тій самій логіці `analyzer.py`), **Redis** — черга завдань NLP (опційно), **ванільний фронтенд** — Chart.js, WordCloud2, **SSE** для потоку результатів.

## Швидкий старт у Docker

Усі компоненти (backend, NLP-сервіс на FastAPI, worker для черги, Redis) піднімаються однією командою:

```bash
cp .env.example .env   # за потреби пропишіть ключі Reddit / Telegram / X / RSS
docker compose up --build
```

Після збірки відкрийте `http://localhost:3000`. API health: `http://localhost:3000/api/health`, NLP health: `http://localhost:8000/health`.

Сервіси у `docker-compose.yml`:

- **`backend`** — Node.js + статика `frontend/` (порт `3000`).
- **`nlp`** — FastAPI на `analyzer.py` (порт `8000`). Кеш моделей Hugging Face лежить у томі `hf-cache`, тому повторні запуски миттєві.
- **`worker`** — той самий образ, але запускає `worker.py`; забирає завдання NLP з Redis-черги.
- **`redis`** — Redis 7 для черги (порт `6379`).

Корисні команди:

```bash
docker compose up -d --build       # запуск у фоні
docker compose logs -f backend nlp # перегляд логів
docker compose ps                  # стан сервісів
docker compose down                # зупинити (томи з моделями/сесією зберігаються)
docker compose down -v             # повна очистка, включно з кешем моделей
```

### Telegram-авторизація під Docker

Файл сесії Telethon зберігається у томі `tg-session` (мапиться у `/app/sessions` контейнера). Зайдіть один раз інтерактивно:

```bash
docker compose run --rm nlp python telegram_login.py
```

Після успішного входу контейнери можна спокійно перезапускати — авторизація збережеться у томі. Якщо у вас уже є локальний `nlp-service/telegram_session.session`, його можна перенести у том без повторного логіну:

```bash
docker compose up -d nlp
docker compose cp ./nlp-service/telegram_session.session nlp:/app/sessions/telegram_session.session
docker compose restart nlp
```

### Прямий HTTP замість Redis-черги

За замовчуванням у Compose backend ходить до NLP **через чергу** (`REDIS_URL` задано). Щоб переключитися на синхронні HTTP-виклики до FastAPI, закоментуйте рядок `REDIS_URL` у секції `backend` у `docker-compose.yml` і перезапустіть стек.

### Запуск без Docker (локально)

## NLP (тональність, KeyBERT, LDA, лематизація)

- **Українська / кирилиця:** fine-tuned класифікатор (`SENTIMENT_MODEL_UK`, за замовчуванням модель на українських Telegram-даних, RoBERTa-сімейство).
- **Інші мови:** `nlptown/bert-base-multilingual-uncased-sentiment` (зірки → позитив/нейтраль/негатив).
- **Ключові фрази:** KeyBERT + окремо TF-IDF для порівняння.
- **Теми:** LDA (sklearn) по корпусу дописів.
- **Лематизація:** pymorphy3 для української (частоти слів / очищення).

### Запуск FastAPI (основний варіант)

```bash
cd nlp-service
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

Перший запуск завантажить кілька моделей з Hugging Face (сотні МБ).

### Запуск Flask (узгоджено з формулюваннями «Python/Flask» у документації)

```bash
cd nlp-service
source .venv/bin/activate
python flask_app.py
# або: flask --app flask_app run --host 127.0.0.1 --port 8000
```

### Черга Redis + worker (асинхронний NLP між Node і Python)

1. Підніміть Redis локально.
2. У `.env` кореня проєкту: `REDIS_URL=redis://127.0.0.1:6379`
3. У окремому терміналі:

```bash
cd nlp-service
source .venv/bin/activate
export REDIS_URL=redis://127.0.0.1:6379
python worker.py
```

Backend лишається на **HTTP** до NLP лише якщо `REDIS_URL` не заданий.

## Backend + фронтенд

```bash
cd backend
npm install
npm start
```

Браузер: `http://localhost:3000` — за замовчуванням використовується **SSE** (`/api/analyze/stream`), є звичайний `GET /api/analyze`.

### Джерела даних і демо

- За замовчуванням **демо-дані вимкнено**. Щоб увімкнути підстановку моків (Twitter/FB тощо), додайте в `.env`: `ALLOW_MOCK=1`.
- **Reddit:** як раніше — `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` (зараз часто потрібне окреме схвалення Reddit; див. політику Responsible Builder).
- **Telegram:** `TELEGRAM_*` і один раз `python telegram_login.py` у `nlp-service/` (див. нижче).

### RSS (новини без API-ключів)

1. У **`.env`** у корені проєкту додайте один рядок — **URL стрічок через кому** (без пробілів між адресами):

   У корені `.env` уже можна задати довгий список через кому (приклад — УП, УНІАН, NV, LB.ua, ТСН, Суспільне, Євроінтеграція, DT, ZN, Обозреватель, Gordon, Укрінформ, Телеграф, BBC Ukrainian, Інтерфакс тощо). Адреси змінюють сайти — якщо якийсь URL починає давати помилку в консолі `[rss]`, замініть його на актуальний з сайту видання.

   ```env
   RSS_FEEDS=https://www.pravda.com.ua/rss/,https://www.unian.net/rss,https://nv.ua/rss/all.xml
   ```

2. Перезапустіть backend (`npm start` у `backend/`).

3. На сайті залиште галочку **«RSS / новини»** і введіть **ключове слово**. Якщо в поточних заголовках цього слова немає, система за замовчуванням все одно підтягне **останні новини зі стрічок** (джерело позначиться як `без_ключового_збігу`). Щоб показувати лише дописи зі збігом ключа, у `.env` задайте **`RSS_STRICT_KEYWORD=1`**.

4. Перевірка: `GET http://localhost:3000/api/health` має показати **`rss: true`**.

Якщо для якогось URL з’являється `[rss] ...` у консолі бекенду — стрічка могла змінити адресу або блокувати незвичний User-Agent; додайте інший RSS або задайте **`RSS_USER_AGENT`** у `.env`.

### Lineage (спрощений запис ETL+NLP)

Успішні прогони дописуються у `backend/data/etl-lineage.jsonl` (не комітиться).

## Reddit (необов’язково)

Додаток на https://www.reddit.com/prefs/apps — ключі в `.env` у корені проєкту.

## X / Twitter (необов’язково)

Потрібен проєкт у [Twitter Developer Portal](https://developer.twitter.com/) і **Bearer Token** з доступом до **Tweet retrieval** і пошуку (**Recent search** залежить від тарифу API — без відповідного плану запити повертають 403).

У `.env` у корені проєкту:

```env
TWITTER_BEARER_TOKEN=AAAA...   # або X_BEARER_TOKEN=
# Опційно — лише дописи обраною мовою (ISO 639-1):
# X_LANG_FILTER=uk
```

На сайті увімкніть джерело **X (Twitter API)**. У запиті використовується ендпоінт `GET /2/tweets/search/recent` (останні ~7 днів публічних постів за ключовими словами; ретвіти відфільтровані).

## Telegram (необов’язково)

1. [my.telegram.org](https://my.telegram.org/apps) — **api_id**, **api_hash**.
2. У `.env` у корені та/або у `nlp-service/.env`:

   ```
   TELEGRAM_API_ID=число
   TELEGRAM_API_HASH=рядок
   TELEGRAM_SESSION_NAME=telegram_session
   TELEGRAM_CHANNELS=@channel1,@channel2
   ```

3. Авторизація Telethon (один раз), з каталогу `nlp-service`:

   ```bash
   python telegram_login.py
   ```

## API

- `GET /api/analyze?keyword=...&limit=120&lang=all|uk|en&sources=reddit,telegram,rss,x`
- `GET /api/analyze/stream?...` — SSE: події `etl`, `result`, `done`, `fault`

Повертає JSON з полями `summary`, `keywords` (KeyBERT), `keywords_tfidf`, `topics`, `top_words`, `trend`, `etl`, `meta` тощо.

## Структура

- `backend/` — API, RSS, X/Twitter, Redis-черга, lineage, статика `frontend/`
- `nlp-service/` — `analyzer.py`, `main.py` (FastAPI), `flask_app.py`, `worker.py`, збір Telegram
- `frontend/` — UI
