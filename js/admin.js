(function () {
  "use strict";

  const cfg = window.CKR_CONFIG;
  if (!cfg) {
    document.body.innerHTML = '<p style="padding:2rem;color:var(--danger)">Missing config.js</p>';
    return;
  }

  const API = cfg.API_BASE || "";
  let TOKEN = null;
  let _challenge = "";
  fetch(API + "/api/challenge")
    .then((r) => r.json())
    .then((d) => { if (d.ok) _challenge = d.challenge; })
    .catch(() => {});
  let editState = null;

  const $ = (id) => document.getElementById(id);
  const status = (el, msg, type) => {
    el.textContent = msg || "";
    el.className = "card-subtitle" + (type ? " status-" + type : "");
  };

  async function api(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    if (_challenge) headers["X-Challenge"] = _challenge;
    const res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || data?.reason || data?.error || res.statusText);
    return data;
  }

  // Login
  $("login-btn").onclick = async () => {
    status($("login-status"), "Signing in...", "ok");
    try {
      const data = await api("POST", "/api/auth/login", {
        username: $("login-user").value.trim(),
        password: $("login-pass").value,
      });
      if (data.profile?.role !== "admin") {
        status($("login-status"), "Admin only", "err");
        return;
      }
      TOKEN = data.access_token;
      $("login-view").classList.add("hidden");
      $("admin-view").classList.remove("hidden");
      $("sidebar").classList.remove("hidden");
      $("header-user-name").textContent = data.profile?.username || "admin";
      status($("login-status"), "", "");
      refreshDashboard();
    } catch (e) {
      status($("login-status"), e.message, "err");
    }
  };

  $("login-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("login-btn").click();
  });

  $("logout-btn").onclick = () => {
    TOKEN = null;
    $("admin-view").classList.add("hidden");
    $("login-view").classList.remove("hidden");
    $("sidebar").classList.add("hidden");
    $("header-user-name").textContent = "";
    $("sidebar").classList.remove("open");
  };

  // Navigation
  document.querySelectorAll(".nav-link[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-link[data-page]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll("#admin-view .tab-content").forEach((p) => p.classList.remove("active"));
      const page = document.getElementById("page-" + btn.dataset.page);
      if (page) page.classList.add("active");
      if (btn.dataset.page === "dashboard") refreshDashboard();
      if (btn.dataset.page === "queue") refreshQueue();
      if (btn.dataset.page === "health") refreshHealth();
      if (btn.dataset.page === "codes") refreshCodes();
      // Close sidebar on mobile
      if (window.innerWidth <= 768) document.getElementById("sidebar").classList.remove("open");
    });
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

  // Users dashboard
  function editRow(id, username, tokens, role) {
    if (editState === id) return;
    editState = id;
    const tokensCell = document.querySelector(`.cell-tokens[data-id="${id}"]`);
    const roleCell = document.querySelector(`.cell-role[data-id="${id}"]`);
    tokensCell.innerHTML = `<div class="edit-inline"><input type="number" id="edit-tokens-${id}" value="${tokens}" min="0" /></div>`;
    roleCell.innerHTML = `<div class="edit-inline">
      <select id="edit-role-${id}">
        <option value="normal" ${role === "normal" ? "selected" : ""}>normal</option>
        <option value="admin" ${role === "admin" ? "selected" : ""}>admin</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="(function(){saveRow('${id}')})()" style="color:var(--success)">Save</button>
      <button class="btn btn-ghost btn-sm" onclick="(function(){cancelEdit('${id}', ${tokens}, '${role}')})()">Cancel</button>
    </div>`;
  }
  window.editRow = editRow;

  function cancelEdit(id, tokens, role) {
    editState = null;
    const tokensCell = document.querySelector(`.cell-tokens[data-id="${id}"]`);
    const roleCell = document.querySelector(`.cell-role[data-id="${id}"]`);
    tokensCell.innerHTML = tokens;
    roleCell.innerHTML = `<span class="status-badge ${role === "admin" ? "completed" : "pending"}">${role}</span>`;
  }
  window.cancelEdit = cancelEdit;

  async function saveRow(id) {
    const newTokens = parseInt(document.getElementById(`edit-tokens-${id}`).value) || 0;
    const newRole = document.getElementById(`edit-role-${id}`).value;
    editState = null;
    try {
      const data = await api("POST", "/api/admin/update-user", {
        user_id: id,
        token_balance: newTokens,
        role: newRole,
      });
      if (data.ok) {
        refreshDashboard();
        status($("dash-status"), "Updated", "ok");
      }
    } catch (e) {
      cancelEdit(id, newTokens, newRole);
      status($("dash-status"), e.message, "err");
    }
  }
  window.saveRow = saveRow;

  async function refreshDashboard() {
    status($("dash-status"), "Loading...", "ok");
    try {
      const data = await api("GET", "/api/admin/users");
      const users = data.users || [];
      let html =
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Username</th><th>Tokens</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody>';
      users.forEach((u) => {
        const created = u.created_at ? u.created_at.slice(0, 10) : "—";
        html += `<tr id="row-${u.id}">
          <td><strong>${u.username || "?"}</strong></td>
          <td class="cell-tokens" data-id="${u.id}">${u.token_balance ?? 0}</td>
          <td class="cell-role" data-id="${u.id}"><span class="status-badge ${u.role === "admin" ? "completed" : "pending"}">${u.role || "normal"}</span></td>
          <td>${created}</td>
          <td><button class="btn-edit" onclick="editRow('${u.id}', '${u.username}', ${u.token_balance ?? 0}, '${u.role || "normal"}')">Edit</button></td>
        </tr>`;
      });
      html += "</tbody></table></div>";
      $("dash-table").innerHTML = html;
      status($("dash-status"), users.length + " users", "ok");
    } catch (e) {
      status($("dash-status"), e.message, "err");
    }
  }

  // Health
  async function refreshHealth() {
    try {
      const h = await fetch(API + "/api/health").then((r) => r.json());
      $("health-info").innerHTML = `
        <span><span class="status-dot ${h.supabase_configured ? "green" : "red"}"></span> Supabase: <b>${h.supabase_configured ? "OK" : "Not configured"}</b></span>
        <span><span class="status-dot ${h.service_role_configured ? "green" : "red"}"></span> Service Role: <b>${h.service_role_configured ? "OK" : "Not configured"}</b></span>
        <span><span class="status-dot ${h.farm_busy ? "red" : "green"}"></span> Farm: <b>${h.farm_busy ? "Busy" : "Available"}</b></span>
        <span><span class="status-dot green"></span> Service: <b>${h.service}</b></span>
      `;
    } catch (e) {
      $("health-info").innerHTML = '<span style="color:var(--danger)">Failed: ' + e.message + "</span>";
    }
  }

  // Queue
  async function refreshQueue() {
    status($("queue-status"), "Loading...", "ok");
    try {
      const q = await api("GET", "/api/admin/queue");
      if (q.ok) {
        let html = "";
        if (q.farm_busy)
          html += '<div style="color:var(--danger);margin-bottom:10px;font-weight:600">Farm is running</div>';
        if (q.max_queue_size) {
          const pct = Math.round((q.queue_length / q.max_queue_size) * 100);
          const color = pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warning)" : "var(--accent)";
          html += `<div style="margin-bottom:10px;font-size:.82rem;color:var(--text-muted)">Queue: <strong style="color:${color}">${q.queue_length}</strong> / ${q.max_queue_size}</div>`;
        }
        if (q.current) {
          const sec = q.current.turn_expires?.remaining_sec ?? 0;
          const min = Math.floor(sec / 60);
          const s = sec % 60;
          html += `<div class="queue-stat" style="margin-bottom:10px">
            <span>Current: <strong>${q.current.username || q.current.user_id?.slice(0, 8)}</strong></span>
            <span style="color:var(--text-muted)">${min}:${String(s).padStart(2, "0")} remaining</span>
          </div>`;
        }
        if (q.queue && q.queue.length > 0) {
          html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Username</th><th>Joined</th></tr></thead><tbody>';
          q.queue.forEach((u) => {
            const joined = u.joined_at ? u.joined_at.slice(11, 19) : "—";
            html += `<tr><td>${u.position}</td><td>${u.username || u.user_id?.slice(0, 8)}</td><td>${joined}</td></tr>`;
          });
          html += "</tbody></table></div>";
        } else if (!q.current) {
          html += '<div style="color:var(--accent)">Queue is empty</div>';
        }
        if (q.last_done && q.last_done.length > 0) {
          html +=
            '<div style="margin-top:12px;color:var(--text-muted);font-size:.72rem">Recent: ' +
            q.last_done
              .slice(0, 3)
              .map((d) => d.username + " " + (d.done_at?.slice(11, 19) || ""))
              .join(", ") +
            "</div>";
        }
        $("queue-info").innerHTML = html || '<div style="color:var(--text-muted)">No data</div>';
        status($("queue-status"), (q.queue?.length || 0) + " in queue", "ok");
      }
    } catch (e) {
      $("queue-info").textContent = e.message;
      status($("queue-status"), "Error", "err");
    }
  }

  // Token actions
  $("t-add-btn").onclick = () => tokenAction(parseInt($("t-amount").value) || 0);
  $("t-remove-btn").onclick = () => tokenAction(-(parseInt($("t-amount").value) || 0));

  async function tokenAction(amount) {
    status($("token-status"), "Processing...", "ok");
    try {
      const data = await api("POST", "/api/admin/add-tokens", {
        query: $("t-username").value.trim(),
        amount,
      });
      const act = amount > 0 ? "Added" : "Removed";
      status($("token-status"), act + " " + data.username + " (Balance: " + data.token_balance + ")", "ok");
    } catch (e) {
      status($("token-status"), e.message, "err");
    }
  }

  // Voucher settings
  async function loadVoucherSettings() {
    try {
      const data = await api("GET", "/api/admin/voucher-settings");
      if (data.ok) {
        $("vs-phone").value = data.phone || "0644718725";
        $("vs-points").value = data.points_per_baht || 1;
      }
    } catch (_) {}
  }
  loadVoucherSettings();

  $("vs-save-btn").onclick = async () => {
    const st = $("voucher-settings-status");
    status(st, "Saving...", "ok");
    try {
      const data = await api("POST", "/api/admin/voucher-settings", {
        phone: $("vs-phone").value.trim(),
        points_per_baht: parseInt($("vs-points").value) || 1,
      });
      status(st, "Saved: phone=" + data.phone + ", " + data.points_per_baht + " pt/baht", "ok");
    } catch (e) {
      status(st, e.message, "err");
    }
  };

  // Redeem codes
  $("code-generate-btn").onclick = async () => {
    const tokens = parseInt($("code-tokens").value) || 0;
    const maxUses = parseInt($("code-max-uses").value) || 1;
    const custom = ($("code-custom").value || "").trim().toUpperCase();
    if (tokens < 1) {
      status($("code-status"), "Token amount must be >= 1", "err");
      return;
    }
    status($("code-status"), "Generating...", "ok");
    try {
      const body = { tokens, max_uses: maxUses };
      if (custom) body.code = custom;
      const data = await api("POST", "/api/admin/redeem-code/create", body);
      if (data.ok) {
        $("code-display").textContent = data.code;
        $("code-result").classList.remove("hidden");
        $("code-custom").value = "";
        status($("code-status"), "Code generated: " + data.tokens + " tokens, " + data.max_uses + " use(s)", "ok");
        refreshCodes();
      }
    } catch (e) {
      status($("code-status"), e.message, "err");
    }
  };

  $("code-copy-btn").onclick = () => {
    const code = $("code-display").textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        status($("code-status"), "Copied to clipboard!", "ok");
      });
    }
  };

  async function refreshCodes() {
    status($("codes-list-status"), "Loading...", "ok");
    try {
      const data = await api("GET", "/api/admin/redeem-codes");
      const codes = data.codes || [];
      if (codes.length === 0) {
        $("codes-list").innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">No codes generated yet</p>';
        status($("codes-list-status"), "No codes", "");
        return;
      }
      let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Tokens</th><th>Uses</th><th>Status</th><th>Created</th></tr></thead><tbody>';
      codes.forEach((c) => {
        const used = c.used_count || 0;
        const maxUses = c.max_uses || 1;
        const full = used >= maxUses;
        const created = c.created_at ? c.created_at.slice(0, 16).replace("T", " ") : "—";
        html += `<tr>
          <td><code style="color:var(--primary-light);font-family:'Space Mono',monospace">${c.code}</code></td>
          <td class="table-amount" style="color:var(--success)">+${c.tokens}</td>
          <td>${used}/${maxUses}</td>
          <td>${full ? '<span style="color:var(--danger)">Exhausted</span>' : '<span style="color:var(--success)">Available</span>'}</td>
          <td>${created}</td>
        </tr>`;
      });
      html += "</tbody></table></div>";
      $("codes-list").innerHTML = html;
      status($("codes-list-status"), codes.length + " codes", "ok");
    } catch (e) {
      status($("codes-list-status"), e.message, "err");
    }
  }

  // Auto-refresh queue every 10s
  setInterval(() => {
    const queuePage = document.getElementById("page-queue");
    if (queuePage && queuePage.classList.contains("active") && TOKEN) {
      refreshQueue();
    }
  }, 10000);
})();
