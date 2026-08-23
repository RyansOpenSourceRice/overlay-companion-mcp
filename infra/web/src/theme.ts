/**
 * Theme management — light / dark / auto.
 *
 * Default is "auto": the app follows the OS/browser `prefers-color-scheme`
 * (Ryan's preferences §4 Themes: auto-follow by default). A manual toggle lets
 * the user force light or dark, or return to auto; the choice is persisted in
 * localStorage (`oc-theme`) so it survives reloads.
 *
 * The active theme is applied as `data-theme` on <html>:
 *   - "auto" (or absent) → follows the system (handled in CSS)
 *   - "light" / "dark"   → forced
 */

export type ThemeChoice = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'oc-theme';

// The themed background SVGs are bundled by webpack (asset/resource), so we get
// their final URLs here and set them on --oc-bg-image per the effective theme.
import bgLight from './assets/bg-light.svg';
import bgDark from './assets/bg-dark.svg';

function applyBackground(effective: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.style.setProperty('--oc-bg-image', `url('${effective === 'dark' ? bgDark : bgLight}')`);
}

export function getStoredTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* localStorage unavailable (private mode / storage blocked) */
  }
  return 'auto';
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
  applyBackground(resolveTheme(choice));
}

export function setTheme(choice: ThemeChoice): void {
  applyTheme(choice);
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable; apply for this session only */
  }
}

export function initTheme(): void {
  applyTheme(getStoredTheme());
}

/** Resolve the effective (computed) theme, ignoring "auto". */
export function resolveTheme(choice: ThemeChoice = getStoredTheme()): 'light' | 'dark' {
  if (choice !== 'auto') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
