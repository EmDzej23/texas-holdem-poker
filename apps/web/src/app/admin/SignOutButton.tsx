'use client';

export function SignOutButton() {
  return (
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
  );
}
