/**
 * Dependency-free markdown renderer for in-app assistant messages (Goal 2).
 *
 * Security model: ESCAPE FIRST, then inject tags via regex over the escaped
 * text. No HTML can enter the DOM from model output — only constructs this
 * file emits. >2000-char single constructs degrade to plain text (size
 * safety) so a runaway table or code fence cannot blow out a bubble.
 *
 * Supported: headings, bold, italic, strikethrough, inline code, fenced code,
 * bullets, ordered lists, blockquotes, hr, links (new tab), ==highlights==,
 * pipe tables.
 */

const MAX_BLOCK = 2000;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  if (text.length > MAX_BLOCK) return esc(text);
  let out = esc(text);
  // inline code first so later passes skip its content
  out = out.replace(/`([^`\n]+)`/g, (_, c: string) =>
    `<code class="md-code">${c}</code>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // ==highlight== → <mark>
  out = out.replace(/==([^=\n]+)==/g, '<mark class="md-mark">$1</mark>');
  // links: [label](url) — URL must be http(s); render new-tab
  out = out.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]{1,500})\)/g,
    (_m, label: string, url: string) =>
      `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  // bare https URLs → plain text link (no icon soup)
  out = out.replace(/(?<!["'=>])(https?:\/\/[^\s<)"]{4,300})(?![^<]*<\/a>)/g,
    (m, url: string) => `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  return out;
}

function renderTable(lines: string[]): string {
  const rows = lines.map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, ''));
  const header = rows[0].split('|').map((c) => c.trim());
  const bodyRows = rows.slice(1).filter((r) => !/^:?-{3,}:?\|/.test(r.replace(/\s/g, '')) && !r.split('|').every((c) => /^:?-+:?$/.test(c.trim())));
  const bodyHtml = bodyRows.slice(0, 24).map((r) => {
    const cells = r.split('|').map((c) => `<td>${inline(c.trim())}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  const headHtml = header.slice(0, 8).map((h) => `<th>${inline(h)}</th>`).join('');
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderCodeBlock(content: string): string {
  const trimmed = content.length > MAX_BLOCK ? content.slice(0, MAX_BLOCK) + '\n…' : content;
  return `<pre class="md-pre"><code>${esc(trimmed)}</code></pre>`;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence (or EOF)
      const cls = lang && /^[a-z]{1,12}$/i.test(lang) ? ` data-lang="${esc(lang)}"` : '';
      html.push(`<div${cls}>${renderCodeBlock(buf.join('\n'))}</div>`);
      continue;
    }

    // table: |a|b|\n|-|-|\n|1|2|
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[-:\s|]+\|\s*$/.test(lines[i + 1])) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      html.push(renderTable(buf));
      continue;
    }

    // hr
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { html.push('<hr class="md-hr">'); i++; continue; }

    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { html.push(`<strong class="md-h md-h${h[1].length}">${inline(h[2])}</strong>`); i++; continue; }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html.push(`<blockquote class="md-quote">${renderInlineBlock(buf.join(' '))}</blockquote>`);
      continue;
    }

    // unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++; }
      html.push(`<ul class="md-ul">${items.map((t) => `<li>${renderInlineBlock(t)}</li>`).join('')}</ul>`);
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      html.push(`<ol class="md-ol">${items.map((t) => `<li>${renderInlineBlock(t)}</li>`).join('')}</ol>`);
      continue;
    }

    // paragraph (gather until blank / structural)
    if (line.trim() !== '') {
      const buf: string[] = [];
      while (
        i < lines.length && lines[i].trim() !== '' &&
        !/^\s*(```|\||#{1,4}\s|>|[-*•]\s|\d+[.)]\s|---+\s*$)/.test(lines[i])
      ) { buf.push(lines[i]); i++; }
      html.push(`<p class="md-p">${renderInlineBlock(buf.join('\n'))}</p>`);
      continue;
    }

    i++;
  }
  return html.join('');
}

/** Inline pass plus soft line breaks inside paragraphs. */
function renderInlineBlock(text: string): string {
  const parts = text.split('\n').map((l) => inline(l));
  return parts.join('<br>');
}
