'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { TableConfig } from '@poker/engine';

interface TableRow {
  tableId: string;
  config: TableConfig;
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Inline rake editor
// ---------------------------------------------------------------------------

function RakeCell({ table }: { table: TableRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(table.config.rakePercent));
  const [capValue, setCapValue] = useState(String((table.config.rakeCapCents / 100).toFixed(2)));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const rake = parseFloat(value);
    const cap = parseFloat(capValue);
    if (isNaN(rake) || rake < 0 || rake > 50) { setError('0–50%'); return; }
    if (isNaN(cap) || cap < 0) { setError('Invalid cap'); return; }
    setError('');
    const res = await fetch(`/api/admin/tables/${table.tableId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rakePercent: rake, rakeCapCents: Math.round(cap * 100) }),
    });
    if (!res.ok) { setError('Save failed'); return; }
    setEditing(false);
    startTransition(() => router.refresh());
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-sm text-gray-300 hover:text-white underline decoration-dotted"
        title="Click to edit"
      >
        {table.config.rakePercent}% / {fmt(table.config.rakeCapCents)} cap
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <input
        type="number" min="0" max="50" step="0.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-16 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-sm text-white"
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
      <span className="text-gray-400 text-xs">% cap</span>
      <input
        type="number" min="0" step="0.25"
        value={capValue}
        onChange={(e) => setCapValue(e.target.value)}
        className="w-20 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-sm text-white"
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }}
        placeholder="cap $"
      />
      <button
        onClick={() => void save()}
        disabled={pending}
        className="px-2 py-0.5 bg-green-700 hover:bg-green-600 rounded text-xs font-semibold text-white"
      >
        {pending ? '…' : 'Save'}
      </button>
      <button onClick={() => setEditing(false)} className="text-gray-500 text-xs hover:text-white">✕</button>
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy link button
// ---------------------------------------------------------------------------

function CopyLinkButton({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={() => void copy()}
      className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200"
    >
      {copied ? '✓ Copied' : 'Copy link'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Create table modal
// ---------------------------------------------------------------------------

const DEFAULT_FORM = {
  tableId: '',
  smallBlind: '0.50',
  maxSeats: '6',
  minBuyIn: '40',
  maxBuyIn: '200',
  rakePercent: '0',
  rakeCap: '0',
  turnTimeout: '30',
};

function CreateTableModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k: keyof typeof DEFAULT_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  // Auto-suggest tableId from blinds
  function suggestId() {
    const sb = parseFloat(form.smallBlind);
    if (!isNaN(sb)) {
      const bb = sb * 2;
      const slug = `${sb.toFixed(0)}c-${(bb * 100).toFixed(0)}c`.replace('.', '');
      setForm((f) => ({ ...f, tableId: `table-${Date.now().toString(36)}` }));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const sb = Math.round(parseFloat(form.smallBlind) * 100);
    const bb = sb * 2;
    const minBuy = Math.round(parseFloat(form.minBuyIn) * bb / 100);
    const maxBuy = Math.round(parseFloat(form.maxBuyIn) * bb / 100);
    const tableId = form.tableId.trim() || `table-${Date.now().toString(36)}`;

    const config: TableConfig = {
      tableId,
      smallBlindCents: sb,
      bigBlindCents: bb,
      minBuyInCents: minBuy,
      maxBuyInCents: maxBuy,
      maxSeats: parseInt(form.maxSeats),
      rakePercent: parseFloat(form.rakePercent),
      rakeCapCents: Math.round(parseFloat(form.rakeCap) * 100),
      turnTimeoutMs: parseInt(form.turnTimeout) * 1000,
    };

    setLoading(true);
    const res = await fetch('/api/admin/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      setError(body.error ?? 'Failed to create table');
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Create table</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <Row label="Table ID (slug)">
            <input
              type="text" value={form.tableId} onChange={set('tableId')} onFocus={suggestId}
              placeholder="auto-generated if empty"
              className="input w-full"
            />
          </Row>
          <Row label="Small blind ($)">
            <input type="number" min="0.01" step="0.01" value={form.smallBlind} onChange={set('smallBlind')} className="input w-full" required />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Min buy-in (× BB)">
              <input type="number" min="1" step="1" value={form.minBuyIn} onChange={set('minBuyIn')} className="input w-full" required />
            </Row>
            <Row label="Max buy-in (× BB)">
              <input type="number" min="1" step="1" value={form.maxBuyIn} onChange={set('maxBuyIn')} className="input w-full" required />
            </Row>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Max seats">
              <select value={form.maxSeats} onChange={set('maxSeats')} className="input w-full">
                {[2,3,4,5,6,7,8,9].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Row>
            <Row label="Turn timeout (s)">
              <input type="number" min="10" max="120" step="5" value={form.turnTimeout} onChange={set('turnTimeout')} className="input w-full" required />
            </Row>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Rake %">
              <input type="number" min="0" max="50" step="0.5" value={form.rakePercent} onChange={set('rakePercent')} className="input w-full" required />
            </Row>
            <Row label="Rake cap ($)">
              <input type="number" min="0" step="0.25" value={form.rakeCap} onChange={set('rakeCap')} className="input w-full" required />
            </Row>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit" disabled={loading}
              className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg font-semibold text-sm"
            >
              {loading ? 'Creating…' : 'Create table'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetButton({ tableId }: { tableId: string }) {
  const [status, setStatus] = useState<'idle' | 'confirm' | 'loading' | 'done'>('idle');
  async function handle() {
    if (status === 'loading') return;
    if (status !== 'confirm') { setStatus('confirm'); return; }
    setStatus('loading');
    await fetch('/api/admin/table-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId }),
    });
    setStatus('done');
    setTimeout(() => setStatus('idle'), 2500);
  }
  const labels = { idle: 'Reset', confirm: 'Sure?', loading: '…', done: '✓' };
  const cls = {
    idle: 'bg-gray-700 hover:bg-red-900 text-gray-300',
    confirm: 'bg-red-700 hover:bg-red-600 text-white animate-pulse',
    loading: 'bg-gray-700 text-gray-500 cursor-not-allowed',
    done: 'bg-green-800 text-white',
  };
  return (
    <button onClick={() => void handle()} className={`px-2 py-1 rounded text-xs font-medium ${cls[status]}`}>
      {labels[status]}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function TablesClient({ tables, appUrl }: { tables: TableRow[]; appUrl: string }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <div className="border border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-900/50">
          <span className="text-sm text-gray-400">{tables.length} table{tables.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-semibold"
          >
            + Create table
          </button>
        </div>

        {tables.length === 0 ? (
          <p className="text-gray-500 text-sm p-5">No tables yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-gray-800">
                <th className="text-left px-5 py-2 font-medium">Table ID</th>
                <th className="text-left px-4 py-2 font-medium">Blinds</th>
                <th className="text-left px-4 py-2 font-medium">Seats</th>
                <th className="text-left px-4 py-2 font-medium">Buy-in</th>
                <th className="text-left px-4 py-2 font-medium">Rake</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {tables.map((t, i) => (
                <tr key={t.tableId} className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-900/30'}`}>
                  <td className="px-5 py-3 font-mono text-gray-200">{t.tableId}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {fmt(t.config.smallBlindCents)} / {fmt(t.config.bigBlindCents)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{t.config.maxSeats}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {fmt(t.config.minBuyInCents)} – {fmt(t.config.maxBuyInCents)}
                  </td>
                  <td className="px-4 py-3">
                    <RakeCell table={t} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <CopyLinkButton href={`${appUrl}/table/${t.tableId}`} />
                      <ResetButton tableId={t.tableId} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateTableModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            router.refresh();
          }}
        />
      )}

      <style>{`.input { background: #1f2937; border: 1px solid #374151; border-radius: 0.375rem; padding: 0.375rem 0.5rem; color: white; font-size: 0.875rem; outline: none; } .input:focus { border-color: #4b5563; }`}</style>
    </>
  );
}
