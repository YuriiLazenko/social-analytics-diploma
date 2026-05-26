#!/usr/bin/env python3
"""
Одноразовий інтерактивний вхід у Telegram (створює файл *.session для Telethon).

1. Отримайте api_id та api_hash: https://my.telegram.org/apps
2. Додайте їх у .env у nlp-service/ або експортуйте змінні.
3. Запустіть з каталогу nlp-service:

   python telegram_login.py

Пароль акаунта та код з SMS/Telegram вводяться у терміналі.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env", override=True)
load_dotenv(BASE_DIR.parent / ".env", override=True)


def main() -> None:
    api_id = int(os.environ.get("TELEGRAM_API_ID", "0") or "0")
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    name = os.environ.get("TELEGRAM_SESSION_NAME", "telegram_session").strip()
    if not api_id or not api_hash:
        raise SystemExit(
            "Додайте TELEGRAM_API_ID та TELEGRAM_API_HASH у .env (див. README)."
        )

    path = BASE_DIR / name

    async def run() -> None:
        client = TelegramClient(str(path), api_id, api_hash)
        await client.start()
        me = await client.get_me()
        print(f"OK: авторизовано як {getattr(me, 'username', None) or me.id}")
        await client.disconnect()

    asyncio.run(run())
    print(f"Файл сесії: {path}.session")


if __name__ == "__main__":
    main()
