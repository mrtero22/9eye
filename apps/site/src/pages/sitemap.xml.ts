// The pages search engines should know, each with the day it last changed: the last commit of its
// source file, or today while the file has uncommitted changes. Empty until SITE_URL is set.
import type { APIRoute } from 'astro';
import { execFileSync } from 'node:child_process';
import { GUIDES } from '../site';

const PAGES: [path: string, source: string][] = [
  ['/', 'index.astro'],
  ['/ai-agents', 'ai-agents.astro'],
  ['/platform', 'platform.astro'],
  ['/tv-traffic-software', 'tv-traffic-software.astro'],
  ['/fast-channel-scheduling', 'fast-channel-scheduling.astro'],
  ['/pricing', 'pricing.astro'],
  ['/guides', 'guides.astro'],
  ...GUIDES.map((g): [string, string] => [`/guides/${g.slug}`, `guides/${g.slug}.astro`]),
  ['/tools/timecode-calculator', 'tools/timecode-calculator.astro'],
  ['/tools/scte35-decoder', 'tools/scte35-decoder.astro'],
  ['/tools/tv-schedule-template', 'tools/tv-schedule-template.astro'],
  ['/tools/ad-break-calculator', 'tools/ad-break-calculator.astro'],
  ['/tools/xmltv-epg-checker', 'tools/xmltv-epg-checker.astro'],
  ['/studio', 'studio.astro'],
  ['/studio/playlist-checker', 'studio/playlist-checker.astro'],
  ['/demo', 'demo.astro'],
  ['/contact', 'contact.astro'],
  ['/privacy', 'privacy.astro'],
];

function lastChanged(source: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const file = `src/pages/${source}`;
  try {
    if (execFileSync('git', ['status', '--porcelain', '--', file], { encoding: 'utf8' }).trim()) return today;
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { encoding: 'utf8' }).trim() || today;
  } catch {
    return today;
  }
}

export const GET: APIRoute = ({ site }) => {
  const urls = site
    ? PAGES.map(([p, source]) => `  <url><loc>${new URL(p, site).href}</loc><lastmod>${lastChanged(source)}</lastmod></url>`).join('\n')
    : '';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
