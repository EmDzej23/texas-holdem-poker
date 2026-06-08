import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '@poker/db';
import { authUsers, authSessions, authAccounts, authVerifications, players } from '@poker/db';

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: authUsers,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,     // refresh if older than 1 day
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Create the poker player profile linked to the auth user.
          await getDb()
            .insert(players)
            .values({
              id: user.id,
              username: user.name,
              email: user.email,
            })
            .onConflictDoNothing();
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
