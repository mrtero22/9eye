// Closed to crawlers until the site has its domain (SITE_URL) and the user opens it (SITE_INDEX=1).
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) =>
  new Response(
    site && process.env.SITE_INDEX === '1'
      ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`
      : 'User-agent: *\nDisallow: /\n',
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
