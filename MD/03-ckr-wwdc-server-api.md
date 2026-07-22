# 03 — CKR WWDC server API

**Entry:** `CKR WWDC/server/main.py` (`uvicorn server.main:app`)  
**Farm engine:** `CKR WWDC/server/farm/partyrun_core.py` → `run_farm(...)`  
**Queue helpers:** `CKR WWDC/server/farm_queue.py`

---

## Runtime constraints (Render Free)

| Constraint | Implication |
|------------|-------------|
| Free plan, **1 instance** | ไม่มี horizontal scale |
| Cold start | request แรกช้ามาก; UI มีข้อความ “กำลังปลุกเซิร์ฟเวอร์…” |
| In-process `_farm_lock` + `_farm_busy` | **ฟาร์มพร้อมกันไม่ได้** บน process เดียวกัน |
| Supabase `farm_lock` row id=1 | lock ข้าม restart / สำหรับ UI gate |
| FIFO `farm_queue` + **TURN_SECONDS = 120** | คนถึงคิวมี 2 นาทีต้องกดเริ่ม ไม่งั้น expire |

**อย่าสมมติว่ามี worker queue แยก** — farm รันใน request ด้วย `asyncio.to_thread(_run_farm_sync, ...)`.

---

## Auth model

1. Client `POST /api/auth/login` ด้วย `{username, password}`
2. Server resolve auth email:
   - Prefer RPC `resolve_username_email` (service_role)
   - Fallback: username-as-email (admin) + synthetic `{sanitized}@users.ckr.local`
3. Supabase `grant_type=password` → access/refresh tokens
4. Subsequent API calls: `Authorization: Bearer <access_token>`
5. `verify_user` → `GET {SUPABASE}/auth/v1/user`
6. Profile from `profiles` (role, username, token_balance)

Admin endpoints require `profiles.role == "admin"`.

---

## Endpoints

### Public / user

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/` | no | JSON pointers to UI/admin |
| GET | `/api/health` | no | `farm_busy`, supabase flags |
| POST | `/api/auth/login` | no | username login |
| GET | `/api/me` | JWT | profile + tokens |
| GET | `/api/farm/gate` | JWT | queue snapshot + `can_run` |
| POST | `/api/farm/queue/join` | JWT | enqueue / activate turn |
| POST | `/api/farm/run` | JWT | **consumes 1 token**, runs farm |

### Admin (Login_j3xdr)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/admin/lookup?q=` | find user by username |
| POST | `/api/admin/add-tokens` | credit tokens |
| POST | `/api/admin/create-user` | create Auth user + profile |
| GET | `/api/admin/users` | list profiles |

### NOT IMPLEMENTED (next task)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/farm/peek` (suggested) | login + GetMemberSummary only — **no token charge** |

---

## `POST /api/farm/run` flow (critical)

Body (`FarmRunBody`):

```json
{
  "email": "devplay@...",
  "password": "...",
  "score": 0,
  "coin": 0,
  "exp": 0
}
```

Limits: ints `0 … 2_147_483_647`. Email is plain `str` (not EmailStr) so odd accounts still work.

Sequence:

1. Load profile; require `token_balance >= 1`
2. Gate check via `farm_queue.queue_snapshot` — if busy / not `can_run` → **409** `farm_busy` (**before** spending token)
3. RPC `consume_token` reason `farm_run` (−1)
4. Optional insert `run_jobs` (service_role)
5. Acquire threading `_farm_lock` non-blocking; on fail → refund + 409
6. Set `_farm_busy=True`, mark queue done, set `farm_lock`, job=running
7. `await asyncio.to_thread(_run_farm_sync, ...)` → `partyrun_core.run_farm`
8. Return `{ok, token_balance, tokens_before/after, job_id, result, logs[-80:]}`
9. `finally`: clear busy/lock, expire stale turns, `promote_next`

Refund helper: `_refund_token` via `admin_credit_tokens` (service_role only).

---

## Queue semantics (`farm_queue.py`)

- Statuses: `waiting | active | done | expired | cancelled`
- Unique open row per user (`waiting`/`active`)
- `join_queue`: if free → become `active` with `turn_expires_at = now+120s`
- `can_run = (not farm_busy) and (is_my_turn OR (nobody queued and nobody active))`
- After farm starts: `mark_queue_done` → promote waiter

Gate response shape (approx):

```json
{
  "farm_busy": false,
  "queue_length": 1,
  "active": {"user_id": "...", "turn_expires_at": "...", "is_me": true},
  "me": {"status": "active", "position": 0, "turn_expires_at": "..."},
  "can_run": true,
  "is_my_turn": true,
  "turn_seconds": 120
}
```

---

## CORS allowlist (`ALLOWED_ORIGINS`)

- `https://j3xdr.github.io`
- `http://localhost:5500`, `127.0.0.1:5500`
- `http://localhost:8000`, `127.0.0.1:8000`

---

## Env vars (Render)

See `08-secrets-safety.md`. Required for useful operation:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (queue/lock/jobs/admin create; placeholder `REPLACE*` treated as unset)

---

## Integration point for peek

Reuse:

- Same `_farm_lock` / `_farm_busy` (or at least refuse when busy + share lock)
- Same DevPlay login + `GetMemberSummary` path inside `partyrun_core`
- **Do not** call `consume_token`
- **Do not** call `join_queue`

Details in `09-NEXT-TASK-account-peek.md`.
