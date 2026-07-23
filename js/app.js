/* hotdog. client — public farm UI only (no admin) */
(function () {
  "use strict";

  const cfg = window.CKR_CONFIG;
  if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) {
    document.body.innerHTML =
      "<p style='padding:2rem;color:#f6e7c8;font-family:sans-serif'>ขาดไฟล์ config.js</p>";
    return;
  }

  const REMEMBER_KEY = "ckr_wwdc_remember";
  const DISCORD_URL = "https://discord.gg/SabrUQ3PCh";
  const API = cfg.API_BASE || "";
  const INT32_MAX = 2147483647;

  const DIGIT_TH = [
    "ศูนย์",
    "หนึ่ง",
    "สอง",
    "สาม",
    "สี่",
    "ห้า",
    "หก",
    "เจ็ด",
    "แปด",
    "เก้า",
  ];
  // index = จำนวนหลัก - 1 ของเลขตัวต้น
  const PLACE_TH = [
    "",
    "สิบ",
    "ร้อย",
    "พัน",
    "หมื่น",
    "แสน",
    "ล้าน",
    "สิบล้าน",
    "ร้อยล้าน",
    "พันล้าน",
  ];

  function digitsOnly(raw) {
    return String(raw || "").replace(/\D/g, "");
  }

  function formatCommas(digitStr) {
    if (!digitStr) return "";
    return digitStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function parseFarmNum(raw) {
    const d = digitsOnly(raw);
    if (!d) return 0;
    const n = Number(d);
    return Number.isFinite(n) ? n : 0;
  }

  /** บอกหลักจากเลขตัวต้นเท่านั้น เช่น 800000 → แปดแสน, 500 → ห้าร้อย */
  function thaiMagnitude(n) {
    if (!Number.isFinite(n) || n <= 0) return "";
    const s = String(Math.floor(Math.abs(n)));
    const first = Number(s[0]);
    const placeIdx = s.length - 1;
    if (placeIdx === 0) return DIGIT_TH[first] || "";
    const place = PLACE_TH[placeIdx];
    if (!place) return DIGIT_TH[first] || "";
    // กรณีพิเศษภาษาไทย: 10 → สิบ, 20 → ยี่สิบ
    if (placeIdx === 1) {
      if (first === 1) return "สิบ";
      if (first === 2) return "ยี่สิบ";
    }
    // 1 ที่หลักพันล้าน → "พันล้าน" ตามตัวอย่าง
    if (first === 1 && placeIdx === 9) return "พันล้าน";
    return (DIGIT_TH[first] || "") + place;
  }

  function syncFarmNumField(input, opts = {}) {
    const hint = $(input.id + "-hint");
    let digits = digitsOnly(input.value);
    if (!digits) {
      // ค่าว่างหลังโฟกัสเคลียร์ — อย่าใส่ 0 กลับทันที
      if (!opts.keepEmpty) {
        input.value = "0";
        if (hint) hint.textContent = "";
      } else {
        input.value = "";
        if (hint) hint.textContent = "";
      }
      return 0;
    }
    // คง "0" ไว้เป็นค่าเริ่มต้น (อย่าตัดเป็นว่าง)
    if (digits === "0") {
      input.value = "0";
      if (hint) hint.textContent = "";
      return 0;
    }
    // ตัดศูนย์นำหน้า ยกเว้นค่า 0 ล้วน
    digits = digits.replace(/^0+(?=\d)/, "");
    const n = Number(digits);
    if (!Number.isFinite(n) || n > INT32_MAX) {
      input.value = "0";
      if (hint) hint.textContent = "";
      if (!opts.silent) {
        showErrorModal(
          "ใส่ได้สูงสุด 2,147,483,647 เท่านั้น — ล้างช่องนี้แล้ว",
          "ตัวเลขเกินกำหนด"
        );
      }
      return 0;
    }
    input.value = formatCommas(digits);
    if (hint) hint.textContent = thaiMagnitude(n);
    return n;
  }

  function clearZeroPlaceholder(input) {
    if (input.disabled || input.readOnly) return;
    if (digitsOnly(input.value) === "0") {
      input.value = "";
      const hint = $(input.id + "-hint");
      if (hint) hint.textContent = "";
    }
  }

  function restoreZeroIfEmpty(input) {
    if (digitsOnly(input.value) === "") {
      input.value = "0";
      const hint = $(input.id + "-hint");
      if (hint) hint.textContent = "";
    } else {
      syncFarmNumField(input, { silent: true });
    }
  }

  function setFarmInputsLocked(locked) {
    ["farm-score", "farm-coin", "farm-exp"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.readOnly = !!locked;
      el.disabled = !!locked;
      el.classList.toggle("is-locked", !!locked);
      el.setAttribute("aria-disabled", locked ? "true" : "false");
    });
  }

  function setupFarmNumberInputs() {
    ["farm-score", "farm-coin", "farm-exp"].forEach((id) => {
      const el = $(id);
      if (!el || el.dataset.numBound === "1") return;
      el.dataset.numBound = "1";
      el.addEventListener("focus", () => clearZeroPlaceholder(el));
      el.addEventListener("pointerdown", () => clearZeroPlaceholder(el));
      el.addEventListener("input", () => syncFarmNumField(el, { keepEmpty: true }));
      el.addEventListener("blur", () => restoreZeroIfEmpty(el));
      syncFarmNumField(el, { silent: true });
    });
  }

  function wantsRemember() {
    const pref = localStorage.getItem(REMEMBER_KEY);
    if (pref === null) return true;
    return pref === "1";
  }

  function setRememberPref(on) {
    if (on) localStorage.setItem(REMEMBER_KEY, "1");
    else localStorage.setItem(REMEMBER_KEY, "0");
  }

  const authStorage = {
    getItem(key) {
      const primary = wantsRemember() ? localStorage : sessionStorage;
      const secondary = wantsRemember() ? sessionStorage : localStorage;
      return primary.getItem(key) ?? secondary.getItem(key);
    },
    setItem(key, value) {
      if (wantsRemember()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    },
    removeItem(key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    },
  };

  const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  const $ = (id) => document.getElementById(id);
  const loginView = $("login-view");
  const userView = $("user-view");
  const modalRoot = $("modal-root");
  const modalTitle = $("modal-title");
  const modalBody = $("modal-body");
  const modalIcon = $("modal-icon");
  const modalActions = $("modal-actions");

  let accessToken = null;
  let profile = null;
  let stageTimer = null;
  let balancePollTimer = null;
  let queuePollTimer = null;
  let modalMode = null; // "empty" | "confirm" | "error" | "queue" | "result" | null
  let farmRunning = false;
  let lastGate = null;
  let runStatusClosable = false;
  let pendingAfterRunStatus = null;

  const ERR_TH = {
    insufficient_tokens: "Contact Admin on Discord",
    farm_busy: "ระบบกำลังยุ่งอยู่ ลองใหม่อีกสักครู่",
    farm_error: "การฟาร์มล้มเหลว ลองใหม่อีกครั้ง",
    consume_failed: "หักโทเค็นไม่สำเร็จ ลองใหม่อีกครั้ง",
    login_no_session: "เข้าสู่ระบบไม่สำเร็จ",
    Invalid: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    login_failed: "เข้าสู่ระบบเกมไม่สำเร็จ — ตรวจอีเมล/รหัสผ่าน DevPlay",
    LOGIN_FAILED: "เข้าสู่ระบบเกมไม่สำเร็จ — ตรวจอีเมล/รหัสผ่าน DevPlay",
    corrupt_pending:
      "บัญชีติดรางวัลค้างจากรอบก่อน รอรีเซ็ตประจำวันแล้วลองใหม่ (ลด XP)",
    BLOCKED: "บัญชีติดรางวัลค้างจากรอบก่อน รอรีเซ็ตประจำวันแล้วลองใหม่",
    matchmaking_failed: "จับคู่ไม่สำเร็จ ลองใหม่อีกครั้ง",
    claim_timeout: "รับรางวัลไม่ทัน ลองใหม่อีกครั้ง (แมตช์อาจจบแล้ว)",
    could_not_claim: "รับรางวัลไม่ทัน ลองใหม่อีกครั้ง",
  };

  function thError(raw) {
    if (!raw) return "เกิดข้อผิดพลาด";
    const s = String(raw);
    for (const [k, v] of Object.entries(ERR_TH)) {
      if (s.includes(k)) return v;
    }
    if (/LOGIN FAILED|wrong email|password|DevPlay/i.test(s)) {
      return ERR_TH.login_failed;
    }
    if (/CORRUPT|corrupt_pending|BLOCKED/i.test(s)) {
      return ERR_TH.corrupt_pending;
    }
    if (/matchmaking failed/i.test(s)) {
      return ERR_TH.matchmaking_failed;
    }
    if (/could not claim|claim_timeout|not finalized/i.test(s)) {
      return ERR_TH.claim_timeout;
    }
    if (/invalid|wrong|credential|password|user/i.test(s)) {
      return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    }
    if (/network|fetch|Failed to fetch|network_error/i.test(s)) {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง";
    }
    if (/traceback|grpc|RpcError|Stack|Exception|at 0x|python/i.test(s)) {
      return "เกิดข้อผิดพลาดระหว่างฟาร์ม ลองใหม่อีกครั้ง";
    }
    if (s.length > 120 || /[{}\[\]]/.test(s)) {
      return "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
    }
    return s;
  }

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "status " + (kind || "muted");
  }

  function tokenBalance() {
    return Number(profile?.token_balance ?? 0);
  }

  function hasTokens() {
    return tokenBalance() >= 1;
  }

  /* ---------- Modal system ---------- */
  function clearModalActions() {
    modalActions.innerHTML = "";
    modalActions.className = "modal-actions";
  }

  function makeBtn(label, className, onClick, opts = {}) {
    const el = opts.href
      ? document.createElement("a")
      : document.createElement("button");
    el.className = "btn " + className;
    if (opts.href) {
      el.href = opts.href;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    } else {
      el.type = "button";
      el.addEventListener("click", onClick);
    }
    if (opts.icon) {
      const img = document.createElement("img");
      img.src = opts.icon;
      img.alt = "";
      img.width = 24;
      img.height = 24;
      el.appendChild(img);
    }
    el.appendChild(document.createTextNode(label));
    return el;
  }

  function openModal({ mode, title, body, icon, locked, bodyHtml }) {
    modalMode = mode;
    modalTitle.textContent = title;
    if (bodyHtml) {
      modalBody.innerHTML = bodyHtml;
    } else {
      modalBody.textContent = body || "";
    }
    modalIcon.src = icon || "assets/tr_event_116.png";
    modalRoot.classList.toggle("locked", !!locked);
    modalRoot.classList.remove("hidden");
    modalRoot.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (modalMode === "empty" || modalMode === "queue") return;
    modalMode = null;
    clearModalActions();
    modalRoot.classList.add("hidden");
    modalRoot.classList.remove("locked");
    modalRoot.setAttribute("aria-hidden", "true");
    stopBalancePoll();
  }

  function forceCloseModal() {
    modalMode = null;
    clearModalActions();
    modalRoot.classList.add("hidden");
    modalRoot.classList.remove("locked");
    modalRoot.setAttribute("aria-hidden", "true");
    stopBalancePoll();
  }

  function showEmptyCoinsModal() {
    clearModalActions();
    openModal({
      mode: "empty",
      title: "Contact Admin on Discord",
      body: "No tokens left. Contact admin on Discord to top up.",
      icon: "assets/tr_event_116.png",
      locked: true,
    });
    modalActions.appendChild(
      makeBtn("Contact Admin on Discord", "btn-discord", null, {
        href: DISCORD_URL,
      })
    );
    modalActions.appendChild(
      makeBtn("ตรวจสอบยอดโทเค็นอีกครั้ง", "btn-ghost btn-wide", async () => {
        try {
          await refreshMe();
          if (hasTokens()) {
            forceCloseModal();
            setStatus($("farm-status"), "เติมโทเค็นแล้ว พร้อมวิ่งฟาร์ม", "ok");
          } else {
            setStatus($("farm-status"), "ยังมียอดเป็น 0 — รอแอดมินเติม", "err");
          }
        } catch (_) {
          setStatus($("farm-status"), "ตรวจยอดไม่สำเร็จ ลองใหม่", "err");
        }
      })
    );
    startBalancePoll();
  }

  function showErrorModal(message, title) {
    clearModalActions();
    openModal({
      mode: "error",
      title: title || "เกิดข้อผิดพลาด",
      body: message,
      icon: "assets/tr_event_116.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function showResultModal(summary) {
    const rows = [
      ["บัญชีเกม", escapeHtml(summary.account || "—")],
      [
        "เหรียญ",
        `<span class="result-delta">+${escapeHtml(summary.coinDelta)}</span> → ยอดรวม ${escapeHtml(summary.coinTotal)}`,
      ],
      [
        "XP",
        `<span class="result-delta">+${escapeHtml(summary.xpDelta)}</span> → ยอดรวม ${escapeHtml(summary.xpTotal)}`,
      ],
      [
        "โทเค็นเว็บ",
        `${escapeHtml(summary.tokensBefore)} → ${escapeHtml(summary.tokensAfter)} <span class="result-delta">(หัก 1)</span>`,
      ],
    ];
    const html =
      '<table class="result-table"><tbody>' +
      rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
        .join("") +
      "</tbody></table>" +
      '<p class="queue-note" style="margin-top:12px">ถ้าในเกมยังไม่เห็นยอด ให้ปิดเกมแล้วเข้าใหม่</p>';

    clearModalActions();
    openModal({
      mode: "result",
      title: "สรุปผลการฟาร์ม",
      bodyHtml: html,
      icon: "assets/tr_event_116.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stopQueuePoll() {
    if (queuePollTimer) {
      clearInterval(queuePollTimer);
      queuePollTimer = null;
    }
  }

  function startQueuePoll() {
    stopQueuePoll();
    queuePollTimer = setInterval(() => {
      refreshGateAndQueueUi().catch(() => {});
    }, 2500);
  }

  function renderQueuePanel(gate) {
    const panel = $("queue-panel");
    const pill = $("queue-pill");
    const statVal = $("queue-stat-val");
    const statSub = $("queue-stat-sub");
    if (!panel) return;
    const g = gate || lastGate || {};
    const me = g.me || {};
    const count = g.queue_length ?? 0;
    if (me.status === "active" || g.is_my_turn) {
      const left = turnCountdownText(me.turn_expires_at);
      panel.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:6px;width:100%">' +
        '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">Status</span><strong style="color:#22d3ee">Your turn</strong></div>' +
        '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">Time left</span><strong>' + escapeHtml(left || "2:00") + "</strong></div>" +
        '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">In queue</span><strong>' + count + "</strong></div>" +
        "</div>";
      if (pill) { pill.textContent = "Your turn"; pill.style.background = "#22d3ee"; pill.style.color = "#0f172a"; }
      if (statVal) statVal.textContent = "Your turn";
      if (statSub) statSub.textContent = count + " in queue";
    } else if (me.status === "waiting") {
      const pos = me.position ?? "—";
      panel.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:6px;width:100%">' +
        '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">Your position</span><strong>' + escapeHtml(String(pos)) + "</strong></div>" +
        '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">In queue</span><strong>' + count + "</strong></div>" +
        '<p style="margin:4px 0 0;font-size:0.75rem;color:#64748b">Keep this page open</p>' +
        "</div>";
      if (pill) { pill.textContent = "In queue"; pill.style.background = "#fbbf24"; pill.style.color = "#0f172a"; }
      if (statVal) statVal.textContent = "Position " + pos;
      if (statSub) statSub.textContent = count + " in queue";
    } else if (g.farm_busy) {
      panel.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:6px;width:100%">' +
        '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">Status</span><strong style="color:#f87171">Farming in progress</strong></div>' +
        '<div style="display:flex;justify-content:space-between"><span style="color:#64748b">In queue</span><strong>' + count + "</strong></div>" +
        "</div>";
      if (pill) { pill.textContent = count + " waiting"; pill.style.background = "#f87171"; pill.style.color = "#fff"; }
      if (statVal) statVal.textContent = "Farming";
      if (statSub) statSub.textContent = count + " waiting";
    } else {
      if (g.queue_full) {
        const mq = g.max_queue_size || "?";
        panel.innerHTML = `<div style="color:var(--danger);display:flex;align-items:center;gap:6px">Queue full (${g.queue_length}/${mq}) — try again later</div>`;
        if (pill) { pill.textContent = "Full"; pill.style.background = "var(--danger)"; pill.style.color = "#fff"; }
        if (statVal) statVal.textContent = "Queue full";
        if (statSub) statSub.textContent = g.queue_length + " / " + mq;
      } else {
        panel.innerHTML = '<div style="color:#22d3ee;display:flex;align-items:center;gap:6px"><span class="queue-spinner" aria-hidden="true" style="width:12px;height:12px;border:2px solid #22d3ee;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;display:inline-block"></span> Queue idle — start farming anytime</div>';
        if (pill) { pill.textContent = "Idle"; pill.style.background = "#22d3ee66"; pill.style.color = "#22d3ee"; }
        if (statVal) statVal.textContent = "Idle";
        if (statSub) statSub.textContent = "No active queue";
      }
    }
  }

  function turnCountdownText(iso) {
    if (!iso) return "";
    const end = Date.parse(iso);
    if (!Number.isFinite(end)) return "";
    const sec = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function renderQueueModal(gate, opts = {}) {
    lastGate = gate || lastGate;
    const g = lastGate || {};
    const me = g.me || {};
    const waking = !!opts.waking;
    let bodyHtml = '<div class="queue-panel">';
    bodyHtml += '<div class="queue-spinner" aria-hidden="true"></div>';

    if (waking) {
      bodyHtml +=
        '<p class="queue-note">กำลังปลุกเซิร์ฟเวอร์… รอสักครู่แล้วระบบจะเข้าคิวให้อัตโนมัติ</p>';
    } else if (me.status === "active" || g.is_my_turn) {
      const left = turnCountdownText(me.turn_expires_at);
      bodyHtml +=
        '<div class="queue-stat"><span>สถานะ</span><strong>ถึงคิวของคุณแล้ว</strong></div>';
      bodyHtml +=
        '<div class="queue-stat"><span>เหลือเวลาเริ่มฟาร์ม</span><strong>' +
        escapeHtml(left || "2:00") +
        "</strong></div>";
      bodyHtml +=
        '<p class="queue-note warn">ต้องกดเริ่มฟาร์มภายใน 2 นาที ไม่งั้นคิวจะข้ามไปคนถัดไป</p>';
    } else if (me.status === "waiting") {
      bodyHtml +=
        '<div class="queue-stat"><span>คิวของคุณ</span><strong>อันดับ ' +
        escapeHtml(me.position ?? "—") +
        "</strong></div>";
      bodyHtml +=
        '<div class="queue-stat"><span>ในคิวทั้งหมด</span><strong>' +
        escapeHtml(g.queue_length ?? 0) +
        "</strong></div>";
      bodyHtml +=
        '<p class="queue-note">รอคิวอยู่ — ปิดหน้าต่างไม่ได้ จนกว่าจะถึงคิวของคุณ</p>';
    } else if (g.farm_busy) {
      bodyHtml +=
        '<div class="queue-stat"><span>สถานะ</span><strong>มีคนกำลังฟาร์ม</strong></div>';
      bodyHtml +=
        '<div class="queue-stat"><span>ในคิว</span><strong>' +
        escapeHtml(g.queue_length ?? 0) +
        "</strong></div>";
      bodyHtml +=
        '<p class="queue-note">กดเข้าคิวเพื่อจองลำดับ — คนกดก่อนได้คิวก่อน</p>';
    } else if (g.queue_full) {
      const mq = g.max_queue_size || "?";
      bodyHtml +=
        '<div class="queue-stat"><span>คิวเต็ม</span><strong style="color:var(--danger)">' +
        escapeHtml(g.queue_length ?? 0) + " / " + mq +
        "</strong></div>";
      bodyHtml +=
        '<p class="queue-note">คิวเต็ม — รอสักครู่แล้วลองใหม่</p>';
    } else {
      bodyHtml +=
        '<p class="queue-note">ระบบกำลังจัดคิว…</p>';
    }
    bodyHtml += "</div>";

    clearModalActions();
    openModal({
      mode: "queue",
      title: waking ? "กำลังเชื่อมต่อเซิร์ฟเวอร์" : "คิวฟาร์ม",
      bodyHtml,
      icon: "assets/tr_event_116.png",
      locked: true,
    });

    if (!waking && !me.status && g.queue_full) {
      // no join button when queue is full
    } else if (!waking && !me.status && g.farm_busy) {
      modalActions.appendChild(
        makeBtn("เข้าคิว", "btn-candy", async () => {
          try {
            const data = await api("/api/farm/queue/join", { method: "POST", body: {} });
            renderQueueModal(data);
            startQueuePoll();
          } catch (e) {
            showErrorModal(thError(e.message) || "เข้าคิวไม่สำเร็จ", "คิว");
          }
        })
      );
    } else if (me.status === "active" || g.is_my_turn) {
      modalActions.appendChild(
        makeBtn("เริ่มฟาร์มเลย", "btn-run", () => {
          forceCloseModal();
          stopQueuePoll();
          $("farm-btn")?.focus();
          setStatus($("farm-status"), "ถึงคิวแล้ว — กดเริ่มฟาร์มได้เลย", "ok");
        })
      );
    }
  }

  async function refreshGateAndQueueUi() {
    if (!accessToken) return null;
    try {
      const data = await api("/api/farm/gate");
      lastGate = data;
      renderQueuePanel(data);
      if (data.is_my_turn || data.me?.status === "waiting" || data.me?.status === "active") {
        renderQueueModal(data);
        startQueuePoll();
      } else if (modalMode === "queue" && !data.farm_busy && !data.queue_full && !data.me?.status) {
        forceCloseModal();
        stopQueuePoll();
      } else if (modalMode === "queue") {
        renderQueueModal(data);
      }
      return data;
    } catch (e) {
      if (/network|Failed to fetch|network_error/i.test(String(e.message))) {
        renderQueueModal(lastGate || { farm_busy: true, queue_length: 0 }, { waking: true });
        startQueuePoll();
      }
      return null;
    }
  }

  function setupXpCalculator() {
    const card = $("xp-calc-card");
    const openBtn = $("xp-calc-open");
    const closeBtn = $("xp-calc-close");
    const applyBtn = $("xp-calc-apply");
    const cur = $("xp-cur");
    const tgt = $("xp-tgt");
    const out = $("xp-calc-result");
    if (!card || !openBtn || !window.CKR_LEVEL_XP) return;

    function refresh() {
      const xp = window.CKR_LEVEL_XP.calculateRequiredXp(cur.value, tgt.value);
      if (xp == null) {
        out.innerHTML = "ใส่เลเวล 1–110 ให้ถูกต้อง";
        return;
      }
      out.innerHTML =
        "ต้องใช้ <strong>" + formatNumTh(xp) + "</strong> XP";
      out.dataset.xp = String(xp);
    }

    openBtn.addEventListener("click", () => {
      card.classList.remove("hidden");
      card.hidden = false;
      refresh();
    });
    closeBtn?.addEventListener("click", () => {
      card.classList.add("hidden");
      card.hidden = true;
    });
    cur?.addEventListener("input", refresh);
    tgt?.addEventListener("input", refresh);
    applyBtn?.addEventListener("click", () => {
      refresh();
      const xp = Number(out.dataset.xp || 0);
      const expInput = $("farm-exp");
      if (!expInput || !Number.isFinite(xp) || xp < 0) return;
      expInput.value = formatCommas(String(Math.trunc(xp)));
      syncFarmNumField(expInput, { silent: true });
      card.classList.add("hidden");
      card.hidden = true;
      setStatus($("farm-status"), "ใส่ XP จากเครื่องคิดเลขแล้ว", "ok");
    });
  }

  function showConfirmModal() {
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันการวิ่งฟาร์ม?",
        body: "เมื่อกดยืนยัน จะหัก 1 โทเค็นทันที แม้ฟาร์มไม่สำเร็จ",
        icon: "assets/tr_event_116.png",
        locked: false,
      });
      modalActions.classList.add("row");
      modalActions.appendChild(
        makeBtn("ยกเลิก", "btn-ghost", () => {
          forceCloseModal();
          resolve(false);
        })
      );
      modalActions.appendChild(
        makeBtn("ยืนยัน", "btn-candy", () => {
          forceCloseModal();
          resolve(true);
        })
      );
    });
  }

  function startBalancePoll() {
    stopBalancePoll();
    balancePollTimer = setInterval(async () => {
      if (modalMode !== "empty" || !accessToken) return;
      try {
        const data = await api("/api/me");
        profile = data.profile;
        paintProfile();
        if (hasTokens()) {
          forceCloseModal();
          setStatus($("farm-status"), "เติมโทเค็นแล้ว พร้อมวิ่งฟาร์ม", "ok");
        }
      } catch (_) {}
    }, 8000);
  }

  function stopBalancePoll() {
    if (balancePollTimer) {
      clearInterval(balancePollTimer);
      balancePollTimer = null;
    }
  }

  function updateFarmAvailability() {
    const btn = $("farm-btn");
    if (!btn) return;
    const empty = !hasTokens();
    if (!farmRunning) {
      btn.disabled = empty;
    }
    setFarmInputsLocked(empty);
  }

  function formatApiDetail(detail) {
    if (detail == null) return "";
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && !Array.isArray(detail)) {
      if (detail.code === "farm_busy" || detail.message === "farm_busy") {
        return "farm_busy";
      }
      return detail.msg || detail.message || detail.reason || detail.code || "request_failed";
    }
    if (Array.isArray(detail)) {
      const parts = detail.map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const loc = Array.isArray(item.loc)
          ? item.loc.filter((x) => x !== "body").join(".")
          : "";
        const msg = item.msg || item.type || "invalid";
        if (loc.includes("email") || /email/i.test(msg)) {
          return "อีเมล DevPlay ไม่ถูกต้อง";
        }
        if (loc.includes("password")) return "รหัสผ่าน DevPlay ว่างหรือไม่ถูกต้อง";
        if (loc.includes("score") || loc.includes("coin") || loc.includes("exp")) {
          return "ค่าคะแนน/เหรียญ/XP ไม่ถูกต้องหรือเกินกำหนด";
        }
        return loc ? loc + ": " + msg : msg;
      });
      return parts.filter(Boolean).join(" · ") || "ข้อมูลไม่ถูกต้อง";
    }
    return String(detail);
  }

  async function api(path, options = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    let res;
    try {
      res = await fetch(API + path, {
        ...options,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (netErr) {
      const err = new Error("network_error");
      err.cause = netErr;
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const raw = data?.detail ?? data?.reason ?? data?.error ?? null;
      const detail = formatApiDetail(raw) || res.statusText || "request_failed";
      const err = new Error(detail);
      err.status = res.status;
      err.data = data;
      if (raw && typeof raw === "object" && raw.gate) err.gate = raw.gate;
      throw err;
    }
    return data;
  }

  function showApp() {
    loginView.classList.add("hidden");
    userView.classList.remove("hidden");
    $("sidebar").classList.remove("hidden");
    $("logout-btn").classList.remove("hidden");
    $("nav-balance").classList.remove("hidden");
    $("topbar-profile").classList.remove("hidden");
    updateFarmAvailability();
    refreshGateAndQueueUi().catch(() => {});
  }

  function showLogin() {
    stopBalancePoll();
    stopQueuePoll();
    forceCloseModal();
    forceCloseRunStatusPopup();
    loginView.classList.remove("hidden");
    userView.classList.add("hidden");
    $("sidebar").classList.add("hidden");
    $("logout-btn").classList.add("hidden");
    $("nav-balance").classList.add("hidden");
    $("topbar-profile").classList.add("hidden");
  }

  function paintProfile() {
    const bal = tokenBalance();
    const name = profile?.username || profile?.display_name || "—";
    $("nav-balance-num").textContent = String(bal);
    $("profile-username").textContent = name;
    $("profile-balance").textContent = String(bal);
    $("profile-role").textContent = profile?.role || "normal";
    $("topbar-username").textContent = name;
    $("sidebar-username").textContent = name;
    $("sidebar-role").textContent = profile?.role || "user";
    if (profile?.avatar_url) {
      $("topbar-avatar").src = profile.avatar_url;
      $("sidebar-avatar").src = profile.avatar_url;
      const pa = $("profile-avatar");
      if (pa) pa.src = profile.avatar_url;
    }
    updateFarmAvailability();
  }

  async function refreshMe() {
    const data = await api("/api/me");
    profile = data.profile;
    paintProfile();
    showApp();
  }

  /* ---------- Friendly farm status pipeline ---------- */
  const PIPELINE_STEPS = [
    { id: "login", label: "เข้าสู่ระบบเกม" },
    { id: "clear", label: "เคลียร์รางวัลค้าง" },
    { id: "match", label: "จับคู่" },
    { id: "run", label: "วิ่งฟาร์ม" },
    { id: "claim", label: "รับรางวัล" },
    { id: "done", label: "สรุปผล" },
  ];

  let pipelineState = null; // { activeIdx, kinds: {id: pending|ok|err}, extras: [] }

  function formatNumTh(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n ?? "");
    return String(Math.trunc(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function setRunStatusSubtitle(done, ok) {
    const sub = $("run-status-subtitle");
    if (!sub) return;
    sub.classList.remove("is-done", "is-fail");
    if (!done) {
      sub.textContent = "กำลังฟาร์ม… ห้ามปิดจนกว่าจะเสร็จ";
      return;
    }
    if (ok) {
      sub.textContent = "เสร็จแล้ว — กด × เพื่อปิด";
      sub.classList.add("is-done");
    } else {
      sub.textContent = "ไม่สำเร็จ — กด × เพื่อปิด";
      sub.classList.add("is-fail");
    }
  }

  function setRunStatusClosable(done) {
    runStatusClosable = !!done;
    const btn = $("run-status-close");
    if (btn) btn.disabled = !runStatusClosable;
  }

  function openRunStatusPopup(running) {
    const root = $("run-status-root");
    if (!root) return;
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    setRunStatusClosable(!running);
    if (running) {
      pendingAfterRunStatus = null;
      setRunStatusSubtitle(false);
    }
  }

  function closeRunStatusPopup() {
    if (!runStatusClosable) return;
    const root = $("run-status-root");
    if (!root) return;
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    const cb = pendingAfterRunStatus;
    pendingAfterRunStatus = null;
    if (typeof cb === "function") cb();
  }

  function forceCloseRunStatusPopup() {
    runStatusClosable = true;
    pendingAfterRunStatus = null;
    const root = $("run-status-root");
    if (root) {
      root.classList.add("hidden");
      root.setAttribute("aria-hidden", "true");
    }
    const btn = $("run-status-close");
    if (btn) btn.disabled = true;
    runStatusClosable = false;
    setRunStatusSubtitle(false);
  }

  function freshPipeline() {
    const kinds = {};
    for (const s of PIPELINE_STEPS) kinds[s.id] = "idle";
    return { activeIdx: 0, kinds, extras: [] };
  }

  function setPipelineActive(idx) {
    if (!pipelineState) pipelineState = freshPipeline();
    const max = PIPELINE_STEPS.length - 1;
    const next = Math.max(0, Math.min(idx, max));
    // Mark all before active as ok; active as pending; after as idle
    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      const id = PIPELINE_STEPS[i].id;
      if (i < next) pipelineState.kinds[id] = "ok";
      else if (i === next) pipelineState.kinds[id] = "pending";
      else if (pipelineState.kinds[id] === "pending") pipelineState.kinds[id] = "idle";
    }
    pipelineState.activeIdx = next;
    renderPipeline();
  }

  function markPipelineError(stepId, message) {
    if (!pipelineState) pipelineState = freshPipeline();
    let hit = false;
    for (const s of PIPELINE_STEPS) {
      if (s.id === stepId) {
        pipelineState.kinds[s.id] = "err";
        hit = true;
      } else if (!hit && pipelineState.kinds[s.id] !== "ok") {
        pipelineState.kinds[s.id] = "ok";
      } else if (hit && pipelineState.kinds[s.id] === "pending") {
        pipelineState.kinds[s.id] = "idle";
      }
    }
    if (message) {
      pipelineState.extras = [{ text: message, kind: "err" }];
    }
    renderPipeline();
  }

  function finalizePipelineSuccess(result) {
    if (!pipelineState) pipelineState = freshPipeline();
    for (const s of PIPELINE_STEPS) {
      pipelineState.kinds[s.id] = "ok";
    }
    pipelineState.activeIdx = PIPELINE_STEPS.length - 1;
    const extras = [];
    const summary = result?.reward_summary;
    const reward = result?.reward;
    const coinDelta = summary?.coin_delta ?? reward?.coin?.delta;
    const coinTotal = summary?.coin_total ?? reward?.coin?.total;
    const expDelta = summary?.exp_delta ?? reward?.exp?.delta;
    const expTotal = summary?.exp_total ?? reward?.exp?.total;
    const bits = [];
    if (coinDelta != null && coinDelta !== "") bits.push("เหรียญ +" + formatNumTh(coinDelta));
    if (expDelta != null && expDelta !== "") bits.push("XP +" + formatNumTh(expDelta));
    if (bits.length) extras.push({ text: "ได้รับ: " + bits.join(" · "), kind: "ok" });
    if (coinTotal != null && coinTotal !== "") {
      extras.push({
        text: "เหรียญในเกมหลังเคลม: " + formatNumTh(coinTotal),
        kind: "ok",
      });
    }
    if (expTotal != null && expTotal !== "") {
      extras.push({
        text: "XP รวมหลังเคลม: " + formatNumTh(expTotal),
        kind: "ok",
      });
    }
    const nick = summary?.nickname || result?.account?.nickname;
    if (nick) extras.push({ text: "บัญชีเกม: " + nick, kind: "ok" });
    extras.push({
      text: "ถ้าในเกมยังไม่เห็น ให้ปิดเกมแล้วเข้าใหม่",
      kind: "ok",
    });
    pipelineState.extras = extras;
    renderPipeline();
  }

  function applyLogsToPipeline(rawLogs) {
    if (!pipelineState) pipelineState = freshPipeline();
    const lines = Array.isArray(rawLogs) ? rawLogs : [];
    let idx = pipelineState.activeIdx || 0;
    let hardErr = null;
    for (const line of lines) {
      const s = String(line || "");
      if (!s.trim()) continue;
      if (/LOGIN FAILED/i.test(s)) {
        hardErr = { id: "login", msg: ERR_TH.login_failed };
        break;
      }
      if (/LOGIN OK|login ok/i.test(s)) idx = Math.max(idx, 1);
      if (/\[1\/4\]|clearing pending|cleared pending/i.test(s)) idx = Math.max(idx, 2);
      if (/BLOCKED|CORRUPT|corrupt_pending/i.test(s)) {
        hardErr = { id: "clear", msg: ERR_TH.corrupt_pending };
        break;
      }
      if (/\[2\/4\]|matchmaking|ingame_id\s*=/i.test(s)) idx = Math.max(idx, 3);
      if (/matchmaking failed|MATCHMAKING ERROR/i.test(s)) {
        hardErr = { id: "match", msg: ERR_TH.matchmaking_failed };
        break;
      }
      if (/\[3\/4\]|playing \+|submitted run_end|quit acknowledged/i.test(s)) {
        idx = Math.max(idx, 4);
      }
      if (/\[4\/4\]|claiming reward|not finalized|REWARD CLAIMED/i.test(s)) {
        idx = Math.max(idx, 5);
      }
      if (/claim_timeout|could not claim/i.test(s)) {
        hardErr = { id: "claim", msg: ERR_TH.claim_timeout };
        break;
      }
    }
    setPipelineActive(idx);
    if (hardErr) markPipelineError(hardErr.id, hardErr.msg);
  }

  function renderPipeline() {
    const root = $("run-status-root");
    const list = $("farm-log");
    if (!list) return;
    if (root) {
      root.classList.remove("hidden");
      root.setAttribute("aria-hidden", "false");
    }
    list.innerHTML = "";
    if (!pipelineState) return;

    for (const s of PIPELINE_STEPS) {
      const kind = pipelineState.kinds[s.id] || "idle";
      if (kind === "idle") continue;
      const li = document.createElement("li");
      const label =
        kind === "pending"
          ? "กำลัง" + s.label + "…"
          : kind === "ok"
            ? s.label + "แล้ว"
            : s.label + "ไม่สำเร็จ";
      // Special polish for done step
      if (s.id === "done" && kind === "ok") li.textContent = "สำเร็จแล้ว";
      else if (s.id === "done" && kind === "pending") li.textContent = "กำลังสรุปผล…";
      else if (s.id === "login" && kind === "ok") li.textContent = "เข้าสู่ระบบเกมแล้ว";
      else if (s.id === "clear" && kind === "ok") li.textContent = "เคลียร์รางวัลค้างแล้ว";
      else if (s.id === "match" && kind === "ok") li.textContent = "จับคู่สำเร็จ";
      else if (s.id === "run" && kind === "ok") li.textContent = "จบการวิ่งแล้ว";
      else if (s.id === "claim" && kind === "ok") li.textContent = "รับรางวัลเรียบร้อย";
      else li.textContent = label;
      li.classList.add(kind === "pending" ? "pending" : kind);
      list.appendChild(li);
    }
    for (const extra of pipelineState.extras || []) {
      const li = document.createElement("li");
      li.textContent = extra.text;
      li.classList.add(extra.kind || "ok");
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;
  }

  function clearStageTimer() {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = null;
    }
  }

  function startLiveStages() {
    clearStageTimer();
    pipelineState = freshPipeline();
    openRunStatusPopup(true);
    setPipelineActive(0);
    let tick = 0;
    stageTimer = setInterval(() => {
      tick += 1;
      const softIdx = Math.min(tick, 4);
      if (
        pipelineState &&
        pipelineState.kinds.done !== "ok" &&
        !PIPELINE_STEPS.some((s) => pipelineState.kinds[s.id] === "err")
      ) {
        if (softIdx > pipelineState.activeIdx) setPipelineActive(softIdx);
      }
      if (tick >= 4) clearStageTimer();
    }, 5000);
  }

  function buildFinalPipeline(rawLogs, result, ok) {
    clearStageTimer();
    pipelineState = freshPipeline();
    if (ok) {
      applyLogsToPipeline(rawLogs);
      finalizePipelineSuccess(result);
    } else {
      applyLogsToPipeline(rawLogs);
      const errCode = String(result?.error || "");
      let failId = "done";
      if (/login/i.test(errCode)) failId = "login";
      else if (/corrupt/i.test(errCode)) failId = "clear";
      else if (/matchmaking/i.test(errCode)) failId = "match";
      else if (/claim/i.test(errCode)) failId = "claim";
      else if (/ingame|farm/i.test(errCode)) failId = "run";
      const alreadyErr = PIPELINE_STEPS.some((s) => pipelineState.kinds[s.id] === "err");
      if (!alreadyErr) {
        markPipelineError(failId, farmErrorMessage(result, "การฟาร์มไม่สำเร็จ ลองใหม่อีกครั้ง"));
      } else if (!(pipelineState.extras || []).length) {
        pipelineState.extras = [
          { text: farmErrorMessage(result, "การฟาร์มไม่สำเร็จ ลองใหม่อีกครั้ง"), kind: "err" },
        ];
        renderPipeline();
      } else {
        renderPipeline();
      }
    }
    setRunStatusClosable(true);
    setRunStatusSubtitle(true, !!ok);
  }

  function farmErrorMessage(result, fallback) {
    const err = result?.error || fallback || "";
    return thError(err);
  }

  /* ---------- DevPlay autofill guards ---------- */
  function armReadonlyUnlock(el) {
    if (!el) return;
    const unlock = () => {
      el.removeAttribute("readonly");
    };
    el.addEventListener("focus", unlock);
    el.addEventListener("pointerdown", unlock);
    requestAnimationFrame(() => {
      if (el.value && document.activeElement !== el) {
        el.value = "";
      }
      el.setAttribute("readonly", "readonly");
    });
  }

  function setupDevPlayAutofillGuards() {
    const mail = $("dp-acct-mail");
    const secret = $("dp-acct-secret");
    armReadonlyUnlock(mail);
    armReadonlyUnlock(secret);
    setTimeout(() => {
      if (mail && document.activeElement !== mail) mail.value = "";
      if (secret && document.activeElement !== secret) secret.value = "";
      if (mail) mail.setAttribute("readonly", "readonly");
      if (secret) secret.setAttribute("readonly", "readonly");
    }, 300);
  }

  async function runFarm() {
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    const btn = $("farm-btn");
    const tokensBefore = tokenBalance();
    farmRunning = true;
    btn.disabled = true;
    setStatus($("farm-status"), "กำลังฟาร์ม… อาจใช้เวลาสักครู่", "muted");
    startLiveStages();

    try {
      const data = await api("/api/farm/run", {
        method: "POST",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
          score: parseFarmNum($("farm-score").value),
          coin: parseFarmNum($("farm-coin").value),
          exp: parseFarmNum($("farm-exp").value),
        },
      });
      clearStageTimer();
      if (typeof data.token_balance === "number") {
        profile.token_balance = data.token_balance;
        paintProfile();
      } else {
        await refreshMe().catch(() => {});
      }

      const result = data.result || data;
      buildFinalPipeline(data.logs || data.steps || [], result, !!data.ok);

      if (data.ok) {
        setStatus($("farm-status"), "ฟาร์มสำเร็จ · หัก 1 โทเค็น", "ok");
        const summary = result?.reward_summary || {};
        const reward = result?.reward || {};
        pendingAfterRunStatus = () =>
          showResultModal({
            account:
              (summary.nickname || result?.account?.nickname || "—") +
              " · level " +
              (summary.level ?? reward.level ?? "—"),
            coinDelta: formatNumTh(summary.coin_delta ?? reward.coin?.delta ?? 0),
            coinTotal: formatNumTh(summary.coin_total ?? reward.coin?.total ?? "—"),
            xpDelta: formatNumTh(summary.exp_delta ?? reward.exp?.delta ?? 0),
            xpTotal: formatNumTh(summary.exp_total ?? reward.exp?.total ?? "—"),
            tokensBefore: formatNumTh(data.tokens_before ?? tokensBefore),
            tokensAfter: formatNumTh(
              data.tokens_after ?? data.token_balance ?? tokenBalance()
            ),
          });
        stopQueuePoll();
        refreshGateAndQueueUi().catch(() => {});
      } else {
        const msg = farmErrorMessage(result, "ฟาร์มจบแล้วแต่มีปัญหา · โทเค็นถูกหักแล้ว");
        setStatus($("farm-status"), msg, "err");
        // Error stays in status cards; no stacked error modal
      }
    } catch (e) {
      clearStageTimer();
      if (e.status === 409 || /farm_busy/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        const gate = e.gate || e.data?.detail?.gate;
        if (gate) renderQueueModal(gate);
        else renderQueueModal({ farm_busy: true, queue_length: 0, me: {} });
        startQueuePoll();
        setStatus($("farm-status"), "ระบบไม่ว่าง — เข้าคิวหรือรอคิว", "muted");
      } else {
        const msg = thError(e.message) || "ฟาร์มไม่สำเร็จ";
        setStatus($("farm-status"), msg, "err");
        buildFinalPipeline(e.data?.logs || [], e.data?.result || { error: e.message }, false);

        if (e.status === 402 || /insufficient_tokens/i.test(String(e.message))) {
          forceCloseRunStatusPopup();
          profile.token_balance = 0;
          paintProfile();
          showEmptyCoinsModal();
        } else if (typeof e.data?.token_balance === "number") {
          profile.token_balance = e.data.token_balance;
          paintProfile();
        }
      }
    } finally {
      farmRunning = false;
      updateFarmAvailability();
    }
  }

  /* ---------- Auth bootstrap ---------- */
  async function bootstrap() {
    // Check URL hash for Discord OAuth token
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.slice(1));
      const err = params.get("discord_error");
      if (err) {
        window.location.hash = "";
        window.history.replaceState(null, "", window.location.pathname);
        document.getElementById("login-status").textContent = "Discord login failed: " + err;
      } else if (hash.includes("access_token=")) {
        try {
          const t = params.get("access_token");
          if (t) {
            localStorage.setItem("ckr_token", t);
          }
          window.location.hash = "";
          window.history.replaceState(null, "", window.location.pathname);
        } catch (_) {}
      }
    }

    setupDevPlayAutofillGuards();
    setupFarmNumberInputs();
    setupXpCalculator();

    // Re-check balance when user returns from Telegram
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || !accessToken) return;
      if (modalMode === "empty") {
        try {
          await refreshMe();
        } catch (_) {}
      }
      if (modalMode === "queue" || lastGate?.me?.status) {
        refreshGateAndQueueUi().catch(() => {});
      }
    });

    // Try Discord JWT token
    const discordToken = localStorage.getItem("ckr_token");
    if (discordToken) {
      accessToken = discordToken;
      try {
        await refreshMe();
        return;
      } catch (e) {
        localStorage.removeItem("ckr_token");
        accessToken = null;
      }
    }

    showLogin();
  }

  /* ---------- Tab switching (sidebar + topbar) ---------- */
  document.querySelectorAll(".nav-link[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const container = btn.closest(".sidebar-nav");
      if (container) container.querySelectorAll(".active").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tabId = btn.dataset.tab;
      if (!tabId) return;
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      const tab = document.getElementById("tab-" + tabId);
      if (tab) tab.classList.add("active");
      if (tabId === "history") refreshHistory();
    });
  });

  $("logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    accessToken = null;
    profile = null;
    localStorage.removeItem("ckr_token");
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes("auth-token")) keys.push(k);
      }
      keys.forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    } catch (_) {}
    showLogin();
  });

  $("farm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (farmRunning) return;

    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    const dpEmail = ($("dp-acct-mail").value || "").trim();
    const dpPass = $("dp-acct-secret").value || "";
    if (!dpEmail || !dpPass) {
      showErrorModal(
        "กรอกอีเมลและรหัสผ่าน DevPlay ของเกมให้ครบก่อนเริ่มฟาร์ม",
        "ข้อมูลไม่ครบ"
      );
      return;
    }

    const confirmed = await showConfirmModal();
    if (!confirmed) {
      setStatus($("farm-status"), "ยกเลิกแล้ว — ยังไม่หักโทเค็น", "muted");
      return;
    }

    // Double-check balance after confirm (in case it changed)
    try {
      await refreshMe();
    } catch (_) {}

    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    await runFarm();
  });

  $("run-status-close")?.addEventListener("click", () => {
    closeRunStatusPopup();
  });

  $("run-status-root")
    ?.querySelector(".run-status-backdrop")
    ?.addEventListener("click", () => {
      if (runStatusClosable) closeRunStatusPopup();
    });

  // Mobile sidebar toggle
  const mobileToggle = document.getElementById("mobile-toggle");
  if (mobileToggle) {
    mobileToggle.addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (window.innerWidth > 768) return;
      const s = document.getElementById("sidebar");
      if (!s.classList.contains("open")) return;
      if (!s.contains(e.target) && !mobileToggle.contains(e.target)) {
        s.classList.remove("open");
      }
    });
  }

  // Redeem code
  const redeemBtn = document.getElementById("redeem-btn");
  const redeemInput = document.getElementById("redeem-code-input");
  const redeemStatus = document.getElementById("redeem-status");
  if (redeemBtn) {
    redeemBtn.addEventListener("click", async () => {
      const code = (redeemInput.value || "").trim().toUpperCase();
      if (!code) { setStatus(redeemStatus, "Enter a redeem code", "err"); return; }
      redeemBtn.disabled = true;
      setStatus(redeemStatus, "Redeeming...", "load");
      try {
        const data = await api("/api/farm/redeem/redeem-code", { method: "POST", body: { code } });
        setStatus(redeemStatus, "Redeemed! +" + data.tokens + " Tokens", "ok");
        redeemInput.value = "";
        if (typeof data.token_balance === "number") {
          profile.token_balance = data.token_balance;
          paintProfile();
        }
      } catch (e) {
        setStatus(redeemStatus, e.message, "err");
      }
      redeemBtn.disabled = false;
    });
  }

  // History
  async function refreshHistory() {
    const list = document.getElementById("history-list");
    const st = document.getElementById("history-status");
    if (!list) return;
    st.textContent = "Loading...";
    try {
      const data = await api("/api/me/history");
      let html = "";
      const items = [];
      if (data.ledger) data.ledger.forEach(function(l) { items.push({ type: "ledger", delta: l.delta, reason: l.reason || "", time: l.created_at }); });
      if (data.payments) data.payments.forEach(function(p) { items.push({ type: "payment", status: p.status, amount: p.amount_baht, tokens: p.tokens, time: p.created_at }); });
      if (data.runs) data.runs.forEach(function(r) { items.push({ type: "run", status: r.status, time: r.created_at }); });
      items.sort(function(a, b) { return (b.time || "").localeCompare(a.time || ""); });
      if (items.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px">No history yet</p>';
        st.textContent = "";
        return;
      }
      items.slice(0, 50).forEach(function(item) {
        var time = item.time ? new Date(item.time).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        if (item.type === "ledger") {
          var isCredit = item.delta > 0;
          html += '<div class="history-item"><div class="history-icon ' + (isCredit ? "credit" : "debit") + '"><img src="' + (isCredit ? "assets/coin.png" : "assets/tr_event_116.png") + '" alt="" /></div><div class="history-info"><div class="history-reason">' + (item.reason || "Token " + (isCredit ? "credit" : "debit")) + '</div><div class="history-time">' + time + '</div></div><div class="history-amount ' + (isCredit ? "pos" : "neg") + '">' + (isCredit ? "+" : "") + item.delta + '</div></div>';
        } else if (item.type === "payment") {
          html += '<div class="history-item"><div class="history-icon credit"><img src="assets/PromptPay.png" alt="" /></div><div class="history-info"><div class="history-reason">PromptPay ' + item.amount + ' THB</div><div class="history-time">' + time + '</div></div><div class="history-amount pos">+' + item.tokens + '</div></div>';
        } else if (item.type === "run") {
          var badge = item.status === "succeeded" ? "completed" : item.status === "failed" ? "failed" : "pending";
          html += '<div class="history-item"><div class="history-icon ' + (item.status === "succeeded" ? "credit" : "debit") + '"><img src="assets/tr_event_116.png" alt="" /></div><div class="history-info"><div class="history-reason">Farm Run</div><div class="history-time">' + time + '</div></div><div class="status-badge ' + badge + '">' + (item.status || "") + '</div></div>';
        }
      });
      list.innerHTML = html;
      st.textContent = items.length + " entries";
    } catch (e) {
      list.innerHTML = '<p style="text-align:center;color:var(--danger);padding:20px">Failed to load: ' + e.message + "</p>";
      st.textContent = "Error";
    }
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const root = $("run-status-root");
    if (!root || root.classList.contains("hidden")) return;
    if (runStatusClosable) closeRunStatusPopup();
    else ev.preventDefault();
  });

  // Voucher redeem
  const voucherBtn = $("voucher-btn");
  const voucherUrl = $("voucher-url");
  const voucherStatus = $("voucher-status");
  voucherBtn?.addEventListener("click", async () => {
    const url = voucherUrl.value.trim();
    if (!url) { setStatus(voucherStatus, "กรุณาใส่ลิงก์ซอง TrueMoney", "err"); return; }
    voucherBtn.disabled = true;
    setStatus(voucherStatus, "กำลังแลกซอง...", "load");
    try {
      const data = await api("/api/farm/redeem-voucher", { method: "POST", body: { voucher_url: url } });
      setStatus(voucherStatus, `✅ แลกสำเร็จ! +${data.tokens_added} Token (${data.amount_baht} บาท)`, "ok");
      voucherUrl.value = "";
      if (typeof data.token_balance === "number") {
        profile.token_balance = data.token_balance;
        $("nav-balance-num").textContent = String(profile.token_balance);
        const balEl = $("token-balance");
        if (balEl) balEl.textContent = String(profile.token_balance);
      }
    } catch (e) {
      setStatus(voucherStatus, "❌ " + e.message, "err");
    }
    voucherBtn.disabled = false;
  });

  // ---------- PromptPay / SlipOK ----------
  let ppPollTimer = null;
  let ppRef = null;

  function stopPpPoll() {
    if (ppPollTimer) { clearInterval(ppPollTimer); ppPollTimer = null; }
  }

  function startPpPoll(ref) {
    stopPpPoll();
    ppRef = ref;
    ppPollTimer = setInterval(async () => {
      if (!ref) return;
      try {
        const data = await api("/api/farm/payment/status/" + ref);
        if (data.status === "confirmed") {
          stopPpPoll();
          setStatus($("pp-status"), "✅ Payment confirmed! Tokens credited.", "ok");
          $("pp-verify-area")?.classList.add("hidden");
          $("pp-verify-btn")?.remove();
          try {
            const me = await api("/api/me");
            profile = me.profile;
            paintProfile();
          } catch (_) {}
          return;
        }
        setStatus($("pp-status"), "⏳ Waiting for payment...", "load");
      } catch (e) {
        if (!/network/i.test(e.message)) {
          setStatus($("pp-status"), "⏳ Checking...", "load");
        }
      }
    }, 5000);
  }

  document.querySelectorAll(".pp-amt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pp-amt-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $("pp-amount").value = btn.dataset.amt;
    });
  });

  $("pp-generate-btn")?.addEventListener("click", async () => {
    const amount = parseInt($("pp-amount")?.value || "0", 10);
    if (amount < 15 || amount > 10000) {
      setStatus($("pp-status"), "Amount must be 15–10,000 THB", "err");
      return;
    }
    const btn = $("pp-generate-btn");
    btn.disabled = true;
    setStatus($("pp-status"), "Generating QR code...", "load");
    $("pp-qr-area")?.classList.remove("hidden");
    $("pp-verify-area")?.classList.add("hidden");
    try {
      const data = await api("/api/farm/payment/create", { method: "POST", body: { amount } });
      const qrImg = $("pp-qr-img");
      if (qrImg) qrImg.src = data.qr_image || data.qr_url;
      const amtEl = $("pp-qr-amount");
      if (amtEl) amtEl.textContent = data.amount_baht + " THB = " + data.tokens + " Tokens";
      const refEl = $("pp-qr-ref");
      if (refEl) refEl.textContent = "Ref: " + data.ref;
      setStatus($("pp-status"), "Scan QR with your banking app to pay", "ok");
      $("pp-verify-area")?.classList.remove("hidden");
      startPpPoll(data.ref);
    } catch (e) {
      setStatus($("pp-status"), "❌ " + e.message, "err");
      $("pp-qr-area")?.classList.add("hidden");
    }
    btn.disabled = false;
  });

  $("pp-verify-btn")?.addEventListener("click", async () => {
    if (!ppRef) return;
    const fileInput = $("pp-slip-file");
    const file = fileInput?.files?.[0];
    if (!file) {
      setStatus($("pp-status"), "Please upload a screenshot of your payment slip", "err");
      return;
    }
    setStatus($("pp-status"), "Verifying with SlipOK...", "load");
    try {
      const form = new FormData();
      form.append("ref", ppRef);
      form.append("file", file);
      const token = accessToken;
      const res = await fetch(API + "/api/farm/payment/verify", {
        method: "POST",
        headers: token ? { Authorization: "Bearer " + token } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.detail || data?.message || res.statusText;
        if (/duplicate_slip/i.test(msg)) {
          setStatus($("pp-status"), "❌ This slip has already been used", "err");
        } else {
          setStatus($("pp-status"), "❌ " + msg, "err");
        }
        return;
      }
      if (data.status === "confirmed") {
        stopPpPoll();
        setStatus($("pp-status"), "✅ Verified! +" + data.tokens + " Tokens credited.", "ok");
        $("pp-verify-area")?.classList.add("hidden");
        $("pp-verify-btn")?.remove();
        if (typeof data.token_balance === "number") {
          profile.token_balance = data.token_balance;
          paintProfile();
        } else {
          try {
            const me = await api("/api/me");
            profile = me.profile;
            paintProfile();
          } catch (_) {}
        }
      } else {
        setStatus($("pp-status"), "⏳ Not yet confirmed", "load");
      }
    } catch (e) {
      const msg = e.message || "";
      if (/duplicate_slip/i.test(msg)) {
        setStatus($("pp-status"), "❌ This slip has already been used", "err");
      } else {
        setStatus($("pp-status"), "❌ " + msg, "err");
      }
    }
  });

  bootstrap();
})();
