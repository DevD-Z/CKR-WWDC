# 09 — CURRENT NEXT TASK: Account peek (ดู coins / XP / nickname ก่อนฟาร์ม)

## Status

**NOT IMPLEMENTED** — อภิปรายและตกลงดีไซน์แล้วเท่านั้น (2026-07-22 ~00:31–00:48)  
AI รอบถัดไปควร **เริ่มที่นี่** (อย่าเดาสถาปัตยกรรมใหม่)

---

## User goal

ก่อนกดฟาร์ม ผู้ใช้อยากกดปุ่มเพื่อดูสถานะบัญชีเกมปัจจุบัน:

- **nickname**
- **coins** (ยอดในเกม)
- **XP** (และ level ถ้าดึงได้)

โดยใช้ DevPlay email/password จาก `#dp-acct-mail` / `#dp-acct-secret`

---

## Agreed product rules

| Rule | Detail |
|------|--------|
| Share farm lock | Peek ใช้กลไกล็อกเดียวกับฟาร์ม (กันชนบน Free 1 instance) |
| No farm FIFO queue | Peek **ไม่** `join_queue` / ไม่ได้เทิร์น 2 นาที |
| Only when free | ถ้า `_farm_busy` หรือ `farm_lock` มี holder → busy response + ปิดปุ่ม |
| Mutual exclusion | ระหว่าง peek กำลังรัน → **บล็อกเริ่มฟาร์ม** (และกลับกัน) |
| No token charge | **ห้าม** เรียก `consume_token` |
| Rate limit peeks | กันสแปมปลุก/ยึด Free instance |
| Cost expectation | ถูกกว่าฟาร์ม (แค่ login + GetMemberSummary) แต่ยัง occupy instance สั้นๆ + cold start ได้ |

---

## Concrete implementation plan

### A) `partyrun_core.py` — เพิ่มฟังก์ชัน peek

**File:** `CKR WWDC/server/farm/partyrun_core.py`

เพิ่มประมาณ:

```python
def peek_account(email, password, log_cb=None):
    """Login + GetMemberSummary only. No matchmaking / run / claim."""
```

Suggested steps inside:

1. ตั้ง `EMAIL`/`PASSWORD` (เหมือน `run_farm`)
2. `_init_session()` (DevPlay login)
3. เรียก `MemberAPI.GetMemberSummary` (reuse `unary` / logic ใน `get_my_equipment`)
4. Parse ให้ได้อย่างน้อย:
   - `nickname`
   - `mid`
   - `coins` / `coin` total
   - `exp` / `xp` total
   - `level` (ถ้ามีใน payload)
5. Return:

```python
{
  "ok": True,
  "nickname": "...",
  "mid": "...",
  "coin": 123,
  "exp": 456,
  "level": 79,   # optional
  "raw": {...}   # optional, อย่าส่งกลับ client ทั้งก้อนถ้าใหญ่/sensitive เกิน
}
```

**สำคัญ:** `get_my_equipment()` ปัจจุบันดึงแค่ nick/equipment — **ยังไม่มี coin/XP**  
ต้อง inspect โครงสร้าง `member_summary` จริงครั้งหนึ่ง (log keys ชั่วคราวบน local) แล้ว map field ที่ถูก  
ถ้า GetMemberSummary ไม่มี currency → ค้น unary อื่นที่มีอยู่แล้วใน descriptor pool (อย่าเดาชื่อมั่ว) แล้วอัปเดต docs

Mirror แนวทาง error เหมือน `run_farm`:

- `FarmError("login_failed")` → `{ok:false, error:"login_failed"}`

**อย่า** เรียก clear_pending / matchmake / play / claim

---

### B) `server/main.py` — endpoint

Suggested:

```http
POST /api/farm/peek
Authorization: Bearer <jwt>
Content-Type: application/json

{ "email": "...", "password": "..." }
```

Behavior:

1. `verify_user` (ต้องล็อกอินเว็บ)
2. **ไม่** ตรวจ token_balance / **ไม่** consume
3. ถ้า `_farm_busy` หรือ `_farm_lock` ถือไม่ได้แบบ non-blocking → **409** `{code:"farm_busy"}`  
   (อ่าน `farm_lock` จาก Supabase เป็นข้อมูลเสริมได้ แต่ in-process lock คือตัวกันจริงบน instance)
4. Acquire same `_farm_lock`, set `_farm_busy=True` (หรือแยก `_peek_busy` แต่ต้องให้ farm_run เห็นว่า busy — **แนะนำใช้ flag ร่วม** ง่ายสุด)
5. `asyncio.to_thread(peek_account, ...)`
6. `finally` release lock + clear busy (+ clear `farm_lock` ถ้าเคย set)
7. Optional: เขียน `farm_lock` ด้วย holder เพื่อให้ `/api/farm/gate` / health สะท้อน busy — ถ้าทำ ต้องไม่ไปยุ่ง `farm_queue`

**Rate limit (ขั้นต่ำที่ยอมรับได้บน Free single instance):**

