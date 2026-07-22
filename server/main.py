"""hotdog. API — FastAPI farm backend (no HTML UI)."""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from urllib.parse import quote, urlencode
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
FARM_DIR = SERVER_DIR / "farm"

if str(FARM_DIR) not in sys.path:
    sys.path.insert(0, str(FARM_DIR))
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import farm_queue as fq  # noqa: E402

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "https://ckr-wwdc-x0pe.onrender.com/api/auth/discord/callback")

print("[boot] SUPABASE_URL set:", bool(SUPABASE_URL))
print("[boot] DISCORD_CLIENT_ID set:", bool(DISCORD_CLIENT_ID))

# Sequential farm queue (Render Free = single instance)
_farm_lock = threading.Lock()
_farm_busy = False

ALLOWED_ORIGINS = [
    "https://devd-z.github.io",
    "https://ckr-wwdc-x0pe.onrender.com",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]


def _require_env() -> None:
    missing = [k for k, v in {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_ANON_KEY": SUPABASE_ANON_KEY,
    }.items() if not v]
    if missing:
        print(f"[warn] missing env: {', '.join(missing)}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _require_env()
    yield


app = FastAPI(title="hotdog. API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
STATIC_DIR = ROOT / "static"
STATIC_DIR.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

from fastapi.responses import FileResponse

@app.get("/app/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str):
    file_path = ROOT / full_path
    if file_path.exists() and file_path.is_file():
        return FileResponse(str(file_path))
    index = ROOT / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"ok": False, "detail": "not_found"}, status_code=404)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    username: str = Field(min_length=2, max_length=128)
    password: str = Field(min_length=1)


class FarmRunBody(BaseModel):
    # DevPlay login id — keep as str (not EmailStr) so unusual accounts still reach the farm core
    email: str = Field(min_length=3, max_length=256)
    password: str = Field(min_length=1)
    score: int = Field(default=0, ge=0, le=2_147_483_647)
    coin: int = Field(default=0, ge=0, le=2_147_483_647)
    exp: int = Field(default=0, ge=0, le=2_147_483_647)

    @field_validator("email")
    @classmethod
    def _trim_email(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("email_required")
        return s


class AdminCreateUserBody(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6)
    initial_tokens: int = Field(default=0, ge=0, le=1_000_000)


class AdminAddTokensBody(BaseModel):
    query: str = Field(min_length=2, description="username (or legacy email)")
    amount: int = Field(ge=1, le=1_000_000)
    reason: str = "admin_credit"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sb_headers(key: str, jwt: Optional[str] = None) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {jwt or key}",
        "Content-Type": "application/json",
    }


def _has_service_role() -> bool:
    key = (SUPABASE_SERVICE_ROLE_KEY or "").strip()
    if not key or key.startswith("REPLACE"):
        return False
    return len(key) > 20


def _service_headers() -> dict[str, str]:
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    return _sb_headers(SUPABASE_SERVICE_ROLE_KEY)


def _synthetic_email(username: str) -> str:
    """Internal Auth email — never shown as a customer-facing field."""
    raw = (username or "").strip().lower()
    safe = re.sub(r"[^a-z0-9._+-]+", "_", raw).strip("._+-")
    if not safe:
        safe = "user"
    if len(safe) > 64:
        safe = safe[:64]
    return f"{safe}@users.ckr.local"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def verify_user(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_bearer_token")
    token = authorization.split(" ", 1)[1].strip()
    if not token or not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=401, detail="auth_not_configured")

    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers=_sb_headers(SUPABASE_ANON_KEY, token),
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="invalid_token")
    user = r.json()
    user["_access_token"] = token
    return user


async def load_profile(user: dict[str, Any]) -> dict[str, Any]:
    uid = user["id"]
    token = user["_access_token"]
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}", "select": "*"},
            headers={
                **_sb_headers(SUPABASE_ANON_KEY, token),
                "Accept": "application/json",
            },
        )
    if r.status_code != 200 or not r.json():
        raise HTTPException(status_code=403, detail="profile_missing")
    return r.json()[0]


async def require_admin(user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
    profile = await load_profile(user)
    if profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    user["_profile"] = profile
    return user


def _public_profile(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": profile["id"],
        "role": profile.get("role"),
        "username": profile.get("username"),
        "display_name": profile.get("display_name"),
        "token_balance": profile.get("token_balance", 0),
    }


# ---------------------------------------------------------------------------
# Health + root (JSON only — UI lives on GitHub Pages)
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    return {
        "ok": True,
        "service": "ckr-wwdc-api",
        "docs": "/api/health",
        "ui": "https://devd-z.github.io/CKR-WWDC/",
        "admin": "https://devd-z.github.io/CKR-WWDC/admin.html",
    }


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "service": "ckr-wwdc",
        "farm_busy": _farm_busy,
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_ANON_KEY),
        "service_role_configured": _has_service_role(),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/me")
