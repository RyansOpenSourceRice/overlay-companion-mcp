/**
 * Login + Settings UI for the Overlay Companion MCP web frontend.
 *
 * The SPA imports showLoginView() when /auth/me returns 401, and
 * renderSettingsForms() into the existing Settings page. The forms are plain
 * DOM (no framework) so they stay intelligible to both a human and an AI agent
 * configuring the app — structured fields, validatable, machine-readable.
 */

import {
  AuthStatus,
  CurrentUser,
  getAuthStatus,
  getSettings,
  loginLocal,
  loginWithOidc,
  registerLocal,
  verifyLocalTotp,
  putSetting,
  logout,
  deleteAccount,
  getCsrfToken,
} from './auth';

// ---- Login view ---------------------------------------------------------

export function showLoginView(container: HTMLElement, onLoggedIn: (u: CurrentUser) => void): void {
  container.innerHTML = '';
  const wrap = el('div', 'login-view');
  wrap.appendChild(el('h2', '', 'Sign in'));
  wrap.appendChild(el('p', 'login-hint', 'Overlay Companion MCP requires authentication.'));

  const statusBox = el('div', 'login-status');
  wrap.appendChild(statusBox);

  const formWrap = el('div', 'login-forms');
  wrap.appendChild(formWrap);

  getAuthStatus()
    .then((status) => renderLoginForms(status, formWrap, onLoggedIn))
    .catch(() => {
      statusBox.textContent = 'Could not reach the server. Is it running?';
    });

  container.appendChild(wrap);
}

function renderLoginForms(status: AuthStatus, container: HTMLElement, onLoggedIn: (u: CurrentUser) => void): void {
  container.innerHTML = '';

  if (status.oidc.configured) {
    const oidcBtn = el('button', 'btn btn-primary', 'Continue with single sign-on (OIDC)');
    oidcBtn.addEventListener('click', () => loginWithOidc('/'));
    container.appendChild(oidcBtn);
    container.appendChild(el('p', 'login-divider', '— or —'));
  }

  if (status.local.enabled) {
    const form = el('form', 'login-local-form') as HTMLFormElement;
    const username = inputField('username', 'Email');
    const password = inputField('password', 'Password', 'password');
    const submit = el('button', 'btn btn-secondary', 'Sign in') as HTMLButtonElement;
    submit.type = 'submit';
    form.append(username.wrap, password.wrap, submit);

    const errBox = el('div', 'login-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      submit.disabled = true;
      try {
        const result = await loginLocal(username.input.value, password.input.value);
        if (result.twoFactor?.required) {
          // Only TOTP is wired as a second factor (§7); if the account's
          // required method isn't TOTP, surface that instead of a dead step.
          const needsTotp = !result.twoFactor.methods || result.twoFactor.methods.includes('totp');
          if (!needsTotp) {
            errBox.textContent = 'This account uses another 2FA method that is not supported yet.';
            return;
          }
          // TOTP-enabled account: prompt for the authenticator code (§7).
          errBox.textContent = '';
          showTotpStep(form, onLoggedIn);
          return;
        }
        onLoggedIn(result.user!);
      } catch (err) {
        errBox.textContent = (err as Error).message;
      } finally {
        submit.disabled = false;
      }
    });
    form.appendChild(errBox);
    container.appendChild(form);

    if (status.signup.allowed) {
      const regWrap = el('div', 'login-register');
      regWrap.appendChild(el('h3', '', 'Create an account'));
      const regForm = el('form', 'login-local-form') as HTMLFormElement;
      const ru = inputField('reg-username', 'Name');
      const rp = inputField('reg-password', 'Password (min 12 chars)', 'password');
      const re = inputField('reg-email', 'Email');
      const rs = el('button', 'btn btn-secondary', 'Register') as HTMLButtonElement;
      rs.type = 'submit';
      regForm.append(ru.wrap, rp.wrap, re.wrap, rs);
      const regErr = el('div', 'login-error');
      regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        regErr.textContent = '';
        try {
          const user = await registerLocal(ru.input.value, re.input.value, rp.input.value);
          onLoggedIn(user);
        } catch (err) {
          regErr.textContent = (err as Error).message;
        }
      });
      regForm.appendChild(regErr);
      regWrap.appendChild(regForm);
      container.appendChild(regWrap);
    } else {
      container.appendChild(el('p', 'login-hint', 'Sign-ups are locked. Ask an admin to enable them in Settings.'));
    }
  } else if (!status.oidc.configured) {
    container.appendChild(el('p', 'login-error', 'No auth method is configured. An admin must enable OIDC or local auth in Settings.'));
  }
}

