'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/profile';
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const result = await signIn.email({
      email: fd.get('email') as string,
      password: fd.get('password') as string,
    });
    setLoading(false);

    if (result.error) {
      setError(result.error.message ?? 'Sign in failed');
    } else {
      router.push(redirect);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white mb-2">Sign in</h1>
        <p className="text-gray-400 text-sm mb-6">Welcome back</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded-lg px-4 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-gray-500 text-sm text-center mt-6">
          No account?{' '}
          <Link href="/register" className="text-green-400 hover:text-green-300">Register</Link>
        </p>
      </div>
    </div>
  );
}
