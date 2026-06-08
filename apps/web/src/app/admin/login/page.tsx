'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
    });
    setLoading(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      setError('Invalid credentials');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-white mb-6">Admin login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            name="username"
            required
            placeholder="Username"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