// ---- Settings forms (GUI-first config, §9) -----------------------------

// Second step of local sign-in for a TOTP-enabled account (§7). The password
// step already set Better Auth's signed `two_factor` cookie on this session;
// this prompts for the authenticator code and completes the login.
function showTotpStep(form: HTMLFormElement, onLoggedIn: (u: CurrentUser) => void): void {
  // Build the TOTP step as a fresh <form> and replace the password form, so the
  // password handler is discarded rather than firing alongside the verify one.
  const step = el('form', 'login-local-form') as HTMLFormElement;
  step.appendChild(el('h3', '', 'Two-factor authentication'));
  step.appendChild(el('p', 'login-hint', 'Enter the 6-digit code from your authenticator app.'));
  const code = inputField('otp-code', 'Authenticator code');
  const submit = el('button', 'btn btn-secondary', 'Verify') as HTMLButtonElement;
  submit.type = 'submit';
  const errBox = el('div', 'login-error');
  step.append(code.wrap, submit, errBox);
  step.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.textContent = '';
    const value = code.input.value.trim();
    // Fail fast on a malformed code so the rate-limited verify endpoint's
    // budget is reserved for genuine brute-force attempts.
    if (!/^\d{6}$/.test(value)) {
      errBox.textContent = 'Enter the 6-digit code from your authenticator app.';
      return;
    }
    // Guard against concurrent submits (double-click) while verification is
    // in flight; re-enable on error so the user can correct and retry.
    submit.disabled = true;
    try {
      const user = await verifyLocalTotp(value);
      onLoggedIn(user);
    } catch (err) {
      errBox.textContent = (err as Error).message;
    } finally {
      submit.disabled = false;
    }
  });
  form.replaceWith(step);
}

