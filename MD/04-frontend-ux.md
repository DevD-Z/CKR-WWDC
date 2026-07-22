# 04 — Frontend UX (GitHub Pages)

**Served from repo root (not `static/`):**

- `CKR WWDC/index.html`
- `CKR WWDC/css/styles.css`
- `CKR WWDC/js/config.js`
- `CKR WWDC/js/app.js`
- `CKR WWDC/js/level_xp.js`
- `CKR WWDC/assets/*`

Config (`js/config.js`):

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public, RLS-protected)
- `API_BASE: "https://ckr-wwdc.onrender.com"`

---

## Views & shell IDs

| ID | Role |
|----|------|
| `#login-view` | username/password login |
| `#login-form`, `#login-user`, `#login-pass`, `#remember-me` | login form |
| `#user-view` | post-login farm UI |
| `#who-user`, `#token-balance`, `#nav-balance-num` | identity + tokens |
| `#logout-btn` | logout |
| `#farm-form` | DevPlay creds + stats + submit |
| `#dp-acct-mail`, `#dp-acct-secret` | game account fields (readonly until focus unlock pattern) |
| `#farm-score`, `#farm-coin`, `#farm-exp` | number inputs (comma + Thai magnitude hints) |
| `#farm-score-hint`, `#farm-coin-hint`, `#farm-exp-hint` | magnitude hints |
| `#farm-btn` | submit — “เริ่มฟาร์ม · ใช้ 1 โทเค็น” |
| `#farm-status` | inline status line |
| `#xp-calc-open`, `#xp-calc-card`, `#xp-cur`, `#xp-tgt`, `#xp-calc-apply` | level→XP tool |
| `#modal-root` | shared modal host |
| `#run-status-root` | **run pipeline popup** (local uncommitted — see `10`) |
| `#farm-log` | list inside run-status (or formerly inline log panel) |

---

## Number inputs UX

- Default `0`; focus clears zero placeholder
- Comma formatting; Thai magnitude hint (เช่น แปดแสน)
- Cap `INT32_MAX = 2147483647`
- When tokens empty → `setFarmInputsLocked(true)` + empty-coins modal

---

## XP calculator

- Source table: `cookierun_level_table.md`
- Builder: `tools/build_level_xp.py` → `js/level_xp.js`
- UI: open card, pick current/target level 1–110, apply into `#farm-exp`
- Label ในฟอร์มใช้คำว่า **XP** (ไม่ใช่ EXP) ตามการ rename ล่าสุด

---

## Modal modes (`modalMode`)

| Mode | Locked? | Purpose |
|------|---------|---------|
| `empty` | yes | โทเค็นหมด — Telegram top-up + poll balance |
| `confirm` | no | ยืนยันก่อนหักโทเค็น |
| `queue` | yes | คิว FIFO / busy / turn timer — ปิดไม่ได้จนกว่าถึงคิว (ยกเว้น force) |
| `result` | no | สรุปผลหลังฟาร์มสำเร็จ |
| `error` | no | error ทั่วไป (บางเส้นทางถูกลดการใช้หลังมี run-status) |

Telegram: `https://t.me/j3xdr`

### Queue modal behavior

- Poll `/api/farm/gate`
- Join via `POST /api/farm/queue/join`
- แสดง “ถึงคิวแล้ว / เหลือเวลา 2 นาที / อันดับในคิว”
- Cold start: “กำลังปลุกเซิร์ฟเวอร์…”

### Result modal fields

- บัญชีเกม (nickname · level)
- เหรียญ +delta → total
- XP +delta → total
- โทเค็นเว็บ before → after (หัก 1)

---

## Run-status popup (สถานะการวิ่ง)

**สถานะโค้ด:** มีใน working tree แล้ว แต่ **ยังไม่ commit/push** (Pages live ยังอาจเป็นแผง `#farm-log-wrap` แบบเก่า)

Design ที่ทำไว้ใน local:

1. ตอนเริ่มฟาร์ม → เปิด `#run-status-root` (pipeline cards)
2. ระหว่างรัน → ปุ่ม `#run-status-close` **disabled**; Escape/backdrop ไม่ปิด
3. จบแล้ว → subtitle “เสร็จแล้ว/ไม่สำเร็จ — กด × เพื่อปิด”; เปิดปิดได้
4. ถ้าสำเร็จ → ปิด run-status แล้วค่อย `showResultModal` (`pendingAfterRunStatus`)
5. ถ้าฟาร์ม fail ใน pipeline → error อยู่ใน cards; ไม่ซ้อน error modal ซ้ำ
6. 409 busy → force-close run-status แล้วโชว์ queue modal

Pipeline step ids (`PIPELINE_STEPS` ใน `app.js`): login → clear → match → run → claim → done

---

## Farm submit path (client)

1. Check tokens; else empty modal
2. Check gate; else queue modal
3. Confirm modal
4. `startLiveStages()` + `POST /api/farm/run`
5. `buildFinalPipeline(logs, result, ok)`
6. Update token balance / result modal

API helper: `api(path, {method, body})` ใช้ Bearer จาก Supabase session.

---

## Peek UI (planned — not built)

วางปุ่มใกล้ `#dp-acct-mail` / `#dp-acct-secret` เช่น “ดูสถานะบัญชีเกม”

- Disable เมื่อ `farm_busy` / กำลังฟาร์ม / กำลัง peek
- Modal แสดง nickname, coins, XP (และ level ถ้ามี)
- รายละเอียด acceptance: `09-NEXT-TASK-account-peek.md`

---

## Theme notes

Dark Cookie Run bakery theme; public README ของ repo ถูก strip เหลือชื่อโปรเจกต์เท่านั้น (ความลับ/วิธีใช้ไม่อยู่ใน GitHub README)
