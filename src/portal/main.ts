import './portal.css';
import {
  ApiError,
  cloudApi,
  formatBytes,
  formatDateTime,
  type CloudProjectSummary,
  type CloudUser,
  type ProjectStatus,
  type ProjectVisibility,
} from '../cloud/api';

type NavSection = 'all' | 'mine' | 'shared_team' | 'public_links' | 'private' | 'account';
type ViewMode = 'grid' | 'list';

const root = document.getElementById('portal-root')!;

let currentUser: CloudUser | null = null;
let setupRequired = false;
let allowPublicShare = true;
let usedBytes = 0;
let quotaBytes = 500 * 1024 * 1024;
let allProjects: CloudProjectSummary[] = [];

let activeSection: NavSection = 'all';
let viewMode: ViewMode = (localStorage.getItem('fx_portal_view') as ViewMode) === 'list' ? 'list' : 'grid';
let searchQ = '';
let statusFilter: '' | ProjectStatus = '';
let sortBy: 'updated' | 'name' | 'size' = 'updated';

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
  setTimeout(() => node.remove(), 2600);
}

function statusLabel(s: ProjectStatus): string {
  if (s === 'approved') return 'Đã duyệt in';
  if (s === 'review') return 'Chờ duyệt';
  return 'Nháp';
}

function parseShareToken(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    const qShare = url.searchParams.get('share');
    if (qShare) return qShare;
    const m = url.pathname.match(/\/share\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  } catch {
    const m = v.match(/\/share\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  }
  return /^[a-zA-Z0-9_-]{8,}$/.test(v) ? v : null;
}

function renderLoginGate(errorMsg = '') {
  root.innerHTML = `
    <div class="gate-wrap">
      <form class="gate-card" id="p-login-form">
        <div class="gate-brand">
          <img src="logo.png" alt="FX Studio">
          <strong>FX Studio Portal</strong>
        </div>
        <h1 class="gate-title">${setupRequired ? 'Khởi tạo hệ thống' : 'Đăng nhập User Portal'}</h1>
        <p class="gate-sub">
          ${
            setupRequired
              ? 'Hệ thống chưa có tài khoản quản trị. Mở /admin để khởi tạo Admin đầu tiên.'
              : 'Truy cập kho dự án đã lưu và các dự án được chia sẻ trong team.'
          }
        </p>
        ${errorMsg ? `<div class="err-banner">${esc(errorMsg)}</div>` : ''}
        ${
          setupRequired
            ? `<a class="btn btn-primary" style="width:100%" href="/admin">Mở trang Khởi tạo Admin (/admin)</a>`
            : `
              <div class="field">
                <label for="pl-email">Email</label>
                <input class="input" id="pl-email" type="email" required placeholder="user@studio.local" autocomplete="username">
              </div>
              <div class="field">
                <label for="pl-pass">Mật khẩu</label>
                <input class="input" id="pl-pass" type="password" required autocomplete="current-password">
              </div>
              <button class="btn btn-primary" style="width:100%" type="submit">Đăng nhập</button>
            `
        }
      </form>
    </div>
  `;

  document.getElementById('p-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (setupRequired) return;
    const email = (document.getElementById('pl-email') as HTMLInputElement).value.trim();
    const pass = (document.getElementById('pl-pass') as HTMLInputElement).value;
    try {
      const res = await cloudApi.login(email, pass);
      currentUser = res.user;
      usedBytes = res.usedBytes;
      quotaBytes = res.user.quotaBytes;
      await loadAndRender();
    } catch (err) {
      renderLoginGate(err instanceof Error ? err.message : 'Đăng nhập thất bại');
    }
  });
}

function openModal(title: string, bodyHtml: string, onMount: (wrap: HTMLElement, close: () => void) => void) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="btn btn-sm" type="button" id="m-close">Đóng</button>
      </div>
      <div>${bodyHtml}</div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#m-close')?.addEventListener('click', close);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  onMount(wrap, close);
}

