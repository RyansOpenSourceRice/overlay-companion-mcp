/**
 * TLS / HTTPS certificate management for the management server.
 *
 * Owns the serving-certificate lifecycle for the app's HTTPS terminator (Caddy
 * or Traefik), following Ryan's preferences §7:
 *   - ACME is the protocol for provisioning/renewal (public CA or a
 *     locally-hosted private ACME root such as step-ca — "public vs private
 *     CA" is a configuration choice, not a different integration).
 *   - The custom CA's trust anchor lives on client devices (installed by the
 *     admin); the app only serves HTTPS. The cert file is the SERVER's
 *     identity. Client keys are never uploaded.
 *   - A self-signed local cert is the automatic no-domain fallback (generated
 *     with admin permission).
 *
 * The management server stays HTTP behind the terminator, so this module
 * renders terminator TLS config (Caddy / Traefik) rather than doing in-Node TLS
 * termination.
 */

import path from 'path';
import { execFileSync } from 'child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type TlsMode = 'none' | 'acme-public' | 'acme-private' | 'upload' | 'self-signed';
export type Terminator = 'caddy' | 'traefik';

export interface TlsSettings {
  mode: TlsMode;
  terminator: Terminator;
  managed: boolean;      // app-managed terminator vs unmanaged (external proxy)
  redirectHttp: boolean; // HTTP -> HTTPS redirect
  acmeDirectory?: string;
  acmeRootCa?: string;   // PEM trust anchor for the ACME endpoint (server-side)
}

export interface TlsStatus {
  mode: TlsMode;
  terminator: Terminator;
  managed: boolean;
  redirectHttp: boolean;
  certLoaded: boolean;
  subject?: string;
  issuer?: string;
  notAfter?: string;
  fingerprint?: string;
  acmeDirectory?: string;
}

// Directory where cert material is persisted. Mounted into the terminator.
const CERTS_DIR = process.env.TLS_CERTS_DIR || path.join(__dirname, '..', 'certs');
const SERVER_CERT = path.join(CERTS_DIR, 'server.crt');
const SERVER_KEY = path.join(CERTS_DIR, 'server.key');
const ACME_ROOT = path.join(CERTS_DIR, 'acme-ca.crt');

interface CertInfo {
  subject: string;
  issuer: string;
  notAfter: string;
  fingerprint: string;
}

const DEFAULT_SETTINGS: TlsSettings = {
  mode: 'none',
  terminator: 'caddy',
  managed: false,
  redirectHttp: false,
};

export class TlsManager {
  private settings: TlsSettings;

