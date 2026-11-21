// Structured data (schema.org JSON-LD) for search engines.
import { BRAND, EMAIL, PRICES, STUDIO, STUDIO_LINKEDIN, TAGLINE, WHATSAPP_E164 } from './site';

export interface Faq { q: string; a: string }

export function organization(site?: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND,
    ...(site ? { url: site.href, logo: new URL('/logo.png', site).href } : {}),
    email: EMAIL,
    contactPoint: { '@type': 'ContactPoint', contactType: 'sales', email: EMAIL, telephone: WHATSAPP_E164, availableLanguage: ['English'] },
  };
}

/** The site's name in search results (home page only). */
export function website(site?: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND,
    ...(site ? { url: site.href } : {}),
  };
}

/** A free tool that runs in the browser. */
export function webApplication(site: URL | undefined, a: { name: string; description: string; path: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: a.name,
    description: a.description,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: PRICES.currency },
    publisher: { '@type': 'Organization', name: BRAND },
    ...(site ? { url: new URL(a.path, site).href } : {}),
  };
}

export function breadcrumbs(site: URL | undefined, items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(site ? { item: new URL(item.path, site).href } : {}),
    })),
  };
}

/** A service of the studio (/studio pages): what it is, who provides it, and that it is offered worldwide. */
export function service(site: URL | undefined, s: { name: string; description: string; path: string; serviceType: string[] }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: s.name,
    description: s.description,
    serviceType: s.serviceType,
    areaServed: { '@type': 'Place', name: 'Worldwide' },
    provider: { '@type': 'Organization', name: STUDIO, parentOrganization: { '@type': 'Organization', name: BRAND }, email: EMAIL, sameAs: [STUDIO_LINKEDIN], ...(site ? { url: new URL('/studio', site).href } : {}) },
    ...(site ? { url: new URL(s.path, site).href } : {}),
  };
}

export function article(site: URL | undefined, a: { headline: string; description: string; path: string; published: string; modified?: string }) {
  const publisher = { '@type': 'Organization', name: BRAND, ...(site ? { logo: new URL('/logo.png', site).href } : {}) };
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: a.headline,
    description: a.description,
    datePublished: a.published,
    dateModified: a.modified ?? a.published,
    author: { '@type': 'Organization', name: BRAND, ...(site ? { url: site.href } : {}) },
    publisher,
    ...(site ? { mainEntityOfPage: new URL(a.path, site).href, image: new URL('/og.png', site).href } : {}),
  };
}

export function softwareApplication(site?: URL) {
  const offer = (name: string, price: number) => ({
    '@type': 'Offer',
    name,
    price: String(price),
    priceCurrency: PRICES.currency,
    priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: PRICES.currency, unitText: 'per channel per month' },
    ...(site ? { url: new URL('/pricing', site).href } : {}),
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: BRAND,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Broadcast scheduling and traffic software',
    operatingSystem: 'Web',
    description: TAGLINE,
    ...(site ? { url: site.href } : {}),
    offers: [offer('Platform', PRICES.platform), offer('Platform + AI agents', PRICES.agents)],
  };
}

export function faqPage(items: Faq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
  };
}