- In-memory dict: `user_id → last_peek_ts` หรือ sliding window
- ตัวอย่างเริ่มต้น: **1 ครั้ง / 30–60 วินาที / user** (ปรับได้)
- Response 429 `{code:"peek_rate_limited"}`

Pydantic body: reuse แบบย่อของ `FarmRunBody` (email+password เท่านั้น) หรือ `PeekBody`

อัปเดต `/api/health` ถ้าต้องการโชว์ busy รวม peek

อัปเดต `farm_run` gate: ถ้า busy เพราะ peek → 409 เหมือนเดิม (frontend ไปโชว์ busy)

---

### C) Frontend

**Files:**

- `CKR WWDC/index.html`
- `CKR WWDC/js/app.js`
- `CKR WWDC/css/styles.css`

UI:

1. ปุ่มใกล้ grid ของ `#dp-acct-mail` / `#dp-acct-secret`  
   แนะนำ id: `#peek-btn` ข้อความเช่น **ดูสถานะบัญชีเกม**
2. กดแล้วอ่านค่า mail/secret จากฟอร์ม (ต้องไม่ว่าง)
3. `POST /api/farm/peek`
4. Modal โหมดใหม่ เช่น `modalMode = "peek"` แสดง:

   - nickname
   - เหรียญ (format commas)
   - XP (format commas)
   - level ถ้ามี

5. ระหว่างรอ: disable `#farm-btn` + `#peek-btn`; status line สั้นๆ
6. ถ้า 409 busy: ข้อความไทยชัดเจน (“มีคนกำลังฟาร์ม/ระบบไม่ว่าง”) — **ไม่บังคับเข้าคิว**
7. ถ้า 429: บอกให้รอ
8. ถ้า login_failed: ใช้ `ERR_TH.login_failed`

อย่าเปิด run-status pipeline ของฟาร์มสำหรับ peek (คนละ UX)

---

### D) Deploy order

1. Implement + test local
2. Commit/push **server** → รอ Render
3. Commit/push **frontend** (หรือพร้อมกันถ้าพร้อม)
4. Apply schema **เฉพาะเมื่อ** เพิ่มตาราง rate-limit (ไม่จำเป็นขั้นแรก)

หมายเหตุ: run-status popup ยัง uncommitted — ตัดสินใจ:

- commit แยกก่อน peek หรือ
- รวมใน PR เดียว (อย่าทำ docs นี้ให้กลายเป็น implement)

---

## Acceptance criteria

- [ ] ผู้ใช้ที่ล็อกอินเว็บแล้ว กรอก DevPlay ถูกต้อง กด peek → เห็น nickname + coins + XP ภายในเวลาสมเหตุสมผล (ไม่รวม cold start อาจนาน)
- [ ] Peek **ไม่ลด** `token_balance`
- [ ] ขณะมีฟาร์มกำลังรัน → peek ได้ 409/ปุ่ม disabled
- [ ] ขณะ peek กำลังรัน → กดฟาร์มไม่ได้ / ได้ busy
- [ ] Peek ไม่สร้างแถว `farm_queue` และไม่เริ่มเทิร์น 2 นาที
- [ ] spam peek โดน rate limit
- [ ] login ผิด → error ไทย ไม่ 500 เปล่า
- [ ] ไม่มี password ใน logs ที่ส่งกลับ client เกินจำเป็น

## Non-goals

- ไม่เคลียร์ pending / ไม่ฟาร์ม / ไม่ claim
- ไม่ทำ multi-account batch peek
- ไม่ทำ real-time websocket
- ไม่เพิ่มค่าโทเค็นสำหรับ peek ในเฟสนี้
- ไม่แก้ guest reroll / desktop exe

## Testing steps

1. Local: รัน uvicorn + เปิด UI ชี้ `API_BASE` local
2. Peek บัญชีทดสอบ → เทียบยอดในเกม (หรือผล claim ล่าสุด)
3. เริ่มฟาร์มอีกแท็บ/ยูสเซอร์ → peek ต้อง busy
4. Peek ค้าง (หรือ sleep ปลอม) → farm_run ต้อง 409
5. ยิง peek ถี่ๆ → 429
6. ตรวจ Supabase `token_ledger` ว่าไม่มีแถวจาก peek
7. ตรวจ `farm_queue` ว่าไม่เพิ่มแถวจาก peek
8. Deploy Render แล้วทดสอบผ่าน Pages จริง (รับ cold start)

## Suggested commit message (เมื่อทำจริง)

```
Add account peek (coins/XP/nickname) without token charge or farm queue.
```

---

## Open implementation detail (resolve while coding)

**Field path ของ coins/XP ใน GetMemberSummary** ยังไม่ถูก hardcodeในโค้ดปัจจุบัน  
ขั้นตอนแรกของ implementer: dump keys ของ `member_summary` จากบัญชีทดสอบ แล้ว map ให้ชัวร์ ก่อนทำ UI
