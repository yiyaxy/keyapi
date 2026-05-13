import { useMemo } from 'react';
import { marked } from 'marked';

const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta']);
const urlAttrs = new Set(['href', 'src']);
const allowedProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function escapeHtml(raw: string) {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isSafeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  try {
    const url = new URL(trimmed, window.location.origin);
    return allowedProtocols.has(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeHtml(html: string) {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('*').forEach((node) => {
    const tagName = node.tagName.toLowerCase();
    if (blockedTags.has(tagName)) {
      node.remove();
      return;
    }

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        return;
      }
      if (urlAttrs.has(name) && !isSafeUrl(attr.value)) {
        node.removeAttribute(attr.name);
      }
    });

    if (tagName === 'a') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noreferrer');
    }
  });

  return doc.body.innerHTML;
}

export function MarkdownContent({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  const html = useMemo(() => {
    const parsed = marked.parse(escapeHtml(content), {
      async: false,
      breaks: true,
      gfm: true,
    }) as string;
    return sanitizeHtml(parsed);
  }, [content]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