function openEditMetaModal(proj: CloudProjectSummary) {
  openModal(
    `Chỉnh sửa thông tin — ${proj.name}`,
    `<form id="pm-form">
      <div class="field">
        <label for="pm-name">Tên dự án</label>
        <input class="input" id="pm-name" required value="${esc(proj.name)}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field">
          <label for="pm-status">Trạng thái sản xuất</label>
          <select class="select" id="pm-status">
            <option value="draft" ${proj.status === 'draft' ? 'selected' : ''}>Nháp (Draft)</option>
            <option value="review" ${proj.status === 'review' ? 'selected' : ''}>Chờ duyệt (Review)</option>
            <option value="approved" ${proj.status === 'approved' ? 'selected' : ''}>Đã duyệt in (Approved)</option>
          </select>
        </div>
        <div class="field">
          <label for="pm-vis">Hiển thị nội bộ</label>
          <select class="select" id="pm-vis">
            <option value="team" ${proj.visibility === 'team' ? 'selected' : ''}>Chia sẻ toàn bộ user</option>
            <option value="private" ${proj.visibility === 'private' ? 'selected' : ''}>Ẩn (Chỉ mình tôi)</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="pm-tags">Tags (ngăn cách bằng dấu phẩy)</label>
        <input class="input" id="pm-tags" value="${esc(proj.tags.join(', '))}" placeholder="Pokemon, Gold Foil, Series 1">
      </div>
      <div class="field">
        <label for="pm-notes">Ghi chú</label>
        <textarea class="textarea" id="pm-notes" rows="3" placeholder="Ghi chú kỹ thuật in hoặc phản hồi duyệt…">${esc(proj.notes)}</textarea>
      </div>
      <div class="modal-foot">
        <button class="btn" type="button" id="pm-cancel">Hủy</button>
        <button class="btn btn-primary" type="submit">Lưu thay đổi</button>
      </div>
    </form>`,
    (wrap, close) => {
      wrap.querySelector('#pm-cancel')?.addEventListener('click', close);
      wrap.querySelector('#pm-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = (wrap.querySelector('#pm-name') as HTMLInputElement).value.trim();
        const status = (wrap.querySelector('#pm-status') as HTMLSelectElement).value as ProjectStatus;
        const visibility = (wrap.querySelector('#pm-vis') as HTMLSelectElement).value as ProjectVisibility;
        const tags = (wrap.querySelector('#pm-tags') as HTMLInputElement).value
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        const notes = (wrap.querySelector('#pm-notes') as HTMLTextAreaElement).value.trim();
        try {
          await cloudApi.updateProjectMeta(proj.id, { name, status, visibility, tags, notes });
          toast('Đã lưu thông tin dự án');
          close();
          await loadAndRender();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Cập nhật thất bại');
        }
      });
    },
  );
}

