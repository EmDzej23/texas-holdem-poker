/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@poker/engine', '@poker/shared', '@poker/db'],
  experimental: {
    // Next.js 14.x API for externalizing server-only packages from webpack.
    serverComponentsExternalPackages: [
      'better-auth',
      '@better-auth/core',
      '@better-auth/kysely-adapter',
      'kysely',
      'postgres',
      'drizzle-orm',
      'bcryptjs',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure transitive deps of better-auth are also treated as externals.
      const { externals } = config;
      const existing = Array.isArray(externals) ? externals : externals ? [externals] : [];
      config.externals = [
        ...existing,
        /^@better-auth\/.*/,
        /^kysely$/,
      ];
    }
    return config;
  },
};

export default nextConfig;
