import './admin.css';
import {
  ApiError,
  apiJson,
  cloudApi,
  formatBytes,
  formatDateTime,
  type CloudUser,
  type ProjectStatus,
  type ProjectVisibility,
  type UserRole,
  type UserStatus,
} from '../cloud/api';

type TabKey = 'overview' | 'users' | 'projects' | 'audit' | 'settings';

interface OverviewResponse {
  stats: {
    totalUsers: number;
    activeUsers: number;
    disabledUsers: number;
    adminUsers: number;
    totalQuotaBytes: number;
    totalProjects: number;
    sharedProjects: number;
    privateProjects: number;
    draftProjects: number;
    reviewProjects: number;
    approvedProjects: number;
    totalAssetRefs: number;
    uniqueR2Objects: number;
    totalR2Bytes: number;
    activity7d: number;
  };
  activity14d: Array<{ date: string; saves: number; logins: number }>;
  topUsers: Array<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
    quotaBytes: number;
    projectCount: number;
    usedBytes: number;
  }>;
  recentLogs: AuditLogItem[];
}

interface AdminUserItem {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  quotaBytes: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  projectCount: number;
  usedBytes: number;
}

interface AdminProjectItem {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  thumbnailUrl: string | null;
  assetCount: number;
  totalBytes: number;
  version: number;
  visibility: ProjectVisibility;
  status: ProjectStatus;
  tags: string[];
  notes: string;
  shareEnabled: boolean;
  shareToken: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AuditLogItem {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detailJson: string | null;
  ip: string | null;
  createdAt: number;
}

interface AdminSettings {
  defaultQuotaMb: number;
  defaultVisibility: ProjectVisibility;
  allowPublicShare: boolean;
  maxVersionsPerProject: number;
}

const root = document.getElementById('admin-root')!;

let currentUser: CloudUser | null = null;
let setupRequired = false;
let activeTab: TabKey = 'overview';

// Filters
let userSearch = '';
let userRoleFilter = '';
let userStatusFilter = '';
let projectSearch = '';
let projectStatusFilter = '';
let projectVisFilter = '';
let projectSharedOnly = false;
let auditFilter = '';

function esc(str: string | null | undefined): string {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function toast(msg: string) {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = msg;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

function quotaBarClass(ratio: number): string {
  if (ratio >= 0.9) return 'bar-fill is-danger';
  if (ratio >= 0.72) return 'bar-fill is-warn';
  return 'bar-fill';
}

function generateStrongPassword(len = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    'system.bootstrap': 'Khởi tạo hệ thống',
    'auth.login': 'Đăng nhập',
    'auth.logout': 'Đăng xuất',
    'auth.profile_update': 'Đổi tên hiển thị',
    'auth.password_change': 'Đổi mật khẩu',
    'auth.session_revoke': 'Thu hồi phiên',
    'auth.sessions_revoke_others': 'Đăng xuất thiết bị khác',
    'project.create': 'Tạo project',
    'project.update': 'Cập nhật project',
    'project.duplicate': 'Nhân bản project',
    'project.meta': 'Sửa thông tin project',
    'project.delete': 'Xóa project',
    'project.share': 'Đổi chia sẻ link',
    'project.visibility': 'Đổi hiển thị Team/Ẩn',
    'admin.user.create': 'Admin tạo user',
    'admin.user.update': 'Admin sửa user',
    'admin.user.delete': 'Admin xóa user',
    'admin.user.revoke_sessions': 'Admin ép đăng xuất',
    'admin.project.update': 'Admin cập nhật project',
    'admin.project.delete': 'Admin xóa project',
    'admin.settings.update': 'Cập nhật cài đặt',
    'admin.maintenance.sessions': 'Dọn phiên hết hạn',
    'admin.maintenance.r2_gc': 'Dọn rác R2',
  };
  return map[action] ?? action;
}

function renderActivitySvg(days: Array<{ date: string; saves: number; logins: number }>): string {
  const w = 560;
  const h = 150;
  const padL = 26;
  const padB = 24;
  const padT = 10;
  const plotW = w - padL - 8;
  const plotH = h - padB - padT;
  const maxVal = Math.max(4, ...days.map((d) => Math.max(d.saves, d.logins)));
  const groupW = plotW / Math.max(1, days.length);
  const barW = Math.max(4, Math.floor((groupW - 8) / 2));

  const bars = days
    .map((d, i) => {
      const gx = padL + i * groupW + 3;
      const sh = Math.round((d.saves / maxVal) * plotH);
      const lh = Math.round((d.logins / maxVal) * plotH);
      const label = d.date.slice(5);
      return `
        <g>
          <rect x="${gx}" y="${padT + plotH - sh}" width="${barW}" height="${Math.max(sh, 1)}" rx="2" fill="#3b82f6">
            <title>${d.date}: ${d.saves} lượt lưu</title>
          </rect>
          <rect x="${gx + barW + 2}" y="${padT + plotH - lh}" width="${barW}" height="${Math.max(lh, 1)}" rx="2" fill="#22c55e" opacity="0.85">
            <title>${d.date}: ${d.logins} đăng nhập</title>
          </rect>
          ${i % 2 === 0 ? `<text x="${gx + barW}" y="${h - 6}" text-anchor="middle" fill="#888894" font-size="10">${label}</text>` : ''}
        </g>
      `;
    })
    .join('');

  return `
    <div class="chart-legend">
      <span><i class="dot" style="background:#3b82f6"></i>Lượt lưu project</span>
      <span><i class="dot" style="background:#22c55e"></i>Lượt đăng nhập</span>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Biểu đồ hoạt động 14 ngày">
        <line x1="${padL}" y1="${padT + plotH}" x2="${w - 8}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.12)"/>
        <text x="${padL - 4}" y="${padT + 8}" text-anchor="end" fill="#888894" font-size="10">${maxVal}</text>
        <text x="${padL - 4}" y="${padT + plotH}" text-anchor="end" fill="#888894" font-size="10">0</text>
        ${bars}
      </svg>
    </div>
  `;
}

function renderGate(errorMsg = '') {
  if (setupRequired) {
    root.innerHTML = `
      <div class="gate-wrap">
        <form class="gate-card" id="setup-form">
          <div class="gate-brand">
            <img src="logo.png" alt="FX Studio">
            <strong>FX Studio Admin</strong>
          </div>
          <h1 class="gate-title">Khởi tạo tài khoản quản trị</h1>
          <p class="gate-sub">Hệ thống chưa có tài khoản nào. Tạo tài khoản Admin đầu tiên để bắt đầu.</p>
          ${errorMsg ? `<div class="err-banner">${esc(errorMsg)}</div>` : ''}
          <div class="field">
            <label for="s-name">Tên hiển thị</label>
            <input class="input" id="s-name" required value="Admin" autocomplete="name">
          </div>
          <div class="field">
            <label for="s-email">Email quản trị</label>
            <input class="input" id="s-email" type="email" required placeholder="admin@studio.local" autocomplete="email">
          </div>
          <div class="field">
            <label for="s-pass">Mật khẩu (tối thiểu 8 ký tự)</label>
            <input class="input" id="s-pass" type="password" required minlength="8" autocomplete="new-password">
          </div>
          <button class="btn btn-primary" style="width:100%" type="submit">Tạo tài khoản Admin</button>
        </form>
      </div>
    `;
    const form = document.getElementById('setup-form') as HTMLFormElement;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (document.getElementById('s-name') as HTMLInputElement).value.trim();
      const email = (document.getElementById('s-email') as HTMLInputElement).value.trim();
      const password = (document.getElementById('s-pass') as HTMLInputElement).value;
      try {
        const res = await cloudApi.setup(email, name, password);
        currentUser = res.user;
        setupRequired = false;
        await renderApp();
      } catch (err) {
        renderGate(err instanceof Error ? err.message : 'Khởi tạo thất bại');
      }
    });
    return;
  }

