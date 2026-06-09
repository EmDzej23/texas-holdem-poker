export const dynamic = 'force-dynamic';
import { getAdminSession } from '@/lib/admin-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SignOutButton } from './SignOutButton';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSession();
  if (!admin) redirect('/admin/login');

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-red-400">Admin</span>
        <Link href="/admin" className="text-gray-300 hover:text-white text-sm">Dashboard</Link>
        <Link href="/admin/tables" className="text-gray-300 hover:text-white text-sm">Tables</Link>
        <Link href="/admin/players" className="text-gray-300 hover:text-white text-sm">Players</Link>
        <Link href="/admin/settlement" className="text-gray-300 hover:text-white text-sm">Settlement</Link>
        <Link href="/admin/reconciliation" className="text-gray-300 hover:text-white text-sm">Reconciliation</Link>
        <span className="ml-auto text-gray-500 text-sm">{admin.username}</span>
        <SignOutButton />
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