function openShareModal(proj: CloudProjectSummary) {
  const shareUrl = proj.shareEnabled && proj.shareToken ? `${location.origin}/share/${proj.shareToken}` : '';
  openModal(
    `Chia sẻ dự án — ${proj.name}`,
    `<div style="display:flex;flex-direction:column;gap:14px">
      <div class="sb-box">
        <div class="sb-box-title">1. Chia sẻ nội bộ (Toàn bộ user trong hệ thống)</div>
        <div class="muted" style="margin-bottom:8px">
          ${
            proj.visibility === 'team'
              ? 'Đang bật: Mọi thành viên đăng nhập đều thấy và mở được dự án này.'
              : 'Đang ẩn: Chỉ mình bạn và Admin mới thấy dự án này.'
          }
        </div>
        <button class="btn btn-sm ${proj.visibility === 'team' ? '' : 'btn-primary'}" type="button" id="ps-toggle-vis">
          ${proj.visibility === 'team' ? 'Chuyển sang Ẩn (Riêng tư)' : 'Chia sẻ cho Toàn bộ user'}
        </button>
      </div>

      <div class="sb-box">
        <div class="sb-box-title">2. Liên kết công khai chỉ xem (/share/...)</div>
        <div class="muted" style="margin-bottom:8px">
          Người có link có thể xem mô phỏng 3D/2D mà không cần tài khoản.
        </div>
        ${
          !allowPublicShare && !proj.shareEnabled
            ? '<div class="muted">Quản trị viên đã tắt tính năng tạo link công khai.</div>'
            : shareUrl
              ? `<input class="input" id="ps-url" readonly value="${esc(shareUrl)}" style="margin-bottom:8px">
                 <div style="display:flex;gap:8px;flex-wrap:wrap">
                   <button class="btn btn-sm btn-primary" type="button" id="ps-copy">Sao chép link</button>
                   <button class="btn btn-sm" type="button" id="ps-regen">Đổi link mới</button>
                   <button class="btn btn-sm btn-danger" type="button" id="ps-off">Tắt link</button>
                 </div>`
              : `<button class="btn btn-sm btn-primary" type="button" id="ps-on">Tạo liên kết công khai</button>`
        }
      </div>
    </div>`,
    (wrap, close) => {
      wrap.querySelector('#ps-toggle-vis')?.addEventListener('click', async () => {
        const next: ProjectVisibility = proj.visibility === 'team' ? 'private' : 'team';
        await cloudApi.setVisibility(proj.id, next);
        toast(next === 'team' ? 'Đã chia sẻ cho toàn bộ user' : 'Đã ẩn dự án');
        close();
        await loadAndRender();
      });
      wrap.querySelector('#ps-copy')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
        toast('Đã sao chép liên kết chia sẻ');
      });
      wrap.querySelector('#ps-on')?.addEventListener('click', async () => {
        const res = await cloudApi.toggleShare(proj.id, true);
        if (res.shareUrl) await navigator.clipboard.writeText(res.shareUrl).catch(() => {});
        toast('Đã tạo & sao chép liên kết công khai');
        close();
        await loadAndRender();
      });
      wrap.querySelector('#ps-regen')?.addEventListener('click', async () => {
        const res = await cloudApi.toggleShare(proj.id, true, true);
        if (res.shareUrl) await navigator.clipboard.writeText(res.shareUrl).catch(() => {});
        toast('Đã tạo link mới (link cũ đã hủy)');
        close();
        await loadAndRender();
      });
      wrap.querySelector('#ps-off')?.addEventListener('click', async () => {
        await cloudApi.toggleShare(proj.id, false);
        toast('Đã tắt liên kết công khai');
        close();
        await loadAndRender();
      });
    },
  );
}

async function openVersionsModal(proj: CloudProjectSummary) {
  const { versions } = await cloudApi.listVersions(proj.id);
  openModal(
    `Lịch sử phiên bản — ${proj.name}`,
    versions.length === 0
      ? '<div class="muted">Chưa có bản ghi lịch sử nào.</div>'
      : `<div style="display:flex;flex-direction:column;gap:8px">
          ${versions
            .map(
              (v) => `
            <div class="sb-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
              <div>
                <strong>v${v.version}</strong> · ${esc(v.name)}
                <div class="muted">${esc(v.savedByName || '—')} · ${formatDateTime(v.createdAt)}${v.note ? ` · "${esc(v.note)}"` : ''}</div>
              </div>
              <a class="btn btn-sm btn-primary" href="/?project=${encodeURIComponent(proj.id)}">Mở Studio</a>
            </div>
          `,
            )
            .join('')}
        </div>`,
    () => {},
  );
}

