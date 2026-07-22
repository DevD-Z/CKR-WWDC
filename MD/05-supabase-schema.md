# 05 — Supabase schema

**Source of truth in repo:** `CKR WWDC/supabase/schema.sql`  
ต้อง apply บนโปรเจกต์ Supabase จริง (SQL editor / migration) — ไฟล์นี้เป็น idempotent DDL + RPCs

Project URL (public, ใน `js/config.js`): `https://huugsgfpgqamnaejydkm.supabase.co`

---

## Core tables

### `profiles`

| Column | Notes |
|--------|-------|
| `id` | = `auth.users.id` |
| `role` | `admin` \| `normal` |
| `username` | unique lower index |
| `display_name` | |
| `email` | internal auth email (อาจเป็น `{user}@users.ckr.local`) |
| `token_balance` | ≥ 0; **1 token = 1 farm run** |
| `is_permanent`, `expires_at`, device/session cols | legacy/other |

Trigger `handle_new_user` on `auth.users` insert → create profile from metadata.

RLS: user reads own; admin can select/update/insert.

### `token_ledger`

Append-only credit/debit history (`delta`, `reason`, `balance_after`, `created_by`).  
Authenticated: SELECT own (or admin). No direct insert from clients.

### `run_jobs`

Farm job audit: `queued|running|succeeded|failed|cancelled` + score/coin/exp + result jsonb.  
Written by server with service_role; users can SELECT own.

### `farm_queue`

FIFO turn system:

| Column | Notes |
|--------|-------|
| `user_id` | FK profiles |
| `status` | `waiting\|active\|done\|expired\|cancelled` |
| `joined_at` | |
| `activated_at` | when became active |
| `turn_expires_at` | active deadline (~120s) |

Unique partial index: one open (`waiting`/`active`) row per user.

### `farm_lock`

Singleton row `id = 1`:

| Column | Notes |
|--------|-------|
| `holder_user_id` | who holds farm now |
| `job_id` | optional `run_jobs.id` |
| `started_at`, `updated_at` | |

Server patches via service_role (`farm_queue.set_farm_lock`).

**Note:** schema file creates queue/lock tables but **ไม่มี RLS policies ละเอียด**สำหรับสองตารางนี้ในท้ายไฟล์ — การเข้าถึงตั้งใจผ่าน **service_role จาก Render** เป็นหลัก

---

## Important RPCs

| RPC | Who | Purpose |
|-----|-----|---------|
| `resolve_username_email(p_username)` | **service_role only** | username → auth email for login |
| `consume_token(p_reason)` | authenticated | −1 balance + ledger |
| `admin_credit_tokens(user, amount, reason)` | admin JWT or service_role | credit/refund |
| `admin_lookup_user(p_query)` | admin / service_role | find by username/email/display |
| `admin_list_profiles()` | admin | list all |
| `is_admin()` | sql helper | role check |

---

## Auth identity pattern

- Customer Auth email: `{sanitized_username}@users.ckr.local` (synthetic; not shown in UI)
- Admin may use real email as username string
- Public Pages login never asks for email — only username

---

## Ops checklist when schema changes

1. Edit `supabase/schema.sql`
2. Apply to live Supabase (manual)
3. Redeploy Render if server expects new columns/RPCs
4. Never put service_role in frontend

---

## Peek feature schema needs

**ไม่จำเป็นต้องตารางใหม่** ถ้าใช้ in-process lock + existing `farm_lock`  
Optional later: `peek_rate_limits` table — ไม่ถูก require ในแผนขั้นแรก (rate limit in-memory ก็ได้บน Free single instance)
