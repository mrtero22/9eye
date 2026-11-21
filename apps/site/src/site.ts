// Everything the website says about the business, in one place (decision 0022).
// "9eye" is the final brand (user, 2026-10-29); BRAND is the one place it is written.

export const BRAND = '9eye';
/** The custom automation studio behind the product (/studio; user, 2026-11-03). */
export const STUDIO = `${BRAND} Studio`;
/** The studio's LinkedIn page (created 2026-11-03); listed as `sameAs` in the structured data. */
export const STUDIO_LINKEDIN = 'https://www.linkedin.com/company/9eye-studio/';
export const TAGLINE = 'AI-powered broadcast scheduling and TV traffic software for channels everywhere.';

/** Shown on every page; Cloudflare Email Routing forwards it to the studio's inbox (user, 2026-11-03). */
export const EMAIL = 'studio@9eye.org';
export const WHATSAPP = '+1 971 480 9697';
export const WHATSAPP_E164 = '+19714809697';
export const WHATSAPP_URL = 'https://wa.me/19714809697';

/** Prices in US dollars, per channel and month. Yearly billing gives two months free. */
export const PRICES = {
  currency: 'USD',
  platform: 999,
  agents: 2390,
  yearlyMonthsPaid: 10,
} as const;

/**
 * The demo and contact forms are e-mailed to the studio's inbox (the address of the Web3Forms account)
 * by Web3Forms (free plan; decision 0022). The access key is public by design: it only lets a form
 * send to that address.
 */
export const FORM_ENDPOINT = 'https://api.web3forms.com/submit';
export const FORM_ACCESS_KEY = '422e83d5-9c46-4fcd-b6e0-c73ebaf7f382';

export const NAV = [
  { href: '/ai-agents', label: 'AI agents', id: 'agents' },
  { href: '/platform', label: 'Platform', id: 'platform' },
  { href: '/platform#solutions', label: 'Solutions', id: 'solutions' },
  { href: '/pricing', label: 'Pricing', id: 'pricing' },
  { href: '/studio', label: 'Studio', id: 'studio' },
  { href: '/studio/playlist-checker', label: 'Playlist checker', id: 'playlist-checker' },
] as const;

/** Long-form guides (/guides/<slug>): the guides page, the footer and the sitemap list them from here. */
export const GUIDES = [
  {
    slug: 'bxf-explained',
    title: 'What is BXF? The Broadcast Exchange Format, explained',
    short: 'BXF explained',
    summary: 'The SMPTE standard that traffic, scheduling and playout systems use to exchange schedules, as-run logs and content data.',
    published: '2026-10-29',
  },
  {
    slug: 'as-run-reconciliation',
    title: 'As-run reconciliation: how TV channels check what actually aired',
    short: 'As-run reconciliation',
    summary: 'Matching the as-run log against the plan, which differences matter, and how make-goods work.',
    published: '2026-10-29',
  },
  {
    slug: 'drop-frame-timecode',
    title: 'Drop-frame timecode, explained: 29.97 and 59.94 fps',
    short: 'Drop-frame timecode',
    summary: 'Why 29.97 fps needs drop-frame timecode, which frame numbers are skipped, and how to convert between frames and timecode.',
    published: '2026-10-29',
  },
] as const;

export const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/ai-agents', label: 'AI agents' },
      { href: '/platform', label: 'Platform' },
      { href: '/tv-traffic-software', label: 'TV traffic' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/demo', label: 'Request a demo' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { href: '/platform#solutions', label: 'Linear broadcast' },
      { href: '/fast-channel-scheduling', label: 'FAST and streaming' },
      { href: '/platform#sol-live', label: 'Sport and live' },
      { href: '/platform#sol-public', label: 'Public media' },
    ],
  },
  {
    title: 'Guides and tools',
    links: [
      ...GUIDES.map((g) => ({ href: `/guides/${g.slug}`, label: g.short })),
      { href: '/tools/timecode-calculator', label: 'Timecode calculator' },
      { href: '/tools/scte35-decoder', label: 'SCTE-35 decoder' },
      { href: '/tools/tv-schedule-template', label: 'TV schedule template' },
      { href: '/tools/ad-break-calculator', label: 'Ad break calculator' },
      { href: '/tools/xmltv-epg-checker', label: 'XMLTV EPG checker' },
      { href: '/guides', label: 'All guides' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/studio', label: 'Studio: workflow automation' },
      { href: '/studio/playlist-checker', label: 'Broadcast playlist checker' },
      { href: '/contact', label: 'Contact' },
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/privacy#cookies', label: 'Cookies' },
    ],
  },
] as const;

export function money(value: number): string {
  return '$' + value.toLocaleString('en-US');
}

export function yearlyMonthly(monthly: number): number {
  return Math.round((monthly * PRICES.yearlyMonthsPaid) / 12);
}
