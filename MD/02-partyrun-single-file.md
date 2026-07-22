# 02 — `partyrun_single_file.py` (Party Run farm engine)

**Path:** `exe_รอทำ/PartyRun/partyrun_single_file.py`  
**Production twin:** `CKR WWDC/server/farm/partyrun_core.py` (เกือบเหมือนกัน + ห่อ `run_farm()` / `FarmError`)

เอกสารนี้อธิบาย flow จากต้นทาง single-file — API เรียก logic เดียวกันผ่าน `run_farm(...)`.

---

## What it does (no device needed)

1. Login DevPlay email/password → `game_access_token` + `mid`
2. Clear pending Party Run rewards (claim / finalize stuck session)
3. Matchmake SOLO Party Run via `RoomStream`
4. Join ingame server → submit `run_end_request` with configured score/coin/exp
5. `quit_request` เพื่อ finalize เร็ว → `ClaimPartyRunReward`

---

## Config block (top of file)

| Symbol | Meaning | Typical |
|--------|---------|---------|
| `EMAIL` / `PASSWORD` | DevPlay credentials | set per run |
| `SCORE` | cosmetic score submitted | e.g. 800000 |
| `COIN` | `earned_coin` ที่เซิร์ฟเกมเชื่อ client | user-chosen |
| `EXP` | `earned_exp` | **ระวังค่าใหญ่เกิน → corrupt pending** |
| `PLAYTIME_SECONDS` | sleep ก่อน submit | 2 |
| `QUIT_AFTER_SECONDS` | หลัง run_end ก่อน quit | 1 |
| `IGNORE_SAVING_REPLAY` | ข้าม replay upload | `True` |

### Fixed endpoints / client shape

| Name | Value |
|------|-------|
| `AUTH_HOST` | `https://account.devplay.com` |
| `GSERVER` | `gserver.live.prod.devsnova.cloud:443` |
| `STREAMING` | `streaming.live.prod.devsnova.cloud:443` |
| Login path | `POST /v3/login/devsisters` |
| Bundle | `com.devsisters.crg` |
| `COMBO_NAME` | `26.6.1_dusrmsdyrhl_crg` |
| `LIVE_INDEX_HASH` | `26e9ec2e5bc49b34877b3d784db97c5c` |

Protobuf descriptors ถูก embed เป็น `_DESCRIPTORS_B64` (zlib+base64) — ไม่ต้องมี `_pb2.py`.

---

## Key functions

### `login()`
- `POST {AUTH_HOST}/v3/login/devsisters` with email/password + `lc` device block
- Success code: `20000`
- Returns `(game_access_token, mid, lc)`
- Failure: single-file exits; core raises `FarmError("login_failed")`

### `_build_pool()` / `msgcls()`
- Build in-memory descriptor pool from embedded FileDescriptorSet
- Message types: `RoomInbound/Outbound`, `IngameInbound/Outbound`, etc.

### `unary(endpoint, service, method, req, md)`
- Generic secure gRPC unary helper
- Errors → `{"__error__": True, "code": ..., "details": ...}`

### `party_run_init()`
- `MatchMakerAPI.PartyRunInit` on `STREAMING`
- Used to list unclaimed / last session

### `claim(ingame_id)`
- `RewardAPI.ClaimPartyRunReward` on `GSERVER`
- Credits coin/exp/gem/ticket; returns reward payload with `delta`/`total`

### `get_my_equipment()`
- `MemberAPI.GetMemberSummary`
- Currently extracts:
  - `nick` (nickname)
  - `pic`, `tier`, `cookie`, `pet`, `treas`
- **ยังไม่ extract coins/XP/level totals** — สำคัญสำหรับ peek (ดู `09`)

### `clear_pending(my, max_loops=8)`
- Claim unclaimed rewards
- ถ้า session ค้าง → `finalize_session` (reconnect + quit) แล้ว claim ใหม่
- ถ้า claim ได้ `INTERNAL SERVER ERROR` โดยไม่มี live session → **corrupt pending**  
  → return `{"corrupt": ingame_id}` (ไม่มี API ลบ — รอ daily/season reset)

### `matchmake(my)`
- Bidirectional `MatchMakerAPI.RoomStream`
- Flow: `create_and_join_request` (ROOM_TYPE_SOLO) → ready → `start_match_making_request` → `match_making_done.session_info`

### `play_and_submit(session, my)`
- Connect **insecure** gRPC to `{address}:{port}` (h2c)
- Heartbeat pings; on `RUN_START` submit:
  - `final_score=SCORE`, `earned_coin=COIN`, `earned_exp=EXP`
- Then `quit_request` เพื่อ finalize

### `main()` / `run_farm(...)` (core only)
Pipeline `[1/4]…[4/4]` ตามด้านบน  
`run_farm` ใน `partyrun_core.py`:

```python
run_farm(email, password, score=..., coin=..., exp=..., log_cb=None, ...)
```

- Sets globals, redirects `print` → `log_cb`
- Returns dict:
  - success: `{ok, reward, reward_summary, account, ingame_id}`
  - fail: `{ok: False, error: "<code>", ...}`

`reward_summary` fields used by UI:

- `coin_delta`, `coin_total`, `exp_delta`, `exp_total`, `level`, `nickname`

---

## Error codes (API / UI map)

| Code / symptom | Meaning |
|----------------|---------|
| `login_failed` / `LOGIN FAILED` | wrong DevPlay credentials |
| `corrupt_pending` / `BLOCKED` | stuck unclaimable reward (too much EXP historically) |
| `matchmaking_failed` | RoomStream failed |
| `claim_timeout` | claim retries exhausted |
| `farm_error` | unexpected exception |

Thai messages อยู่ใน `CKR WWDC/js/app.js` → `ERR_TH`.

---

## Important behavioral notes

1. **เซิร์ฟเกมเชื่อค่า `earned_coin` / `earned_exp` จาก client** — นี่คือที่มาของ “ฟาร์ม”
2. **EXP ใหญ่เกินทำให้ claim พัง** (level-up crash server-side) → corrupt pending
3. Score ส่วนใหญ่ cosmetic; rewards มาจาก coin/exp ที่ส่ง
4. Single-file เรียก `login()` ที่ import-time; **core** เลื่อนไป `_init_session()` ใน `main()`/`run_farm()` เพื่อให้ใส่ email ทีหลังได้
5. Docs อ้างอิงเพิ่ม: `exe_รอทำ/PartyRun/README_partyrun.md`

---

## Relation to desktop WIP

`exe_รอทำ/PartyRun/app/` + encrypted core loader + Cloudflare worker เป็นเส้นทางทำ exe แยก — **ไม่เกี่ยวกับ Pages farm UI** และไม่ใช่ next task
