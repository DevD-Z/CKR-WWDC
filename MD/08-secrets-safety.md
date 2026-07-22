# 08 — Secrets & safety

## ห้ามใส่ใน MD / README / commit

- DevPlay / เกม email+password ของใครก็ตาม
- รหัสแอดมิน Login_j3xdr
- `SUPABASE_SERVICE_ROLE_KEY`
- ไฟล์ `.env` จริง
- JWT access tokens ของผู้ใช้
- บัญชีทดสอบที่มีของจริงในเกม (อย่าแปะ credential ใน chat/docs)

Public anon key ใน `js/config.js` **ตั้งใจให้ public** (มี RLS) — อย่าสับสนกับ service_role

---

## Env vars ที่ต้องมี

### Render (API)

| Var | Required | Notes |
|-----|----------|-------|
| `SUPABASE_URL` | yes | project URL |
| `SUPABASE_ANON_KEY` | yes | for user-scoped calls |
| `SUPABASE_SERVICE_ROLE_KEY` | strongly yes | queue, lock, jobs, admin create, refunds |
| `PYTHON_VERSION` | set in render.yaml | `3.11.9` |
| `PORT` | provided by Render | uvicorn |

Local: copy `.env.example` → `.env` (gitignored)

### Frontend (`js/config.js`)

| Key | Notes |
|-----|-------|
| `SUPABASE_URL` | same project |
| `SUPABASE_ANON_KEY` | anon only |
| `API_BASE` | `https://ckr-wwdc.onrender.com` |

---

## What not to commit

จาก `.gitignore` แล้ว:

- `.env`, `.env.*` (ยกเว้น `.env.example`)
- venv, `__pycache__`, logs, `.supabase/`

เพิ่มเติมที่ควรระวัง:

- `assets_web/` dump ขนาดใหญ่ (ตอนนี้ untracked) — อย่า commit มั่วถ้าไม่จำเป็น
- การ hardcode password ใน `partyrun_single_file.py` CONFIG
- การ commit `static/` sync ที่ทำให้คนสับสนกับ root Pages files

---

## Token economics safety

- `consume_token` หักก่อนรันฟาร์ม — ถ้าพังหลังหัก โทเค็นเสีย (refund เฉพาะบางกรณี busy-before-lock)
- Peek **ต้องไม่เรียก** `consume_token`
- Admin credit ผ่าน `/api/admin/add-tokens` หรือ Telegram กับแอดมิน

---

## Game-side safety

- อย่าส่ง EXP มโหฬาร — ทำให้ `corrupt_pending` แล้วฟาร์มบัญชีนั้นไม่ได้จนกว่า daily/season reset
- Score/coin/exp cap ฝั่ง API = Int32 max แต่ “ปลอดภัยต่อบัญชี” ≠ max ทางเทคนิค

---

## Transcript / tools

Agent transcripts อาจมี secrets จากช่วง reverse — **อย่าคัดลอก credential จาก transcript ลง MD**