async def me(user: dict[str, Any] = Depends(verify_user)):
    profile = await load_profile(user)
    return {
        "ok": True,
        "user": {
            "id": user["id"],
            "username": profile.get("username"),
        },
        "profile": _public_profile(profile),
    }


# ---------------------------------------------------------------------------
# Auth: username + password → Supabase session (Pages never need email)
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
async def auth_login(body: LoginBody):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="auth_not_configured")

    username = body.username.strip()
    resolved: dict[str, Any] = {}
    candidates: list[str] = []

    # Prefer DB resolve when service_role is available
    if _has_service_role():
        async with httpx.AsyncClient(timeout=20.0) as client:
            looked = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/resolve_username_email",
                headers=_service_headers(),
                json={"p_username": username},
            )
            if looked.status_code == 200:
                data = looked.json() or {}
                if data.get("ok") and data.get("email"):
                    resolved = data
                    candidates.append(str(data["email"]))

    # Fallback: username-as-email (admin) + synthetic local email (customers)
    if "@" in username:
        candidates.append(username)
    candidates.append(_synthetic_email(username))

    seen: set[str] = set()
    emails: list[str] = []
    for e in candidates:
        key = e.strip().lower()
        if key and key not in seen:
            seen.add(key)
            emails.append(e.strip())

    session: Optional[dict[str, Any]] = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for auth_email in emails:
            sign = await client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers=_sb_headers(SUPABASE_ANON_KEY),
                json={"email": auth_email, "password": body.password},
            )
            if sign.status_code == 200:
                session = sign.json()
                break
        if not session or not session.get("access_token"):
            raise HTTPException(status_code=401, detail="invalid_credentials")

        access = session["access_token"]
        uid = (session.get("user") or {}).get("id") or resolved.get("id")
        profile_row: dict[str, Any] = {}
        if uid:
            pr = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{uid}", "select": "*"},
                headers={
                    **_sb_headers(SUPABASE_ANON_KEY, access),
                    "Accept": "application/json",
                },
            )
            if pr.status_code == 200 and pr.json():
                profile_row = pr.json()[0]

    profile_out = {
        "id": profile_row.get("id") or resolved.get("id") or uid,
        "role": profile_row.get("role") or resolved.get("role"),
        "username": profile_row.get("username") or resolved.get("username") or username,
        "display_name": profile_row.get("display_name") or resolved.get("display_name"),
        "token_balance": profile_row.get("token_balance", resolved.get("token_balance", 0)),
    }

    return {
        "ok": True,
        "access_token": session.get("access_token"),
        "refresh_token": session.get("refresh_token"),
        "expires_in": session.get("expires_in"),
        "token_type": session.get("token_type", "bearer"),
        "user": {
            "id": profile_out["id"],
            "username": profile_out["username"],
        },
        "profile": profile_out,
    }


# ---------------------------------------------------------------------------
# Discord OAuth2
# ---------------------------------------------------------------------------
@app.get("/api/auth/discord")
async def discord_auth():
    if not DISCORD_CLIENT_ID:
        raise HTTPException(status_code=503, detail="discord_not_configured")
    params = urlencode({
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify",
    })
    return {"ok": True, "url": f"https://discord.com/api/oauth2/authorize?{params}"}


