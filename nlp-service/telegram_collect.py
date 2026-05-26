"""
Збір повідомлень із заданого списку публічних Telegram-каналів (MTProto, Telethon).
"""

from __future__ import annotations

import logging
import os
from datetime import timezone
from pathlib import Path
from typing import Any, List

from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    RPCError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent


def _reaction_emojis(msg: Any) -> list[str]:
    """Повертає емодзі реакцій з повідомлення (Telethon), з урахуванням count."""
    out: list[str] = []
    rs = getattr(msg, "reactions", None)
    if not rs:
        return out
    results = getattr(rs, "results", None) or []
    for item in results:
        reaction_obj = getattr(item, "reaction", None)
        emoticon = getattr(reaction_obj, "emoticon", None)
        if not emoticon:
            continue
        count = int(getattr(item, "count", 1) or 1)
        out.extend([str(emoticon)] * max(1, min(count, 6)))
    return out


def _env_channels() -> List[str]:
    raw = os.environ.get("TELEGRAM_CHANNELS", "")
    return [c.strip().lstrip("@") for c in raw.split(",") if c.strip()]


def _client_params() -> tuple[int, str, Path]:
    api_id = int(os.environ.get("TELEGRAM_API_ID", "0") or "0")
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    name = os.environ.get("TELEGRAM_SESSION_NAME", "telegram_session").strip()
    session_dir = Path(os.environ.get("TELEGRAM_SESSION_DIR", str(BASE_DIR)))
    session_path = session_dir / name
    if not api_id or not api_hash:
        raise RuntimeError("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH")
    return api_id, api_hash, session_path


async def collect_telegram_posts(keyword: str, limit: int) -> List[dict[str, Any]]:
    channels = _env_channels()
    if not channels:
        raise RuntimeError("TELEGRAM_CHANNELS порожній — додайте @username через кому у .env")

    if limit < 1:
        return []

    api_id, api_hash, session_path = _client_params()
    kw = (keyword or "").strip()
    if not kw:
        raise RuntimeError("keyword порожній")

    kw_lower = kw.lower()
    per_channel = max(1, (limit + len(channels) - 1) // len(channels))

    posts: List[dict[str, Any]] = []

    async with TelegramClient(str(session_path), api_id, api_hash) as client:
        if not await client.is_user_authorized():
            raise RuntimeError(
                "Сесія Telegram не авторизована. У каталозі nlp-service виконайте: "
                "python telegram_login.py"
            )

        for uname in channels:
            if len(posts) >= limit:
                break
            try:
                entity = await client.get_entity(uname)
            except (UsernameInvalidError, UsernameNotOccupiedError, ValueError) as e:
                logger.warning("Telegram skip %s: %s", uname, e)
                continue
            except ChannelPrivateError:
                logger.warning("Telegram private channel: %s", uname)
                continue
            except RPCError as e:
                logger.warning("Telegram RPC %s: %s", uname, e)
                continue

            ch_username = getattr(entity, "username", None) or uname
            need_here = min(per_channel, limit - len(posts))
            if need_here <= 0:
                break
            got_here = 0
            try:
                async for msg in client.iter_messages(
                    entity, limit=min(800, max(120, per_channel * 30))
                ):
                    if len(posts) >= limit:
                        break
                    if got_here >= need_here:
                        break
                    if not getattr(msg, "message", None):
                        continue
                    text = str(msg.message).strip()
                    if kw_lower not in text.lower():
                        continue
                    r_emoji = _reaction_emojis(msg)
                    if r_emoji:
                        text = f"{text}\n\n[reactions] {' '.join(r_emoji)}"
                    created = msg.date
                    if created and created.tzinfo is None:
                        created = created.replace(tzinfo=timezone.utc)
                    link = (
                        f"https://t.me/{ch_username}/{msg.id}"
                        if ch_username
                        else ""
                    )
                    posts.append(
                        {
                            "id": f"tg-{ch_username}-{msg.id}",
                            "text": text,
                            "created_at": created.isoformat() if created else None,
                            "source": "telegram",
                            "permalink": link,
                            "author": f"@{ch_username}" if ch_username else uname,
                        }
                    )
                    got_here += 1
            except FloodWaitError as e:
                logger.warning("Telegram FloodWait on %s: %ss", uname, e.seconds)

    return posts[:limit]
