
// Screen-mirror capturer singleton (R13/R14). The iframe ref is resolved
// lazily because the element is created per connection.
const screenMirror = new ScreenMirror(() => {
  const c = document.getElementById('kasmvnc-container');
  return (c?.querySelector('iframe') as HTMLIFrameElement | null) ?? null;
});
/**
 * Overlay Companion MCP - Main Application
 *
 * Comprehensive web UI for AI-powered screen overlay system with:
 * - Secure credential management in browser storage
 * - KasmVNC integration with multi-monitor support
 * - Connection management and testing
 * - Real-time status monitoring
 * - MCP server integration
 */

import type { CurrentUser } from './auth';
import { ChatPanel } from './components/ChatPanel';
import { ScreenMirror, type MirrorCadence } from './components/ScreenMirror';
import { initTheme, setTheme, resolveTheme, getStoredTheme, type ThemeChoice } from './theme';
import {
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection as apiDeleteConnection,
  touchConnection,
  storePassword,
  withPassword,
  type Connection,
} from './connections';

export type { Connection };

// Per-view URL routes (Ryan's preference §5): each page is addressable via a
// hash route so it can be deep-linked and survives back/forward navigation.
const APP_ROUTES = ['home', 'connections', 'settings', 'vm-view'] as const;

type SettingsFormsRenderer = (container: HTMLElement, user: CurrentUser) => Promise<void>;

interface OverlayCommand {
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  opacity?: number;
  label?: string;
}

// Overlay shape as broadcast by the MCP server via the management WS relay.
interface RemoteOverlay {
  id: string | number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  color?: string;
  opacity?: number;
  template?: string | null;
}

/** Accepts either a flat or C#-style bounds-nested overlay description. */
function overlayGeometry(o: RemoteOverlay): { x: number; y: number; width: number; height: number } {
  const b = o.bounds;
  return b
    ? { x: Number(b.x) || 0, y: Number(b.y) || 0, width: Number(b.width) || 0, height: Number(b.height) || 0 }
    : { x: Number(o.x) || 0, y: Number(o.y) || 0, width: Number(o.width) || 0, height: Number(o.height) || 0 };
}

// Logical display size overlays are authored against (matches the VM's
// resolution; get_display_info reports the same values).
const OVERLAY_DISPLAY = { width: 1920, height: 1080 };

interface ToastType {
  success: string;
  error: string;
  warning: string;
  info: string;
}

class OverlayCompanionApp {
  private currentPage: string = 'home';
  private connections: Map<string, Connection> = new Map();
  private currentConnection: Connection | null = null;
  private websocket: WebSocket | null = null;
  private statusInterval: number | null = null;
  // Auth: populated at init from /auth/me. Null when auth is disabled or
  // before the gate resolves.
  private currentUser: CurrentUser | null = null;
  private _renderSettingsForms: SettingsFormsRenderer | null = null;
  private editingConnectionId: string | null = null;
  private chatPanel: ChatPanel | null = null;
  private mcpConfigLoaded = false;

  constructor() {
    // Apply the persisted theme (auto/light/dark) and wire the toggle.
    initTheme();
    this.setupThemeToggle();
    // Initialize the application
    this.init();
  }

