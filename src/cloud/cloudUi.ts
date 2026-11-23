import type { Asset, Project } from '../model/types';
import {
  cloudApi,
  formatBytes,
  formatDateTime,
  type CloudProjectSummary,
  type CloudUser,
  type ProjectStatus,
  type ProjectVisibility,
} from './api';

export interface CloudHost {
  getActiveProject(): { project: Project; assets: Asset[]; cloudId?: string };
  setActiveCloudId(cloudId: string): void;
  captureThumbnail(): Promise<Blob | null>;
  openProjectInTab(project: Project, assetList: Asset[], cloudId?: string): void;
  onUserChange?(user: CloudUser | null): void;
  onSyncLabel?(label: string | null): void;
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .fx-cloud-backdrop {
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(0,0,0,0.68); backdrop-filter: blur(4px);
      display: grid; place-items: center; padding: 20px; font-family: inherit;
    }
    .fx-cloud-gate {
      position: fixed; inset: 0; z-index: 9999;
      background: #111114; color: #f3f3f5;
      display: grid; place-items: center; padding: 24px; font-family: inherit;
    }
    .fx-cloud-gate-card {
      width: 100%; max-width: 390px; background: #18181c;
      border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 28px;
      display: flex; flex-direction: column; gap: 14px; box-shadow: 0 24px 60px rgba(0,0,0,0.55);
    }
    .fx-cloud-modal {
      width: 100%; max-width: 820px; max-height: 88vh;
      background: #18181c; color: #f3f3f5;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .fx-cloud-head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .fx-cloud-head h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .fx-cloud-body { padding: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
    .fx-cloud-btn {
      padding: 6px 11px; border-radius: 8px; font-size: 12.5px; font-weight: 500;
      border: 1px solid rgba(255,255,255,0.14); background: #23232a; color: #f3f3f5;
      cursor: pointer; display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
    }
    .fx-cloud-btn:hover { background: #2d2d36; }
    .fx-cloud-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .fx-cloud-btn--primary { background: #3b82f6; border-color: transparent; color: #fff; }
    .fx-cloud-btn--primary:hover { background: #2563eb; }
    .fx-cloud-btn--danger { color: #fca5a5; border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.1); }
    .fx-cloud-btn--danger:hover { background: rgba(239,68,68,0.2); }
    .fx-cloud-input, .fx-cloud-select, .fx-cloud-textarea {
      width: 100%; padding: 8px 10px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.14); background: #111114; color: #f3f3f5; font-size: 13px;
      font-family: inherit;
    }
    .fx-cloud-card {
      background: #202026; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px;
    }
    .fx-cloud-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .fx-cloud-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .fx-cloud-muted { color: #9898a3; font-size: 12px; }
    .fx-cloud-err {
      background: rgba(239,68,68,0.14); border: 1px solid rgba(239,68,68,0.35);
      color: #fecaca; padding: 9px 12px; border-radius: 8px; font-size: 12.5px;
    }
    .fx-cloud-ok {
      background: rgba(34,197,94,0.14); border: 1px solid rgba(34,197,94,0.35);
      color: #bbf7d0; padding: 9px 12px; border-radius: 8px; font-size: 12.5px;
    }
    .fx-cloud-bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 6px; }
    .fx-cloud-bar > div { height: 100%; background: #3b82f6; transition: width 0.2s; }
    .fx-cloud-list { display: flex; flex-direction: column; gap: 8px; }
    .fx-cloud-item {
      display: grid; grid-template-columns: 42px 1fr auto; gap: 12px; align-items: center;
      padding: 10px 12px; border-radius: 10px; background: #202026; border: 1px solid rgba(255,255,255,0.07);
    }
    .fx-cloud-thumb {
      width: 42px; height: 56px; border-radius: 5px; object-fit: cover;
      background: #141418; border: 1px solid rgba(255,255,255,0.08);
      display: grid; place-items: center; font-size: 10px; color: #888;
    }
    .fx-cloud-pill {
      display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
      background: rgba(245,158,11,0.16); color: #fcd34d;
    }
    .fx-cloud-pill--team { background: rgba(34,197,94,0.15); color: #86efac; }
    .fx-cloud-pill--private { background: rgba(255,255,255,0.09); color: #a1a1aa; }
    .fx-cloud-pill--draft { background: rgba(148,163,184,0.16); color: #cbd5e1; }
    .fx-cloud-pill--review { background: rgba(59,130,246,0.18); color: #93c5fd; }
    .fx-cloud-pill--approved { background: rgba(16,185,129,0.2); color: #6ee7b7; }
    .fx-cloud-tag {
      display: inline-block; padding: 1px 6px; border-radius: 5px; font-size: 11px;
      background: rgba(255,255,255,0.06); color: #d4d4d8; border: 1px solid rgba(255,255,255,0.08);
    }
    .fx-cloud-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .fx-cloud-tab {
      padding: 5px 10px; border-radius: 7px; font-size: 12px; cursor: pointer;
      border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #9898a3;
    }
    .fx-cloud-tab.is-active { background: rgba(59,130,246,0.18); border-color: rgba(59,130,246,0.45); color: #93c5fd; }
    .fx-cloud-check {
      display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: #d4d4d8;
      cursor: pointer; user-select: none;
    }
    .fx-share-banner {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 8000;
      background: rgba(24,24,28,0.95); color: #f3f3f5; border: 1px solid rgba(255,255,255,0.14);
      border-radius: 999px; padding: 8px 14px; display: flex; align-items: center; gap: 12px;
      font-size: 12.5px; box-shadow: 0 12px 32px rgba(0,0,0,0.45);
    }
    .fx-cloud-toast {
      position: fixed; right: 18px; bottom: 18px; z-index: 9995;
      background: #23232b; color: #f3f3f5; border: 1px solid rgba(255,255,255,0.14);
      border-radius: 9px; padding: 10px 14px; font-size: 13px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    }
    .fx-cloud-toast.is-err { border-color: rgba(239,68,68,0.45); color: #fecaca; }
  `;
  document.head.appendChild(style);
}

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function statusLabel(s: ProjectStatus): string {
  if (s === 'approved') return 'Đã duyệt in';
  if (s === 'review') return 'Chờ duyệt';
  return 'Nháp';
}

export function showCloudToast(msg: string, isError = false): void {
  injectStyles();
  document.querySelector('.fx-cloud-toast')?.remove();
  const el = document.createElement('div');
  el.className = `fx-cloud-toast ${isError ? 'is-err' : ''}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isError ? 4000 : 2600);
}

let quickSaving = false;
export async function quickSaveToCloud(host: CloudHost): Promise<void> {
  if (quickSaving) return;
  quickSaving = true;
  host.onSyncLabel?.('Đang lưu Cloud…');
  showCloudToast('Đang đồng bộ lên Cloudflare…');
  try {
    const cur = host.getActiveProject();
    const hidePref = localStorage.getItem('fx_cloud_hide_on_save') === '1';
    const thumb = await host.captureThumbnail().catch(() => null);
    const saved = await cloudApi.saveProject(cur.project, cur.assets, {
      cloudId: cur.cloudId,
      visibility: cur.cloudId ? undefined : hidePref ? 'private' : 'team',
      thumbnail: thumb,
    });
    host.setActiveCloudId(saved.id);
    const visLabel = saved.visibility === 'private' ? 'Đã ẩn' : 'Team';
    host.onSyncLabel?.(`v${saved.version} · ${visLabel}`);
    showCloudToast(`Đã lưu "${saved.name}" (v${saved.version} · ${visLabel})`);
  } catch (err) {
    host.onSyncLabel?.(null);
    showCloudToast(err instanceof Error ? err.message : 'Lưu Cloud thất bại', true);
  } finally {
    quickSaving = false;
  }
}

export async function openCloudModal(host: CloudHost): Promise<void> {
  injectStyles();
  document.querySelector('.fx-cloud-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'fx-cloud-backdrop';
  backdrop.innerHTML = `
    <div class="fx-cloud-modal" role="dialog" aria-modal="true" aria-label="FX Cloud">
      <div class="fx-cloud-head">
        <div style="display:flex;align-items:center;gap:12px">
          <h2>FX Cloud</h2>
          <div class="fx-cloud-tabs" id="fx-modal-nav" style="display:none">
            <button type="button" class="fx-cloud-tab is-active" data-mnav="projects">Dự án</button>
            <button type="button" class="fx-cloud-tab" data-mnav="account">Tài khoản & Phiên</button>
          </div>
        </div>
        <button type="button" class="fx-cloud-btn" id="fx-cloud-close">Đóng</button>
      </div>
      <div class="fx-cloud-body" id="fx-cloud-body">
        <div class="fx-cloud-muted">Đang kết nối…</div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('#fx-cloud-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const body = backdrop.querySelector('#fx-cloud-body') as HTMLElement;
  const navEl = backdrop.querySelector('#fx-modal-nav') as HTMLElement;

  let modalTab: 'projects' | 'account' = 'projects';
  let listFilter: 'all' | 'mine' | 'team' | 'private' = 'all';
  let statusFilter: '' | ProjectStatus = '';
  let sortBy: 'updated' | 'name' | 'size' = 'updated';
  let searchQ = '';
  let allowPublicShare = true;
  let defaultVis: ProjectVisibility = 'team';

  const openSubDialog = (title: string, innerHtml: string, onMount: (wrap: HTMLElement, closeSub: () => void) => void) => {
    const sub = document.createElement('div');
    sub.className = 'fx-cloud-backdrop';
    sub.style.zIndex = '9500';
    sub.innerHTML = `
      <div class="fx-cloud-modal" style="max-width:520px">
        <div class="fx-cloud-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="fx-cloud-btn" id="fx-sub-close">Đóng</button>
        </div>
        <div class="fx-cloud-body">${innerHtml}</div>
      </div>
    `;
    document.body.appendChild(sub);
    const closeSub = () => sub.remove();
    sub.querySelector('#fx-sub-close')?.addEventListener('click', closeSub);
    sub.addEventListener('click', (e) => {
      if (e.target === sub) closeSub();
    });
    onMount(sub, closeSub);
  };

  const renderAccount = async (user: CloudUser) => {
    body.innerHTML = '<div class="fx-cloud-muted">Đang tải thông tin tài khoản…</div>';
    const { sessions } = await cloudApi.listSessions();

    body.innerHTML = `
      <div class="fx-cloud-grid2">
        <form class="fx-cloud-card" id="fxc-profile-form" style="display:flex;flex-direction:column;gap:10px">
          <strong>Thông tin cá nhân</strong>
          <div class="fx-cloud-muted">${esc(user.email)} · vai trò <strong>${user.role}</strong></div>
          <label class="fx-cloud-muted">Tên hiển thị
            <input class="fx-cloud-input" id="fxc-prof-name" required value="${esc(user.name)}" style="margin-top:4px">
          </label>
          <div id="fxc-prof-msg"></div>
          <button type="submit" class="fx-cloud-btn fx-cloud-btn--primary" style="align-self:flex-start">Lưu tên</button>
        </form>

        <form class="fx-cloud-card" id="fxc-pass-form" style="display:flex;flex-direction:column;gap:10px">
          <strong>Đổi mật khẩu</strong>
          <input class="fx-cloud-input" id="fxc-cur-pass" type="password" required placeholder="Mật khẩu hiện tại" autocomplete="current-password">
          <input class="fx-cloud-input" id="fxc-new-pass" type="password" required minlength="8" placeholder="Mật khẩu mới (≥ 8 ký tự)" autocomplete="new-password">
          <div id="fxc-pass-msg"></div>
          <button type="submit" class="fx-cloud-btn fx-cloud-btn--primary" style="align-self:flex-start">Cập nhật mật khẩu</button>
        </form>
      </div>

      <div class="fx-cloud-card">
        <div class="fx-cloud-row" style="margin-bottom:10px">
          <div>
            <strong>Phiên đăng nhập đang hoạt động (${sessions.length})</strong>
            <div class="fx-cloud-muted">Quản lý các trình duyệt/thiết bị đang truy cập tài khoản của bạn</div>
          </div>
          ${
            sessions.length > 1
              ? '<button type="button" class="fx-cloud-btn fx-cloud-btn--danger" id="fxc-revoke-others">Đăng xuất các thiết bị khác</button>'
              : ''
          }
        </div>
        <div class="fx-cloud-list">
          ${sessions
            .map(
              (s) => `
            <div class="fx-cloud-row" style="padding:8px 10px;border-radius:8px;background:#18181c;border:1px solid rgba(255,255,255,0.06)">
              <div style="min-width:0">
                <div style="font-size:12.5px">
                  ${s.isCurrent ? '<span class="fx-cloud-pill fx-cloud-pill--team">Thiết bị hiện tại</span> ' : ''}
                  <span>${esc((s.userAgent || 'Trình duyệt').slice(0, 72))}</span>
                </div>
                <div class="fx-cloud-muted">IP: ${esc(s.ip || '—')} · Đăng nhập: ${formatDateTime(s.createdAt)}</div>
              </div>
              ${
                !s.isCurrent
                  ? `<button type="button" class="fx-cloud-btn fx-cloud-btn--danger" data-revoke-sid="${esc(s.fullId)}">Thu hồi</button>`
                  : ''
              }
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;

    body.querySelector('#fxc-profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (body.querySelector('#fxc-prof-name') as HTMLInputElement).value.trim();
      const msgEl = body.querySelector('#fxc-prof-msg')!;
      try {
        await cloudApi.updateProfile(name);
        user.name = name;
        host.onUserChange?.(user);
        msgEl.innerHTML = '<div class="fx-cloud-ok">Đã cập nhật tên hiển thị</div>';
      } catch (err) {
        msgEl.innerHTML = `<div class="fx-cloud-err">${esc(err instanceof Error ? err.message : 'Lỗi')}</div>`;
      }
    });

    body.querySelector('#fxc-pass-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cur = (body.querySelector('#fxc-cur-pass') as HTMLInputElement).value;
      const next = (body.querySelector('#fxc-new-pass') as HTMLInputElement).value;
      const msgEl = body.querySelector('#fxc-pass-msg')!;
      try {
        await cloudApi.changePassword(cur, next);
        (body.querySelector('#fxc-cur-pass') as HTMLInputElement).value = '';
        (body.querySelector('#fxc-new-pass') as HTMLInputElement).value = '';
        msgEl.innerHTML = '<div class="fx-cloud-ok">Đã đổi mật khẩu thành công</div>';
      } catch (err) {
        msgEl.innerHTML = `<div class="fx-cloud-err">${esc(err instanceof Error ? err.message : 'Lỗi')}</div>`;
      }
    });

    body.querySelector('#fxc-revoke-others')?.addEventListener('click', async () => {
      await cloudApi.revokeOtherSessions();
      showCloudToast('Đã đăng xuất các thiết bị khác');
      await renderAccount(user);
    });

    body.querySelectorAll<HTMLButtonElement>('[data-revoke-sid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await cloudApi.revokeSession(btn.dataset.revokeSid!);
        showCloudToast('Đã thu hồi phiên đăng nhập');
        await renderAccount(user);
      });
    });
  };

  const renderLibrary = async (user: CloudUser) => {
    body.innerHTML = '<div class="fx-cloud-muted">Đang tải danh sách dự án trên Cloudflare…</div>';
    const data = await cloudApi.listProjects();
    const projects: CloudProjectSummary[] = data.projects;
    const ratio = data.quotaBytes > 0 ? Math.min(1, data.usedBytes / data.quotaBytes) : 0;
    const active = host.getActiveProject();
    const activeCloud = active.cloudId ? projects.find((x) => x.id === active.cloudId) : undefined;
    const canUpdateActive = Boolean(activeCloud && (activeCloud.isOwner || user.role === 'admin'));

    const savedHidePref = localStorage.getItem('fx_cloud_hide_on_save');
    const hideChecked = activeCloud
      ? activeCloud.visibility === 'private'
      : savedHidePref !== null
        ? savedHidePref === '1'
        : defaultVis === 'private';

    const q = searchQ.trim().toLowerCase();
    const filtered = projects
      .filter((p) => {
        if (listFilter === 'mine' && !p.isOwner) return false;
        if (listFilter === 'team' && p.visibility !== 'team') return false;
        if (listFilter === 'private' && p.visibility !== 'private') return false;
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

    const listHtml =
      filtered.length === 0
        ? '<div class="fx-cloud-muted">Không có dự án phù hợp. Bấm "Lưu lên Cloud" để đồng bộ dự án hiện tại.</div>'
        : filtered
            .map((p) => {
              const canManage = p.isOwner || user.role === 'admin';
              return `
            <div class="fx-cloud-item">
              ${
                p.thumbnailUrl
                  ? `<img class="fx-cloud-thumb" src="${esc(p.thumbnailUrl)}" alt="">`
                  : '<div class="fx-cloud-thumb">FX</div>'
              }
              <div style="min-width:0">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <strong>${esc(p.name)}</strong>
                  ${p.id === active.cloudId ? '<span class="fx-cloud-muted">(đang mở)</span>' : ''}
                  <span class="fx-cloud-pill fx-cloud-pill--${p.status}">${statusLabel(p.status)}</span>
                  ${
                    p.visibility === 'team'
                      ? '<span class="fx-cloud-pill fx-cloud-pill--team">Toàn bộ user</span>'
                      : '<span class="fx-cloud-pill fx-cloud-pill--private">Đã ẩn</span>'
                  }
                  ${p.shareEnabled ? '<span class="fx-cloud-pill">Link công khai</span>' : ''}
                </div>
                <div class="fx-cloud-muted" style="margin-top:2px">
                  ${p.ownerName ? `${esc(p.ownerName)} · ` : ''}v${p.version} · ${p.assetCount} asset · ${formatBytes(p.totalBytes)} · ${formatDateTime(p.updatedAt)}
                </div>
                ${
                  p.tags.length > 0
                    ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${p.tags.map((t) => `<span class="fx-cloud-tag">#${esc(t)}</span>`).join('')}</div>`
                    : ''
                }
              </div>
              <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
                <button type="button" class="fx-cloud-btn" data-open="${esc(p.id)}" data-manage="${canManage ? '1' : '0'}">Mở</button>
                <button type="button" class="fx-cloud-btn" data-vers="${esc(p.id)}" data-manage="${canManage ? '1' : '0'}">Lịch sử</button>
                ${
                  canManage
                    ? `<button type="button" class="fx-cloud-btn" data-meta="${esc(p.id)}">Sửa</button>
                       <button type="button" class="fx-cloud-btn" data-vis="${esc(p.id)}" data-next-vis="${p.visibility === 'team' ? 'private' : 'team'}">${p.visibility === 'team' ? 'Ẩn' : 'Hiện Team'}</button>
                       ${allowPublicShare || p.shareEnabled ? `<button type="button" class="fx-cloud-btn" data-share-dlg="${esc(p.id)}">Chia sẻ</button>` : ''}
                       <button type="button" class="fx-cloud-btn fx-cloud-btn--danger" data-del="${esc(p.id)}" data-name="${esc(p.name)}">Xóa</button>`
                    : ''
                }
              </div>
            </div>
          `;
            })
            .join('');

    body.innerHTML = `
      <div class="fx-cloud-card">
        <div class="fx-cloud-row">
          <div>
            <strong>${esc(user.name)}</strong> <span class="fx-cloud-muted">(${esc(user.email)})</span>
            <div class="fx-cloud-muted" style="margin-top:2px">
              Đã dùng ${formatBytes(data.usedBytes)} / ${formatBytes(data.quotaBytes)} trên R2 · Nhấn <kbd>⌘S</kbd> để lưu nhanh
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <a class="fx-cloud-btn" href="/portal">User Portal (/portal)</a>
            ${user.role === 'admin' ? '<a class="fx-cloud-btn" href="/admin">Quản trị (/admin)</a>' : ''}
            <button type="button" class="fx-cloud-btn" id="fxc-logout">Đăng xuất</button>
          </div>
        </div>
        <div class="fx-cloud-bar"><div style="width:${(ratio * 100).toFixed(1)}%"></div></div>
      </div>

      <div class="fx-cloud-card">
        <div class="fx-cloud-row">
          <div>
            <strong>Tab hiện tại: ${esc(active.project.name)}</strong>
            <div class="fx-cloud-muted">${active.assets.length} asset liên quan (artwork, mask, foil, HDRI) sẽ được đồng bộ lên R2</div>
          </div>
          <div style="display:flex;gap:8px">
            <button type="button" class="fx-cloud-btn fx-cloud-btn--primary" id="fxc-save">
              ${canUpdateActive ? 'Cập nhật lên Cloud' : 'Lưu lên Cloud'}
            </button>
            ${
              canUpdateActive
                ? '<button type="button" class="fx-cloud-btn" id="fxc-save-copy">Lưu bản mới</button>'
                : ''
            }
          </div>
        </div>
        <div class="fx-cloud-grid2" style="margin-top:10px">
          <select class="fx-cloud-select" id="fxc-save-status">
            <option value="draft" ${(activeCloud?.status ?? 'draft') === 'draft' ? 'selected' : ''}>Trạng thái: Nháp (Draft)</option>
            <option value="review" ${activeCloud?.status === 'review' ? 'selected' : ''}>Trạng thái: Chờ duyệt (Review)</option>
            <option value="approved" ${activeCloud?.status === 'approved' ? 'selected' : ''}>Trạng thái: Đã duyệt in (Approved)</option>
          </select>
          <input class="fx-cloud-input" id="fxc-save-note" placeholder="Ghi chú phiên bản (tùy chọn)…">
        </div>
        <label class="fx-cloud-check" style="margin-top:10px">
          <input type="checkbox" id="fxc-hide-private" ${hideChecked ? 'checked' : ''}>
          <span>Ẩn dự án (chỉ mình tôi & Admin thấy — mặc định chia sẻ toàn bộ user)</span>
        </label>
        <div id="fxc-progress" style="display:none;margin-top:10px">
          <div class="fx-cloud-muted" id="fxc-progress-label">Đang lưu…</div>
          <div class="fx-cloud-bar"><div id="fxc-progress-bar" style="width:0%"></div></div>
        </div>
        <div id="fxc-error" style="margin-top:8px"></div>
      </div>

      <div>
        <div class="fx-cloud-row" style="margin-bottom:8px">
          <strong style="font-size:13.5px">Thư viện dự án (${filtered.length}/${projects.length})</strong>
          <div class="fx-cloud-tabs">
            <button type="button" class="fx-cloud-tab ${listFilter === 'all' ? 'is-active' : ''}" data-filter="all">Tất cả</button>
            <button type="button" class="fx-cloud-tab ${listFilter === 'team' ? 'is-active' : ''}" data-filter="team">Toàn bộ user</button>
            <button type="button" class="fx-cloud-tab ${listFilter === 'mine' ? 'is-active' : ''}" data-filter="mine">Của tôi</button>
            <button type="button" class="fx-cloud-tab ${listFilter === 'private' ? 'is-active' : ''}" data-filter="private">Đã ẩn</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 140px 135px;gap:8px;margin-bottom:10px">
          <input class="fx-cloud-input" id="fxc-search" type="search" placeholder="Tìm tên dự án, tác giả, #tag…" value="${esc(searchQ)}">
          <select class="fx-cloud-select" id="fxc-status-filter">
            <option value="" ${statusFilter === '' ? 'selected' : ''}>Mọi trạng thái</option>
            <option value="draft" ${statusFilter === 'draft' ? 'selected' : ''}>Nháp</option>
            <option value="review" ${statusFilter === 'review' ? 'selected' : ''}>Chờ duyệt</option>
            <option value="approved" ${statusFilter === 'approved' ? 'selected' : ''}>Đã duyệt in</option>
          </select>
          <select class="fx-cloud-select" id="fxc-sort">
            <option value="updated" ${sortBy === 'updated' ? 'selected' : ''}>Mới cập nhật</option>
            <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Tên A → Z</option>
            <option value="size" ${sortBy === 'size' ? 'selected' : ''}>Dung lượng lớn</option>
          </select>
        </div>
        <div class="fx-cloud-list">${listHtml}</div>
      </div>
    `;

    body.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        listFilter = btn.dataset.filter as typeof listFilter;
        void renderLibrary(user);
      });
    });

    const searchInput = body.querySelector('#fxc-search') as HTMLInputElement;
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        searchQ = searchInput.value;
        void renderLibrary(user);
      }
    });
    searchInput.addEventListener('search', () => {
      searchQ = searchInput.value;
      void renderLibrary(user);
    });
    (body.querySelector('#fxc-status-filter') as HTMLSelectElement).addEventListener('change', (e) => {
      statusFilter = (e.target as HTMLSelectElement).value as '' | ProjectStatus;
      void renderLibrary(user);
    });
    (body.querySelector('#fxc-sort') as HTMLSelectElement).addEventListener('change', (e) => {
      sortBy = (e.target as HTMLSelectElement).value as typeof sortBy;
      void renderLibrary(user);
    });

    const hideCheckbox = body.querySelector('#fxc-hide-private') as HTMLInputElement;
    hideCheckbox?.addEventListener('change', () => {
      localStorage.setItem('fx_cloud_hide_on_save', hideCheckbox.checked ? '1' : '0');
    });

    body.querySelector('#fxc-logout')?.addEventListener('click', async () => {
      await cloudApi.logout();
      host.onUserChange?.(null);
      close();
      await requireLoginGate(host);
    });

    const runSave = async (asNew: boolean) => {
      const progWrap = body.querySelector('#fxc-progress') as HTMLElement;
      const progLabel = body.querySelector('#fxc-progress-label') as HTMLElement;
      const progBar = body.querySelector('#fxc-progress-bar') as HTMLElement;
      const errWrap = body.querySelector('#fxc-error') as HTMLElement;
      const saveBtn = body.querySelector('#fxc-save') as HTMLButtonElement;
      errWrap.innerHTML = '';
      progWrap.style.display = 'block';
      saveBtn.disabled = true;

      const visibility: ProjectVisibility = hideCheckbox?.checked ? 'private' : 'team';
      const status = (body.querySelector('#fxc-save-status') as HTMLSelectElement).value as ProjectStatus;
      const versionNote = (body.querySelector('#fxc-save-note') as HTMLInputElement).value.trim();

      try {
        const cur = host.getActiveProject();
        const thumb = await host.captureThumbnail().catch(() => null);
        const saved = await cloudApi.saveProject(cur.project, cur.assets, {
          cloudId: asNew || !canUpdateActive ? undefined : cur.cloudId,
          visibility,
          status,
          versionNote,
          thumbnail: thumb,
          onProgress: (label, r) => {
            progLabel.textContent = label;
            progBar.style.width = `${Math.round(r * 100)}%`;
          },
        });
        host.setActiveCloudId(saved.id);
        host.onSyncLabel?.(`v${saved.version} · ${saved.visibility === 'private' ? 'Đã ẩn' : 'Team'}`);
        showCloudToast(`Đã lưu "${saved.name}" (v${saved.version})`);
        await renderLibrary(user);
      } catch (err) {
        errWrap.innerHTML = `<div class="fx-cloud-err">${esc(err instanceof Error ? err.message : 'Lưu thất bại')}</div>`;
        saveBtn.disabled = false;
      }
    };

    body.querySelector('#fxc-save')?.addEventListener('click', () => void runSave(false));
    body.querySelector('#fxc-save-copy')?.addEventListener('click', () => void runSave(true));

    body.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.open!;
        const canManage = btn.dataset.manage === '1';
        btn.disabled = true;
        btn.textContent = 'Đang tải…';
        try {
          const detail = await cloudApi.getProject(id);
          const downloaded = await cloudApi.downloadAssets(detail.assets);
          host.openProjectInTab(detail.project, downloaded, canManage ? detail.meta.id : undefined);
          host.onSyncLabel?.(`v${detail.meta.version} · ${detail.meta.visibility === 'private' ? 'Đã ẩn' : 'Team'}`);
          close();
        } catch (err) {
          showCloudToast(err instanceof Error ? err.message : 'Không mở được dự án', true);
          btn.disabled = false;
          btn.textContent = 'Mở';
        }
      });
    });

    body.querySelectorAll<HTMLButtonElement>('[data-vers]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.vers!;
        const canManage = btn.dataset.manage === '1';
        const proj = projects.find((x) => x.id === id);
        if (!proj) return;
        const { versions } = await cloudApi.listVersions(id);
        openSubDialog(
          `Lịch sử phiên bản — ${proj.name}`,
          versions.length === 0
            ? '<div class="fx-cloud-muted">Chưa có bản lưu lịch sử nào (bản lưu tiếp theo sẽ tự động ghi nhận).</div>'
            : `<div class="fx-cloud-list">
                ${versions
                  .map(
                    (v) => `
                  <div class="fx-cloud-row" style="padding:9px 12px;border-radius:8px;background:#202026;border:1px solid rgba(255,255,255,0.07)">
                    <div>
                      <strong>v${v.version}</strong> · ${esc(v.name)}
                      <div class="fx-cloud-muted">${esc(v.savedByName || '—')} · ${formatDateTime(v.createdAt)}${v.note ? ` · "${esc(v.note)}"` : ''}</div>
                    </div>
                    <button type="button" class="fx-cloud-btn fx-cloud-btn--primary" data-restore-ver="${esc(v.id)}">Khôi phục</button>
                  </div>
                `,
                  )
                  .join('')}
              </div>`,
          (wrap, closeSub) => {
            wrap.querySelectorAll<HTMLButtonElement>('[data-restore-ver]').forEach((rbtn) => {
              rbtn.addEventListener('click', async () => {
                rbtn.disabled = true;
                rbtn.textContent = 'Đang tải…';
                try {
                  const detail = await cloudApi.getVersion(id, rbtn.dataset.restoreVer!);
                  const downloaded = await cloudApi.downloadAssets(detail.assets);
                  host.openProjectInTab(detail.project, downloaded, canManage ? id : undefined);
                  showCloudToast(`Đã mở bản khôi phục v${detail.version.version}`);
                  closeSub();
                  close();
                } catch (err) {
                  showCloudToast(err instanceof Error ? err.message : 'Khôi phục thất bại', true);
                  rbtn.disabled = false;
                  rbtn.textContent = 'Khôi phục';
                }
              });
            });
          },
        );
      });
    });

    body.querySelectorAll<HTMLButtonElement>('[data-meta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const proj = projects.find((x) => x.id === btn.dataset.meta);
        if (!proj) return;
        openSubDialog(
          `Thông tin dự án — ${proj.name}`,
          `<form id="fx-meta-form" style="display:flex;flex-direction:column;gap:12px">
            <label class="fx-cloud-muted">Tên dự án
              <input class="fx-cloud-input" id="fm-name" required value="${esc(proj.name)}" style="margin-top:4px">
            </label>
            <div class="fx-cloud-grid2">
              <label class="fx-cloud-muted">Trạng thái sản xuất
                <select class="fx-cloud-select" id="fm-status" style="margin-top:4px">
                  <option value="draft" ${proj.status === 'draft' ? 'selected' : ''}>Nháp (Draft)</option>
                  <option value="review" ${proj.status === 'review' ? 'selected' : ''}>Chờ duyệt (Review)</option>
                  <option value="approved" ${proj.status === 'approved' ? 'selected' : ''}>Đã duyệt in (Approved)</option>
                </select>
              </label>
              <label class="fx-cloud-muted">Hiển thị nội bộ
                <select class="fx-cloud-select" id="fm-vis" style="margin-top:4px">
                  <option value="team" ${proj.visibility === 'team' ? 'selected' : ''}>Toàn bộ user</option>
                  <option value="private" ${proj.visibility === 'private' ? 'selected' : ''}>Ẩn (Chỉ mình tôi)</option>
                </select>
              </label>
            </div>
            <label class="fx-cloud-muted">Tags (ngăn cách bởi dấu phẩy)
              <input class="fx-cloud-input" id="fm-tags" value="${esc(proj.tags.join(', '))}" placeholder="Pokemon, Foil Gold, Batch 1" style="margin-top:4px">
            </label>
            <label class="fx-cloud-muted">Ghi chú nội bộ
              <textarea class="fx-cloud-textarea" id="fm-notes" rows="3" placeholder="Ghi chú cho team hoặc nhà in…" style="margin-top:4px">${esc(proj.notes)}</textarea>
            </label>
            <div style="display:flex;justify-content:flex-end;gap:8px">
              <button type="submit" class="fx-cloud-btn fx-cloud-btn--primary">Lưu thông tin</button>
            </div>
          </form>`,
          (wrap, closeSub) => {
            wrap.querySelector('#fx-meta-form')?.addEventListener('submit', async (e) => {
              e.preventDefault();
              const name = (wrap.querySelector('#fm-name') as HTMLInputElement).value.trim();
              const status = (wrap.querySelector('#fm-status') as HTMLSelectElement).value as ProjectStatus;
              const visibility = (wrap.querySelector('#fm-vis') as HTMLSelectElement).value as ProjectVisibility;
              const tags = (wrap.querySelector('#fm-tags') as HTMLInputElement).value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean);
              const notes = (wrap.querySelector('#fm-notes') as HTMLTextAreaElement).value.trim();
              try {
                await cloudApi.updateProjectMeta(proj.id, { name, status, visibility, tags, notes });
                showCloudToast('Đã cập nhật thông tin dự án');
                closeSub();
                await renderLibrary(user);
              } catch (err) {
                showCloudToast(err instanceof Error ? err.message : 'Cập nhật thất bại', true);
              }
            });
          },
        );
      });
    });

    body.querySelectorAll<HTMLButtonElement>('[data-share-dlg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const proj = projects.find((x) => x.id === btn.dataset.shareDlg);
        if (!proj) return;
        const shareUrl = proj.shareEnabled && proj.shareToken ? `${location.origin}/share/${proj.shareToken}` : '';
        openSubDialog(
          `Chia sẻ công khai — ${proj.name}`,
          `<div style="display:flex;flex-direction:column;gap:12px">
            <div class="fx-cloud-muted">
              Ai có liên kết này đều có thể mở xem 3D/2D ở chế độ <strong>chỉ xem</strong> mà không cần đăng nhập.
            </div>
            <div id="fs-box">
              ${
                shareUrl
                  ? `<input class="fx-cloud-input" id="fs-url" readonly value="${esc(shareUrl)}">
                     <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                       <button type="button" class="fx-cloud-btn fx-cloud-btn--primary" id="fs-copy">Sao chép link</button>
                       <button type="button" class="fx-cloud-btn" id="fs-regen">Đổi link mới</button>
                       <button type="button" class="fx-cloud-btn fx-cloud-btn--danger" id="fs-off">Tắt chia sẻ</button>
                     </div>`
                  : `<button type="button" class="fx-cloud-btn fx-cloud-btn--primary" id="fs-on">Tạo liên kết chia sẻ công khai</button>`
              }
            </div>
          </div>`,
          (wrap, closeSub) => {
            wrap.querySelector('#fs-copy')?.addEventListener('click', async () => {
              const url = (wrap.querySelector('#fs-url') as HTMLInputElement).value;
              await navigator.clipboard.writeText(url).catch(() => {});
              showCloudToast('Đã sao chép liên kết chia sẻ');
            });
            wrap.querySelector('#fs-on')?.addEventListener('click', async () => {
              try {
                const res = await cloudApi.toggleShare(proj.id, true);
                if (res.shareUrl) await navigator.clipboard.writeText(res.shareUrl).catch(() => {});
                showCloudToast('Đã bật chia sẻ & sao chép liên kết');
                closeSub();
                await renderLibrary(user);
              } catch (err) {
                showCloudToast(err instanceof Error ? err.message : 'Lỗi bật chia sẻ', true);
              }
            });
            wrap.querySelector('#fs-regen')?.addEventListener('click', async () => {
              try {
                const res = await cloudApi.toggleShare(proj.id, true, true);
                if (res.shareUrl) await navigator.clipboard.writeText(res.shareUrl).catch(() => {});
                showCloudToast('Đã tạo link mới (link cũ đã vô hiệu hóa)');
                closeSub();
                await renderLibrary(user);
              } catch (err) {
                showCloudToast(err instanceof Error ? err.message : 'Lỗi đổi link', true);
              }
            });
            wrap.querySelector('#fs-off')?.addEventListener('click', async () => {
              try {
                await cloudApi.toggleShare(proj.id, false);
                showCloudToast('Đã tắt chia sẻ công khai');
                closeSub();
                await renderLibrary(user);
              } catch (err) {
                showCloudToast(err instanceof Error ? err.message : 'Lỗi tắt chia sẻ', true);
              }
            });
          },
        );
      });
    });

    body.querySelectorAll<HTMLButtonElement>('[data-vis]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.vis!;
        const nextVis = btn.dataset.nextVis as ProjectVisibility;
        btn.disabled = true;
        try {
          await cloudApi.setVisibility(id, nextVis);
          showCloudToast(nextVis === 'private' ? 'Đã ẩn dự án' : 'Đã hiển thị cho toàn bộ user');
          await renderLibrary(user);
        } catch (err) {
          showCloudToast(err instanceof Error ? err.message : 'Lỗi đổi quyền hiển thị', true);
          btn.disabled = false;
        }
      });
    });

    body.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.del!;
        const name = btn.dataset.name!;
        if (!confirm(`Xóa vĩnh viễn dự án "${name}" trên Cloudflare?`)) return;
        try {
          await cloudApi.deleteProject(id);
          showCloudToast('Đã xóa dự án');
          await renderLibrary(user);
        } catch (err) {
          showCloudToast(err instanceof Error ? err.message : 'Xóa thất bại', true);
        }
      });
    });
  };

  try {
    const me = await cloudApi.me();
    host.onUserChange?.(me.user);
    allowPublicShare = me.settings?.allowPublicShare ?? true;
    defaultVis = me.settings?.defaultVisibility ?? 'team';

    if (me.user) {
      const user = me.user;
      navEl.style.display = 'flex';
      navEl.querySelectorAll<HTMLButtonElement>('[data-mnav]').forEach((btn) => {
        btn.addEventListener('click', () => {
          modalTab = btn.dataset.mnav as 'projects' | 'account';
          navEl.querySelectorAll('.fx-cloud-tab').forEach((t) => t.classList.remove('is-active'));
          btn.classList.add('is-active');
          if (modalTab === 'account') void renderAccount(user);
          else void renderLibrary(user);
        });
      });
      await renderLibrary(user);
    } else {
      close();
      await requireLoginGate(host);
    }
  } catch {
    body.innerHTML = '<div class="fx-cloud-err">Không kết nối được máy chủ Cloudflare Worker (/api/auth/me)</div>';
  }
}

