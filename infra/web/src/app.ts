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

  constructor() {
    // Initialize the application
    this.init();
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
      }

      // Load stored connections
      await this.loadConnections();

      // Setup event listeners
      this.setupEventListeners();

      // Initialize status monitoring
      this.startStatusMonitoring();

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
    // Navigation
    document.querySelectorAll<HTMLElement>('.nav-btn').forEach(btn => {
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

  navigateToPage(page: string): void {
    // Update navigation
    document.querySelectorAll<HTMLElement>('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll<HTMLElement>('.page').forEach(pageEl => {
      pageEl.classList.toggle('active', pageEl.id === `${page}-page`);
    });

    this.currentPage = page;

    // Page-specific initialization
    if (page === 'connections') {
      this.renderConnections();
    } else if (page === 'home') {
      this.renderRecentConnections();
    } else if (page === 'settings') {
      // Render the GUI-first settings forms (auth/connection/wazuh) into
      // the existing Settings page, appended to the MCP config section.
      this.renderSettingsPage();
    }
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
      title.textContent = 'Edit Connection';
      this.populateConnectionForm(connection);
    } else {
      title.textContent = 'Add New Connection';
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
      this.showToast('success', 'Connection Saved', `Connection "${saved.name}" has been saved successfully.`);
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
      const protocol = connection.ssl ? 'https' : 'http';
      const url = `${protocol}://${connection.host}:${connection.port}`;

      // Simple connectivity test
      const response = await fetch(`/api/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connection)
      });

      if (response.ok) {
        this.showToast('success', 'Connection Test', 'Connection test successful!');
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      this.showToast('warning', 'Connection Test', 'Could not verify connection. Please check your settings.');
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
                    <p>No connections configured</p>
                    <button class="btn btn-primary" id="add-first-connection-btn">
                        <i class="fas fa-plus"></i> Add Your First Connection
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
                    <p>No recent connections</p>
                    <button class="btn btn-primary" data-page="connections">Add Your First Connection</button>
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
        this.showToast('info', 'Connection Deleted', `Connection "${connection.name}" has been deleted.`);
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
      // Use proxied path under the main server so users never see a raw port
      url = `/vnc/`;
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

    // Initialize overlay system
    this.initializeOverlaySystem();
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

    // Setup WebSocket for overlay commands
    this.setupOverlayWebSocket();
  }

  setupOverlayWebSocket(): void {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/overlays`;

    try {
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('✅ Overlay WebSocket connected');
      };

      this.websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as OverlayCommand;
          this.handleOverlayCommand(data);
        } catch (error) {
          console.error('Failed to parse overlay command:', error);
        }
      };

      this.websocket.onclose = () => {
        console.log('🔌 Overlay WebSocket disconnected');
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

  handleOverlayCommand(command: OverlayCommand): void {
    const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    switch (command.type) {
      case 'create_overlay':
        this.drawOverlay(ctx, command);
        break;
      case 'clear_overlays':
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        break;
      default:
        console.log('Unknown overlay command:', command.type);
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
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

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
    try {
      const response = await fetch('/mcp-config');
      const config = await response.json();

      const configElement = document.getElementById('mcp-config-json');
      if (configElement) {
        configElement.textContent = JSON.stringify(config, null, 2);
      }
    } catch (error) {
      console.error('Failed to load MCP config:', error);
      const configElement = document.getElementById('mcp-config-json');
      if (configElement) {
        configElement.textContent = 'Failed to load configuration';
      }
    }
  }

  async copyMCPConfig(): Promise<void> {
    const configElement = document.getElementById('mcp-config-json');
    if (!configElement) return;

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