async function renderAccountSection() {
  const { sessions } = await cloudApi.listSessions();
  const mainEl = document.getElementById('portal-main')!;
  mainEl.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Tài khoản & Thiết bị</h1>
        <div class="page-sub">Quản lý thông tin cá nhân, mật khẩu và các phiên đăng nhập đang hoạt động</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <form class="sb-box" id="pa-prof-form" style="padding:18px">
        <h3 style="margin:0 0 12px;font-size:15px">Thông tin cá nhân</h3>
        <div class="field">
          <label>Email</label>
          <input class="input" value="${esc(currentUser?.email)}" disabled>
        </div>
        <div class="field">
          <label for="pa-name">Tên hiển thị</label>
          <input class="input" id="pa-name" required value="${esc(currentUser?.name)}">
        </div>
        <div id="pa-prof-msg"></div>
        <button class="btn btn-primary" type="submit">Lưu tên hiển thị</button>
      </form>

      <form class="sb-box" id="pa-pass-form" style="padding:18px">
        <h3 style="margin:0 0 12px;font-size:15px">Đổi mật khẩu</h3>
        <div class="field">
          <label for="pa-cur">Mật khẩu hiện tại</label>
          <input class="input" id="pa-cur" type="password" required autocomplete="current-password">
        </div>
        <div class="field">
          <label for="pa-new">Mật khẩu mới (tối thiểu 8 ký tự)</label>
          <input class="input" id="pa-new" type="password" required minlength="8" autocomplete="new-password">
        </div>
        <div id="pa-pass-msg"></div>
        <button class="btn btn-primary" type="submit">Cập nhật mật khẩu</button>
      </form>
    </div>

    <div class="sb-box" style="padding:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="margin:0;font-size:15px">Phiên đăng nhập đang hoạt động (${sessions.length})</h3>
        ${
          sessions.length > 1
            ? '<button class="btn btn-sm btn-danger" type="button" id="pa-revoke-others">Đăng xuất các thiết bị khác</button>'
            : ''
        }
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${sessions
          .map(
            (s) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;background:var(--surface);border:1px solid var(--border)">
            <div>
              <div>
                ${s.isCurrent ? '<span class="pill pill-team">Thiết bị hiện tại</span> ' : ''}
                <strong>${esc((s.userAgent || 'Trình duyệt').slice(0, 76))}</strong>
              </div>
              <div class="muted">IP: ${esc(s.ip || '—')} · Đăng nhập: ${formatDateTime(s.createdAt)}</div>
            </div>
            ${
              !s.isCurrent
                ? `<button class="btn btn-sm btn-danger" data-revoke="${esc(s.fullId)}" type="button">Thu hồi</button>`
                : ''
            }
          </div>
        `,
          )
          .join('')}
      </div>
    </div>
  `;

  document.getElementById('pa-prof-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('pa-name') as HTMLInputElement).value.trim();
    const msg = document.getElementById('pa-prof-msg')!;
    try {
      await cloudApi.updateProfile(name);
      if (currentUser) currentUser.name = name;
      msg.innerHTML = '<div class="ok-banner">Đã cập nhật tên hiển thị</div>';
      renderPortal();
    } catch (err) {
      msg.innerHTML = `<div class="err-banner">${esc(err instanceof Error ? err.message : 'Lỗi')}</div>`;
    }
  });

  document.getElementById('pa-pass-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = (document.getElementById('pa-cur') as HTMLInputElement).value;
    const next = (document.getElementById('pa-new') as HTMLInputElement).value;
    const msg = document.getElementById('pa-pass-msg')!;
    try {
      await cloudApi.changePassword(cur, next);
      (document.getElementById('pa-cur') as HTMLInputElement).value = '';
      (document.getElementById('pa-new') as HTMLInputElement).value = '';
      msg.innerHTML = '<div class="ok-banner">Đã đổi mật khẩu thành công</div>';
    } catch (err) {
      msg.innerHTML = `<div class="err-banner">${esc(err instanceof Error ? err.message : 'Lỗi')}</div>`;
    }
  });

  document.getElementById('pa-revoke-others')?.addEventListener('click', async () => {
    await cloudApi.revokeOtherSessions();
    toast('Đã đăng xuất các thiết bị khác');
    await renderAccountSection();
  });

  mainEl.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await cloudApi.revokeSession(btn.dataset.revoke!);
      toast('Đã thu hồi phiên đăng nhập');
      await renderAccountSection();
    });
  });
}