export async function renderSettingsForms(container: HTMLElement, user: CurrentUser): Promise<void> {
  const isAdmin = user.roles.includes('admin');
  let settings;
  try {
    settings = await getSettings();
  } catch {
    container.appendChild(el('p', 'login-error', 'Could not load settings. Are you signed in?'));
    return;
  }

  container.innerHTML = '';
  container.appendChild(el('h3', '', 'Authentication'));

  const oidc = (settings.auth?.['auth.oidc'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('OIDC / Single Sign-On', 'Connect a Keycloak or other OIDC IdP.', [
      toggleRow('enabled', 'Enable OIDC', Boolean(oidc.enabled), isAdmin),
      textRow('issuer', 'Issuer URL', String(oidc.issuer ?? ''), isAdmin),
      textRow('clientId', 'Client ID', String(oidc.clientId ?? ''), isAdmin),
      textRow('clientSecret', 'Client secret', String(oidc.clientSecret ?? ''), isAdmin, 'password'),
      textRow('audience', 'Audience', String(oidc.audience ?? ''), isAdmin),
      textRow('requiredRole', 'Required role', String(oidc.requiredRole ?? 'overlay:user'), isAdmin),
    ], () => saveAuthSection(container, 'oidc', isAdmin)),
  );

  const local = (settings.auth?.['auth.local'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('Local auth', 'Username/password fallback (hashed + salted).', [
      toggleRow('enabled', 'Enable local auth', Boolean(local.enabled), isAdmin),
    ], () => saveAuthSection(container, 'local', isAdmin)),
  );

  const signup = (settings.auth?.['auth.signup'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('Sign-ups', 'Open registration. Locked by default (admin opt-in).', [
      toggleRow('allowed', 'Allow new sign-ups', Boolean(signup.allowed), isAdmin),
    ], () => saveAuthSection(container, 'signup', isAdmin)),
  );

  const session = (settings.auth?.['auth.session'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('Session', 'How long a login stays valid.', [
      numberRow('ttlMinutes', 'Session TTL (minutes)', Number(session.ttlMinutes ?? 480), isAdmin),
    ], () => saveAuthSection(container, 'session', isAdmin)),
  );

  // §7 optional 2FA: passkeys (WebAuthn / hardware keys) and TOTP. Both are
  // per-account opt-in. Better Auth serves the management endpoints; the rows
  // here reflect availability. Per-user setup runs against Better Auth's own
  // endpoints (/api/auth/passkey/*, /api/auth/two-factor/*).
  let passkeyEnabled = false;
  let totpEnabled = false;
  try {
    const st = await getAuthStatus();
    passkeyEnabled = st.passkey?.enabled ?? false;
    totpEnabled = st.totp?.enabled ?? false;
  } catch {
    // Leave both false; the card just notes availability.
  }
  container.appendChild(
    settingsCard(
      'Two-factor security',
      'Optional per-account passkeys (WebAuthn / hardware keys) and TOTP authenticator app codes. ' +
        'Add these from your account\u2019s security settings; neither is required to sign in.',
      [
        el('p', 'settings-hint', passkeyEnabled ? 'Passkeys: enabled (optional).' : 'Passkeys: available.'),
        el('p', 'settings-hint', totpEnabled ? 'TOTP 2FA: enabled (optional).' : 'TOTP 2FA: available.'),
      ],
    ),
  );

  // Wazuh integration (§8): admin-enabled, no paywall.
  const wazuh = (settings.wazuh?.['wazuh.shipper'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('Wazuh / SIEM log shipping', 'Forward structured logs to an external Wazuh instance. The admin runs Wazuh separately; this app only ships logs to it.', [
      toggleRow('enabled', 'Enable log shipping', Boolean(wazuh.enabled), isAdmin),
      textRow('endpoint', 'Wazuh endpoint', String(wazuh.endpoint ?? ''), isAdmin),
      textRow('apiKey', 'API key (if required)', String(wazuh.apiKey ?? ''), isAdmin, 'password'),
    ], () => saveSection(container, 'wazuh', 'shipper', isAdmin)),
  );

  // In-app assistant provider (B1): the chat panel is a second client to the
  // same MCP tools; this supplies the OpenRouter model + key for streaming.
  const provider = (settings.provider?.['provider.chat'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('In-app assistant (provider)', 'Model + API key used by the built-in chat panel. It calls the same MCP overlay tools an external agent uses.', [
      toggleRow('enabled', 'Enable chat panel', Boolean(provider.enabled), isAdmin),
      textRow('baseUrl', 'Provider base URL', String(provider.baseUrl ?? 'https://openrouter.ai/api/v1'), isAdmin),
      textRow('model', 'Model', String(provider.model ?? 'deepseek/deepseek-chat-v3-0324'), isAdmin),
      textRow('apiKey', 'API key', String(provider.apiKey ?? ''), isAdmin, 'password'),
    ], () => saveSection(container, 'provider', 'chat', isAdmin)),
  );

  // Display ownership (B2): which agent may draw on the shared canvas.
  const actor = String(settings.general?.['general.activeActor'] ?? 'exterior');
  container.appendChild(
    settingsCard('Display ownership', 'Only one agent owns the overlay canvas at a time; switching releases the other\u2019s overlays. The in-app assistant is \u201cinterior\u201d; external MCP agents are \u201cexterior\u201d.', [
      selectRow('activeActor', 'Active owner', actor, ['interior', 'exterior'], isAdmin),
    ], () => saveSection(container, 'general', 'activeActor', isAdmin)),
  );

  // Audio provider (Phase C): default OFF; cloud (OpenRouter fish) or local
  // (whisper.cpp / faster-whisper) STT/TTS for the chat panel.
  const audio = (settings.audio?.['audio.provider'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('Voice & transcription (Phase C)', 'Optional STT/TTS for the chat panel. Off by default. Cloud uses OpenRouter fish-audio; local points at a whisper.cpp / faster-whisper server.', [
      toggleRow('enabled', 'Enable voice', Boolean(audio.enabled), isAdmin),
      selectRow('provider', 'Provider', String(audio.provider ?? 'off'), ['off', 'openrouter', 'local'], isAdmin),
      textRow('sttModel', 'STT model (OpenRouter)', String(audio.sttModel ?? 'fish-audio/transcribe-1'), isAdmin),
      textRow('ttsModel', 'TTS model (OpenRouter)', String(audio.ttsModel ?? 'fish-audio/s1'), isAdmin),
      textRow('sttUrl', 'Local STT URL', String(audio.sttUrl ?? ''), isAdmin),
      textRow('ttsUrl', 'Local TTS URL', String(audio.ttsUrl ?? ''), isAdmin),
    ], () => saveSection(container, 'audio', 'provider', isAdmin)),
  );

  // TLS / HTTPS management (§7).
  const tls = (settings.tls?.['tls.settings'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard(
      'HTTPS & Certificates',
      'How this instance serves HTTPS. The certificate is the server\u2019s identity (served by ' +
        'the Caddy/Traefik terminator); client trust anchors are installed on end devices. ' +
        'ACME renews automatically. No client keys are ever uploaded to the server.',
      [
        selectRow(
          'terminator',
          'Terminator',
          String(tls.terminator ?? 'caddy'),
          ['caddy', 'traefik'],
          isAdmin,
        ),
        selectRow(
          'mode',
          'Mode',
          String(tls.mode ?? 'none'),
          ['none', 'acme-public', 'acme-private', 'upload', 'self-signed'],
          isAdmin,
        ),
        toggleRow('managed', 'App-managed terminator (vs unmanaged/external proxy)', Boolean(tls.managed), isAdmin),
        toggleRow('redirectHttp', 'Redirect HTTP to HTTPS', Boolean(tls.redirectHttp), isAdmin),
        textRow('acmeDirectory', 'Private ACME directory URL (step-ca)', String(tls.acmeDirectory ?? ''), isAdmin),
        textareaRow(
          'acmeRootCa',
          'ACME endpoint root CA (PEM)',
          String(tls.acmeRootCa ?? ''),
          isAdmin,
          'Optional: trust anchor for a private ACME endpoint, server-side.',
        ),
      ],
      () => saveSection(container, 'tls', 'settings', isAdmin),
    ),
  );

  // TLS actions: upload server cert, generate self-signed, view status/config.
  const tlsActions = el('div', 'settings-section');
  tlsActions.appendChild(el('h4', '', 'Certificate actions'));
  const statusLine = el('p', 'settings-card-desc', 'Loading certificate status…');
  tlsActions.appendChild(statusLine);

  const uploadCert = el('input', 'file-input') as HTMLInputElement;
  uploadCert.type = 'file';
  uploadCert.accept = '.crt,.pem,.cer';
  uploadCert.id = 'tls-cert-file';
  uploadCert.disabled = !isAdmin;
  const keyInput = el('input', 'file-input') as HTMLInputElement;
  keyInput.type = 'file';
  keyInput.accept = '.key,.pem';
  keyInput.id = 'tls-key-file';
  keyInput.disabled = !isAdmin;
  tlsActions.appendChild(el('label', '', 'Server certificate (PEM)'));
  tlsActions.appendChild(uploadCert);
  tlsActions.appendChild(el('label', '', 'Private key (PEM, server\u2019s own key)'));
  tlsActions.appendChild(keyInput);
  const uploadBtn = el('button', 'btn btn-primary', 'Upload certificate') as HTMLButtonElement;
  uploadBtn.disabled = !isAdmin;
  uploadBtn.addEventListener('click', async () => {
    const certFile = uploadCert.files?.[0];
    const keyFile = keyInput.files?.[0];
    if (!certFile || !keyFile) {
      alert('Select a certificate and its matching private key first.');
      return;
    }
    try {
      const cert = await certFile.text();
      const key = await keyFile.text();
      const res = await fetch('/api/tls/cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ certificate: cert, privateKey: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
      flashSaved(tlsActions);
      await refreshTlsStatus(statusLine);
    } catch (err) {
      alert((err as Error).message);
    }
  });
  tlsActions.appendChild(uploadBtn);

  const genSelfSigned = el('button', 'btn btn-secondary', 'Generate self-signed cert') as HTMLButtonElement;
  genSelfSigned.disabled = !isAdmin;
  genSelfSigned.addEventListener('click', async () => {
    if (!confirm('Generate a self-signed server certificate for local/LAN HTTPS? This does not touch a CA.')) return;
    try {
      const res = await fetch('/api/tls/self-signed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ permission: true, commonName: 'overlay-companion-mcp.local' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `Generate failed (${res.status})`);
      flashSaved(tlsActions);
      await refreshTlsStatus(statusLine);
    } catch (err) {
      alert((err as Error).message);
    }
  });
  tlsActions.appendChild(genSelfSigned);

  container.appendChild(tlsActions);
  void refreshTlsStatus(statusLine, isAdmin);

  // Fine-grained authorization (D-017): OpenFGA is a separate service (like
  // SurrealDB/Keycloak) — never embedded in the app. When enabled, the server
  // enforces owner/operator/viewer relations on saved connections (fail-closed).
  // storeId/modelId are provisioned by the server and shown read-only here.
  const openfga = (settings.openfga?.['openfga.settings'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard(
      'Fine-grained authorization (OpenFGA)',
      'Relationship-based access control for saved connections. OpenFGA runs as its own ' +
        'service; this app only talks to it over HTTP. When enabled, the server writes the ' +
        'creator as the connection owner and enforces viewer/operator/owner on every request. ' +
        'Disabled by default (owner-scoped behavior).',
      [
        toggleRow('enabled', 'Enable OpenFGA', Boolean(openfga.enabled), isAdmin),
        textRow('endpoint', 'OpenFGA endpoint', String(openfga.endpoint ?? 'http://openfga:8080'), isAdmin),
        el('p', 'settings-hint', `Store: ${String(openfga.storeId ?? '—')}`),
        el('p', 'settings-hint', `Authorization model: ${String(openfga.modelId ?? '—')}`),
      ],
      () => saveSection(container, 'openfga', 'settings', isAdmin),
    ),
  );

  // Account actions
  container.appendChild(el('h3', '', 'Account'));
  const accountBox = el('div', 'settings-section');
  const logoutBtn = el('button', 'btn btn-secondary', 'Sign out');
  logoutBtn.addEventListener('click', async () => {
    await logout();
    window.location.reload();
  });
  accountBox.appendChild(logoutBtn);

  const deleteBtn = el('button', 'btn btn-danger', 'Delete my account');
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('This permanently deletes your account and revokes all sessions. Continue?')) return;
    try {
      await deleteAccount();
      window.location.reload();
    } catch (err) {
      alert((err as Error).message);
    }
  });
  accountBox.appendChild(deleteBtn);
  container.appendChild(accountBox);
}

async function saveAuthSection(container: HTMLElement, key: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin) {
    alert('Only admins can change settings.');
    return;
  }
  const value = collectCardValues(container, key);
  try {
    await putSetting('auth', key, value);
    flashSaved(container);
  } catch (err) {
    alert((err as Error).message);
  }
}

interface TlsStatus {
  mode: string;
  terminator: string;
  managed: boolean;
  redirectHttp: boolean;
  certLoaded: boolean;
  subject?: string;
  issuer?: string;
  notAfter?: string;
  acmeDirectory?: string;
}

async function refreshTlsStatus(el: HTMLElement, isAdmin = true): Promise<void> {
  if (!isAdmin) {
    el.textContent = 'Certificate status available to admins.';
    return;
  }
  try {
    const res = await fetch('/api/tls/status');
    if (!res.ok) throw new Error(`status ${res.status}`);
    const s = (await res.json()) as TlsStatus;
    el.textContent = s.certLoaded
      ? `Loaded: ${s.subject ?? 'cert'} | issuer ${s.issuer ?? '?'} | expires ${s.notAfter ?? '?'} | mode ${s.mode} | ${s.terminator}`
      : `No server certificate loaded yet (mode ${s.mode}). Upload one or generate a self-signed cert.`;
  } catch {
    el.textContent = 'Could not load certificate status.';
  }
}

async function saveSection(container: HTMLElement, category: string, key: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin) {
    alert('Only admins can change settings.');
    return;
  }
  const value = collectCardValues(container, key);
  try {
    await putSetting(category, key, value);
    flashSaved(container);
  } catch (err) {
    alert((err as Error).message);
  }
}

function collectCardValues(scope: HTMLElement, dataKey: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  scope.querySelectorAll<HTMLElement>(`[data-setting="${dataKey}"]`).forEach((card) => {
    card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((input) => {
      const field = input.dataset.field;
      if (!field) return;
      if (input.type === 'checkbox') {
        out[field] = (input as HTMLInputElement).checked;
      } else if (input.type === 'number') {
        out[field] = Number(input.value);
      } else {
        out[field] = input.value;
      }
    });
  });
  return out;
}

function flashSaved(scope: HTMLElement): void {
  const existing = scope.querySelector('.save-flash');
  if (existing) existing.remove();
  const flash = el('span', 'save-flash', 'Saved ✓');
  scope.appendChild(flash);
  setTimeout(() => flash.remove(), 2000);
}

// ---- Small DOM helpers --------------------------------------------------

function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function inputField(id: string, label: string, type = 'text'): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('div', 'form-field');
  const lbl = el('label', '', label) as HTMLLabelElement;
  lbl.htmlFor = id;
  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.name = id;
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return { wrap, input };
}

function settingsCard(title: string, description: string, rows: HTMLElement[], onSave?: () => void): HTMLElement {
  const card = el('div', 'settings-card');
  card.appendChild(el('h4', '', title));
  card.appendChild(el('p', 'settings-card-desc', description));
  const body = el('div', 'settings-card-body');
  rows.forEach((r) => body.appendChild(r));
  card.appendChild(body);
  if (onSave) {
    const saveBtn = el('button', 'btn btn-primary', 'Save');
    saveBtn.addEventListener('click', onSave);
    card.appendChild(saveBtn);
  }
  return card;
}

function textRow(field: string, label: string, value: string, enabled: boolean, type = 'text'): HTMLElement {
  const row = el('div', 'setting-item');
  const lbl = el('label', '', label) as HTMLLabelElement;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.dataset.field = field;
  input.disabled = !enabled;
  row.appendChild(lbl);
  row.appendChild(input);
  return row;
}

function numberRow(field: string, label: string, value: number, enabled: boolean): HTMLElement {
  const row = el('div', 'setting-item');
  const lbl = el('label', '', label) as HTMLLabelElement;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.dataset.field = field;
  input.disabled = !enabled;
  row.appendChild(lbl);
  row.appendChild(input);
  return row;
}

function toggleRow(field: string, label: string, checked: boolean, enabled: boolean): HTMLElement {
  const row = el('div', 'setting-item');
  const lbl = el('label', 'checkbox-label', label) as HTMLLabelElement;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset.field = field;
  input.disabled = !enabled;
  lbl.prepend(input);
  row.appendChild(lbl);
  return row;
}

function selectRow(field: string, label: string, value: string, options: string[], enabled: boolean): HTMLElement {
  const row = el('div', 'setting-item');
  const lbl = el('label', '', label) as HTMLLabelElement;
  const select = document.createElement('select');
  select.value = value;
  select.dataset.field = field;
  select.disabled = !enabled;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    select.appendChild(o);
  }
  row.appendChild(lbl);
  row.appendChild(select);
  return row;
}

function textareaRow(field: string, label: string, value: string, enabled: boolean, placeholder = ''): HTMLElement {
  const row = el('div', 'setting-item');
  const lbl = el('label', '', label) as HTMLLabelElement;
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.placeholder = placeholder;
  ta.rows = 3;
  ta.dataset.field = field;
  ta.disabled = !enabled;
  row.appendChild(lbl);
  row.appendChild(ta);
  return row;
}
