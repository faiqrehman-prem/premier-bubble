import fetch from "node-fetch";
import { convert } from 'html-to-text';

/**
 * Extract clean, readable text content only (no HTML)
 */
export async function extractVisibleText(url: string): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  const r = await fetch(url, { redirect: "follow" as any, signal: ac.signal });
  clearTimeout(t);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  const html = await r.text();

  // Convert HTML to clean text
  const txt = convert(html, {
    wordwrap: false,
    selectors: [
      // Remove these elements completely
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'header', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      { selector: 'aside', format: 'skip' },
      { selector: 'iframe', format: 'skip' },
      { selector: 'noscript', format: 'skip' },
      // Format links as just text
      { selector: 'a', options: { ignoreHref: true } },
      // Handle lists nicely
      { selector: 'ul', options: { itemPrefix: '• ' } },
      { selector: 'ol', options: { itemPrefix: '1. ' } }
    ],
    preserveNewlines: false
  }).trim();

  if (!txt) throw new Error("empty body text");
  return txt;
}