  if (currentUser && currentUser.role !== 'admin') {
    root.innerHTML = `
      <div class="gate-wrap">
        <div class="gate-card">
          <div class="gate-brand">
            <img src="logo.png" alt="FX Studio">
            <strong>FX Studio Admin</strong>
          </div>
          <h1 class="gate-title">Không có quyền quản trị</h1>
          <p class="gate-sub">Tài khoản <strong>${esc(currentUser.email)}</strong> chỉ có quyền thành viên (member).</p>
          <div class="actions-row">
            <a class="btn btn-primary" href="/">Về FX Studio</a>
            <button class="btn" id="btn-logout-gate" type="button">Đăng xuất</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btn-logout-gate')?.addEventListener('click', async () => {
      await cloudApi.logout();
      currentUser = null;
      renderGate();
    });
    return;
  }

  root.innerHTML = `
    <div class="gate-wrap">
      <form class="gate-card" id="login-form">
        <div class="gate-brand">
          <img src="logo.png" alt="FX Studio">
          <strong>FX Studio Admin</strong>
        </div>
        <h1 class="gate-title">Đăng nhập quản trị</h1>
        <p class="gate-sub">Hệ thống nội bộ — chỉ tài khoản được cấp mới có thể truy cập.</p>
        ${errorMsg ? `<div class="err-banner">${esc(errorMsg)}</div>` : ''}
        <div class="field">
          <label for="l-email">Email</label>
          <input class="input" id="l-email" type="email" required placeholder="admin@studio.local" autocomplete="username">
        </div>
        <div class="field">
          <label for="l-pass">Mật khẩu</label>
          <input class="input" id="l-pass" type="password" required autocomplete="current-password">
        </div>
        <button class="btn btn-primary" style="width:100%" type="submit">Đăng nhập</button>
        <div style="margin-top:14px;text-align:center">
          <a class="muted" href="/">← Quay lại FX Studio</a>
        </div>
      </form>
    </div>
  `;
  const form = document.getElementById('login-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('l-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('l-pass') as HTMLInputElement).value;
    try {
      const res = await cloudApi.login(email, password);
      currentUser = res.user;
      await renderApp();
    } catch (err) {
      renderGate(err instanceof Error ? err.message : 'Đăng nhập thất bại');
    }
  });
}

function renderShell(contentHtml: string) {
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sb-brand">
          <img src="logo.png" alt="FX Studio">
          <div>
            <div class="sb-brand-title">FX Studio</div>
            <div class="sb-brand-sub">Cloudflare Admin</div>
          </div>
        </div>
        <nav class="sb-nav">
          <button type="button" class="sb-item ${activeTab === 'overview' ? 'is-active' : ''}" data-tab="overview">Tổng quan</button>
          <button type="button" class="sb-item ${activeTab === 'users' ? 'is-active' : ''}" data-tab="users">Người dùng</button>
          <button type="button" class="sb-item ${activeTab === 'projects' ? 'is-active' : ''}" data-tab="projects">Dự án</button>
          <button type="button" class="sb-item ${activeTab === 'audit' ? 'is-active' : ''}" data-tab="audit">Nhật ký</button>
          <button type="button" class="sb-item ${activeTab === 'settings' ? 'is-active' : ''}" data-tab="settings">Cài đặt & Bảo trì</button>
        </nav>
        <div class="sb-foot">
          <div class="sb-user">
            <div class="sb-user-name">${esc(currentUser?.name)}</div>
            <div class="sb-user-email">${esc(currentUser?.email)}</div>
          </div>
          <a class="btn btn-sm" href="/portal">User Portal (/portal)</a>
          <a class="btn btn-sm" href="/">Mở FX Studio</a>
          <button class="btn btn-sm" id="btn-logout" type="button">Đăng xuất</button>
        </div>
      </aside>
      <main class="main" id="admin-main">${contentHtml}</main>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab as TabKey;
      void renderApp();
    });
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await cloudApi.logout();
    currentUser = null;
    renderGate();
  });
}

async function renderOverview() {
  renderShell('<div class="muted">Đang tải dữ liệu tổng quan…</div>');
  const data = await apiJson<OverviewResponse>('/api/admin/overview');
  const s = data.stats;

  const warnings = data.topUsers.filter((u) => u.quotaBytes > 0 && u.usedBytes / u.quotaBytes >= 0.8);

  const topHtml =
    data.topUsers.length === 0
      ? '<div class="muted">Chưa có dữ liệu lưu trữ.</div>'
      : data.topUsers
          .map((u) => {
            const ratio = u.quotaBytes > 0 ? Math.min(1, u.usedBytes / u.quotaBytes) : 0;
            return `
              <div class="storage-row">
                <div class="storage-row-top">
                  <div>
                    <strong>${esc(u.name)}</strong>
                    <span class="muted"> · ${esc(u.email)}</span>
                  </div>
                  <div class="num">${formatBytes(u.usedBytes)} / ${formatBytes(u.quotaBytes)} · ${u.projectCount} dự án</div>
                </div>
                <div class="bar-track">
                  <div class="${quotaBarClass(ratio)}" style="width:${(ratio * 100).toFixed(1)}%"></div>
                </div>
              </div>
            `;
          })
          .join('');

  const logsHtml =
    data.recentLogs.length === 0
      ? '<div class="muted">Chưa có nhật ký hoạt động.</div>'
      : `<table>
          <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th></tr></thead>
          <tbody>
            ${data.recentLogs
              .slice(0, 8)
              .map(
                (l) => `
              <tr>
                <td class="num muted">${formatDateTime(l.createdAt)}</td>
                <td>${esc(l.actorEmail || 'Hệ thống')}</td>
                <td><span class="pill pill-member">${esc(actionLabel(l.action))}</span></td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>`;

  renderShell(`
    <div class="page-head">
      <div>
        <h1>Tổng quan hệ thống</h1>
        <div class="page-sub">Cloudflare Workers · D1 + R2 · Phân quyền nội bộ</div>
      </div>
      <button class="btn" id="btn-refresh" type="button">Làm mới</button>
    </div>

    ${
      warnings.length > 0
        ? `<div class="err-banner">Cảnh báo dung lượng (>80% quota): ${warnings.map((w) => `${esc(w.name)} (${Math.round((w.usedBytes / w.quotaBytes) * 100)}%)`).join(', ')}</div>`
        : ''
    }

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Tài khoản nội bộ</div>
        <div class="kpi-value num">${s.totalUsers}</div>
        <div class="kpi-meta">${s.activeUsers} hoạt động · ${s.disabledUsers} bị khóa · ${s.adminUsers} admin</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tổng số dự án</div>
        <div class="kpi-value num">${s.totalProjects}</div>
        <div class="kpi-meta">${s.approvedProjects} đã duyệt · ${s.reviewProjects} chờ duyệt · ${s.draftProjects} nháp</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Dung lượng R2 thực tế</div>
        <div class="kpi-value num">${formatBytes(s.totalR2Bytes)}</div>
        <div class="kpi-meta">${s.uniqueR2Objects} tệp duy nhất · ${s.sharedProjects} link công khai</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Hoạt động (7 ngày)</div>
        <div class="kpi-value num">${s.activity7d}</div>
        <div class="kpi-meta">Tổng hạn mức: ${formatBytes(s.totalQuotaBytes)}</div>
      </div>
    </div>

    <div class="dash-grid" style="margin-bottom:16px">
      <section class="panel">
        <div class="panel-head"><h2>Hoạt động 14 ngày gần nhất</h2></div>
        ${renderActivitySvg(data.activity14d)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Dung lượng theo tài khoản</h2></div>
        ${topHtml}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2>Hoạt động gần đây</h2>
        <button class="btn btn-sm" id="btn-see-audit" type="button">Xem toàn bộ nhật ký</button>
      </div>
      <div class="table-wrap">${logsHtml}</div>
    </section>
  `);

  document.getElementById('btn-refresh')?.addEventListener('click', () => void renderOverview());
  document.getElementById('btn-see-audit')?.addEventListener('click', () => {
    activeTab = 'audit';
    void renderApp();
  });
}

function openUserModal(existing?: AdminUserItem) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const quotaMb = existing ? Math.max(50, Math.round(existing.quotaBytes / (1024 * 1024))) : 500;
  wrap.innerHTML = `
    <form class="modal-card" id="user-modal-form">
      <div class="modal-head">
        <h3>${existing ? 'Chỉnh sửa tài khoản' : 'Tạo tài khoản nội bộ'}</h3>
        <button class="btn btn-sm" type="button" id="m-close">Đóng</button>
      </div>
      <div id="m-err"></div>
      ${
        existing
          ? `<div class="field"><label>Email</label><input class="input" id="m-email" value="${esc(existing.email)}" disabled></div>`
          : `<div class="field"><label for="m-email">Email</label><input class="input" id="m-email" type="email" required placeholder="designer@studio.local"></div>`
      }
      <div class="field">
        <label for="m-name">Tên hiển thị</label>
        <input class="input" id="m-name" required value="${esc(existing?.name ?? '')}" placeholder="Nguyễn Văn A">
      </div>
      <div class="field">
        <label for="m-pass">${existing ? 'Đặt lại mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu (tối thiểu 8 ký tự)'}</label>
        <div style="display:flex;gap:6px">
          <input class="input" id="m-pass" type="text" ${existing ? '' : 'required minlength="8"'} placeholder="••••••••">
          <button class="btn btn-sm" type="button" id="m-gen-pass" style="white-space:nowrap">Tạo MK</button>
          <button class="btn btn-sm" type="button" id="m-copy-cred" style="white-space:nowrap">Copy</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field">
          <label for="m-role">Vai trò</label>
          <select class="select" id="m-role">
            <option value="member" ${existing?.role !== 'admin' ? 'selected' : ''}>Thành viên (Member)</option>
            <option value="admin" ${existing?.role === 'admin' ? 'selected' : ''}>Quản trị (Admin)</option>
          </select>
        </div>
        <div class="field">
          <label for="m-quota">Hạn mức lưu trữ (MB)</label>
          <input class="input num" id="m-quota" type="number" min="50" step="50" required value="${quotaMb}">
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" type="button" id="m-cancel">Hủy</button>
        <button class="btn btn-primary" type="submit">${existing ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>
      </div>
    </form>
  `;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector('#m-close')?.addEventListener('click', close);
  wrap.querySelector('#m-cancel')?.addEventListener('click', close);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });

  const passInput = wrap.querySelector('#m-pass') as HTMLInputElement;
  wrap.querySelector('#m-gen-pass')?.addEventListener('click', () => {
    passInput.value = generateStrongPassword();
  });
  wrap.querySelector('#m-copy-cred')?.addEventListener('click', async () => {
    const email = (wrap.querySelector('#m-email') as HTMLInputElement).value.trim();
    const pass = passInput.value;
    if (!email || !pass) {
      toast('Nhập email và mật khẩu trước khi copy');
      return;
    }
    await navigator.clipboard.writeText(`FX Studio (${location.origin})\nEmail: ${email}\nMật khẩu: ${pass}`).catch(() => {});
    toast('Đã sao chép thông tin đăng nhập');
  });

  const form = wrap.querySelector('#user-modal-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = wrap.querySelector('#m-err')!;
    errEl.innerHTML = '';
    const name = (wrap.querySelector('#m-name') as HTMLInputElement).value.trim();
    const password = passInput.value;
    const role = (wrap.querySelector('#m-role') as HTMLSelectElement).value as UserRole;
    const quotaMbVal = Number((wrap.querySelector('#m-quota') as HTMLInputElement).value);

    try {
      if (existing) {
        await apiJson(`/api/admin/users/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            role,
            quotaMb: quotaMbVal,
            ...(password ? { password } : {}),
          }),
        });
        toast('Đã cập nhật tài khoản');
      } else {
        const email = (wrap.querySelector('#m-email') as HTMLInputElement).value.trim();
        await apiJson('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({ email, name, password, role, quotaMb: quotaMbVal }),
        });
        toast('Đã tạo tài khoản mới');
      }
      close();
      await renderUsers();
    } catch (err) {
      errEl.innerHTML = `<div class="err-banner">${esc(err instanceof Error ? err.message : 'Có lỗi xảy ra')}</div>`;
    }
  });
}

async function openUserDetailModal(user: AdminUserItem) {
  const detail = await apiJson<{
    projects: Array<{ id: string; name: string; status: string; visibility: string; totalBytes: number; updatedAt: number }>;
    sessions: Array<{ id: string; userAgent: string | null; ip: string | null; createdAt: number }>;
  }>(`/api/admin/users/${encodeURIComponent(user.id)}/detail`);

  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal-card" style="max-width:600px;max-height:85vh;overflow-y:auto">
      <div class="modal-head">
        <h3>${esc(user.name)} · ${esc(user.email)}</h3>
        <button class="btn btn-sm" type="button" id="ud-close">Đóng</button>
      </div>
      <div style="margin-bottom:16px">
        <div class="panel-head" style="margin-bottom:8px">
          <h2>Phiên đăng nhập đang hoạt động (${detail.sessions.length})</h2>
          ${
            detail.sessions.length > 0 && user.id !== currentUser?.id
              ? '<button class="btn btn-sm btn-danger" type="button" id="ud-revoke">Ép đăng xuất tất cả</button>'
              : ''
          }
        </div>
        ${
          detail.sessions.length === 0
            ? '<div class="muted">Không có phiên nào đang hoạt động.</div>'
            : detail.sessions
                .map(
                  (s) => `
              <div class="storage-row">
                <div style="font-size:12.5px">${esc((s.userAgent || 'Trình duyệt').slice(0, 72))}</div>
                <div class="muted">IP: ${esc(s.ip || '—')} · ${formatDateTime(s.createdAt)}</div>
              </div>`,
                )
                .join('')
        }
      </div>
      <div>
        <h2 style="font-size:14px;margin:0 0 8px">Dự án sở hữu (${detail.projects.length})</h2>
        ${
          detail.projects.length === 0
            ? '<div class="muted">Chưa có dự án nào.</div>'
            : detail.projects
                .map(
                  (p) => `
              <div class="storage-row">
                <div class="storage-row-top">
                  <strong>${esc(p.name)}</strong>
                  <span class="num muted">${formatBytes(p.totalBytes)} · ${formatDateTime(p.updatedAt)}</span>
                </div>
              </div>`,
                )
                .join('')
        }
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#ud-close')?.addEventListener('click', close);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector('#ud-revoke')?.addEventListener('click', async () => {
    await apiJson(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, { method: 'POST' });
    toast('Đã đăng xuất toàn bộ phiên của người dùng');
    close();
  });
}

async function renderUsers() {
  renderShell('<div class="muted">Đang tải danh sách người dùng…</div>');
  const { users } = await apiJson<{ users: AdminUserItem[] }>('/api/admin/users');

  const q = userSearch.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (userRoleFilter && u.role !== userRoleFilter) return false;
    if (userStatusFilter && u.status !== userStatusFilter) return false;
    if (q && !`${u.name} ${u.email}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const rowsHtml = filtered
    .map((u) => {
      const ratio = u.quotaBytes > 0 ? Math.min(1, u.usedBytes / u.quotaBytes) : 0;
      const isSelf = u.id === currentUser?.id;
      return `
        <tr>
          <td>
            <div><strong>${esc(u.name)}</strong> ${isSelf ? '<span class="muted">(bạn)</span>' : ''}</div>
            <div class="muted">${esc(u.email)}</div>
          </td>
          <td><span class="pill ${u.role === 'admin' ? 'pill-admin' : 'pill-member'}">${u.role}</span></td>
          <td><span class="pill ${u.status === 'active' ? 'pill-active' : 'pill-disabled'}">${u.status === 'active' ? 'Hoạt động' : 'Đã khóa'}</span></td>
          <td class="num">${u.projectCount}</td>
          <td style="min-width:170px">
            <div class="num" style="font-size:12px">${formatBytes(u.usedBytes)} / ${formatBytes(u.quotaBytes)}</div>
            <div class="bar-track"><div class="${quotaBarClass(ratio)}" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
          </td>
          <td class="num muted">${formatDateTime(u.lastLoginAt)}</td>
          <td>
            <div class="actions-row">
              <button class="btn btn-sm" data-detail="${esc(u.id)}" type="button">Chi tiết</button>
              <button class="btn btn-sm" data-edit="${esc(u.id)}" type="button">Sửa</button>
              ${
                !isSelf
                  ? `<button class="btn btn-sm" data-toggle-status="${esc(u.id)}" data-next="${u.status === 'active' ? 'disabled' : 'active'}" type="button">${u.status === 'active' ? 'Khóa' : 'Mở'}</button>
                     <button class="btn btn-sm btn-danger" data-del-user="${esc(u.id)}" data-email="${esc(u.email)}" type="button">Xóa</button>`
                  : ''
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  renderShell(`
    <div class="page-head">
      <div>
        <h1>Quản lý người dùng (${filtered.length}/${users.length})</h1>
        <div class="page-sub">Tạo tài khoản nội bộ, quản lý phiên đăng nhập và hạn mức R2</div>
      </div>
      <button class="btn btn-primary" id="btn-new-user" type="button">+ Tạo tài khoản</button>
    </div>

    <div class="toolbar">
      <input class="input" id="u-search" type="search" placeholder="Tìm tên hoặc email…" value="${esc(userSearch)}">
      <select class="select" id="u-role" style="max-width:160px">
        <option value="" ${userRoleFilter === '' ? 'selected' : ''}>Mọi vai trò</option>
        <option value="admin" ${userRoleFilter === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="member" ${userRoleFilter === 'member' ? 'selected' : ''}>Member</option>
      </select>
      <select class="select" id="u-status" style="max-width:160px">
        <option value="" ${userStatusFilter === '' ? 'selected' : ''}>Mọi trạng thái</option>
        <option value="active" ${userStatusFilter === 'active' ? 'selected' : ''}>Hoạt động</option>
        <option value="disabled" ${userStatusFilter === 'disabled' ? 'selected' : ''}>Đã khóa</option>
      </select>
    </div>

    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Dự án</th>
              <th>Dung lượng R2</th>
              <th>Đăng nhập cuối</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="7" class="muted">Không có tài khoản phù hợp.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);

  document.getElementById('btn-new-user')?.addEventListener('click', () => openUserModal());
  const uSearchEl = document.getElementById('u-search') as HTMLInputElement;
  uSearchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      userSearch = uSearchEl.value;
      void renderUsers();
    }
  });
  uSearchEl.addEventListener('search', () => {
    userSearch = uSearchEl.value;
    void renderUsers();
  });
  (document.getElementById('u-role') as HTMLSelectElement).addEventListener('change', (e) => {
    userRoleFilter = (e.target as HTMLSelectElement).value;
    void renderUsers();
  });
  (document.getElementById('u-status') as HTMLSelectElement).addEventListener('change', (e) => {
    userStatusFilter = (e.target as HTMLSelectElement).value;
    void renderUsers();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = users.find((u) => u.id === btn.dataset.detail);
      if (target) void openUserDetailModal(target);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = users.find((u) => u.id === btn.dataset.edit);
      if (target) openUserModal(target);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-toggle-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggleStatus!;
      const next = btn.dataset.next as UserStatus;
      try {
        await apiJson(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: next }),
        });
        toast(next === 'disabled' ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản');
        await renderUsers();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Thao tác thất bại');
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-del-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delUser!;
      const email = btn.dataset.email!;
      if (!confirm(`Xóa vĩnh viễn tài khoản ${email} và toàn bộ dự án của họ trên R2?`)) return;
      try {
        await apiJson(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('Đã xóa tài khoản');
        await renderUsers();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Xóa thất bại');
      }
    });
  });
}

async function openTransferOwnerModal(project: AdminProjectItem) {
  const { users } = await apiJson<{ users: AdminUserItem[] }>('/api/admin/users');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <form class="modal-card" id="tr-form">
      <div class="modal-head">
        <h3>Chuyển chủ sở hữu — ${esc(project.name)}</h3>
        <button class="btn btn-sm" type="button" id="tr-close">Đóng</button>
      </div>
      <div class="field">
        <label for="tr-owner">Chủ sở hữu mới</label>
        <select class="select" id="tr-owner">
          ${users
            .map(
              (u) =>
                `<option value="${esc(u.id)}" ${u.id === project.ownerId ? 'selected' : ''}>${esc(u.name)} (${esc(u.email)})</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="modal-foot">
        <button class="btn" type="button" id="tr-cancel">Hủy</button>
        <button class="btn btn-primary" type="submit">Xác nhận chuyển</button>
      </div>
    </form>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#tr-close')?.addEventListener('click', close);
  wrap.querySelector('#tr-cancel')?.addEventListener('click', close);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector('#tr-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ownerId = (wrap.querySelector('#tr-owner') as HTMLSelectElement).value;
    try {
      await apiJson(`/api/admin/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ownerId }),
      });
      toast('Đã chuyển chủ sở hữu dự án');
      close();
      await renderProjects();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Chuyển thất bại');
    }
  });
}