@app.get("/api/auth/discord/callback")
async def discord_callback(code: str):
    def _home(reason: str = ""):
        suffix = f"#discord_error={reason}" if reason else ""
        return HTMLResponse(
            content=f'<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>Redirecting...</title><meta http-equiv="refresh" content="0;url=https://devd-z.github.io/CKR-WWDC/{suffix}"></head><body><p>Redirecting...</p></body></html>',
            status_code=200,
        )
    try:
        if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET:
            return _home("no_discord_creds")
        if not code:
            return _home("no_code")
        if not _has_service_role():
            return _home("no_svc_role")

        async with httpx.AsyncClient(timeout=20.0) as client:
            token_resp = await client.post(
                "https://discord.com/api/oauth2/token",
                data={
                    "client_id": DISCORD_CLIENT_ID,
                    "client_secret": DISCORD_CLIENT_SECRET,
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": DISCORD_REDIRECT_URI,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if token_resp.status_code != 200:
                return _home("discord_token_fail")
            token_data = token_resp.json()
            discord_token = token_data.get("access_token")

            user_resp = await client.get(
                "https://discord.com/api/users/@me",
                headers={"Authorization": f"Bearer {discord_token}"},
            )
            if user_resp.status_code != 200:
                return _home("discord_user_fail")
            discord_user = user_resp.json()

        discord_id = str(discord_user.get("id"))
        discord_username = discord_user.get("username", "")
        discord_avatar = discord_user.get("avatar", "")

        svc = _service_headers()

        async with httpx.AsyncClient(timeout=30.0) as client:
            match = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"discord_id": f"eq.{discord_id}", "select": "*"},
                headers={**svc, "Accept": "application/json"},
            )
            existing = match.json()[0] if match.status_code == 200 and match.json() else None

            if existing:
                uid = existing["id"]
                auth_email = existing.get("email")
                if not auth_email:
                    return _home("existing_no_email")
                await client.patch(
                    f"{SUPABASE_URL}/rest/v1/profiles",
                    params={"id": f"eq.{uid}"},
                    headers=svc,
                    json={"discord_username": discord_username, "discord_avatar": discord_avatar},
                )
                temp_pass = os.urandom(32).hex()
                pw_resp = await client.put(
                    f"{SUPABASE_URL}/auth/v1/admin/users/{uid}",
                    headers=svc,
                    json={"password": temp_pass},
                )
                if pw_resp.status_code not in (200, 204):
                    return _home(f"pw_update_fail:{pw_resp.status_code}")
            else:
                auth_email = f"discord_{discord_id}@discord.ckr.local"
                temp_pass = os.urandom(32).hex()
                cr = await client.post(
                    f"{SUPABASE_URL}/auth/v1/admin/users",
                    headers=svc,
                    json={
                        "email": auth_email,
                        "password": temp_pass,
                        "email_confirm": True,
                        "user_metadata": {"username": discord_username, "display_name": discord_username},
                    },
                )
                if cr.status_code in (200, 201):
                    uid = cr.json().get("id")
                elif cr.status_code == 422:
                    lu = await client.get(
                        f"{SUPABASE_URL}/auth/v1/admin/users",
                        headers=svc,
                        params={"email": auth_email},
                    )
                    uid = (lu.json().get("users") or [None])[0].get("id") if lu.status_code == 200 and lu.json() else None
                    if not uid:
                        return _home("no_uid_422")
                    await client.put(
                        f"{SUPABASE_URL}/auth/v1/admin/users/{uid}",
                        headers=svc,
                        json={"password": temp_pass},
                    )
                else:
                    return _home("create_user_fail")
                if not uid:
                    return _home("no_uid")
                await client.patch(
                    f"{SUPABASE_URL}/rest/v1/profiles",
                    params={"id": f"eq.{uid}"},
                    headers={**svc, "Prefer": "return=representation"},
                    json={
                        "email": auth_email,
                        "username": discord_username,
                        "display_name": discord_username,
                        "role": "normal",
                        "token_balance": 0,
                        "discord_id": discord_id,
                        "discord_username": discord_username,
                        "discord_avatar": discord_avatar,
                    },
                )

        async with httpx.AsyncClient(timeout=30.0) as client:
            sign = await client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers=_sb_headers(SUPABASE_ANON_KEY),
                json={"email": auth_email, "password": temp_pass},
            )
            if sign.status_code != 200:
                body_text = sign.text[:200]
                return _home(f"sign_in_fail:{sign.status_code}:{body_text}")

            session = sign.json()

        profile_out = {
            "id": uid,
            "role": existing.get("role", "normal") if existing else "normal",
            "username": discord_username,
            "display_name": discord_username,
            "token_balance": existing.get("token_balance", 0) if existing else 0,
        }

        access_token_str = session.get("access_token", "")
        redirect_url = f"https://devd-z.github.io/CKR-WWDC/#access_token={access_token_str}"

        html_page = f"""<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>Redirecting...</title><meta http-equiv="refresh" content="0;url={redirect_url}"></head><body><p>Signing in... redirecting to dashboard.</p></body></html>"""

        return HTMLResponse(content=html_page, status_code=200)
    except Exception as exc:
        return _home(f"exception:{type(exc).__name__}")


def _svc():
    """Service-role headers for queue/lock tables."""
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    return _service_headers()


