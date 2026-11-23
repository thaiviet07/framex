import type { Asset, Project } from '../model/types';
import {
  cloudApi,
  formatBytes,
  formatDateTime,
  type CloudProjectSummary,
  type CloudUser,
} from './api';

export interface CloudHost {
  getActiveProject(): { project: Project; assets: Asset[]; cloudId?: string };
  setActiveCloudId(cloudId: string): void;
  captureThumbnail(): Promise<Blob | null>;
  openProjectInTab(project: Project, assetList: Asset[], cloudId?: string): void;
  onUserChange?(user: CloudUser | null): void;
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
      display: grid; place-items: center; padding: 20px;
      font-family: inherit;
    }
    .fx-cloud-gate {
      position: fixed; inset: 0; z-index: 9999;
      background: #111114; color: #f3f3f5;
      display: grid; place-items: center; padding: 24px;
      font-family: inherit;
    }
    .fx-cloud-gate-card {
      width: 100%; max-width: 390px;
      background: #18181c; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px; padding: 28px;
      display: flex; flex-direction: column; gap: 14px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.55);
    }
    .fx-cloud-modal {
      width: 100%; max-width: 720px; max-height: 86vh;
      background: #18181c; color: #f3f3f5;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .fx-cloud-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 15px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .fx-cloud-head h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .fx-cloud-body { padding: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .fx-cloud-btn {
      padding: 7px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 500;
      border: 1px solid rgba(255,255,255,0.14); background: #23232a; color: #f3f3f5;
      cursor: pointer; display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
    }
    .fx-cloud-btn:hover { background: #2d2d36; }
    .fx-cloud-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .fx-cloud-btn--primary { background: #3b82f6; border-color: transparent; color: #fff; }
    .fx-cloud-btn--primary:hover { background: #2563eb; }
    .fx-cloud-btn--danger { color: #fca5a5; border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.1); }
    .fx-cloud-btn--danger:hover { background: rgba(239,68,68,0.2); }
    .fx-cloud-input {
      width: 100%; padding: 9px 11px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.14); background: #111114; color: #f3f3f5; font-size: 13px;
    }
    .fx-cloud-card {
      background: #202026; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px;
    }
    .fx-cloud-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .fx-cloud-muted { color: #9898a3; font-size: 12px; }
    .fx-cloud-err {
      background: rgba(239,68,68,0.14); border: 1px solid rgba(239,68,68,0.35);
      color: #fecaca; padding: 9px 12px; border-radius: 8px; font-size: 12.5px;
    }
    .fx-cloud-bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 6px; }
    .fx-cloud-bar > div { height: 100%; background: #3b82f6; transition: width 0.2s; }
    .fx-cloud-list { display: flex; flex-direction: column; gap: 8px; }
    .fx-cloud-item {
      display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center;
      padding: 10px 12px; border-radius: 10px; background: #202026; border: 1px solid rgba(255,255,255,0.07);
    }
    .fx-cloud-thumb {
      width: 40px; height: 54px; border-radius: 5px; object-fit: cover;
      background: #141418; border: 1px solid rgba(255,255,255,0.08);
      display: grid; place-items: center; font-size: 10px; color: #888;
    }
    .fx-cloud-pill {
      display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
      background: rgba(245,158,11,0.16); color: #fcd34d;
    }
    .fx-share-banner {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 8000;
      background: rgba(24,24,28,0.95); color: #f3f3f5; border: 1px solid rgba(255,255,255,0.14);
      border-radius: 999px; padding: 8px 14px; display: flex; align-items: center; gap: 12px;
      font-size: 12.5px; box-shadow: 0 12px 32px rgba(0,0,0,0.45);
    }
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

export async function openCloudModal(host: CloudHost): Promise<void> {
  injectStyles();
  document.querySelector('.fx-cloud-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'fx-cloud-backdrop';
  backdrop.innerHTML = `
    <div class="fx-cloud-modal" role="dialog" aria-modal="true" aria-label="FX Cloud">
      <div class="fx-cloud-head">
        <h2>FX Cloud — Lưu trữ Cloudflare</h2>
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

  const renderLogin = (errorMsg = '', setupRequired = false) => {
    body.innerHTML = `
      <form id="fx-cloud-login" style="max-width:380px;margin:8px auto;width:100%;display:flex;flex-direction:column;gap:12px">
        <div>
          <strong style="font-size:15px">${setupRequired ? 'Hệ thống chưa khởi tạo Admin' : 'Đăng nhập tài khoản nội bộ'}</strong>
          <div class="fx-cloud-muted" style="margin-top:4px">
            ${
              setupRequired
                ? 'Vui lòng mở trang Quản trị (/admin) để tạo tài khoản Admin đầu tiên.'
                : 'Đăng nhập để lưu dự án lên Cloudflare D1 + R2 và tạo liên kết chia sẻ.'
            }
          </div>
        </div>
        ${errorMsg ? `<div class="fx-cloud-err">${esc(errorMsg)}</div>` : ''}
        ${
          setupRequired
            ? `<a class="fx-cloud-btn fx-cloud-btn--primary" href="/admin" style="justify-content:center">Mở trang khởi tạo Admin (/admin)</a>`
            : `
              <input class="fx-cloud-input" id="fxc-email" type="email" required placeholder="Email tài khoản" autocomplete="username">
              <input class="fx-cloud-input" id="fxc-pass" type="password" required placeholder="Mật khẩu" autocomplete="current-password">
              <button class="fx-cloud-btn fx-cloud-btn--primary" type="submit" style="justify-content:center">Đăng nhập</button>
            `
        }
      </form>
    `;
    const form = body.querySelector('#fx-cloud-login') as HTMLFormElement | null;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (body.querySelector('#fxc-email') as HTMLInputElement).value.trim();
      const pass = (body.querySelector('#fxc-pass') as HTMLInputElement).value;
      try {
        const res = await cloudApi.login(email, pass);
        host.onUserChange?.(res.user);
        await renderLibrary(res.user);
      } catch (err) {
        renderLogin(err instanceof Error ? err.message : 'Đăng nhập thất bại');
      }
    });
  };

  const renderLibrary = async (user: CloudUser) => {
    body.innerHTML = '<div class="fx-cloud-muted">Đang tải danh sách dự án trên Cloudflare…</div>';
    const data = await cloudApi.listProjects();
    const projects: CloudProjectSummary[] = data.projects;
    const ratio = data.quotaBytes > 0 ? Math.min(1, data.usedBytes / data.quotaBytes) : 0;
    const active = host.getActiveProject();

    const listHtml =
      projects.length === 0
        ? '<div class="fx-cloud-muted">Chưa có dự án nào trên Cloud. Bấm "Lưu dự án hiện tại" để đồng bộ.</div>'
        : projects
            .map(
              (p) => `
            <div class="fx-cloud-item">
              ${
                p.thumbnailUrl
                  ? `<img class="fx-cloud-thumb" src="${esc(p.thumbnailUrl)}" alt="">`
                  : '<div class="fx-cloud-thumb">FX</div>'
              }
              <div style="min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <strong>${esc(p.name)}</strong>
                  ${p.id === active.cloudId ? '<span class="fx-cloud-muted">(đang mở)</span>' : ''}
                  ${p.shareEnabled ? '<span class="fx-cloud-pill">Đang chia sẻ</span>' : ''}
                </div>
                <div class="fx-cloud-muted">
                  v${p.version} · ${p.assetCount} asset · ${formatBytes(p.totalBytes)} · ${formatDateTime(p.updatedAt)}
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                <button type="button" class="fx-cloud-btn" data-open="${esc(p.id)}">Mở</button>
                <button type="button" class="fx-cloud-btn" data-share="${esc(p.id)}" data-enabled="${p.shareEnabled ? '1' : '0'}">${p.shareEnabled ? 'Copy / Tắt share' : 'Chia sẻ'}</button>
                <button type="button" class="fx-cloud-btn fx-cloud-btn--danger" data-del="${esc(p.id)}" data-name="${esc(p.name)}">Xóa</button>
              </div>
            </div>
          `,
            )
            .join('');

    body.innerHTML = `
      <div class="fx-cloud-card">
        <div class="fx-cloud-row">
          <div>
            <strong>${esc(user.name)}</strong> <span class="fx-cloud-muted">(${esc(user.email)})</span>
            <div class="fx-cloud-muted" style="margin-top:2px">
              Đã dùng ${formatBytes(data.usedBytes)} / ${formatBytes(data.quotaBytes)} trên R2
            </div>
          </div>
          <div style="display:flex;gap:8px">
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
            <div class="fx-cloud-muted">${active.assets.length} tài nguyên · chỉ tải lên ảnh mới (incremental R2)</div>
          </div>
          <div style="display:flex;gap:8px">
            <button type="button" class="fx-cloud-btn fx-cloud-btn--primary" id="fxc-save">
              ${active.cloudId ? 'Cập nhật lên Cloud' : 'Lưu lên Cloud'}
            </button>
            ${
              active.cloudId
                ? '<button type="button" class="fx-cloud-btn" id="fxc-save-copy">Lưu bản mới</button>'
                : ''
            }
          </div>
        </div>
        <div id="fxc-progress" style="display:none;margin-top:10px">
          <div class="fx-cloud-muted" id="fxc-progress-label">Đang lưu…</div>
          <div class="fx-cloud-bar"><div id="fxc-progress-bar" style="width:0%"></div></div>
        </div>
        <div id="fxc-error" style="margin-top:10px"></div>
      </div>

      <div>
        <div class="fx-cloud-row" style="margin-bottom:8px">
          <strong style="font-size:13.5px">Dự án của bạn trên Cloud (${projects.length})</strong>
        </div>
        <div class="fx-cloud-list">${listHtml}</div>
      </div>
    `;

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

      try {
        const cur = host.getActiveProject();
        const thumb = await host.captureThumbnail().catch(() => null);
        const saved = await cloudApi.saveProject(cur.project, cur.assets, {
          cloudId: asNew ? undefined : cur.cloudId,
          thumbnail: thumb,
          onProgress: (label, r) => {
            progLabel.textContent = label;
            progBar.style.width = `${Math.round(r * 100)}%`;
          },
        });
        host.setActiveCloudId(saved.id);
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
        btn.disabled = true;
        btn.textContent = 'Đang tải…';
        try {
          const detail = await cloudApi.getProject(id);
          const downloaded = await cloudApi.downloadAssets(detail.assets);
          host.openProjectInTab(detail.project, downloaded, detail.meta.id);
          close();
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Không mở được dự án');
          btn.disabled = false;
          btn.textContent = 'Mở';
        }
      });
    });

    body.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.share!;
        const isEnabled = btn.dataset.enabled === '1';
        try {
          if (isEnabled) {
            const proj = projects.find((x) => x.id === id);
            const url = proj?.shareToken ? `${location.origin}/share/${proj.shareToken}` : '';
            const turnOff = !confirm(
              `Link chia sẻ hiện tại:\n${url}\n\nBấm OK để sao chép link, hoặc Cancel để TẮT chia sẻ.`,
            );
            if (turnOff) {
              await cloudApi.toggleShare(id, false);
              await renderLibrary(user);
            } else if (url) {
              await navigator.clipboard.writeText(url).catch(() => {});
              btn.textContent = 'Đã copy!';
              setTimeout(() => {
                btn.textContent = 'Copy / Tắt share';
              }, 1500);
            }
          } else {
            const res = await cloudApi.toggleShare(id, true);
            if (res.shareUrl) {
              await navigator.clipboard.writeText(res.shareUrl).catch(() => {});
              alert(`Đã bật chia sẻ chỉ xem & sao chép link:\n${res.shareUrl}`);
            }
            await renderLibrary(user);
          }
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Lỗi cập nhật chia sẻ');
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
          await renderLibrary(user);
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Xóa thất bại');
        }
      });
    });
  };

  try {
    const me = await cloudApi.me();
    host.onUserChange?.(me.user);
    if (me.user) {
      await renderLibrary(me.user);
    } else {
      renderLogin('', me.setupRequired);
    }
  } catch {
    renderLogin('Không kết nối được máy chủ Cloudflare Worker (/api/auth/me)');
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

export async function loadSharedProjectIntoStudio(token: string, host: CloudHost): Promise<void> {
  injectStyles();
  const detail = await cloudApi.getShared(token);
  const downloaded = await cloudApi.downloadAssets(detail.assets);
  host.openProjectInTab(detail.project, downloaded);

  document.querySelector('.fx-share-banner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'fx-share-banner';
  banner.innerHTML = `
    <span>Bản chia sẻ chỉ xem: <strong>${esc(detail.meta.name)}</strong> · bởi ${esc(detail.meta.ownerName)}</span>
    <button type="button" class="fx-cloud-btn" id="fx-share-dismiss">Đóng thông báo</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('#fx-share-dismiss')?.addEventListener('click', () => {
    banner.remove();
    const url = new URL(location.href);
    url.searchParams.delete('share');
    history.replaceState(null, '', url.toString());
  });
}
