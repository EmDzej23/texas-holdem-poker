'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUp } from '@/lib/auth-client';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const name = fd.get('name') as string;
    const email = fd.get('email') as string;
    const password = fd.get('password') as string;

    const result = await signUp.email({ name, email, password });
    setLoading(false);

    if (result.error) {
      setError(result.error.message ?? 'Registration failed');
    } else {
      router.push('/profile');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white mb-2">Create account</h1>
        <p className="text-gray-400 text-sm mb-6">Start playing Texas Hold'em</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Display name</label>
            <input
              name="name"
              required
              minLength={2}
              maxLength={32}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
              placeholder="PokerPro"
            />
          </div>

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
              minLength={8}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
              placeholder="Min 8 characters"
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
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-gray-500 text-sm text-center mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-green-400 hover:text-green-300">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