async def _gate_for(user_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        return await fq.queue_snapshot(
            client, SUPABASE_URL, _svc(), user_id, _farm_busy
        )


# ---------------------------------------------------------------------------
# Farm gate / queue
# ---------------------------------------------------------------------------
@app.get("/api/farm/gate")
async def farm_gate(user: dict[str, Any] = Depends(verify_user)):
    snap = await _gate_for(user["id"])
    return {"ok": True, **snap}


@app.post("/api/farm/queue/join")
async def farm_queue_join(user: dict[str, Any] = Depends(verify_user)):
    async with httpx.AsyncClient(timeout=20.0) as client:
        snap = await fq.join_queue(
            client, SUPABASE_URL, _svc(), user["id"], _farm_busy
        )
    return {"ok": True, **snap}


# ---------------------------------------------------------------------------
# Farm run (JWT + consume 1 token + sequential execution)
# ---------------------------------------------------------------------------
@app.post("/api/farm/run")
async def farm_run(body: FarmRunBody, user: dict[str, Any] = Depends(verify_user)):
    global _farm_busy
    profile = await load_profile(user)
    token = user["_access_token"]
    uid = user["id"]
    tokens_before = int(profile.get("token_balance") or 0)

    if tokens_before < 1:
        raise HTTPException(status_code=402, detail="insufficient_tokens")

    # Queue / busy gate BEFORE spending a token
    gate = await _gate_for(uid)
    if _farm_busy or not gate.get("can_run"):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "farm_busy",
                "message": "farm_busy",
                "gate": gate,
            },
        )
    # If someone holds an active turn and it's not me, block
    if gate.get("active") and not gate["active"].get("is_me") and gate.get("me", {}).get("status") != "active":
        raise HTTPException(
            status_code=409,
            detail={"code": "farm_busy", "message": "farm_busy", "gate": gate},
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        cons = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/consume_token",
            headers=_sb_headers(SUPABASE_ANON_KEY, token),
            json={"p_reason": "farm_run"},
        )
    if cons.status_code != 200:
        raise HTTPException(status_code=500, detail=f"consume_failed:{cons.text}")
    cons_data = cons.json()
    if not cons_data.get("ok"):
        reason = cons_data.get("reason", "consume_failed")
        code = 402 if reason == "insufficient_tokens" else 400
        raise HTTPException(status_code=code, detail=reason)

    job_id = None
    if _has_service_role():
        async with httpx.AsyncClient(timeout=20.0) as client:
            jr = await client.post(
                f"{SUPABASE_URL}/rest/v1/run_jobs",
                headers={
                    **_service_headers(),
                    "Prefer": "return=representation",
                },
                json={
                    "user_id": uid,
                    "status": "queued",
                    "score": body.score,
                    "coin": body.coin,
                    "exp": body.exp,
                },
            )
            if jr.status_code < 300 and jr.json():
                job_id = jr.json()[0]["id"]

    if not _farm_lock.acquire(blocking=False):
        await _refund_token(uid, "farm_busy_refund")
        gate2 = await _gate_for(uid)
        raise HTTPException(
            status_code=409,
            detail={"code": "farm_busy", "message": "farm_busy", "gate": gate2},
        )

    _farm_busy = True
    logs: list[str] = []

    def log_cb(msg: str) -> None:
        logs.append(msg)

    try:
        if _has_service_role():
            async with httpx.AsyncClient(timeout=20.0) as client:
                await fq.mark_queue_done(client, SUPABASE_URL, _svc(), uid)
                await fq.set_farm_lock(client, SUPABASE_URL, _svc(), uid, job_id)

        if job_id and _has_service_role():
            await _patch_job(job_id, {"status": "running", "started_at": _now()})

        result = await asyncio.to_thread(
            _run_farm_sync,
            body.email,
            body.password,
            body.score,
            body.coin,
            body.exp,
            log_cb,
        )

        ok = bool(result and result.get("ok"))
        if job_id and _has_service_role():
            await _patch_job(
                job_id,
                {
                    "status": "succeeded" if ok else "failed",
                    "result": result,
                    "error": None if ok else (result or {}).get("error"),
                    "finished_at": _now(),
                },
            )

        return {
            "ok": ok,
            "token_balance": cons_data.get("token_balance"),
            "tokens_before": tokens_before,
            "tokens_after": cons_data.get("token_balance"),
            "job_id": job_id,
            "result": result,
            "logs": logs[-80:],
        }
    except Exception as exc:
        if job_id and _has_service_role():
            await _patch_job(
                job_id,
                {
                    "status": "failed",
                    "error": str(exc),
                    "finished_at": _now(),
                },
            )
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "detail": "farm_error",
                "error": str(exc),
                "token_balance": cons_data.get("token_balance"),
                "tokens_before": tokens_before,
                "logs": logs[-80:],
                "trace": traceback.format_exc()[-2000:],
            },
        )
    finally:
        _farm_busy = False
        try:
            _farm_lock.release()
        except RuntimeError:
            pass
        if _has_service_role():
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    await fq.set_farm_lock(client, SUPABASE_URL, _svc(), None, None)
                    await fq.expire_stale_turns(client, SUPABASE_URL, _svc())
                    await fq.promote_next(client, SUPABASE_URL, _svc())
            except Exception:
                pass


