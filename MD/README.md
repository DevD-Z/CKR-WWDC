# CKR WWDC / CookieRun Classic API — Handoff Index

เอกสารชุดนี้เขียนไว้ให้ AI/คนทำงานต่อได้ทันทีโดยไม่ต้องมีประวัติแชท

**Workspace root:** `C:\Users\jaras\OneDrive\Desktop\CookieRun_Classic API`  
**โปรเจกต์เว็บ+API ที่ production:** `CKR WWDC/` (GitHub `j3xdr/CKR-WWDC`)  
**สคริปต์ฟาร์มต้นทาง (WIP / local):** `exe_รอทำ/PartyRun/`

---

## CURRENT NEXT TASK (เริ่มที่นี่)

> **ยังไม่ได้ implement** — ออกแบบและตกลงแล้วเท่านั้น  
> ฟีเจอร์: **ดู coins / XP / nickname ปัจจุบันก่อน แล้วค่อยกดฟาร์ม** (account peek)

อ่านแผนละเอียดทั้งหมดใน:

### → [`09-NEXT-TASK-account-peek.md`](./09-NEXT-TASK-account-peek.md)

สรุปสั้นๆ ของข้อกำหนดที่ตกลงแล้ว:

- ใช้ **farm lock ร่วมกับฟาร์ม** (กันชนกันบน Render Free 1 instance)
- Peek **ไม่เข้า FIFO queue** / ไม่มีเทิร์น 2 นาที
- ล็อกว่างเท่านั้น — ถ้า busy → ตอบ busy / ปิดปุ่ม
- ระหว่าง peek → **บล็อกเริ่มฟาร์ม**
- **ไม่หักโทเค็น** ฟาร์ม
- ต้องมี rate limit
- ถูกกว่าฟาร์ม แต่ยัง occupy instance สั้นๆ

---

## Reading order

| File | Contents |
|------|----------|
| [`01-project-overview.md`](./01-project-overview.md) | แผนที่โฟลเดอร์, production vs WIP, live URLs |
| [`02-partyrun-single-file.md`](./02-partyrun-single-file.md) | สถาปัตยกรรม `partyrun_single_file.py` end-to-end |
| [`03-ckr-wwdc-server-api.md`](./03-ckr-wwdc-server-api.md) | FastAPI endpoints, farm core, queue, Render constraints |
| [`04-frontend-ux.md`](./04-frontend-ux.md) | Pages UI, form IDs, modals, run-status popup, XP calc |
| [`05-supabase-schema.md`](./05-supabase-schema.md) | profiles, tokens, farm_queue, farm_lock, RPCs |
| [`06-deploy-ops.md`](./06-deploy-ops.md) | GitHub Pages + Render + เมื่อไหร่ push/redeploy |
| [`07-feature-history.md`](./07-feature-history.md) | ประวัติตัดสินใจ / สิ่งที่สร้างแล้ว |
| [`08-secrets-safety.md`](./08-secrets-safety.md) | env vars, สิ่งที่ห้าม commit |
| [`09-NEXT-TASK-account-peek.md`](./09-NEXT-TASK-account-peek.md) | **แผน implement peek (สถานะ: NOT DONE)** |
| [`10-git-status-uncommitted.md`](./10-git-status-uncommitted.md) | สถานะ git + งาน local ที่ยังไม่ push |

---

## Live URLs (อ้างอิง)

| What | URL |
|------|-----|
| Public farm UI (GitHub Pages) | https://j3xdr.github.io/CKR-WWDC/ |
| API (Render Free) | https://ckr-wwdc.onrender.com |
| Health | https://ckr-wwdc.onrender.com/api/health |
| Admin UI (แยก repo/โฟลเดอร์) | https://j3xdr.github.io/Login_j3xdr/ |
| GitHub | https://github.com/j3xdr/CKR-WWDC |

---

## สถานะสำคัญก่อนเริ่มงาน

1. **Run-status popup (สถานะการวิ่งเป็น card popup)** — มีใน working tree ของ `CKR WWDC` **แต่ยังไม่ commit/push** (ดู `10-git-status-uncommitted.md`)
2. **Account peek** — ยังไม่มีโค้ด endpoint/UI — เริ่มที่ `09-...`
3. **อย่า commit/push และอย่า implement peek ในรอบเขียน docs นี้** (docs-only handoff)

---

## Quick start สำหรับ AI รอบถัดไป

1. อ่าน `01` → `03` → `04` → `10` (รู้ architecture + สถานะ local)
2. อ่าน `09` แล้ว implement peek ตาม acceptance criteria
3. ตัดสินใจก่อนว่าจะ commit run-status popup แยก PR หรือรวมกับ peek
4. Pages = push root `index.html`/`js`/`css` · API = redeploy Render หลัง push `server/`
