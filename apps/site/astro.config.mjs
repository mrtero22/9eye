// The public website (decision 0022): static pages, no server.
// SITE_URL is the domain (absolute canonical and social-card URLs). Search engines are let in only
// with SITE_INDEX=1 as well; otherwise every page says noindex and robots.txt disallows all.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL || undefined,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  server: { host: '127.0.0.1', port: 4102 },
  devToolbar: { enabled: false },
});