class RedeemVoucherBody(BaseModel):
    username: Optional[str] = Field(None, min_length=2, max_length=128)
    voucher_url: str = Field(min_length=10, max_length=512)
    phone: str = Field(min_length=9, max_length=13, default="0644718725")


@app.post("/api/farm/redeem-voucher")
async def farm_redeem_voucher(
    body: RedeemVoucherBody,
    user: dict[str, Any] = Depends(verify_user),
):
    import re as _re
    import cloudscraper
    import certifi as _certifi

    url = body.voucher_url.strip()
    phone = body.phone.strip()
    uid = user["id"]

    match = _re.match(r"https://gift\.truemoney\.com/campaign/\?v=([a-zA-Z0-9]{18,})", url)
    if not match:
        raise HTTPException(status_code=400, detail="ลิงก์ซองไม่ถูกต้อง")

    voucher_hash = match.group(1)

    try:
        scraper = cloudscraper.create_scraper()
        resp = scraper.post(
            f"https://gift.truemoney.com/campaign/vouchers/{voucher_hash}/redeem",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            json={"mobile": phone, "voucher_hash": voucher_hash},
            verify=_certifi.where(),
            timeout=30,
        )
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"เรียก API TrueMoney ไม่สำเร็จ: {e}")

    code = (data.get("status") or {}).get("code", "UNKNOWN")
    message = (data.get("status") or {}).get("message", "")
    amount_str = (data.get("data") or {}).get("my_ticket", {}).get("amount_baht", "0")

    if code != "SUCCESS":
        raise HTTPException(status_code=400, detail=f"ซองไม่สำเร็จ: {code} — {message}")

    try:
        amount_baht = int(float(amount_str))
    except (ValueError, TypeError):
        amount_baht = 0

    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    # Fetch global voucher settings from admin profile
    svc = _service_headers()
    points_per_baht = 1
    voucher_phone = "0644718725"
    async with httpx.AsyncClient(timeout=20.0) as client:
        ar = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"role": "eq.admin", "select": "voucher_phone,points_per_baht", "limit": "1"},
            headers={**svc, "Accept": "application/json"},
        )
        if ar.status_code == 200 and ar.json():
            admin_row = ar.json()[0]
            voucher_phone = admin_row.get("voucher_phone", "0644718725")
            points_per_baht = int(admin_row.get("points_per_baht", 1))

    tokens = amount_baht * points_per_baht
    if tokens <= 0:
        raise HTTPException(status_code=400, detail=f"ยอดเงินไม่ถูกต้อง: {amount_str}")

    async with httpx.AsyncClient(timeout=20.0) as client:
        credit = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={"p_user_id": uid, "p_amount": tokens, "p_reason": "voucher_redeem"},
        )
        if credit.status_code != 200:
            raise HTTPException(status_code=500, detail=credit.text)
        credit_data = credit.json()

    return {
        "ok": True,
        "token_balance": credit_data.get("token_balance"),
        "amount_baht": amount_baht,
        "tokens_added": tokens,
    }


def _run_farm_sync(email, password, score, coin, exp, log_cb):
    from partyrun_core import run_farm  # noqa: WPS433 — server-only

    return run_farm(
        email=email,
        password=password,
        score=score,
        coin=coin,
        exp=exp,
        log_cb=log_cb,
    )


async def _patch_job(job_id: str, patch: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/run_jobs",
            params={"id": f"eq.{job_id}"},
            headers=_service_headers(),
            json=patch,
        )


async def _refund_token(user_id: str, reason: str) -> None:
    if not _has_service_role():
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={"p_user_id": user_id, "p_amount": 1, "p_reason": reason},
        )


