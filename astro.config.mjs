import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';

// E2E CI builds use @astrojs/node so `astro preview` works (Vercel adapter
// doesn't support preview). The Node adapter is a devDependency.
const adapter = process.env.E2E_BUILD
  ? (await import('@astrojs/node')).default({ mode: 'standalone' })
  : vercel();

export default defineConfig({
  output: 'server',
  adapter,
  integrations: [preact(), tailwind()],
  image: {
    remotePatterns: [
      {
        protocol: 'https',
      },
    ],
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  vite: {
    server: {
      proxy: {
        '/api': {
          target: process.env.API_BASE_URL || 'http://localhost:8001',
          changeOrigin: true,
        },
      },
    },
  },
});