export async function requireLoginGate(host: CloudHost): Promise<CloudUser> {
  injectStyles();
  document.querySelector('.fx-cloud-gate')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'fx-cloud-gate';
  overlay.innerHTML = `
    <div class="fx-cloud-gate-card">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="logo.png" alt="FX Studio" style="width:28px;height:28px;border-radius:6px">
        <strong style="font-size:16px">FX Studio</strong>
      </div>
      <div class="fx-cloud-muted">Đang kiểm tra phiên đăng nhập…</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const renderForm = (errorMsg: string, setupRequired: boolean, resolve: (u: CloudUser) => void) => {
    overlay.innerHTML = `
      <form class="fx-cloud-gate-card" id="fx-gate-form">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="logo.png" alt="FX Studio" style="width:28px;height:28px;border-radius:6px">
          <strong style="font-size:16px">FX Studio</strong>
        </div>
        <div>
          <h2 style="margin:0 0 4px;font-size:19px;font-weight:600">
            ${setupRequired ? 'Khởi tạo hệ thống' : 'Đăng nhập nội bộ'}
          </h2>
          <div class="fx-cloud-muted">
            ${
              setupRequired
                ? 'Chưa có tài khoản quản trị nào. Mở trang /admin để tạo tài khoản Admin đầu tiên.'
                : 'Vui lòng đăng nhập bằng tài khoản được cấp để sử dụng FX Studio.'
            }
          </div>
        </div>
        ${errorMsg ? `<div class="fx-cloud-err">${esc(errorMsg)}</div>` : ''}
        ${
          setupRequired
            ? `<a class="fx-cloud-btn fx-cloud-btn--primary" href="/admin" style="justify-content:center;padding:10px 14px">Khởi tạo tài khoản Admin (/admin)</a>`
            : `
              <input class="fx-cloud-input" id="fxg-email" type="email" required placeholder="Email tài khoản" autocomplete="username" autofocus>
              <input class="fx-cloud-input" id="fxg-pass" type="password" required placeholder="Mật khẩu" autocomplete="current-password">
              <button class="fx-cloud-btn fx-cloud-btn--primary" id="fxg-submit" type="submit" style="justify-content:center;padding:10px 14px">Đăng nhập</button>
            `
        }
      </form>
    `;

    const form = overlay.querySelector('#fx-gate-form') as HTMLFormElement | null;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (overlay.querySelector('#fxg-email') as HTMLInputElement).value.trim();
      const pass = (overlay.querySelector('#fxg-pass') as HTMLInputElement).value;
      const submitBtn = overlay.querySelector('#fxg-submit') as HTMLButtonElement | null;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang đăng nhập…';
      }
      try {
        const res = await cloudApi.login(email, pass);
        host.onUserChange?.(res.user);
        overlay.remove();
        resolve(res.user);
      } catch (err) {
        renderForm(err instanceof Error ? err.message : 'Đăng nhập thất bại', false, resolve);
      }
    });
  };

  try {
    const me = await cloudApi.me();
    if (me.user) {
      host.onUserChange?.(me.user);
      overlay.remove();
      return me.user;
    }
    return await new Promise<CloudUser>((resolve) => {
      renderForm('', me.setupRequired, resolve);
    });
  } catch {
    return await new Promise<CloudUser>((resolve) => {
      renderForm('Không kết nối được máy chủ xác thực (/api/auth/me)', false, resolve);
    });
  }
}

export async function openCloudProjectById(projectId: string, host: CloudHost): Promise<void> {
  injectStyles();
  const detail = await cloudApi.getProject(projectId);
  const downloaded = await cloudApi.downloadAssets(detail.assets);
  host.openProjectInTab(detail.project, downloaded, detail.meta.isOwner ? detail.meta.id : undefined);
  host.onSyncLabel?.(`v${detail.meta.version} · ${detail.meta.visibility === 'private' ? 'Đã ẩn' : 'Team'}`);
  showCloudToast(`Đã mở dự án "${detail.meta.name}"`);
}

export async function loadSharedProjectIntoStudio(token: string, host: CloudHost): Promise<void> {
  injectStyles();
  const detail = await cloudApi.getShared(token);
  const downloaded = await cloudApi.downloadAssets(detail.assets);
  host.openProjectInTab(detail.project, downloaded);

  document.querySelector('.fx-share-banner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'fx-share-banner';
  banner.innerHTML = `
    <span>Chế độ Preview & Inspect (Chỉ xem thông số): <strong>${esc(detail.meta.name)}</strong> · bởi ${esc(detail.meta.ownerName)}</span>
    <a class="fx-cloud-btn fx-cloud-btn--primary" href="/">Đăng nhập Studio</a>
  `;
  document.body.appendChild(banner);
}
