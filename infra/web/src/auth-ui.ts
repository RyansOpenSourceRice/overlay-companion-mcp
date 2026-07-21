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
    const username = inputField('username', 'Username');
    const password = inputField('password', 'Password', 'password');
    const submit = el('button', 'btn btn-secondary', 'Sign in') as HTMLButtonElement;
    submit.type = 'submit';
    form.append(username.wrap, password.wrap, submit);

    const errBox = el('div', 'login-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      try {
        const user = await loginLocal(username.input.value, password.input.value);
        onLoggedIn(user);
      } catch (err) {
        errBox.textContent = (err as Error).message;
      }
    });
    form.appendChild(errBox);
    container.appendChild(form);

    if (status.signup.allowed) {
      const regWrap = el('div', 'login-register');
      regWrap.appendChild(el('h3', '', 'Create an account'));
      const regForm = el('form', 'login-local-form') as HTMLFormElement;
      const ru = inputField('reg-username', 'Username');
      const rp = inputField('reg-password', 'Password (min 12 chars)', 'password');
      const re = inputField('reg-email', 'Email (optional)');
      const rs = el('button', 'btn btn-secondary', 'Register') as HTMLButtonElement;
      rs.type = 'submit';
      regForm.append(ru.wrap, rp.wrap, re.wrap, rs);
      const regErr = el('div', 'login-error');
      regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        regErr.textContent = '';
        try {
          const user = await registerLocal(ru.input.value, rp.input.value, re.input.value || undefined);
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

  // Wazuh integration (§8): admin-enabled, no paywall.
  const wazuh = (settings.wazuh?.['wazuh.shipper'] as Record<string, unknown>) ?? {};
  container.appendChild(
    settingsCard('Wazuh / SIEM log shipping', 'Forward structured logs to an external Wazuh instance. The admin runs Wazuh separately; this app only ships logs to it.', [
      toggleRow('enabled', 'Enable log shipping', Boolean(wazuh.enabled), isAdmin),
      textRow('endpoint', 'Wazuh endpoint', String(wazuh.endpoint ?? ''), isAdmin),
      textRow('apiKey', 'API key (if required)', String(wazuh.apiKey ?? ''), isAdmin, 'password'),
    ], () => saveSection(container, 'wazuh', 'shipper', isAdmin)),
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

function settingsCard(title: string, description: string, rows: HTMLElement[], onSave: () => void): HTMLElement {
  const card = el('div', 'settings-card');
  card.appendChild(el('h4', '', title));
  card.appendChild(el('p', 'settings-card-desc', description));
  const body = el('div', 'settings-card-body');
  rows.forEach((r) => body.appendChild(r));
  card.appendChild(body);
  const saveBtn = el('button', 'btn btn-primary', 'Save');
  saveBtn.addEventListener('click', onSave);
  card.appendChild(saveBtn);
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