function renderPortal() {
  if (!currentUser) {
    renderLoginGate();
    return;
  }

  const counts = {
    all: allProjects.length,
    mine: allProjects.filter((p) => p.isOwner).length,
    shared_team: allProjects.filter((p) => !p.isOwner && p.visibility === 'team').length,
    public_links: allProjects.filter((p) => p.shareEnabled).length,
    private: allProjects.filter((p) => p.visibility === 'private').length,
  };

  const ratio = quotaBytes > 0 ? Math.min(1, usedBytes / quotaBytes) : 0;

  const q = searchQ.trim().toLowerCase();
  const filtered = allProjects
    .filter((p) => {
      if (activeSection === 'mine' && !p.isOwner) return false;
      if (activeSection === 'shared_team' && (p.isOwner || p.visibility !== 'team')) return false;
      if (activeSection === 'public_links' && !p.shareEnabled) return false;
      if (activeSection === 'private' && p.visibility !== 'private') return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.ownerName ?? ''} ${p.tags.join(' ')} ${p.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.totalBytes - a.totalBytes;
      return b.updatedAt - a.updatedAt;
    });

  const sectionTitles: Record<NavSection, { title: string; sub: string }> = {
    all: { title: 'Tất cả dự án', sub: 'Dự án của bạn và các dự án được chia sẻ trong toàn hệ thống' },
    mine: { title: 'Dự án của tôi', sub: 'Các dự án do bạn tạo và lưu trên Cloudflare D1 + R2' },
    shared_team: { title: 'Được chia sẻ với tôi', sub: 'Dự án do các thành viên khác trong team chia sẻ' },
    public_links: { title: 'Đang có link công khai', sub: 'Dự án đang bật liên kết chỉ xem (/share/...)' },
    private: { title: 'Dự án đã ẩn (Riêng tư)', sub: 'Chỉ mình bạn và Admin có thể nhìn thấy' },
    account: { title: 'Tài khoản & Thiết bị', sub: '' },
  };

  const renderCardsHtml = () => {
    if (filtered.length === 0) {
      return `
        <div class="empty-state">
          <h3>Chưa có dự án nào trong mục này</h3>
          <p class="muted" style="margin:0 0 16px">Mở FX Studio và nhấn ⌘S (hoặc nút Cloud → Lưu lên Cloud) để lưu dự án của bạn.</p>
          <a class="btn btn-primary" href="/">+ Mở FX Studio để thiết kế</a>
        </div>
      `;
    }

    if (viewMode === 'list') {
      return `
        <div class="list-panel">
          <table>
            <thead>
              <tr>
                <th>Dự án</th>
                <th>Tác giả</th>
                <th>Trạng thái</th>
                <th>Hiển thị</th>
                <th>Dung lượng</th>
                <th>Cập nhật</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((p) => {
                  const canManage = p.isOwner || currentUser?.role === 'admin';
                  return `
                    <tr>
                      <td>
                        <strong>${esc(p.name)}</strong>
                        <div class="muted">v${p.version} · ${p.assetCount} asset</div>
                      </td>
                      <td>${p.isOwner ? '<strong>Bạn</strong>' : esc(p.ownerName || '—')}</td>
                      <td><span class="pill pill-${p.status}">${statusLabel(p.status)}</span></td>
                      <td>
                        <span class="pill ${p.visibility === 'team' ? 'pill-team' : 'pill-private'}">
                          ${p.visibility === 'team' ? 'Toàn bộ user' : 'Đã ẩn'}
                        </span>
                        ${p.shareEnabled ? ' <span class="pill pill-shared">Link</span>' : ''}
                      </td>
                      <td class="num">${formatBytes(p.totalBytes)}</td>
                      <td class="num muted">${formatDateTime(p.updatedAt)}</td>
                      <td>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                          <a class="btn btn-sm btn-primary" href="/?project=${encodeURIComponent(p.id)}">Mở Studio</a>
                          <button class="btn btn-sm" data-dup="${esc(p.id)}" type="button">Nhân bản</button>
                          ${
                            canManage
                              ? `<button class="btn btn-sm" data-share="${esc(p.id)}" type="button">Chia sẻ</button>
                                 <button class="btn btn-sm" data-edit="${esc(p.id)}" type="button">Sửa</button>
                                 <button class="btn btn-sm btn-danger" data-del="${esc(p.id)}" data-name="${esc(p.name)}" type="button">Xóa</button>`
                              : ''
                          }
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="card-grid">
        ${filtered
          .map((p) => {
            const canManage = p.isOwner || currentUser?.role === 'admin';
            return `
              <article class="pcard">
                <a class="pcard-stage" href="/?project=${encodeURIComponent(p.id)}" title="Mở ${esc(p.name)} trong FX Studio">
                  <div class="pcard-badges">
                    <span class="pill pill-${p.status}">${statusLabel(p.status)}</span>
                    <span class="pill ${p.visibility === 'team' ? 'pill-team' : 'pill-private'}">
                      ${p.visibility === 'team' ? 'Toàn bộ user' : 'Đã ẩn'}
                    </span>
                  </div>
                  ${
                    p.thumbnailUrl
                      ? `<img class="pcard-thumb" src="${esc(p.thumbnailUrl)}" alt="${esc(p.name)}" loading="lazy">`
                      : `<div class="pcard-placeholder">FX</div>`
                  }
                </a>
                <div class="pcard-body">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                    <h3 class="pcard-title" title="${esc(p.name)}">${esc(p.name)}</h3>
                    <span class="muted num">v${p.version}</span>
                  </div>
                  <div class="pcard-meta">
                    <span>${p.isOwner ? 'Của bạn' : `Bởi ${esc(p.ownerName || 'Team')}`}</span>
                    <span>·</span>
                    <span class="num">${p.assetCount} asset (${formatBytes(p.totalBytes)})</span>
                    <span>·</span>
                    <span class="num">${formatDateTime(p.updatedAt)}</span>
                  </div>
                  ${
                    p.tags.length > 0
                      ? `<div class="pcard-tags">${p.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}${p.shareEnabled ? '<span class="pill pill-shared">Link công khai</span>' : ''}</div>`
                      : p.shareEnabled
                        ? '<div><span class="pill pill-shared">Link công khai</span></div>'
                        : ''
                  }
                  ${p.notes ? `<div class="pcard-notes" title="${esc(p.notes)}">${esc(p.notes)}</div>` : ''}
                  <div class="pcard-foot">
                    <a class="btn btn-sm btn-primary" href="/?project=${encodeURIComponent(p.id)}">Mở Studio</a>
                    <div style="display:flex;gap:4px;flex-wrap:wrap">
                      <button class="btn btn-sm" data-dup="${esc(p.id)}" type="button" title="Tạo bản sao vào tài khoản của bạn">Nhân bản</button>
                      <button class="btn btn-sm" data-vers="${esc(p.id)}" type="button" title="Lịch sử phiên bản">v${p.version}</button>
                      ${
                        canManage
                          ? `<button class="btn btn-sm" data-share="${esc(p.id)}" type="button" title="Chia sẻ & Quyền hiển thị">Chia sẻ</button>
                             <button class="btn btn-sm" data-edit="${esc(p.id)}" type="button" title="Sửa tên, trạng thái, tag">Sửa</button>
                             <button class="btn btn-sm btn-danger" data-del="${esc(p.id)}" data-name="${esc(p.name)}" type="button" title="Xóa dự án">×</button>`
                          : ''
                      }
                    </div>
                  </div>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  };

  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sb-brand">
          <img src="logo.png" alt="FX Studio">
          <div>
            <div class="sb-brand-title">FX Studio</div>
            <div class="sb-brand-sub">User Portal</div>
          </div>
        </div>

        <a class="btn btn-primary" href="/" style="width:100%">+ Mở FX Studio Editor</a>

        <nav class="sb-nav">
          <button type="button" class="sb-item ${activeSection === 'all' ? 'is-active' : ''}" data-sec="all">
            <span>Tất cả dự án</span><span class="sb-count num">${counts.all}</span>
          </button>
          <button type="button" class="sb-item ${activeSection === 'mine' ? 'is-active' : ''}" data-sec="mine">
            <span>Dự án của tôi</span><span class="sb-count num">${counts.mine}</span>
          </button>
          <button type="button" class="sb-item ${activeSection === 'shared_team' ? 'is-active' : ''}" data-sec="shared_team">
            <span>Được chia sẻ (Team)</span><span class="sb-count num">${counts.shared_team}</span>
          </button>
          <button type="button" class="sb-item ${activeSection === 'public_links' ? 'is-active' : ''}" data-sec="public_links">
            <span>Có link công khai</span><span class="sb-count num">${counts.public_links}</span>
          </button>
          <button type="button" class="sb-item ${activeSection === 'private' ? 'is-active' : ''}" data-sec="private">
            <span>Đã ẩn (Riêng tư)</span><span class="sb-count num">${counts.private}</span>
          </button>
          <button type="button" class="sb-item ${activeSection === 'account' ? 'is-active' : ''}" data-sec="account">
            <span>Tài khoản & Thiết bị</span>
          </button>
        </nav>

        <form class="sb-box" id="open-share-form">
          <div class="sb-box-title">Mở nhanh từ Link chia sẻ</div>
          <div style="display:flex;gap:6px">
            <input class="input" id="share-link-input" placeholder="Dán link /share/... hoặc mã" style="padding:6px 8px;font-size:12px">
            <button class="btn btn-sm" type="submit">Mở</button>
          </div>
        </form>

        <div class="sb-foot">
          <div class="sb-box">
            <div style="font-weight:600;font-size:13px">${esc(currentUser.name)}</div>
            <div class="muted" style="overflow:hidden;text-overflow:ellipsis">${esc(currentUser.email)}</div>
            <div class="muted num" style="margin-top:6px">
              R2: ${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
          </div>
          <div style="display:flex;gap:6px">
            ${currentUser.role === 'admin' ? '<a class="btn btn-sm" style="flex:1" href="/admin">Trang Admin</a>' : ''}
            <button class="btn btn-sm" style="flex:1" id="btn-portal-logout" type="button">Đăng xuất</button>
          </div>
        </div>
      </aside>

      <main class="main" id="portal-main">
        <div class="page-head">
          <div>
            <h1>${esc(sectionTitles[activeSection].title)}</h1>
            <div class="page-sub">${esc(sectionTitles[activeSection].sub)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" id="btn-portal-refresh" type="button">Làm mới</button>
            <a class="btn btn-sm btn-primary" href="/">Mở Studio</a>
          </div>
        </div>

        <div class="toolbar">
          <input class="input" id="p-search" type="search" placeholder="Tìm theo tên dự án, tác giả, #tag, ghi chú…" value="${esc(searchQ)}">
          <select class="select" id="p-status">
            <option value="" ${statusFilter === '' ? 'selected' : ''}>Mọi trạng thái</option>
            <option value="draft" ${statusFilter === 'draft' ? 'selected' : ''}>Nháp (Draft)</option>
            <option value="review" ${statusFilter === 'review' ? 'selected' : ''}>Chờ duyệt (Review)</option>
            <option value="approved" ${statusFilter === 'approved' ? 'selected' : ''}>Đã duyệt in (Approved)</option>
          </select>
          <select class="select" id="p-sort">
            <option value="updated" ${sortBy === 'updated' ? 'selected' : ''}>Mới cập nhật</option>
            <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Tên A → Z</option>
            <option value="size" ${sortBy === 'size' ? 'selected' : ''}>Dung lượng lớn</option>
          </select>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : ''}" id="p-view-grid" type="button">Lưới</button>
            <button class="btn btn-sm ${viewMode === 'list' ? 'btn-primary' : ''}" id="p-view-list" type="button">Danh sách</button>
          </div>
        </div>

        ${renderCardsHtml()}
      </main>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>('[data-sec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSection = btn.dataset.sec as NavSection;
      if (activeSection === 'account') {
        renderPortal();
        void renderAccountSection();
      } else {
        renderPortal();
      }
    });
  });

  if (activeSection === 'account') {
    void renderAccountSection();
    return;
  }

  document.getElementById('open-share-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = (document.getElementById('share-link-input') as HTMLInputElement).value;
    const token = parseShareToken(raw);
    if (!token) {
      toast('Liên kết hoặc mã chia sẻ không hợp lệ');
      return;
    }
    location.href = `/?share=${encodeURIComponent(token)}`;
  });

  document.getElementById('btn-portal-logout')?.addEventListener('click', async () => {
    await cloudApi.logout();
    currentUser = null;
    renderLoginGate();
  });

  document.getElementById('btn-portal-refresh')?.addEventListener('click', () => void loadAndRender());

  const searchEl = document.getElementById('p-search') as HTMLInputElement;
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchQ = searchEl.value;
      renderPortal();
    }
  });
  searchEl.addEventListener('search', () => {
    searchQ = searchEl.value;
    renderPortal();
  });

  (document.getElementById('p-status') as HTMLSelectElement).addEventListener('change', (e) => {
    statusFilter = (e.target as HTMLSelectElement).value as '' | ProjectStatus;
    renderPortal();
  });

  (document.getElementById('p-sort') as HTMLSelectElement).addEventListener('change', (e) => {
    sortBy = (e.target as HTMLSelectElement).value as typeof sortBy;
    renderPortal();
  });

  document.getElementById('p-view-grid')?.addEventListener('click', () => {
    viewMode = 'grid';
    localStorage.setItem('fx_portal_view', 'grid');
    renderPortal();
  });

  document.getElementById('p-view-list')?.addEventListener('click', () => {
    viewMode = 'list';
    localStorage.setItem('fx_portal_view', 'list');
    renderPortal();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-dup]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await cloudApi.duplicateProject(btn.dataset.dup!);
        toast(`Đã nhân bản "${res.project.name}"`);
        await loadAndRender();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Nhân bản thất bại');
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-vers]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const proj = allProjects.find((x) => x.id === btn.dataset.vers);
      if (proj) void openVersionsModal(proj);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const proj = allProjects.find((x) => x.id === btn.dataset.share);
      if (proj) openShareModal(proj);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const proj = allProjects.find((x) => x.id === btn.dataset.edit);
      if (proj) openEditMetaModal(proj);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.del!;
      const name = btn.dataset.name!;
      if (!confirm(`Xóa vĩnh viễn dự án "${name}" trên Cloudflare?`)) return;
      try {
        await cloudApi.deleteProject(id);
        toast('Đã xóa dự án');
        await loadAndRender();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Xóa thất bại');
      }
    });
  });
}

async function loadAndRender() {
  try {
    const data = await cloudApi.listProjects();
    allProjects = data.projects;
    usedBytes = data.usedBytes;
    quotaBytes = data.quotaBytes;
    renderPortal();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      currentUser = null;
      renderLoginGate('Phiên đăng nhập đã hết hạn');
      return;
    }
    toast(err instanceof Error ? err.message : 'Không tải được danh sách dự án');
  }
}

async function boot() {
  try {
    const me = await cloudApi.me();
    currentUser = me.user;
    setupRequired = me.setupRequired;
    allowPublicShare = me.settings?.allowPublicShare ?? true;
    if (!currentUser) {
      renderLoginGate();
      return;
    }
    usedBytes = me.usedBytes ?? 0;
    quotaBytes = currentUser.quotaBytes;
    await loadAndRender();
  } catch {
    renderLoginGate('Không kết nối được backend Worker (/api/auth/me)');
  }
}

void boot();
