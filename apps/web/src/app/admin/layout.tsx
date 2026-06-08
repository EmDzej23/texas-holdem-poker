import { getAdminSession } from '@/lib/admin-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSession();
  if (!admin) redirect('/admin/login');

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-red-400">Admin</span>
        <Link href="/admin" className="text-gray-300 hover:text-white text-sm">Dashboard</Link>
        <Link href="/admin/players" className="text-gray-300 hover:text-white text-sm">Players</Link>
        <Link href="/admin/settlement" className="text-gray-300 hover:text-white text-sm">Settlement</Link>
        <Link href="/admin/reconciliation" className="text-gray-300 hover:text-white text-sm">Reconciliation</Link>
        <span className="ml-auto text-gray-500 text-sm">{admin.username}</span>
        <form action="/api/admin/auth" method="POST">
          <input type="hidden" name="_method" value="DELETE" />
          <button
            type="button"
            onClick={async () => {
              await fetch('/api/admin/auth', { method: 'DELETE' });
              window.location.href = '/admin/login';
            }}
            className="text-gray-400 hover:text-white text-sm"
          >
            Sign out
          </button>
        </form>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
