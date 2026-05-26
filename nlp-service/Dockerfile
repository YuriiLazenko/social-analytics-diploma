# syntax=docker/dockerfile:1.6
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models \
    TRANSFORMERS_CACHE=/models \
    SENTENCE_TRANSFORMERS_HOME=/models

# Системні залежності: build для деяких wheel, curl/git — для скачування моделей з HF
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        git \
        curl \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./

# CPU-only torch wheel + інші пакети
RUN pip install --upgrade pip \
 && pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY . .

# Том для кешу моделей Hugging Face (щоб не качати щоразу)
VOLUME ["/models"]

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