  // Theme: auto-follow the OS/browser by default, with a manual light/dark
  // toggle. The user's choice persists (localStorage); the button cycles
  // auto -> light -> dark (Ryan's preferences §4 Themes).
  private setupThemeToggle(): void {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    const refreshIcon = (): void => {
      const choice = getStoredTheme();
      const effective = resolveTheme(choice);
      if (!icon) return;
      icon.className = effective === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
      btn.setAttribute('aria-label', `Theme: ${choice} (${effective}). Toggle light / dark.`);
      btn.title = `Theme: ${choice}. Click to change.`;
    };
    btn.addEventListener('click', () => {
      const cycle: Record<ThemeChoice, ThemeChoice> = { auto: 'light', light: 'dark', dark: 'auto' };
      setTheme(cycle[getStoredTheme()]);
      refreshIcon();
    });
    // Keep the icon in sync if the OS theme changes while on "auto".
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshIcon);
    refreshIcon();
  }

  // Show the account actions (user + Sign out) in the header once a session is
  // established, and wire the GUI logout button to sign out + reload past the
  // auth gate. When logged out the whole #app is replaced by the login view, so
  // this element is only ever present while authenticated.
  private setupAccountActions(user: CurrentUser): void {
    const box = document.getElementById('account-actions');
    if (!box) return;
    box.style.display = 'flex';
    const nameEl = document.getElementById('account-user');
    if (nameEl) nameEl.textContent = user.email || user.username;
    const btn = document.getElementById('logout-btn') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
      const { logout } = await import('./auth');
      await logout();
      window.location.reload();
    });
  }

  async init(): Promise<void> {
    console.log('🚀 Initializing Overlay Companion MCP');

    try {
      // Auth gate: if the server requires a session and we have none,
      // show the login view instead of the app. When auth is disabled
      // (dev), /auth/me returns the dev user and we proceed.
      const { getCurrentUser, getAuthStatus } = await import('./auth');
      const { showLoginView, renderSettingsForms } = await import('./auth-ui');
      this._renderSettingsForms = renderSettingsForms;
      const user = await getCurrentUser();
      if (!user) {
        const status = await getAuthStatus();
        if (status.enabled) {
          const loading = document.getElementById('loading');
          if (loading) loading.style.display = 'none';
          showLoginView(document.getElementById('app') ?? document.body, () => window.location.reload());
          return;
        }
      } else {
        this.currentUser = user;
        this.setupAccountActions(user);
      }

      // Load stored connections
      await this.loadConnections();

      // Setup event listeners
      this.setupEventListeners();

      // Hash routing: honour any deep link and keep back/forward working.
      this.setupRouting();
      this.navigateToPage(OverlayCompanionApp.routeToPage(window.location.hash));

      // Initialize status monitoring
      this.startStatusMonitoring();

      // Open the overlay WebSocket at app init (not only after connecting to a
      // VM) so the System Status "WebSocket" indicator reflects a real
      // connection.
      this.setupOverlayWebSocket();

      // Load MCP configuration
      await this.loadMCPConfig();

      console.log('✅ Application initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      this.showToast('error', 'Initialization Error', error instanceof Error ? error.message : String(error));
    }
  }

  // ==================== Navigation ====================

  setupEventListeners(): void {
    // In-app assistant (B1): toggles the chat panel, a second client to the
    // same MCP tools.
    const chatToggle = document.getElementById('chat-toggle-btn');
    if (chatToggle) {
      chatToggle.addEventListener('click', () => {
        const host = document.getElementById('chat-panel-host');
        if (!host) return;
        if (!this.chatPanel) this.chatPanel = new ChatPanel(host);
        this.chatPanel.toggle();
        chatToggle.classList.toggle('active', this.chatPanel.isOpen());
      });
    }

    // Navigation (nav buttons + any other button carrying a data-page target,
    // e.g. the hero "New Connection" button).
    document.querySelectorAll<HTMLElement>('.nav-btn, button[data-page]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = (e.currentTarget as HTMLElement).dataset.page;
        if (page) this.navigateToPage(page);
      });
    });

    // Quick connect button
    const quickConnectBtn = document.getElementById('quick-connect-btn');
    if (quickConnectBtn) {
      quickConnectBtn.addEventListener('click', () => this.handleQuickConnect());
    }

    // Add connection buttons
    document.querySelectorAll<HTMLElement>('#add-connection-btn, #add-first-connection-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showConnectionModal());
    });

    // Modal close
    const modalClose = document.querySelector('.modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', () => this.hideConnectionModal());
    }

    // Modal background click
    const modal = document.getElementById('connection-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.hideConnectionModal();
      });
    }

    // Connection form
    const connectionForm = document.getElementById('connection-form');
    if (connectionForm) {
      connectionForm.addEventListener('submit', (e) => this.handleConnectionSubmit(e));
    }

    // Test connection button
    const testBtn = document.getElementById('test-connection-btn');
    if (testBtn) {
      testBtn.addEventListener('click', () => this.testConnection());
    }

    // Password toggle
    const passwordToggle = document.getElementById('toggle-password');
    if (passwordToggle) {
      passwordToggle.addEventListener('click', () => this.togglePasswordVisibility());
    }

    // Settings
    const clearDataBtn = document.getElementById('clear-stored-data');
    if (clearDataBtn) {
      clearDataBtn.addEventListener('click', () => this.clearStoredData());
    }

    // Copy MCP config
    const copyConfigBtn = document.getElementById('copy-config-btn');
    if (copyConfigBtn) {
      copyConfigBtn.addEventListener('click', () => this.copyMCPConfig());
    }

    // VM navigation
    const backBtn = document.getElementById('back-to-connections');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.navigateToPage('connections'));
    }

    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => this.disconnectFromVM());
    }

    // Fullscreen toggle
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }
  }

  navigateToPage(page: string, updateHash: boolean = true): void {
    const target = OverlayCompanionApp.pageToRoute(page);

    // Update navigation
    document.querySelectorAll<HTMLElement>('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === target);
    });

    // Update pages
    document.querySelectorAll<HTMLElement>('.page').forEach(pageEl => {
      pageEl.classList.toggle('active', pageEl.id === `${target}-page`);
    });

    this.currentPage = target;

    // Keep the URL in sync so each view is deep-linkable and back/forward
    // works. Setting location.hash fires a hashchange; the handler below is a
    // no-op when the route already matches currentPage.
    const desired = `#/${target}`;
    if (updateHash && window.location.hash !== desired) {
      window.location.hash = desired;
    }

    // Page-specific initialization
    if (target === 'connections') {
      this.renderConnections();
    } else if (target === 'home') {
      this.renderRecentConnections();
    } else if (target === 'settings') {
      // Render the GUI-first settings forms (auth/connection/wazuh) into
      // the existing Settings page, appended to the MCP config section.
      this.renderSettingsPage();
    }
  }

  // Canonicalize a page name to a known route (fall back to "home").
  private static pageToRoute(page: string): string {
    return (APP_ROUTES as readonly string[]).includes(page) ? page : 'home';
  }

  // Parse "location.hash" (e.g. "#/connections", "#settings", "") into a route
  // name, defaulting to "home".
  private static routeToPage(hash: string): string {
    const route = hash.replace(/^#\/?/, '').split(/[/?#]/)[0].toLowerCase();
    return OverlayCompanionApp.pageToRoute(route);
  }

  private setupRouting(): void {
    window.addEventListener('hashchange', () => {
      const route = OverlayCompanionApp.routeToPage(window.location.hash);
      if (route !== this.currentPage) {
        this.navigateToPage(route);
      }
    });
  }

  async renderSettingsPage(): Promise<void> {
    if (!this._renderSettingsForms || !this.currentUser) return;
    const page = document.getElementById('settings-page');
    if (!page) return;
    // Avoid double-render on re-entry.
    let host = document.getElementById('auth-settings-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'auth-settings-host';
      page.querySelector('.settings-container')?.prepend(host);
    }
    try {
      await this._renderSettingsForms(host, this.currentUser);
    } catch (err) {
      console.error('Settings render failed:', err);
    }
    if (this.currentUser?.roles?.includes('admin')) void this.loadRateLimits();
    void this.loadAssistantPrefs();
  }

  private async loadAssistantPrefs(): Promise<void> {
    const section = document.getElementById('assistant-prefs-section');
    const toggle = document.getElementById('pref-enforce-preview') as HTMLInputElement | null;
    const maxText = document.getElementById('pref-max-text') as HTMLInputElement | null;
    const maxNonText = document.getElementById('pref-max-nontext') as HTMLInputElement | null;
    if (!section || !toggle) return;
    section.style.display = '';
    // Keep in sync with MARKING_LIMIT_MIN/MAX/DEFAULTS in infra/server/src/chat.ts —
    // no shared module exists between web and server packages.
    const PREF_LIMIT_MIN = 0, PREF_LIMIT_MAX = 8, PREF_LIMIT_DEFAULT = 2;
    try {
      const res = await fetch('/api/me/preferences', { credentials: 'include' });
      if (!res.ok) { section.style.display = 'none'; return; }
      const data = (await res.json()) as { enforcePreview: boolean; maxTextMarkings?: number; maxNonTextMarkings?: number };
      toggle.checked = data.enforcePreview;
      if (maxText) maxText.value = String(data.maxTextMarkings ?? PREF_LIMIT_DEFAULT);
      if (maxNonText) maxNonText.value = String(data.maxNonTextMarkings ?? PREF_LIMIT_DEFAULT);
    } catch {
      section.style.display = 'none';
      return;
    }
    const savePrefs = async (patch: Record<string, unknown>): Promise<void> => {
      const res = await fetch('/api/me/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      this.showToast(res.ok ? 'success' : 'error', 'Preferences', res.ok ? 'Saved.' : `Save failed (${res.status}).`);
    };
    toggle.onchange = async () => { await savePrefs({ enforcePreview: toggle.checked }); };
    const clampLimit = (el: HTMLInputElement): number | null => {
      const raw = el.value.trim();
      // Number('') === 0: an emptied field must NOT silently save a 0 cap.
      if (raw === '' || !Number.isFinite(Math.round(Number(raw)))) {
        this.showToast('error', 'Preferences', 'Marking limits must be a whole number 0–8.');
        return null;
      }
      const n = Math.round(Number(raw));
      if (n < PREF_LIMIT_MIN || n > PREF_LIMIT_MAX) { this.showToast('error', 'Preferences', 'Marking limits must be 0–8.'); return null; }
      return n;
    };
    if (maxText) maxText.onchange = async () => { const n = clampLimit(maxText); if (n !== null) await savePrefs({ maxTextMarkings: n }); };
    if (maxNonText) maxNonText.onchange = async () => { const n = clampLimit(maxNonText); if (n !== null) await savePrefs({ maxNonTextMarkings: n }); };
  }

  private async loadRateLimits(): Promise<void> {
    const section = document.getElementById('limits-section');
    const host = document.getElementById('limits-content');
    if (!section || !host) return;
    section.style.display = '';
    let data: { surfaces: Record<string, { pointsPerWindow: number; windowMs: number; blockDurationMs: number; configured: boolean }>; bypassAdmin: boolean };
    try {
      const res = await fetch('/api/admin/limits', { credentials: 'include' });
      if (!res.ok) { host.innerHTML = '<em>Not available.</em>'; return; }
      data = (await res.json()) as typeof data;
    } catch {
      host.innerHTML = '<em>Failed to load rate limits.</em>';
      return;
    }
    const rows = Object.entries(data.surfaces).map(([surf, v]) => `
      <form class="config-card limit-form" data-surface="${this.escapeHtml(surf)}">
        <h4>${this.escapeHtml(surf)} ${v.configured ? '' : '<small>(defaults)</small>'}</h4>
        <label>Requests per window <input type="number" min="1" name="pointsPerWindow" value="${v.pointsPerWindow}" /></label>
        <label>Window ms <input type="number" min="1000" step="1000" name="windowMs" value="${v.windowMs}" /></label>
        <label>Cool-down ms <input type="number" min="0" step="500" name="blockDurationMs" value="${v.blockDurationMs}" /></label>
        <button type="submit" class="btn btn-primary">Save</button>
      </form>`).join('');
    host.innerHTML = rows + `
      <label style="display:block;margin-top:.5rem">
        <input type="checkbox" id="limits-bypass-admin" ${data.bypassAdmin ? 'checked' : ''} />
        Admins bypass chat/connection throttling
      </label>`;
    host.querySelectorAll<HTMLFormElement>('form.limit-form').forEach((f) => {
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const surf = f.dataset.surface!;
        const fd = new FormData(f);
        const body = {
          pointsPerWindow: Number(fd.get('pointsPerWindow')),
          windowMs: Number(fd.get('windowMs')),
          blockDurationMs: Number(fd.get('blockDurationMs')),
        };
        const res = await fetch(`/api/settings/limits/${surf}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        this.showToast(res.ok ? 'success' : 'error', 'Rate Limits', res.ok ? `${surf} updated — applies within ~5s.` : `Update failed (${res.status}).`);
      });
    });
    const ba = host.querySelector<HTMLInputElement>('#limits-bypass-admin');
    ba?.addEventListener('change', async () => {
      // store on the chat surface row to persist
      const res = await fetch('/api/settings/limits/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ bypassAdmin: ba.checked }),
      });
      this.showToast(res.ok ? 'success' : 'error', 'Rate Limits', res.ok ? 'Preference saved.' : `Save failed (${res.status}).`);
    });
  }

  // ==================== Connection Management ====================

  async loadConnections(): Promise<void> {
    try {
      const connections = await listConnections();
      this.connections = new Map(connections.map((conn) => [conn.id, conn]));
    } catch (error) {
      console.error('Failed to load connections:', error);
      this.showToast('error', 'Load Error', 'Failed to load connections from the server.');
    }
  }

  showConnectionModal(connection: Connection | null = null): void {
    const modal = document.getElementById('connection-modal');
    const form = document.getElementById('connection-form') as HTMLFormElement | null;
    const title = document.getElementById('modal-title');
    if (!title) return;

    this.editingConnectionId = connection ? connection.id : null;
    if (connection) {
      title.textContent = 'Edit Computer';
      this.populateConnectionForm(connection);
    } else {
      title.textContent = 'Add a Computer';
      form?.reset();
      const portInput = document.getElementById('connection-port') as HTMLInputElement | null;
      if (portInput) portInput.value = '6901';
    }

    modal?.classList.add('active');
  }

  hideConnectionModal(): void {
    const modal = document.getElementById('connection-modal');
    modal?.classList.remove('active');
    this.editingConnectionId = null;
  }

  populateConnectionForm(connection: Connection): void {
    (document.getElementById('connection-name') as HTMLInputElement).value = connection.name;
    (document.getElementById('connection-host') as HTMLInputElement).value = connection.host;
    (document.getElementById('connection-port') as HTMLInputElement).value = String(connection.port);
    (document.getElementById('connection-protocol') as HTMLInputElement).value = connection.protocol;
    (document.getElementById('connection-username') as HTMLInputElement).value = connection.username ?? '';
    (document.getElementById('connection-password') as HTMLInputElement).value = connection.password ?? '';
    (document.getElementById('connection-ssl') as HTMLInputElement).checked = connection.ssl;
    (document.getElementById('connection-description') as HTMLInputElement).value = connection.description ?? '';
  }

  async handleConnectionSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const formData = new FormData(e.target as HTMLFormElement);
    const payload = {
      name: String(formData.get('name') ?? ''),
      host: String(formData.get('host') ?? ''),
      port: parseInt(String(formData.get('port') ?? '0'), 10),
      protocol: String(formData.get('protocol') ?? ''),
      username: formData.get('username') ? String(formData.get('username')) : null,
      password: formData.get('password') ? String(formData.get('password')) : undefined,
      ssl: formData.has('ssl'),
      description: formData.get('description') ? String(formData.get('description')) : null,
    };

    try {
      let saved: Connection;
      if (this.editingConnectionId) {
        saved = await updateConnection(this.editingConnectionId, payload);
      } else {
        saved = await createConnection(payload);
      }
      // Keep the plaintext password only transiently in sessionStorage for the
      // live VM handshake; the server persists only an Argon2id hash.
      if (payload.password) storePassword(saved.id, payload.password);
      this.connections.set(saved.id, saved);
      this.hideConnectionModal();
      this.renderConnections();
      this.showToast('success', 'Computer Saved', `"${saved.name}" has been added.`);
    } catch (error) {
      console.error('Failed to save connection:', error);
      this.showToast('error', 'Save Error', error instanceof Error ? error.message : 'Failed to save connection');
    }
  }

  async testConnection(): Promise<void> {
    const form = document.getElementById('connection-form') as HTMLFormElement;
    const formData = new FormData(form);
    const testBtn = document.getElementById('test-connection-btn') as HTMLButtonElement;

    const connection = {
      host: String(formData.get('host') ?? ''),
      port: parseInt(String(formData.get('port') ?? '0'), 10),
      protocol: String(formData.get('protocol') ?? ''),
      ssl: formData.has('ssl')
    };

    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

    try {
      // Simple connectivity test via the server (SSRF-protected).
      const response = await fetch(`/api/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connection)
      });

      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; errors?: string[]; message?: string }
        | null;

      if (response.ok && result?.success) {
        this.showToast('success', 'Connection Test', 'Connection test successful!');
        return;
      }

      // Surface the server's actual reason instead of a generic message.
      const reason =
        result?.error ??
        (result?.errors && result.errors.length > 0 ? result.errors.join('; ') : undefined) ??
        (response.status === 429 ? 'Too many tests — wait a minute and retry.' : undefined) ??
        `HTTP ${response.status}`;
      this.showToast('error', 'Connection Test Failed', reason);
    } catch (error) {
      console.error('Connection test failed:', error);
      const msg = error instanceof TypeError && /fetch|network/i.test(error.message)
        ? 'Network error — the server could not be reached.'
        : (error instanceof Error ? error.message : String(error));
      this.showToast('error', 'Connection Test Failed', msg);
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
    }
  }

  renderConnections(): void {
    const container = document.getElementById('connections-list');
    if (!container) return;

    if (this.connections.size === 0) {
      container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-desktop"></i>
                    <p>No computers added yet. Add one to start viewing and controlling it from here.</p>
                    <button class="btn btn-primary" id="add-first-connection-btn">
                        <i class="fas fa-plus"></i> Add Your First Computer
                    </button>
                </div>
            `;

      // Re-attach event listener
      const addBtn = document.getElementById('add-first-connection-btn');
      if (addBtn) {
        addBtn.addEventListener('click', () => this.showConnectionModal());
      }
      return;
    }

    const connectionsHTML = Array.from(this.connections.values()).map(conn => `
            <div class="connection-card" data-connection-id="${conn.id}">
                <div class="connection-header">
                    <div class="connection-name">${this.escapeHtml(conn.name)}</div>
                    <div class="connection-status offline">Offline</div>
                </div>
                <div class="connection-info">
                    <div><i class="fas fa-server"></i> ${this.escapeHtml(conn.host)}:${conn.port}</div>
                    <div><i class="fas fa-network-wired"></i> ${conn.protocol.toUpperCase()}${conn.ssl ? ' (SSL)' : ''}</div>
                    ${conn.description ? `<div><i class="fas fa-info-circle"></i> ${this.escapeHtml(conn.description)}</div>` : ''}
                </div>
                <div class="connection-actions">
                    <button class="btn btn-primary" onclick="app.connectToVM('${conn.id}')">
                        <i class="fas fa-play"></i> Connect
                    </button>
                    <button class="btn btn-secondary" onclick="app.editConnection('${conn.id}')">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-danger" onclick="app.deleteConnection('${conn.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `).join('');

    container.innerHTML = connectionsHTML;
  }

  renderRecentConnections(): void {
    const container = document.getElementById('recent-connections-list');
    if (!container) return;

    const recentConnections = Array.from(this.connections.values())
      .filter(conn => conn.lastConnected)
      .sort((a, b) => new Date(b.lastConnected as string).getTime() - new Date(a.lastConnected as string).getTime())
      .slice(0, 3);

    if (recentConnections.length === 0) {
      container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-desktop"></i>
                    <p>Nothing here yet. A "computer" is one you can reach from here — add yours to get started.</p>
                    <button class="btn btn-primary" data-page="connections">Add Your First Computer</button>
                </div>
            `;

      // Re-attach event listener
      const addBtn = container.querySelector('[data-page="connections"]');
      if (addBtn) {
        addBtn.addEventListener('click', () => this.navigateToPage('connections'));
      }
      return;
    }

    const connectionsHTML = recentConnections.map(conn => `
            <div class="connection-card" onclick="app.connectToVM('${conn.id}')">
                <div class="connection-header">
                    <div class="connection-name">${this.escapeHtml(conn.name)}</div>
                    <div class="connection-status offline">Offline</div>
                </div>
                <div class="connection-info">
                    <div><i class="fas fa-server"></i> ${this.escapeHtml(conn.host)}:${conn.port}</div>
                    <div><i class="fas fa-clock"></i> Last connected: ${this.formatDate(conn.lastConnected as string)}</div>
                </div>
            </div>
        `).join('');

    container.innerHTML = connectionsHTML;
  }

  editConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.showConnectionModal(withPassword(connection));
    }
  }

  async deleteConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    if (confirm(`Are you sure you want to delete the connection "${connection.name}"?`)) {
      try {
        await apiDeleteConnection(connectionId);
        this.connections.delete(connectionId);
        this.renderConnections();
        this.renderRecentConnections();
        this.showToast('info', 'Computer Removed', `"${connection.name}" has been deleted.`);
      } catch (error) {
        console.error('Failed to delete connection:', error);
        this.showToast('error', 'Delete Error', error instanceof Error ? error.message : 'Failed to delete connection');
      }
    }
  }

  // ==================== VM Connection ====================

  async connectToVM(connectionId: string): Promise<void> {
    const base = this.connections.get(connectionId);
    if (!base) {
      this.showToast('error', 'Connection Error', 'Connection not found');
      return;
    }
    // Merge any transient plaintext password (sessionStorage) for the live
    // VM handshake; the server never returns the plaintext.
    const connection = withPassword(base);

    this.currentConnection = connection;
    this.navigateToPage('vm-view');

    // Update connection info in VM view
    const vmNameEl = document.getElementById('current-vm-name');
    if (vmNameEl) vmNameEl.textContent = connection.name;
    const vmStatus = document.getElementById('current-vm-status');
    if (vmStatus) {
      vmStatus.textContent = 'Connecting...';
      vmStatus.className = 'status-badge connecting';
    }

    try {
      await this.initializeKasmVNC(connection);

      // Record the successful connect server-side (authoritative timestamp).
      try {
        await touchConnection(connectionId);
      } catch (err) {
        console.warn('Failed to record last_connected:', err);
      }
      const refreshed = await listConnections();
      this.connections = new Map(refreshed.map((c) => [c.id, c]));
      const latest = this.connections.get(connectionId);
      if (latest) {
        this.currentConnection = withPassword(latest);
        if (latest.lastConnected) {
          this.currentConnection.lastConnected = latest.lastConnected;
        }
      }

      if (vmStatus) {
        vmStatus.textContent = 'Connected';
        vmStatus.className = 'status-badge connected';
      }

      this.showToast('success', 'Connected', `Successfully connected to ${connection.name}`);
    } catch (error) {
      console.error('Failed to connect to VM:', error);
      if (vmStatus) {
        vmStatus.textContent = 'Connection Failed';
        vmStatus.className = 'status-badge error';
      }
      this.showToast('error', 'Connection Failed', error instanceof Error ? error.message : String(error));
    }
  }

  async initializeKasmVNC(connection: Connection): Promise<void> {
    const container = document.getElementById('kasmvnc-container');
    if (!container) throw new Error('KasmVNC container not found');

    const protocol = connection.ssl ? 'https' : 'http';

    let url: string;
    if (connection.protocol === 'kasmvnc') {
      // Proxied under the main server; `connection.host` is the operator's
      // KasmVNC target id (from KASMVNC_ALLOWLIST_JSON), never a raw address.
      // Trailing slash is required so the browser resolves KasmVNC's relative
      // sub-resource URLs (dist/*.js, vendor/*.js, style.bundle.css, etc.)
      // under /vnc/<id>/ and not one directory up — missing it makes every
      // asset 404 and the desktop render as an unstyled black page.
      // Screen sizing (docs/REQUIREMENTS.md R7):
      //  'scale'  – guest res unchanged; framebuffer scales to fill available space (default)
      //  'remote' – ask KasmVNC to change guest resolution to track the window
      //  'off'    – native size, letterboxed (legacy behaviour)
      const settings = (connection as unknown as { settings?: { screenSizing?: 'scale' | 'remote' | 'off' } }).settings;
      const mode = settings?.screenSizing ?? 'scale';
      const sizing = mode === 'scale' ? '&resize=scale' : mode === 'remote' ? '&resize=remote' : '';
      url = `/vnc/${encodeURIComponent(connection.host)}/?autoconnect=1${sizing}`;
    } else {
      // For standard VNC, we'll need to proxy through our server
      url = `/vnc-proxy?host=${encodeURIComponent(connection.host)}&port=${connection.port}&protocol=${connection.protocol}`;
    }

    // Create iframe for KasmVNC
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';

    container.innerHTML = '';
    container.appendChild(iframe);
    // Stamp guest resolution for the mirror capturer once the client reports it
    iframe.addEventListener('load', () => {
      setTimeout(() => { void this.refreshDisplayMeta(); }, 2500);
    });

    // Initialize overlay system
    this.initializeOverlaySystem();
    // Start mirror at last-used cadence (default: input-driven).
    const saved = localStorage.getItem('oc.mirrorCadence') as MirrorCadence | null;
    screenMirror.setCadence(saved ?? 'input');
  }


  private async refreshDisplayMeta(): Promise<void> {
    try {
      const res = await fetch('/api/display-state', { credentials: 'include' });
      if (!res.ok) return;
      const d = (await res.json()) as { width?: number; height?: number };
      const iframe = document.querySelector('#kasmvnc-container iframe') as HTMLIFrameElement | null;
      if (iframe && d.width && d.height) {
        iframe.dataset.ocDisplayWidth = String(d.width);
        iframe.dataset.ocDisplayHeight = String(d.height);
      }
    } catch { /* non-fatal */ }
  }

  initializeOverlaySystem(): void {
    const overlayContainer = document.getElementById('overlay-canvas-container');
    if (!overlayContainer) return;

    // Create overlay canvas
    const canvas = document.createElement('canvas');
    canvas.id = 'overlay-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '10';

    overlayContainer.innerHTML = '';
    overlayContainer.appendChild(canvas);
    window.addEventListener('resize', () => this.renderRemoteOverlays());
    // Docking/resizing changes container size without a window resize event.
    const w = window as unknown as { ocResizeObserver?: ResizeObserver };
    w.ocResizeObserver?.disconnect();
    w.ocResizeObserver = new ResizeObserver(() => this.renderRemoteOverlays());
    w.ocResizeObserver.observe(canvas.parentElement ?? canvas);

    // Setup WebSocket for overlay commands
    this.setupOverlayWebSocket();
  }

  setupOverlayWebSocket(): void {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // The management server's WebSocketServer is mounted on `/ws` (not
    // `/ws/overlays`); align the client so the System Status overlay WebSocket
    // actually connects.
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    try {
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('✅ Overlay WebSocket connected');
        this.updateStatusIndicator('websocket-status', 'websocket-status-text', true, 'Connected');
      };

      this.websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type: string; payload?: Record<string, unknown> };
          if (data.type === 'overlay_broadcast' && data.payload) {
            this.handleRemoteOverlay(data.payload);
          }
          // Model-driven mirror control (R14): the assistant tunes its own
          // view cadence via the set_screen_updates tool.
          if (data.type === 'mirror_control' && data.payload) {
            const pl = data.payload as { cadenceMs?: number | 'input' | 'off'; triggerNow?: boolean; previewSpec?: { x: number; y: number; width: number; height: number; color?: string } };
            if (pl.triggerNow) {
              void screenMirror.captureNow();
              return;
            }
            // Phase 3: server asks the page to ghost-render a candidate spec.
            if (pl.previewSpec && typeof pl.previewSpec === 'object') {
              void screenMirror.composePreview(pl.previewSpec as { x: number; y: number; width: number; height: number; color?: string });
              return;
            }
            if (typeof pl.cadenceMs !== 'undefined') {
              screenMirror.setCadence(pl.cadenceMs);
              localStorage.setItem('oc.mirrorCadence', String(pl.cadenceMs));
            }
          }
        } catch (error) {
          console.error('Failed to parse overlay message:', error);
        }
      };

      this.websocket.onclose = () => {
        console.log('🔌 Overlay WebSocket disconnected');
        this.updateStatusIndicator('websocket-status', 'websocket-status-text', false, 'Disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(() => this.setupOverlayWebSocket(), 3000);
      };

      this.websocket.onerror = (error) => {
        console.error('❌ Overlay WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to setup overlay WebSocket:', error);
    }
  }

  // Current overlay set; redrawn on every change AND on window resize so
  // annotations stay pinned to desktop coordinates while elements move.
  private remoteOverlays: RemoteOverlay[] = [];

  handleRemoteOverlay(payload: Record<string, unknown>): void {
    const action = String(payload.action ?? '');
    switch (action) {
      case 'create':
        if (payload.overlay) this.remoteOverlays.push(payload.overlay as unknown as RemoteOverlay);
        break;
      case 'remove':
        this.remoteOverlays = this.remoteOverlays.filter((o) => String(o.id) !== String(payload.id));
        break;
      case 'clear':
        this.remoteOverlays = [];
        break;
      case 'state':
        this.remoteOverlays = (payload.overlays as unknown as RemoteOverlay[]) ?? [];
        break;
      default:
        return;
    }
    this.renderRemoteOverlays();
  }

  renderRemoteOverlays(): void {
    const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size backing store to actual element pixels for crisp scaling.
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Authoritative guest resolution comes from screen-mirror captures
    // (__ocDisplay, the real framebuffer size); fall back to the historical
    // constant before the first frame exists.
    const disp = (window as unknown as { __ocDisplay?: { width: number; height: number } }).__ocDisplay
      ?? OVERLAY_DISPLAY;
    const sx = canvas.width / disp.width;
    const sy = canvas.height / disp.height;

    for (const o of this.remoteOverlays) {
      ctx.save();
      ctx.fillStyle = o.color ?? '#ffff00';
      ctx.globalAlpha = o.opacity ?? 0.5;
      const g = overlayGeometry(o);
      const isCircle = o.template === 'circle' ||
        Math.abs(g.width - g.height) < Math.max(g.width, g.height) * 0.05 && g.width > 0;
      const w = g.width * sx;
      const h = g.height * sy;
      const x = g.x * sx;
      const y = g.y * sy;
      if (isCircle) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.08);
        ctx.strokeStyle = o.color ?? '#ffff00';
        ctx.stroke();
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D, command: OverlayCommand): void {
    ctx.save();

    // Set overlay properties
    ctx.fillStyle = command.color ?? '#ff0000';
    ctx.globalAlpha = command.opacity ?? 0.5;

    // Draw overlay rectangle
    ctx.fillRect(command.x ?? 0, command.y ?? 0, command.width ?? 0, command.height ?? 0);

    // Draw label if provided
    if (command.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(
        command.label,
        (command.x ?? 0) + (command.width ?? 0) / 2,
        (command.y ?? 0) + (command.height ?? 0) / 2
      );
    }

    ctx.restore();
  }

  disconnectFromVM(): void {
    // The overlay WebSocket is a persistent app-level connection now (opened at
    // init); do not tear it down when leaving a VM — only clear the remote
    // desktop surface and navigate back.

    screenMirror.setCadence('off');
    // Clear KasmVNC container
    const container = document.getElementById('kasmvnc-container');
    if (container) {
      container.innerHTML = '';
    }

    // Clear overlay container
    const overlayContainer = document.getElementById('overlay-canvas-container');
    if (overlayContainer) {
      overlayContainer.innerHTML = '';
    }

    this.currentConnection = null;
    this.navigateToPage('connections');

    this.showToast('info', 'Disconnected', 'Disconnected from VM');
  }

  toggleFullscreen(): void {
    const vmContent = document.querySelector('.vm-content');
    if (!vmContent) return;

    if (!document.fullscreenElement) {
      vmContent.requestFullscreen().catch(err => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  // ==================== Quick Connect ====================

  handleQuickConnect(): void {
    // Find the most recently connected connection
    const recentConnection = Array.from(this.connections.values())
      .filter(conn => conn.lastConnected)
      .sort((a, b) => new Date(b.lastConnected as string).getTime() - new Date(a.lastConnected as string).getTime())[0];

    if (recentConnection) {
      this.connectToVM(recentConnection.id);
    } else {
      this.navigateToPage('connections');
      this.showToast('info', 'No Recent Connections', 'Please add a connection first');
    }
  }

  // ==================== Status Monitoring ====================

  startStatusMonitoring(): void {
    this.updateSystemStatus();
    this.statusInterval = setInterval(() => {
      this.updateSystemStatus();
    }, 10000); // Update every 10 seconds
  }

  async updateSystemStatus(): Promise<void> {
    try {
      const response = await fetch('/health');
      const health = await response.json() as {
        services: { mcpServer: string; kasmvnc: string };
      };

      this.updateStatusIndicator('mcp-status', 'mcp-status-text',
        health.services.mcpServer === 'healthy',
        health.services.mcpServer === 'healthy' ? 'Connected' : 'Disconnected'
      );

      this.updateStatusIndicator('kasmvnc-status', 'kasmvnc-status-text',
        health.services.kasmvnc === 'healthy',
        health.services.kasmvnc === 'healthy' ? 'Available' : 'Unavailable'
      );

      this.updateStatusIndicator('websocket-status', 'websocket-status-text',
        this.websocket !== null && this.websocket.readyState === WebSocket.OPEN,
        this.websocket !== null && this.websocket.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected'
      );

    } catch (error) {
      console.error('Failed to update system status:', error);

      // Set all indicators to error state
      ['mcp-status', 'kasmvnc-status', 'websocket-status'].forEach(id => {
        this.updateStatusIndicator(id, `${id}-text`, false, 'Error');
      });
    }
  }

  updateStatusIndicator(indicatorId: string, textId: string, isHealthy: boolean, statusText: string): void {
    const indicator = document.getElementById(indicatorId);
    const text = document.getElementById(textId);

    if (indicator) {
      indicator.className = `status-indicator ${isHealthy ? 'healthy' : 'error'}`;
    }

    if (text) {
      text.textContent = statusText;
    }
  }

  // ==================== MCP Configuration ====================

  async loadMCPConfig(): Promise<void> {
    const configElement = document.getElementById('mcp-config-json');
    const copyButton = document.getElementById('copy-config-btn') as HTMLButtonElement | null;
    try {
      const response = await fetch('/mcp-config');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      if (configElement) {
        configElement.textContent = JSON.stringify(config, null, 2);
      }
      this.mcpConfigLoaded = true;
      if (copyButton) copyButton.disabled = false;
    } catch (error) {
      console.error('Failed to load MCP config:', error);
      this.mcpConfigLoaded = false;
      if (configElement) {
        configElement.textContent = 'Configuration unavailable. Reload the page to retry.';
      }
      // Don't let the user copy a placeholder: with no config loaded there is
      // nothing to copy.
      if (copyButton) copyButton.disabled = true;
    }
  }

  async copyMCPConfig(): Promise<void> {
    const configElement = document.getElementById('mcp-config-json');
    if (!configElement) return;

    if (!this.mcpConfigLoaded) {
      this.showToast('error', 'Copy Unavailable', 'Configuration has not loaded — reload the page and try again.');
      return;
    }

    try {
      await navigator.clipboard.writeText(configElement.textContent ?? '');
      this.showToast('success', 'Copied', 'MCP configuration copied to clipboard');
    } catch (error) {
      console.error('Failed to copy config:', error);
      this.showToast('error', 'Copy Failed', 'Failed to copy configuration to clipboard');
    }
  }

  // ==================== Settings ====================

  async clearStoredData(): Promise<void> {
    if (confirm('Are you sure you want to clear all stored data? This will remove all connections and settings.')) {
      try {
        localStorage.clear();
        sessionStorage.clear();
        this.connections.clear();
        this.renderConnections();
        this.renderRecentConnections();
        this.showToast('info', 'Data Cleared', 'All stored data has been cleared');
      } catch (error) {
        console.error('Failed to clear data:', error);
        this.showToast('error', 'Clear Failed', 'Failed to clear stored data');
      }
    }
  }

  // ==================== Utility Functions ====================

  togglePasswordVisibility(): void {
    const passwordInput = document.getElementById('connection-password') as HTMLInputElement | null;
    const toggleBtn = document.getElementById('toggle-password');
    if (!passwordInput || !toggleBtn) return;

    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
      passwordInput.type = 'password';
      toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
    }
  }

  showToast(type: keyof ToastType, title: string, message: string): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
            <div class="toast-icon">
                <i class="fas fa-${this.getToastIcon(type)}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-title">${this.escapeHtml(title)}</div>
                <div class="toast-message">${this.escapeHtml(message)}</div>
            </div>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;

    // Add close functionality
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        toast.remove();
      });
    }

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 5000);
  }

  getToastIcon(type: keyof ToastType): string {
    const icons: ToastType = {
      success: 'check-circle',
      error: 'exclamation-circle',
      warning: 'exclamation-triangle',
      info: 'info-circle'
    };
    return icons[type] ?? 'info-circle';
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  // ==================== Cleanup ====================

  destroy(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }

    if (this.websocket) {
      this.websocket.close();
    }
  }
}

// Make the app globally available
declare global {
  interface Window {
    app: OverlayCompanionApp;
    OverlayCompanionApp: typeof OverlayCompanionApp;
  }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new OverlayCompanionApp();
});

// Make the app globally available
window.OverlayCompanionApp = OverlayCompanionApp;