# ---------------------------------------------------------------------------
# Admin (Login_j3xdr only — JWT admin + service_role on Render)
# ---------------------------------------------------------------------------
@app.get("/api/admin/lookup")
async def admin_lookup(q: str, admin: dict[str, Any] = Depends(require_admin)):
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=headers,
            json={"p_query": q},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    data = r.json()
    if data.get("ok"):
        # Prefer username in admin UI; keep email only as internal fallback
        data.pop("email", None)
    return data


@app.post("/api/admin/add-tokens")
async def admin_add_tokens(
    body: AdminAddTokensBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        looked = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=headers,
            json={"p_query": body.query},
        )
        data = looked.json() if looked.status_code == 200 else {}
        if not data.get("ok"):
            raise HTTPException(status_code=404, detail=data.get("reason", "not_found"))

        credit = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=headers,
            json={
                "p_user_id": data["id"],
                "p_amount": body.amount,
                "p_reason": body.reason,
            },
        )
    if credit.status_code != 200:
        raise HTTPException(status_code=500, detail=credit.text)
    out = credit.json()
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("reason", "credit_failed"))
    return {
        "ok": True,
        "id": out.get("id"),
        "username": data.get("username"),
        "token_balance": out.get("token_balance"),
    }


@app.post("/api/admin/create-user")
async def admin_create_user(
    body: AdminCreateUserBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username_required")

    # Block reserved / colliding usernames that look like internal domains
    lower = username.lower()
    if lower.endswith("@users.ckr.local") or lower.endswith("@ckr.local"):
        raise HTTPException(status_code=400, detail="invalid_username")

    auth_email = _synthetic_email(username)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Username uniqueness (also blocks collision with existing auth emails)
        exists = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=_service_headers(),
            json={"p_query": username},
        )
        if exists.status_code == 200 and (exists.json() or {}).get("ok"):
            raise HTTPException(status_code=409, detail="username_taken")

        cr = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_service_headers(),
            json={
                "email": auth_email,
                "password": body.password,
                "email_confirm": True,
                "user_metadata": {
                    "username": username,
                    "display_name": username,
                },
            },
        )
        if cr.status_code not in (200, 201):
            raise HTTPException(status_code=400, detail=cr.text)
        created = cr.json()
        uid = created.get("id")
        if not uid:
            raise HTTPException(status_code=500, detail="create_user_no_id")

        await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}"},
            headers={**_service_headers(), "Prefer": "return=representation"},
            json={
                "email": auth_email,
                "username": username,
                "display_name": username,
                "role": "normal",
                "token_balance": body.initial_tokens,
            },
        )

        if body.initial_tokens > 0:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/token_ledger",
                headers={**_service_headers(), "Prefer": "return=minimal"},
                json={
                    "user_id": uid,
                    "delta": body.initial_tokens,
                    "reason": "initial_grant",
                    "balance_after": body.initial_tokens,
                    "created_by": admin["id"],
                },
            )

    return {
        "ok": True,
        "id": uid,
        "username": username,
        "token_balance": body.initial_tokens,
    }



