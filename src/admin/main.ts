import './admin.css';
import {
  ApiError,
  apiJson,
  cloudApi,
  formatBytes,
  formatDateTime,
  type CloudUser,
  type UserRole,
  type UserStatus,
} from '../cloud/api';

type TabKey = 'overview' | 'users' | 'projects' | 'audit';

interface OverviewResponse {
  stats: {
    totalUsers: number;
    activeUsers: number;
    disabledUsers: number;
    adminUsers: number;
    totalQuotaBytes: number;
    totalProjects: number;
    sharedProjects: number;
    totalAssetRefs: number;
    uniqueR2Objects: number;
    totalR2Bytes: number;
    activity7d: number;
  };
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

const root = document.getElementById('admin-root')!;

let currentUser: CloudUser | null = null;
let setupRequired = false;
let activeTab: TabKey = 'overview';
let projectSearch = '';
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
  const existing = document.querySelector('.toast');
  existing?.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = msg;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function quotaBarClass(ratio: number): string {
  if (ratio >= 0.9) return 'bar-fill is-danger';
  if (ratio >= 0.72) return 'bar-fill is-warn';
  return 'bar-fill';
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    'system.bootstrap': 'Khởi tạo hệ thống',
    'auth.login': 'Đăng nhập',
    'auth.logout': 'Đăng xuất',
    'auth.password_change': 'Đổi mật khẩu',
    'project.create': 'Tạo project',
    'project.update': 'Cập nhật project',
    'project.delete': 'Xóa project',
    'project.share': 'Đổi chia sẻ',
    'admin.user.create': 'Admin tạo user',
    'admin.user.update': 'Admin sửa user',
    'admin.user.delete': 'Admin xóa user',
    'admin.project.delete': 'Admin xóa project',
  };
  return map[action] ?? action;
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
        </nav>
        <div class="sb-foot">
          <div class="sb-user">
            <div class="sb-user-name">${esc(currentUser?.name)}</div>
            <div class="sb-user-email">${esc(currentUser?.email)}</div>
          </div>
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
              .slice(0, 10)
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
        <div class="page-sub">Lưu trữ Cloudflare D1 + R2 · Phân quyền nội bộ</div>
      </div>
      <button class="btn" id="btn-refresh" type="button">Làm mới</button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Tài khoản nội bộ</div>
        <div class="kpi-value num">${s.totalUsers}</div>
        <div class="kpi-meta">${s.activeUsers} hoạt động · ${s.disabledUsers} bị khóa · ${s.adminUsers} admin</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tổng số dự án</div>
        <div class="kpi-value num">${s.totalProjects}</div>
        <div class="kpi-meta">${s.sharedProjects} đang bật link chia sẻ · ${s.totalAssetRefs} lượt asset</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Dung lượng R2 thực tế</div>
        <div class="kpi-value num">${formatBytes(s.totalR2Bytes)}</div>
        <div class="kpi-meta">${s.uniqueR2Objects} tệp duy nhất (đã chống trùng lặp)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Hoạt động (7 ngày)</div>
        <div class="kpi-value num">${s.activity7d}</div>
        <div class="kpi-meta">Tổng hạn mức cấp: ${formatBytes(s.totalQuotaBytes)}</div>
      </div>
    </div>

