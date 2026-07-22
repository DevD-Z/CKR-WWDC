"""Farm queue + lock helpers (Supabase-backed FIFO, 2-minute turn)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

TURN_SECONDS = 120


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    return (dt or _now()).isoformat()


async def expire_stale_turns(
    client: httpx.AsyncClient, url: str, headers: dict[str, str]
) -> int:
    now = _iso()
    r = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={
            "status": "eq.active",
            "turn_expires_at": f"lt.{now}",
            "select": "id",
        },
        headers=headers,
    )
    if r.status_code != 200:
        return 0
    rows = r.json() or []
    for row in rows:
        await client.patch(
            f"{url}/rest/v1/farm_queue",
            params={"id": f"eq.{row['id']}"},
            headers=headers,
            json={"status": "expired", "updated_at": now},
        )
    return len(rows)


async def promote_next(
    client: httpx.AsyncClient, url: str, headers: dict[str, str]
) -> Optional[dict[str, Any]]:
    now = _now()
    active = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={"status": "eq.active", "select": "id", "limit": "1"},
        headers=headers,
    )
    if active.status_code == 200 and active.json():
        return None

    waiting = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={
            "status": "eq.waiting",
            "select": "*",
            "order": "joined_at.asc",
            "limit": "1",
        },
        headers=headers,
    )
    if waiting.status_code != 200 or not waiting.json():
        return None
    row = waiting.json()[0]
    expires = now + timedelta(seconds=TURN_SECONDS)
    await client.patch(
        f"{url}/rest/v1/farm_queue",
        params={"id": f"eq.{row['id']}"},
        headers=headers,
        json={
            "status": "active",
            "activated_at": _iso(now),
            "turn_expires_at": _iso(expires),
            "updated_at": _iso(now),
        },
    )
    row["status"] = "active"
    row["activated_at"] = _iso(now)
    row["turn_expires_at"] = _iso(expires)
    return row


async def queue_snapshot(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    user_id: str,
    farm_busy: bool,
) -> dict[str, Any]:
    await expire_stale_turns(client, url, headers)
    if not farm_busy:
        await promote_next(client, url, headers)

    waiting = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={
            "status": "eq.waiting",
            "select": "id,user_id,joined_at",
            "order": "joined_at.asc",
        },
        headers=headers,
    )
    active = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={"status": "eq.active", "select": "*", "limit": "1"},
        headers=headers,
    )
    mine = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={
            "user_id": f"eq.{user_id}",
            "status": "in.(waiting,active)",
            "select": "*",
            "limit": "1",
        },
        headers=headers,
    )

    waiting_rows = waiting.json() if waiting.status_code == 200 else []
    active_row = (active.json() or [None])[0] if active.status_code == 200 else None
    my_row = (mine.json() or [None])[0] if mine.status_code == 200 else None

    position = None
    if my_row and my_row.get("status") == "waiting":
        position = 1 + sum(1 for r in waiting_rows if r["joined_at"] < my_row["joined_at"])
        if active_row:
            position += 1
    elif my_row and my_row.get("status") == "active":
        position = 0

    total_waiting = len(waiting_rows) + (1 if active_row else 0)
    is_my_turn = bool(my_row and my_row.get("status") == "active")
    can_run = (not farm_busy) and (is_my_turn or (my_row is None and active_row is None))

    return {
        "farm_busy": farm_busy,
        "queue_length": total_waiting,
        "active": {
            "user_id": active_row.get("user_id") if active_row else None,
            "turn_expires_at": active_row.get("turn_expires_at") if active_row else None,
            "is_me": bool(active_row and active_row.get("user_id") == user_id),
        }
        if active_row
        else None,
        "me": {
            "status": my_row.get("status") if my_row else None,
            "position": position,
            "joined_at": my_row.get("joined_at") if my_row else None,
            "turn_expires_at": my_row.get("turn_expires_at") if my_row else None,
            "id": my_row.get("id") if my_row else None,
        },
        "can_run": can_run,
        "is_my_turn": is_my_turn,
        "turn_seconds": TURN_SECONDS,
    }


async def join_queue(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    user_id: str,
    farm_busy: bool,
) -> dict[str, Any]:
    await expire_stale_turns(client, url, headers)

    existing = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={
            "user_id": f"eq.{user_id}",
            "status": "in.(waiting,active)",
            "select": "id",
            "limit": "1",
        },
        headers=headers,
    )
    if existing.status_code == 200 and existing.json():
        return await queue_snapshot(client, url, headers, user_id, farm_busy)

    active = await client.get(
        f"{url}/rest/v1/farm_queue",
        params={"status": "eq.active", "select": "id", "limit": "1"},
        headers=headers,
    )
    has_active = active.status_code == 200 and bool(active.json())

    status = "waiting"
    activated_at = None
    turn_expires_at = None
    if not farm_busy and not has_active:
        status = "active"
        activated_at = _iso()
        turn_expires_at = _iso(_now() + timedelta(seconds=TURN_SECONDS))

    await client.post(
        f"{url}/rest/v1/farm_queue",
        headers={**headers, "Prefer": "return=minimal"},
        json={
            "user_id": user_id,
            "status": status,
            "activated_at": activated_at,
            "turn_expires_at": turn_expires_at,
        },
    )
    return await queue_snapshot(client, url, headers, user_id, farm_busy)


async def mark_queue_done(
    client: httpx.AsyncClient, url: str, headers: dict[str, str], user_id: str
) -> None:
    await client.patch(
        f"{url}/rest/v1/farm_queue",
        params={"user_id": f"eq.{user_id}", "status": "in.(waiting,active)"},
        headers=headers,
        json={"status": "done", "updated_at": _iso()},
    )


async def set_farm_lock(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    user_id: Optional[str],
    job_id: Optional[str] = None,
) -> None:
    await client.patch(
        f"{url}/rest/v1/farm_lock",
        params={"id": "eq.1"},
        headers=headers,
        json={
            "holder_user_id": user_id,
            "job_id": job_id,
            "started_at": _iso() if user_id else None,
            "updated_at": _iso(),
        },
    )


async def read_farm_lock(
    client: httpx.AsyncClient, url: str, headers: dict[str, str]
) -> dict[str, Any]:
    r = await client.get(
        f"{url}/rest/v1/farm_lock",
        params={"id": "eq.1", "select": "*"},
        headers=headers,
    )
    if r.status_code == 200 and r.json():
        return r.json()[0]
    return {}
