# 07 — Feature history / decisions log

เรียงจากงานเก่า → ใหม่ (อิง commit บน `CKR WWDC` + แชท)

---

## Scaffold → split UI/API

| Decision | Why |
|----------|-----|
| Scaffold token-based farm API | ขายรอบฟาร์มเป็นโทเค็น |
| Serve UI on **GitHub Pages**; Render **API-only** | Free hosting แยก static ออกจาก Python cold start |
| Strip public README to title only | ไม่โฆษณาวิธีใช้/ความลับบน GitHub |
| Username login (ไม่โชว์ email) | UX ลูกค้า + synthetic `@users.ckr.local` |
| Admin แยกที่ Login_j3xdr | ไม่ปนปุ่มแอดมินในหน้าฟาร์มสาธารณะ |

Commits ที่เกี่ยวข้องโดยประมาณ: `255fa39` … `926aa69` … `89af18f` … `73f1dab`

---

## Farm UX polish

| Decision | Why |
|----------|-----|
| Dark Cookie Run bakery theme | brand |
| Token gate + confirm + Telegram top-up modal | กันกดฟาร์มตอนโทเค็นหมด / ยืนยันก่อนหัก |
| Number format commas + Thai magnitude + Int32 max | ใส่เลขใหญ่ให้อ่านง่าย กัน overflow |
| Default farm stats = 0; clear on focus | ไม่พลาดค่า default เก่า |
| Lock inputs when tokens empty | บังคับเติมก่อนแก้ตัวเลข |
| Accept DevPlay email as plain string | บัญชีแปลกๆ ยังส่งเข้า core ได้ |
| Default claim totals / clearer errors | กัน UI โชว์ undefined |

---

## Result popup + queue + XP (commit `7adfb1b`)

| Decision | Why |
|----------|-----|
| Result summary modal หลังฟาร์ม | โชว์ nickname, coin/XP delta+total, token before→after |
| Rename label **EXP → XP** | ตรงภาษาที่ user ใช้ |
| Level→XP calculator จาก `cookierun_level_table.md` | user ต้องการคำนวณ XP จากเลเวล (เช่น 25→75) |
| FIFO queue + **2-minute turn** | Render Free 1 instance — กันคนแย่ง + ไม่ค้างคิว |
| Supabase `farm_queue` + `farm_lock` | lock/queue ทน cold restart ระดับหนึ่ง |
| Pipeline status cards ในแผง `#farm-log-wrap` (ตอนนั้น) | แสดงขั้นตอน login/clear/match/run/claim |

---

## Run-status as locked popup (LOCAL ONLY after `7adfb1b`)

User ชี้ DOM `#farm-log-wrap` แล้วขอให้เป็น **popup**:

| Decision | Why |
|----------|-----|
| ย้ายสถานะการวิ่งไป `#run-status-root` | ไม่ดันเลย์เอาต์หน้าฟอร์ม |
| ล็อกปิดจนกว่าเสร็จ | กันปิดกลางคันแล้วสับสน |
| หลังปิด status ค่อยโชว์ result modal | ไม่ซ้อนสอง modal |
| Fail อยู่ใน cards ไม่ซ้อน error modal | UI สะอาดขึ้น |

**ยังไม่ commit/push** ตอนเขียน docs — ดู `10-git-status-uncommitted.md`

---

## Next: Account peek (NOT IMPLEMENTED)

User ขอ: ดู coins/XP/nickname **ก่อน** กดฟาร์ม

ตกลงออกแบบแล้ว (12:31–12:48 2026-07-22):

- Share farm lock กับฟาร์ม
- ไม่เข้าคิว 2 นาที
- Busy → ปิดปุ่ม/ตอบ busy
- ระหว่าง peek บล็อกฟาร์ม
- ไม่หักโทเค็น
- Rate limit
- Cost ถูกกว่าฟาร์มแต่ occupy Free instance สั้นๆ

แผนเต็ม: `09-NEXT-TASK-account-peek.md`

---

## Explicit non-goals / deferred

- Desktop exe PartyRun packaging (`exe_รอทำ`) — คนละสายงาน
- Guest reroll / API-only gRPC unlock จาก transcript เก่า — ไม่ใช่ WWDC next task
- Multi-instance farm workers — นอก Free plan