@app.get("/api/admin/queue")
async def admin_queue(admin: dict[str, Any] = Depends(require_admin)):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    async with httpx.AsyncClient(timeout=20.0) as client:
        waiting = await client.get(
            f"{SUPABASE_URL}/rest/v1/farm_queue",
            params={"status": "eq.waiting", "select": "*", "order": "joined_at.asc"},
            headers=_service_headers(),
        )
        active = await client.get(
            f"{SUPABASE_URL}/rest/v1/farm_queue",
            params={"status": "eq.active", "select": "*", "limit": "1"},
            headers=_service_headers(),
        )
        done = await client.get(
            f"{SUPABASE_URL}/rest/v1/farm_queue",
            params={"status": "eq.done", "select": "id,user_id,updated_at", "order": "updated_at.desc", "limit": "10"},
            headers=_service_headers(),
        )
        lock = await client.get(
            f"{SUPABASE_URL}/rest/v1/farm_lock",
            params={"id": "eq.1", "select": "*"},
            headers=_service_headers(),
        )

    waiting_rows = waiting.json() if waiting.status_code == 200 else []
    active_row = (active.json() or [None])[0] if active.status_code == 200 else None
    done_rows = done.json() if done.status_code == 200 else []
    lock_row = lock.json()[0] if lock.status_code == 200 and lock.json() else None

    user_ids = set()
    for r in waiting_rows:
        user_ids.add(r["user_id"])
    if active_row:
        user_ids.add(active_row["user_id"])
    for r in done_rows:
        user_ids.add(r["user_id"])

    usernames = {}
    if user_ids:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for uid in user_ids:
                pr = await client.get(
                    f"{SUPABASE_URL}/rest/v1/profiles",
                    params={"id": f"eq.{uid}", "select": "id,username"},
                    headers=_service_headers(),
                )
                if pr.status_code == 200 and pr.json():
                    usernames[uid] = pr.json()[0].get("username", uid[:8])

    now = datetime.now(timezone.utc)
    queue_list = []
    for i, r in enumerate(waiting_rows):
        queue_list.append({
            "position": i + 1,
            "user_id": r["user_id"],
            "username": usernames.get(r["user_id"], r["user_id"][:8]),
            "status": r["status"],
            "joined_at": r.get("joined_at"),
        })

    current = None
    if active_row:
        expires = None
        if active_row.get("turn_expires_at"):
            expires_dt = datetime.fromisoformat(active_row["turn_expires_at"].replace("Z", "+00:00"))
            remaining = max(0, int((expires_dt - now).total_seconds()))
            expires = {"at": active_row["turn_expires_at"], "remaining_sec": remaining}
        current = {
            "user_id": active_row["user_id"],
            "username": usernames.get(active_row["user_id"], active_row["user_id"][:8]),
            "activated_at": active_row.get("activated_at"),
            "turn_expires": expires,
        }

    last_done = []
    for r in done_rows:
        last_done.append({
            "user_id": r["user_id"],
            "username": usernames.get(r["user_id"], r["user_id"][:8]),
            "done_at": r.get("updated_at"),
        })

    return {
        "ok": True,
        "farm_busy": _farm_busy,
        "current": current,
        "queue": queue_list,
        "last_done": last_done,
        "lock": {
            "holder_user_id": lock_row.get("holder_user_id") if lock_row else None,
            "started_at": lock_row.get("started_at") if lock_row else None,
        } if lock_row else None,
    }


@app.get("/api/admin/users")
async def admin_users(admin: dict[str, Any] = Depends(require_admin)):
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_list_profiles",
            headers=_sb_headers(SUPABASE_ANON_KEY, admin["_access_token"]),
            json={},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    rows = r.json()
    safe = []
    for p in rows or []:
        safe.append(
            {
                "id": p.get("id"),
                "username": p.get("username"),
                "display_name": p.get("display_name"),
                "role": p.get("role"),
                "token_balance": p.get("token_balance", 0),
                "created_at": p.get("created_at"),
            }
        )
    return {"ok": True, "users": safe}


from fastapi.responses import HTMLResponse


@app.get("/admin", include_in_schema=False)
async def admin_page(user: dict[str, Any] = Depends(verify_user)):
    profile = await load_profile(user)
    if profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    admin_html = ROOT / "admin.html"
    if admin_html.exists():
        return HTMLResponse(content=admin_html.read_text(encoding="utf-8"))
    return JSONResponse({"ok": False, "detail": "admin.html not found"}, status_code=404)


class AdminUpdateUserBody(BaseModel):
    user_id: str = Field(min_length=20)
    role: Optional[str] = Field(None, pattern=r"^(admin|normal)$")
    token_balance: Optional[int] = Field(None, ge=0, le=2_147_483_647)


@app.post("/api/admin/update-user")
async def admin_update_user(
    body: AdminUpdateUserBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    patch: dict[str, Any] = {}
    if body.role is not None:
        patch["role"] = body.role
    if body.token_balance is not None:
        async with httpx.AsyncClient(timeout=20.0) as client:
            current = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{body.user_id}", "select": "token_balance"},
                headers=_service_headers(),
            )
            if current.status_code != 200 or not current.json():
                raise HTTPException(status_code=404, detail="user_not_found")
            old_balance = current.json()[0].get("token_balance", 0)
            delta = body.token_balance - old_balance
            patch["token_balance"] = body.token_balance

    if not patch:
        raise HTTPException(status_code=400, detail="nothing_to_update")

    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{body.user_id}"},
            headers={**_service_headers(), "Prefer": "return=representation"},
            json=patch,
        )
        if r.status_code != 200 or not r.json():
            raise HTTPException(status_code=500, detail=r.text)

    updated = r.json()[0]

    if body.token_balance is not None:
        async with httpx.AsyncClient(timeout=20.0) as client:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/token_ledger",
                headers={**_service_headers(), "Prefer": "return=minimal"},
                json={
                    "user_id": body.user_id,
                    "delta": delta,
                    "reason": "admin_adjust",
                    "balance_after": body.token_balance,
                    "created_by": admin["id"],
                },
            )

    return {
        "ok": True,
        "user": {
            "id": updated.get("id"),
            "username": updated.get("username"),
            "role": updated.get("role"),
            "token_balance": updated.get("token_balance"),
        },
    }