  constructor(settings: TlsSettings = DEFAULT_SETTINGS) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    mkdirSync(CERTS_DIR, { recursive: true });
  }

  update(patch: Partial<TlsSettings>): void {
    this.settings = { ...this.settings, ...patch };
    if (this.settings.acmeRootCa) {
      writeFileSync(ACME_ROOT, this.settings.acmeRootCa, { mode: 0o600 });
    }
  }

  getSettings(): TlsSettings {
    return { ...this.settings };
  }

  certsDir(): string {
    return CERTS_DIR;
  }

  /** True when both server cert and key are present and parse. */
  hasServerCert(): boolean {
    return existsSync(SERVER_CERT) && existsSync(SERVER_KEY) && inspect(SERVER_CERT) !== null;
  }

  /** Validate a cert/key pair before persisting it. */
  validatePair(certPem: string, keyPem: string): { ok: boolean; error?: string } {
    const dir = mktempDir();
    try {
      const certPath = path.join(dir, 'cert.pem');
      const keyPath = path.join(dir, 'key.pem');
      writeFileSync(certPath, certPem);
      writeFileSync(keyPath, keyPem);
      // Both must parse.
      execFileSync('openssl', ['x509', '-noout', '-subject', '-in', certPath], { stdio: 'pipe' });
      execFileSync('openssl', ['pkey', '-noout', '-in', keyPath], { stdio: 'pipe' });
      // Public keys must match.
      const certPub = execFileSync('openssl', ['x509', '-noout', '-pubkey', '-in', certPath], { encoding: 'utf-8' });
      const keyPub = execFileSync('openssl', ['pkey', '-pubout', '-in', keyPath], { encoding: 'utf-8' });
      if (certPub.trim() !== keyPub.trim()) {
        return { ok: false, error: 'Certificate and private key do not match.' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Invalid certificate or key: ${(err as Error).message}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Store an uploaded server certificate + key (with validation). */
  uploadServerCert(certPem: string, keyPem: string): { ok: boolean; error?: string } {
    const v = this.validatePair(certPem, keyPem);
    if (!v.ok) return v;
    writeFileSync(SERVER_CERT, certPem, { mode: 0o644 });
    writeFileSync(SERVER_KEY, keyPem, { mode: 0o600 });
    return { ok: true };
  }

  /** Generate a self-signed server cert (no-domain fallback), with permission. */
  generateSelfSigned(commonName: string, days = 825): { ok: boolean; error?: string } {
    try {
      const cn = (commonName || 'overlay-companion-mcp.local').trim();
      const dir = mktempDir();
      const confPath = path.join(dir, 'openssl.conf');
      const conf = [
        '[req]',
        'distinguished_name=dn',
        'prompt=no',
        '[dn]',
        `CN=${cn}`,
        '[ext]',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        'extendedKeyUsage=serverAuth',
      ].join('\n');
      writeFileSync(confPath, conf);
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', SERVER_KEY, '-out', SERVER_CERT,
        '-days', String(days), '-config', confPath,
        '-extensions', 'ext',
      ], { stdio: 'pipe' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  status(): TlsStatus {
    const info = existsSync(SERVER_CERT) ? inspect(SERVER_CERT) : null;
    return {
      mode: this.settings.mode,
      terminator: this.settings.terminator,
      managed: this.settings.managed,
      redirectHttp: this.settings.redirectHttp,
      certLoaded: info !== null,
      subject: info?.subject,
      issuer: info?.issuer,
      notAfter: info?.notAfter,
      fingerprint: info?.fingerprint,
      acmeDirectory: this.settings.acmeDirectory,
    };
  }

  /**
   * Render the terminator TLS config fragment. In unmanaged mode this is
   * reference material the operator wires into their existing proxy; in
   * managed compose mode it is written to the terminator's config volume.
   */
  renderTerminatorConfig(): string {
    switch (this.settings.terminator) {
      case 'traefik':
        return renderTraefik(this.settings, CERTS_DIR);
      case 'caddy':
      default:
        return renderCaddy(this.settings, CERTS_DIR);
    }
  }

  /** Write rendered config to the certs dir and return its path. */
  writeTerminatorConfig(): string {
    const cfg = this.renderTerminatorConfig();
    const file = this.settings.terminator === 'traefik'
      ? path.join(CERTS_DIR, 'traefik-dynamic.yml')
      : path.join(CERTS_DIR, 'Caddyfile.tls');
    writeFileSync(file, cfg);
    return file;
  }
}

function inspect(certPath: string): CertInfo | null {
  try {
    const s = (k: string): string => {
      const out = execFileSync('openssl', ['x509', '-in', certPath, '-noout', k], { encoding: 'utf-8' }).trim();
      return out.includes('=') ? out.slice(out.indexOf('=') + 1) : out;
    };
    return {
      subject: s('-subject'),
      issuer: s('-issuer'),
      notAfter: s('-enddate'),
      fingerprint: s('-fingerprint'),
    };
  } catch {
    return null;
  }
}

function renderCaddy(s: TlsSettings, certsDir: string): string {
  const out: string[] = ['# Generated TLS config for Caddy (managed by Overlay Companion MCP).', ''];
  let tls: string;
  switch (s.mode) {
    case 'acme-public':
      tls = 'tls {  issuer acme }';
      break;
    case 'acme-private':
      tls = `tls { issuer acme { ca ${s.acmeDirectory || ''}${
        s.acmeRootCa ? ` ca_root ${path.join(certsDir, 'acme-ca.crt')}` : ''
      } } }`;
      break;
    case 'upload':
      tls = `tls ${JSON.stringify(path.join(certsDir, 'server.crt'))} ${JSON.stringify(path.join(certsDir, 'server.key'))}`;
      break;
    case 'self-signed':
      tls = 'tls internal';
      break;
    default:
      tls = '# HTTPS disabled (mode=none); serving plain HTTP only';
  }
  out.push(tls);
  if (s.redirectHttp) {
    out.push('http:// { redir https://{host}{uri} permanent }');
  }
  out.push('');
  out.push('# Apply the tls directive inside your site block, e.g.:');
  out.push('#  example.local {');
  out.push('#    ' + tls.replace(/\n/g, '\n#    '));
  out.push('#    reverse_proxy overlay-web:8080');
  out.push('#  }');
  out.push('');
  return out.join('\n');
}

function renderTraefik(s: TlsSettings, certsDir: string): string {
  const out: string[] = ['# Generated TLS config for Traefik (managed by Overlay Companion MCP).', ''];
  if (s.mode === 'acme-public' || s.mode === 'acme-private') {
    const caServer = s.acmeDirectory ? `      caServer: "${s.acmeDirectory}"` : '';
    out.push('certificatesResolvers:');
    out.push('  acme:');
    out.push('    acme:');
    out.push('      email: admin@example.local');
    out.push('      storage: /data/acme.json');
    if (caServer) out.push(caServer);
    out.push('      httpChallenge:');
    out.push('        entryPoint: web');
    if (s.acmeRootCa) {
      out.push(`      ca: ${JSON.stringify(path.join(certsDir, 'acme-ca.crt'))}`);
    }
    out.push('        # (legacy field placement note)');
  } else if (s.mode === 'upload') {
    out.push('tls:');
    out.push('  stores:');
    out.push('    default: { defaultCertificate: { certFile: ' + JSON.stringify(path.join(certsDir, 'server.crt')) + ', keyFile: ' + JSON.stringify(path.join(certsDir, 'server.key')) + ' } }');
  } else if (s.mode === 'self-signed') {
    out.push('tls:');
    out.push('  stores:');
    out.push('    default: { defaultCertificate: { certFile: ' + JSON.stringify(path.join(certsDir, 'server.crt')) + ', keyFile: ' + JSON.stringify(path.join(certsDir, 'server.key')) + ' } }');
  } else {
    out.push('# HTTPS disabled (mode=none); serving plain HTTP only');
  }
  out.push('');
  return out.join('\n');
}

function mktempDir(): string {
  const dir = path.join('/tmp', `tls-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const tlsSettingsDefault = DEFAULT_SETTINGS;
