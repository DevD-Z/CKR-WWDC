# 10 — Git status & uncommitted work (CKR WWDC)

ตรวจ ณ เวลาเขียน handoff (2026-07-22)

## Branch

```
master...origin/master
HEAD = 7adfb1b  "Add farm result popup, FIFO queue with 2m turn, and level XP calculator."
```

- **ไม่มี commit ที่ ahead ของ origin**
- **ไม่มี commit ที่ behind origin** (up to date กับ remote สำหรับ commits)
- แต่มี **local uncommitted changes**

---

## Already on GitHub / Render (from `7adfb1b`)

รวมแล้วบน remote:

- Result summary modal
- FIFO queue + 2-minute turn (`server/farm_queue.py`, schema tables, API gate/join)
- Level → XP calculator (`js/level_xp.js`, `tools/build_level_xp.py`)
- Pipeline status แบบ **inline panel** `#farm-log-wrap` (เวอร์ชันที่ push แล้ว)

---

## NOT committed / NOT pushed (สำคัญ)

### Modified

| File | What changed locally |
|------|----------------------|
| `index.html` | ลบ `#farm-log-wrap` inline; เพิ่ม `#run-status-root` popup |
| `js/app.js` | run-status open/close lock; result modal หลังปิด status; ลด error modal ซ้อน |
| `css/styles.css` | สไตล์ `.run-status-*` (~155 บรรทัด) |

### Untracked

| Path | Notes |
|------|-------|
| `assets_web/*` | dump รูปจำนวนมาก — **อาจไม่ต้อง commit**; production ใช้ `assets/` อยู่แล้ว |

---

## Implications for next AI

1. **Pages live อาจยังไม่มี run-status popup** จนกว่าจะ commit+push สามไฟล์ modified
2. ถ้าเริ่มทำ peek บน working tree ปัจจุบัน — คุณจะต่อบนโค้ดที่มี run-status แล้ว (ดี) แต่ต้องจำว่ายังไม่ได้อยู่บน remote
3. แนะนำลำดับ:
   - Option A: commit/push run-status แยกก่อน → แล้วค่อย peek
   - Option B: รวม run-status + peek ในชุดเดียว (บอก user ก่อน)
4. **อย่า `git restore` ทิ้ง run-status** โดยไม่ถาม — เป็นงานที่ user ขอไว้แล้ว

---

## How to re-check

```powershell
cd "C:\Users\jaras\OneDrive\Desktop\CookieRun_Classic API\CKR WWDC"
git status -sb
git diff --stat
git log --oneline -5
```

---

## Handoff docs location

เอกสารชุดนี้อยู่ที่ workspace:

`C:\Users\jaras\OneDrive\Desktop\CookieRun_Classic API\MD\`

**ไม่อยู่ใน git ของ CKR-WWDC** (โฟลเดอร์แม่) — ถ้าต้องการเก็บใน repo ต้อง copy/add แยกและถาม user ก่อน commit
