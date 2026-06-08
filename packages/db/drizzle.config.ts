import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Point at compiled JS so drizzle-kit's CJS bundler can resolve .js imports.
  // Run `pnpm build` in packages/db before `db:generate` or `db:push`.
  schema: './dist/schema/index.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
  verbose: true,
  strict: true,
});