    <div class="dash-grid">
      <section class="panel">
        <div class="panel-head">
          <h2>Dung lượng theo tài khoản</h2>
        </div>
        ${topHtml}
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>Hoạt động gần đây</h2>
          <button class="btn btn-sm" id="btn-see-audit" type="button">Xem tất cả</button>
        </div>
        <div class="table-wrap">${logsHtml}</div>
      </section>
    </div>
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
  const quotaMb = existing ? Math.max(10, Math.round(existing.quotaBytes / (1024 * 1024))) : 500;
  wrap.innerHTML = `
    <form class="modal-card" id="user-modal-form">
      <div class="modal-head">
        <h3>${existing ? 'Chỉnh sửa tài khoản' : 'Tạo tài khoản nội bộ'}</h3>
        <button class="btn btn-sm" type="button" id="m-close">Đóng</button>
      </div>
      <div id="m-err"></div>
      ${
        existing
          ? `<div class="field"><label>Email</label><input class="input" value="${esc(existing.email)}" disabled></div>`
          : `<div class="field"><label for="m-email">Email</label><input class="input" id="m-email" type="email" required placeholder="designer@studio.local"></div>`
      }
      <div class="field">
        <label for="m-name">Tên hiển thị</label>
        <input class="input" id="m-name" required value="${esc(existing?.name ?? '')}" placeholder="Nguyễn Văn A">
      </div>
      <div class="field">
        <label for="m-pass">${existing ? 'Đặt lại mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu (tối thiểu 8 ký tự)'}</label>
        <input class="input" id="m-pass" type="password" ${existing ? '' : 'required minlength="8"'} placeholder="••••••••">
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

  const form = wrap.querySelector('#user-modal-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = wrap.querySelector('#m-err')!;
    errEl.innerHTML = '';
    const name = (wrap.querySelector('#m-name') as HTMLInputElement).value.trim();
    const password = (wrap.querySelector('#m-pass') as HTMLInputElement).value;
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

async function renderUsers() {
  renderShell('<div class="muted">Đang tải danh sách người dùng…</div>');
  const { users } = await apiJson<{ users: AdminUserItem[] }>('/api/admin/users');

  const rowsHtml = users
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
              <button class="btn btn-sm" data-edit="${esc(u.id)}" type="button">Sửa</button>
              ${
                !isSelf
                  ? `<button class="btn btn-sm" data-toggle-status="${esc(u.id)}" data-next="${u.status === 'active' ? 'disabled' : 'active'}" type="button">${u.status === 'active' ? 'Khóa' : 'Mở khóa'}</button>
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
        <h1>Quản lý người dùng</h1>
        <div class="page-sub">Tạo tài khoản nội bộ, phân quyền và quản lý hạn mức R2</div>
      </div>
      <button class="btn btn-primary" id="btn-new-user" type="button">+ Tạo tài khoản</button>
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
          <tbody>${rowsHtml || '<tr><td colspan="7" class="muted">Chưa có tài khoản.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);

  document.getElementById('btn-new-user')?.addEventListener('click', () => openUserModal());

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

async function renderProjects() {
  renderShell('<div class="muted">Đang tải danh sách dự án…</div>');
  const params = new URLSearchParams();
  if (projectSearch.trim()) params.set('q', projectSearch.trim());
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
              <div class="muted">v${p.version} · ${p.id}</div>
            </div>
          </div>
        </td>
        <td>
          <div>${esc(p.ownerName)}</div>
          <div class="muted">${esc(p.ownerEmail)}</div>
        </td>
        <td class="num">${p.assetCount}</td>
        <td class="num">${formatBytes(p.totalBytes)}</td>
        <td>
          ${
            p.shareEnabled && p.shareToken
              ? `<span class="pill pill-shared">Đang chia sẻ</span>`
              : '<span class="muted">Riêng tư</span>'
          }
        </td>
        <td class="num muted">${formatDateTime(p.updatedAt)}</td>
        <td>
          <div class="actions-row">
            ${
              p.shareEnabled && p.shareToken
                ? `<button class="btn btn-sm" data-copy-share="${esc(p.shareToken)}" type="button">Copy link</button>`
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
        <h1>Quản lý dự án</h1>
        <div class="page-sub">Toàn bộ project được lưu trên D1 và tài nguyên ảnh trên R2</div>
      </div>
    </div>

    <div class="toolbar">
      <input class="input" id="proj-search" type="search" placeholder="Tìm tên dự án hoặc email…" value="${esc(projectSearch)}">
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)">
        <input type="checkbox" id="proj-shared-only" ${projectSharedOnly ? 'checked' : ''}>
        Chỉ dự án đang chia sẻ
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
              <th>Assets</th>
              <th>Dung lượng</th>
              <th>Chia sẻ</th>
              <th>Cập nhật</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="7" class="muted">Không tìm thấy dự án nào.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);

  const searchInput = document.getElementById('proj-search') as HTMLInputElement;
  const sharedCheck = document.getElementById('proj-shared-only') as HTMLInputElement;
  const applyFilter = () => {
    projectSearch = searchInput.value;
    projectSharedOnly = sharedCheck.checked;
    void renderProjects();
  };
  document.getElementById('btn-proj-filter')?.addEventListener('click', applyFilter);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilter();
  });
  sharedCheck.addEventListener('change', applyFilter);

  root.querySelectorAll<HTMLButtonElement>('[data-copy-share]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = `${location.origin}/share/${btn.dataset.copyShare}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast('Đã sao chép liên kết chia sẻ');
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
}

async function renderApp() {
  if (!currentUser || currentUser.role !== 'admin') {
    renderGate();
    return;
  }
  try {
    if (activeTab === 'overview') await renderOverview();
    else if (activeTab === 'users') await renderUsers();
    else if (activeTab === 'projects') await renderProjects();
    else await renderAudit();
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