@app.post("/api/admin/redeem-voucher")
async def admin_redeem_voucher(
    body: RedeemVoucherBody,
    user: dict[str, Any] = Depends(verify_admin),
):
    import re as _re
    import cloudscraper
    import certifi as _certifi

    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    if not body.username:
        raise HTTPException(status_code=400, detail="ต้องระบุ username")

    url = body.voucher_url.strip()
    phone = body.phone.strip()

    match = _re.match(r"https://gift\.truemoney\.com/campaign/\?v=([a-zA-Z0-9]{18,})", url)
    if not match:
        raise HTTPException(status_code=400, detail="ลิงก์ซองไม่ถูกต้อง")

    voucher_hash = match.group(1)

    try:
        scraper = cloudscraper.create_scraper()
        resp = scraper.post(
            f"https://gift.truemoney.com/campaign/vouchers/{voucher_hash}/redeem",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            json={"mobile": phone, "voucher_hash": voucher_hash},
            verify=_certifi.where(),
            timeout=30,
        )
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"เรียก API TrueMoney ไม่สำเร็จ: {e}")

    code = (data.get("status") or {}).get("code", "UNKNOWN")
    message = (data.get("status") or {}).get("message", "")
    amount_str = (data.get("data") or {}).get("my_ticket", {}).get("amount_baht", "0")

    if code != "SUCCESS":
        raise HTTPException(status_code=400, detail=f"ซองไม่สำเร็จ: {code} — {message}")

    try:
        amount_baht = int(float(amount_str))
    except (ValueError, TypeError):
        amount_baht = 0

    tokens = amount_baht
    if tokens <= 0:
        raise HTTPException(status_code=400, detail=f"ยอดเงินไม่ถูกต้อง: {amount_str}")

    async with httpx.AsyncClient(timeout=20.0) as client:
        looked = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=_service_headers(),
            json={"p_query": body.username.strip()},
        )
        user_data = looked.json() if looked.status_code == 200 else {}
        if not user_data.get("ok"):
            raise HTTPException(status_code=404, detail=f"ไม่พบ user: {body.username}")

        uid = user_data["id"]
        credit = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={"p_user_id": uid, "p_amount": tokens, "p_reason": "voucher_redeem"},
        )
        if credit.status_code != 200:
            raise HTTPException(status_code=500, detail=credit.text)
        credit_data = credit.json()

    return {
        "ok": True,
        "username": user_data.get("username"),
        "token_balance": credit_data.get("token_balance"),
        "amount_baht": amount_baht,
        "tokens_added": tokens,
        "voucher_hash": voucher_hash,
    }


class VoucherSettingsBody(BaseModel):
    phone: str = Field(min_length=9, max_length=13, default="0644718725")
    points_per_baht: int = Field(ge=1, le=1000, default=1)


@app.get("/api/admin/voucher-settings")
async def get_voucher_settings(
    user: dict[str, Any] = Depends(verify_admin),
):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    uid = user["id"]
    svc = _service_headers()
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}", "select": "voucher_phone,points_per_baht"},
            headers={**svc, "Accept": "application/json"},
        )
        if r.status_code == 200 and r.json():
            row = r.json()[0]
            return {"ok": True, "phone": row.get("voucher_phone", "0644718725"), "points_per_baht": row.get("points_per_baht", 1)}
        # Columns may not exist yet — try full select and return defaults
        try:
            r2 = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{uid}", "select": "*"},
                headers={**svc, "Accept": "application/json"},
            )
        except Exception:
            pass
        return {"ok": True, "phone": "0644718725", "points_per_baht": 1}


@app.post("/api/admin/voucher-settings")
async def set_voucher_settings(
    body: VoucherSettingsBody,
    user: dict[str, Any] = Depends(verify_admin),
):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    uid = user["id"]
    svc = _service_headers()
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}"},
            headers=svc,
            json={"voucher_phone": body.phone.strip(), "points_per_baht": body.points_per_baht},
        )
        if r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=r.text)
    return {"ok": True, "phone": body.phone.strip(), "points_per_baht": body.points_per_baht}
