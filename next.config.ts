import type { NextConfig } from 'next';
import { RETIRED_PAGES } from './src/lib/game/features';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Caddy compresses every answer (encode zstd gzip); doing it here too cost the single CPU twice.
  compress: false,
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
  // Pages of the features removed in „Просто“ lead to „Игри и награди“ (old links, bookmarks).
  async redirects() {
    return RETIRED_PAGES.flatMap((page) => [
      { source: page, destination: '/game/play', permanent: false },
      { source: `${page}/:rest*`, destination: '/game/play', permanent: false },
    ]);
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