async function renderProjects() {
  renderShell('<div class="muted">Đang tải danh sách dự án…</div>');
  const params = new URLSearchParams();
  if (projectSearch.trim()) params.set('q', projectSearch.trim());
  if (projectStatusFilter) params.set('status', projectStatusFilter);
  if (projectVisFilter) params.set('visibility', projectVisFilter);
  if (projectSharedOnly) params.set('shared', '1');
  const { projects } = await apiJson<{ projects: AdminProjectItem[] }>(`/api/admin/projects?${params.toString()}`);

  const rowsHtml = projects
    .map(
      (p) => `
      <tr>
        <td>
          <div class="proj-cell">
            ${
              p.thumbnailUrl
                ? `<img class="thumb" src="${esc(p.thumbnailUrl)}" alt="">`
                : '<div class="thumb-empty">FX</div>'
            }
            <div>
              <strong>${esc(p.name)}</strong>
              <div class="muted">v${p.version} · ${p.assetCount} asset · ${formatBytes(p.totalBytes)}</div>
            </div>
          </div>
        </td>
        <td>
          <div>${esc(p.ownerName)}</div>
          <div class="muted">${esc(p.ownerEmail)}</div>
        </td>
        <td>
          <select class="select-inline" data-set-status="${esc(p.id)}">
            <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Nháp</option>
            <option value="review" ${p.status === 'review' ? 'selected' : ''}>Chờ duyệt</option>
            <option value="approved" ${p.status === 'approved' ? 'selected' : ''}>Đã duyệt in</option>
          </select>
        </td>
        <td>
          ${
            p.visibility === 'team'
              ? '<span class="pill pill-active">Toàn bộ user</span>'
              : '<span class="pill pill-member">Đã ẩn</span>'
          }
          ${p.shareEnabled && p.shareToken ? ' <span class="pill pill-shared">Link công khai</span>' : ''}
        </td>
        <td class="num muted">${formatDateTime(p.updatedAt)}</td>
        <td>
          <div class="actions-row">
            <a class="btn btn-sm" href="/?project=${encodeURIComponent(p.id)}" target="_blank">Mở Studio</a>
            <button class="btn btn-sm" data-toggle-vis="${esc(p.id)}" data-next-vis="${p.visibility === 'team' ? 'private' : 'team'}" type="button">${p.visibility === 'team' ? 'Ẩn' : 'Hiện'}</button>
            <button class="btn btn-sm" data-transfer="${esc(p.id)}" type="button">Đổi chủ</button>
            ${
              p.shareEnabled && p.shareToken
                ? `<button class="btn btn-sm" data-copy-share="${esc(p.shareToken)}" type="button">Copy link</button>
                   <button class="btn btn-sm" data-off-share="${esc(p.id)}" type="button">Tắt link</button>`
                : ''
            }
            <button class="btn btn-sm btn-danger" data-del-proj="${esc(p.id)}" data-name="${esc(p.name)}" type="button">Xóa</button>
          </div>
        </td>
      </tr>
    `,
    )
    .join('');

  renderShell(`
    <div class="page-head">
      <div>
        <h1>Quản lý dự án (${projects.length})</h1>
        <div class="page-sub">Duyệt trạng thái in, kiểm soát hiển thị và quản lý tài nguyên R2</div>
      </div>
    </div>

    <div class="toolbar">
      <input class="input" id="proj-search" type="search" placeholder="Tìm tên dự án, email, #tag…" value="${esc(projectSearch)}">
      <select class="select" id="proj-status" style="max-width:155px">
        <option value="" ${projectStatusFilter === '' ? 'selected' : ''}>Mọi trạng thái</option>
        <option value="draft" ${projectStatusFilter === 'draft' ? 'selected' : ''}>Nháp</option>
        <option value="review" ${projectStatusFilter === 'review' ? 'selected' : ''}>Chờ duyệt</option>
        <option value="approved" ${projectStatusFilter === 'approved' ? 'selected' : ''}>Đã duyệt in</option>
      </select>
      <select class="select" id="proj-vis" style="max-width:165px">
        <option value="" ${projectVisFilter === '' ? 'selected' : ''}>Mọi hiển thị</option>
        <option value="team" ${projectVisFilter === 'team' ? 'selected' : ''}>Toàn bộ user</option>
        <option value="private" ${projectVisFilter === 'private' ? 'selected' : ''}>Đã ẩn</option>
      </select>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)">
        <input type="checkbox" id="proj-shared-only" ${projectSharedOnly ? 'checked' : ''}>
        Có link công khai
      </label>
      <button class="btn btn-sm" id="btn-proj-filter" type="button">Lọc</button>
    </div>

    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dự án</th>
              <th>Chủ sở hữu</th>
              <th>Trạng thái</th>
              <th>Hiển thị</th>
              <th>Cập nhật</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="6" class="muted">Không tìm thấy dự án nào.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);

  const searchInput = document.getElementById('proj-search') as HTMLInputElement;
  const statusSel = document.getElementById('proj-status') as HTMLSelectElement;
  const visSel = document.getElementById('proj-vis') as HTMLSelectElement;
  const sharedCheck = document.getElementById('proj-shared-only') as HTMLInputElement;
  const applyFilter = () => {
    projectSearch = searchInput.value;
    projectStatusFilter = statusSel.value;
    projectVisFilter = visSel.value;
    projectSharedOnly = sharedCheck.checked;
    void renderProjects();
  };
  document.getElementById('btn-proj-filter')?.addEventListener('click', applyFilter);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilter();
  });
  statusSel.addEventListener('change', applyFilter);
  visSel.addEventListener('change', applyFilter);
  sharedCheck.addEventListener('change', applyFilter);

  root.querySelectorAll<HTMLSelectElement>('[data-set-status]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.setStatus!;
      try {
        await apiJson(`/api/admin/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        });
        toast('Đã cập nhật trạng thái duyệt');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Cập nhật thất bại');
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-toggle-vis]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiJson(`/api/admin/projects/${encodeURIComponent(btn.dataset.toggleVis!)}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: btn.dataset.nextVis }),
      });
      toast('Đã đổi quyền hiển thị');
      await renderProjects();
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-transfer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const proj = projects.find((x) => x.id === btn.dataset.transfer);
      if (proj) void openTransferOwnerModal(proj);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-copy-share]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = `${location.origin}/share/${btn.dataset.copyShare}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast('Đã sao chép liên kết chia sẻ');
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-off-share]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiJson(`/api/admin/projects/${encodeURIComponent(btn.dataset.offShare!)}`, {
        method: 'PATCH',
        body: JSON.stringify({ shareEnabled: false }),
      });
      toast('Đã tắt liên kết chia sẻ công khai');
      await renderProjects();
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-del-proj]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delProj!;
      const name = btn.dataset.name!;
      if (!confirm(`Xóa vĩnh viễn dự án "${name}"?`)) return;
      try {
        await apiJson(`/api/admin/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('Đã xóa dự án');
        await renderProjects();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Xóa thất bại');
      }
    });
  });
}

async function renderAudit() {
  renderShell('<div class="muted">Đang tải nhật ký hoạt động…</div>');
  const params = new URLSearchParams();
  if (auditFilter) params.set('action', auditFilter);
  const { logs } = await apiJson<{ logs: AuditLogItem[] }>(`/api/admin/audit?${params.toString()}`);

  const rowsHtml = logs
    .map(
      (l) => `
      <tr>
        <td class="num muted">${formatDateTime(l.createdAt)}</td>
        <td>${esc(l.actorEmail || 'Hệ thống')}</td>
        <td><span class="pill pill-member">${esc(actionLabel(l.action))}</span></td>
        <td class="muted">${esc(l.targetType ? `${l.targetType}: ${l.targetId ?? ''}` : '—')}</td>
        <td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.detailJson ?? '—')}</td>
        <td class="num muted">${esc(l.ip ?? '—')}</td>
      </tr>
    `,
    )
    .join('');

  renderShell(`
    <div class="page-head">
      <div>
        <h1>Nhật ký hoạt động</h1>
        <div class="page-sub">Theo dõi đăng nhập, lưu/xóa dự án và thay đổi quản trị</div>
      </div>
      <button class="btn" id="btn-export-csv" type="button">Xuất CSV</button>
    </div>

    <div class="toolbar">
      <select class="select" id="audit-filter" style="max-width:220px">
        <option value="" ${auditFilter === '' ? 'selected' : ''}>Tất cả sự kiện</option>
        <option value="auth." ${auditFilter === 'auth.' ? 'selected' : ''}>Xác thực (Auth)</option>
        <option value="project." ${auditFilter === 'project.' ? 'selected' : ''}>Dự án (Project)</option>
        <option value="admin." ${auditFilter === 'admin.' ? 'selected' : ''}>Quản trị (Admin)</option>
      </select>
    </div>

    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Người thực hiện</th>
              <th>Hành động</th>
              <th>Đối tượng</th>
              <th>Chi tiết</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="6" class="muted">Chưa có nhật ký.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);

  document.getElementById('audit-filter')?.addEventListener('change', (e) => {
    auditFilter = (e.target as HTMLSelectElement).value;
    void renderAudit();
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    const csvCell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const header = ['ThoiGian', 'NguoiThucHien', 'HanhDong', 'DoiTuong', 'ChiTiet', 'IP'].join(',');
    const lines = logs.map((l) =>
      [
        new Date(l.createdAt).toISOString(),
        l.actorEmail || 'system',
        l.action,
        l.targetType ? `${l.targetType}:${l.targetId ?? ''}` : '',
        l.detailJson ?? '',
        l.ip ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([`\uFEFF${header}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fx-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

async function renderSettings() {
  renderShell('<div class="muted">Đang tải cài đặt hệ thống…</div>');
  const { settings } = await apiJson<{ settings: AdminSettings }>('/api/admin/settings');

  renderShell(`
    <div class="page-head">
      <div>
        <h1>Cài đặt hệ thống & Bảo trì</h1>
        <div class="page-sub">Cấu hình mặc định toàn cục (lưu trên D1) và công cụ dọn rác R2/Session</div>
      </div>
    </div>

    <div class="dash-grid">
      <form class="panel" id="sys-settings-form">
        <div class="panel-head"><h2>Cấu hình toàn cục</h2></div>
        <div class="field">
          <label for="st-quota">Hạn mức lưu trữ mặc định cho user mới (MB)</label>
          <input class="input num" id="st-quota" type="number" min="50" step="50" required value="${settings.defaultQuotaMb}">
        </div>
        <div class="field">
          <label for="st-vis">Quyền hiển thị mặc định khi lưu dự án</label>
          <select class="select" id="st-vis">
            <option value="team" ${settings.defaultVisibility === 'team' ? 'selected' : ''}>Tự động chia sẻ cho toàn bộ user (Team)</option>
            <option value="private" ${settings.defaultVisibility === 'private' ? 'selected' : ''}>Ẩn (Chỉ chủ sở hữu & Admin)</option>
          </select>
        </div>
        <div class="field">
          <label for="st-maxver">Số phiên bản lịch sử tối đa giữ lại mỗi dự án</label>
          <input class="input num" id="st-maxver" type="number" min="1" max="100" required value="${settings.maxVersionsPerProject}">
        </div>
        <div class="field">
          <label style="display:inline-flex;align-items:center;gap:8px;color:var(--text);cursor:pointer">
            <input type="checkbox" id="st-share" ${settings.allowPublicShare ? 'checked' : ''}>
            <span>Cho phép người dùng tạo link chia sẻ công khai (/share/...)</span>
          </label>
        </div>
        <button class="btn btn-primary" type="submit">Lưu cài đặt</button>
      </form>

      <section class="panel" style="display:flex;flex-direction:column;gap:14px">
        <div class="panel-head" style="margin-bottom:0"><h2>Bảo trì D1 & R2</h2></div>
        <div class="storage-row">
          <div style="margin-bottom:8px">
            <strong>Dọn phiên đăng nhập hết hạn (D1)</strong>
            <div class="muted">Xóa các bản ghi trong bảng sessions đã quá hạn 14 ngày.</div>
          </div>
          <button class="btn btn-sm" id="btn-clean-sessions" type="button">Dọn phiên hết hạn</button>
        </div>
        <div class="storage-row">
          <div style="margin-bottom:8px">
            <strong>Kiểm tra & dọn rác lưu trữ R2</strong>
            <div class="muted">Quét toàn bộ object trên bucket R2 không còn tham chiếu trong D1.</div>
          </div>
          <div class="actions-row">
            <button class="btn btn-sm" id="btn-r2-scan" type="button">Quét thử (Dry-run)</button>
            <button class="btn btn-sm btn-danger" id="btn-r2-clean" type="button">Xóa rác R2</button>
          </div>
          <div class="muted" id="r2-result" style="margin-top:8px"></div>
        </div>
      </section>
    </div>
  `);

  document.getElementById('sys-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const defaultQuotaMb = Number((document.getElementById('st-quota') as HTMLInputElement).value);
    const defaultVisibility = (document.getElementById('st-vis') as HTMLSelectElement).value as ProjectVisibility;
    const maxVersionsPerProject = Number((document.getElementById('st-maxver') as HTMLInputElement).value);
    const allowPublicShare = (document.getElementById('st-share') as HTMLInputElement).checked;
    try {
      await apiJson('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultQuotaMb, defaultVisibility, maxVersionsPerProject, allowPublicShare }),
      });
      toast('Đã lưu cài đặt hệ thống');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu cài đặt thất bại');
    }
  });

  document.getElementById('btn-clean-sessions')?.addEventListener('click', async () => {
    const res = await apiJson<{ deleted: number }>('/api/admin/maintenance/sessions', { method: 'POST' });
    toast(`Đã xóa ${res.deleted} phiên đăng nhập hết hạn`);
  });

  const runR2 = async (dryRun: boolean) => {
    const out = document.getElementById('r2-result')!;
    out.textContent = dryRun ? 'Đang quét R2…' : 'Đang dọn rác R2…';
    const res = await apiJson<{ scanned: number; orphans: number; deleted: number; reclaimedBytes: number }>(
      '/api/admin/maintenance/r2-gc',
      { method: 'POST', body: JSON.stringify({ dryRun }) },
    );
    out.textContent = dryRun
      ? `Đã quét ${res.scanned} object · Phát hiện ${res.orphans} tệp rác (${formatBytes(res.reclaimedBytes)})`
      : `Đã quét ${res.scanned} object · Đã xóa ${res.deleted} tệp rác · Thu hồi ${formatBytes(res.reclaimedBytes)}`;
  };

  document.getElementById('btn-r2-scan')?.addEventListener('click', () => void runR2(true));
  document.getElementById('btn-r2-clean')?.addEventListener('click', () => {
    if (confirm('Xóa vĩnh viễn các tệp rác trên R2 không còn được tham chiếu trong D1?')) {
      void runR2(false);
    }
  });
}

async function renderApp() {
  if (currentUser?.role !== 'admin') {
    renderGate();
    return;
  }
  try {
    if (activeTab === 'overview') await renderOverview();
    else if (activeTab === 'users') await renderUsers();
    else if (activeTab === 'projects') await renderProjects();
    else if (activeTab === 'audit') await renderAudit();
    else await renderSettings();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      currentUser = null;
      renderGate('Phiên đăng nhập đã hết hạn');
      return;
    }
    toast(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
  }
}

async function boot() {
  try {
    const me = await cloudApi.me();
    currentUser = me.user;
    setupRequired = me.setupRequired;
    await renderApp();
  } catch {
    renderGate('Không kết nối được backend Worker (/api/auth/me)');
  }
}

void boot();
