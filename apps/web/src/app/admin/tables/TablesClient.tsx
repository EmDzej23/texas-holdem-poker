'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { TableConfig } from '@poker/engine';

interface TableRow {
  tableId: string;
  config: TableConfig;
}

const CURRENCIES = ['$', '€', '£', '₽', '₸', '₿'];

function fmtCents(cents: number, sym = '$') {
  return `${sym}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Edit table modal
// ---------------------------------------------------------------------------

function EditTableModal({ table, onClose, onSaved }: {
  table: TableRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = table.config;
  const [form, setForm] = useState({
    smallBlind: (c.smallBlindCents / 100).toFixed(2),
    bigBlind: (c.bigBlindCents / 100).toFixed(2),
    minBuyIn: (c.minBuyInCents / 100).toFixed(2),
    maxBuyIn: (c.maxBuyInCents / 100).toFixed(2),
    rakePercent: String(c.rakePercent),
    rakeCap: (c.rakeCapCents / 100).toFixed(2),
    currencySymbol: c.currencySymbol ?? '$',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const patch = {
      smallBlindCents: Math.round(parseFloat(form.smallBlind) * 100),
      bigBlindCents: Math.round(parseFloat(form.bigBlind) * 100),
      minBuyInCents: Math.round(parseFloat(form.minBuyIn) * 100),
      maxBuyInCents: Math.round(parseFloat(form.maxBuyIn) * 100),
      rakePercent: parseFloat(form.rakePercent),
      rakeCapCents: Math.round(parseFloat(form.rakeCap) * 100),
      currencySymbol: form.currencySymbol || '$',
    };
    if (patch.bigBlindCents <= patch.smallBlindCents) { setError('Big blind must be > small blind'); return; }
    if (patch.minBuyInCents <= 0) { setError('Min buy-in must be > 0'); return; }
    if (patch.maxBuyInCents <= patch.minBuyInCents) { setError('Max buy-in must be > min'); return; }
    if (patch.rakePercent < 0 || patch.rakePercent > 50) { setError('Rake 0–50%'); return; }

    setLoading(true);
    const res = await fetch(`/api/admin/tables/${table.tableId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json() as { error?: string; detail?: string };
      setError(body.detail ?? body.error ?? 'Save failed');
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Edit <span className="font-mono text-gray-300">{table.tableId}</span></h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <form onSubmit={(e) => void save(e)} className="space-y-4">

          {/* Currency */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Currency symbol</label>
            <div className="flex gap-2 flex-wrap">
              {CURRENCIES.map((s) => (
                <button
                  key={s} type="button"
                  onClick={() => setForm((f) => ({ ...f, currencySymbol: s }))}
                  className={`w-9 h-9 rounded-lg text-sm font-bold border transition-colors ${
                    form.currencySymbol === s
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'
                  }`}
                >{s}</button>
              ))}
              <input
                type="text" maxLength={3}
                value={form.currencySymbol}
                onChange={set('currencySymbol')}
                className="input w-16 text-center font-bold"
                placeholder="other"
              />
            </div>
          </div>

          {/* Blinds */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Blinds</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-gray-500 mb-1 block">Small blind</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                  <input type="number" min="0.01" step="0.01" value={form.smallBlind}
                    onChange={(e) => {
                      const sb = e.target.value;
                      const bb = (parseFloat(sb) * 2).toFixed(2);
                      setForm((f) => ({ ...f, smallBlind: sb, bigBlind: bb }));
                    }}
                    className="input flex-1" required />
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 mb-1 block">Big blind</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                  <input type="number" min="0.01" step="0.01" value={form.bigBlind}
                    onChange={set('bigBlind')} className="input flex-1" required />
                </div>
              </div>
            </div>
          </div>

          {/* Buy-in */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Buy-in range</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-gray-500 mb-1 block">Min</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                  <input type="number" min="0.01" step="0.01" value={form.minBuyIn}
                    onChange={set('minBuyIn')} className="input flex-1" required />
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 mb-1 block">Max</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                  <input type="number" min="0.01" step="0.01" value={form.maxBuyIn}
                    onChange={set('maxBuyIn')} className="input flex-1" required />
                </div>
              </div>
            </div>
          </div>

          {/* Rake */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Rake</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-gray-500 mb-1 block">Percentage</span>
                <div className="flex items-center gap-1">
                  <input type="number" min="0" max="50" step="0.5" value={form.rakePercent}
                    onChange={set('rakePercent')} className="input flex-1" required />
                  <span className="text-gray-400 text-sm">%</span>
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 mb-1 block">Cap per hand</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                  <input type="number" min="0" step="0.25" value={form.rakeCap}
                    onChange={set('rakeCap')} className="input flex-1" required />
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-1">Cap = max rake taken from any single hand</p>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading}
              className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg font-semibold text-sm">
              {loading ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create table modal
// ---------------------------------------------------------------------------

const DEFAULT_FORM = {
  tableId: '',
  smallBlind: '0.50',
  bigBlind: '1.00',
  maxSeats: '6',
  minBuyIn: '20.00',
  maxBuyIn: '200.00',
  rakePercent: '0',
  rakeCap: '0.00',
  turnTimeout: '30',
  currencySymbol: '$',
};

function CreateTableModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k: keyof typeof DEFAULT_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const tableId = form.tableId.trim() || `table-${Date.now().toString(36)}`;
    const config: TableConfig = {
      tableId,
      smallBlindCents: Math.round(parseFloat(form.smallBlind) * 100),
      bigBlindCents: Math.round(parseFloat(form.bigBlind) * 100),
      minBuyInCents: Math.round(parseFloat(form.minBuyIn) * 100),
      maxBuyInCents: Math.round(parseFloat(form.maxBuyIn) * 100),
      maxSeats: parseInt(form.maxSeats),
      rakePercent: parseFloat(form.rakePercent),
      rakeCapCents: Math.round(parseFloat(form.rakeCap) * 100),
      turnTimeoutMs: parseInt(form.turnTimeout) * 1000,
      currencySymbol: form.currencySymbol || '$',
    };
    setLoading(true);
    const res = await fetch('/api/admin/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json() as { error?: string; detail?: string };
      setError(body.detail ?? body.error ?? 'Failed to create table');
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
          <div>
            <label className="block text-xs text-gray-400 mb-1">Table ID (slug)</label>
            <input type="text" value={form.tableId} onChange={set('tableId')}
              placeholder="auto-generated if empty" className="input w-full" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Currency symbol</label>
            <div className="flex gap-2 flex-wrap">
              {CURRENCIES.map((s) => (
                <button key={s} type="button"
                  onClick={() => setForm((f) => ({ ...f, currencySymbol: s }))}
                  className={`w-9 h-9 rounded-lg text-sm font-bold border transition-colors ${
                    form.currencySymbol === s
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Small blind</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                <input type="number" min="0.01" step="0.01" value={form.smallBlind}
                  onChange={(e) => {
                    const sb = e.target.value;
                    const bb = (parseFloat(sb) * 2).toFixed(2);
                    setForm((f) => ({ ...f, smallBlind: sb, bigBlind: bb }));
                  }}
                  className="input flex-1" required />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Big blind</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                <input type="number" min="0.01" step="0.01" value={form.bigBlind}
                  onChange={set('bigBlind')} className="input flex-1" required />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Min buy-in</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                <input type="number" min="0.01" step="0.01" value={form.minBuyIn}
                  onChange={set('minBuyIn')} className="input flex-1" required />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max buy-in</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                <input type="number" min="0.01" step="0.01" value={form.maxBuyIn}
                  onChange={set('maxBuyIn')} className="input flex-1" required />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max seats</label>
              <select value={form.maxSeats} onChange={set('maxSeats')} className="input w-full">
                {[2,3,4,5,6,7,8,9].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Turn timeout (s)</label>
              <input type="number" min="10" max="120" step="5" value={form.turnTimeout}
                onChange={set('turnTimeout')} className="input w-full" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rake %</label>
              <input type="number" min="0" max="50" step="0.5" value={form.rakePercent}
                onChange={set('rakePercent')} className="input w-full" required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rake cap</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-400 text-sm">{form.currencySymbol}</span>
                <input type="number" min="0" step="0.25" value={form.rakeCap}
                  onChange={set('rakeCap')} className="input flex-1" required />
              </div>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading}
              className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg font-semibold text-sm">
              {loading ? 'Creating…' : 'Create table'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reset button
// ---------------------------------------------------------------------------

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
    <button onClick={() => void handle()}
      className={`px-2 py-1 rounded text-xs font-medium ${cls[status]}`}>
      {labels[status]}
    </button>
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
    <button onClick={() => void copy()}
      className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200">
      {copied ? '✓ Copied' : 'Copy link'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function TablesClient({ tables, appUrl }: { tables: TableRow[]; appUrl: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [editingTable, setEditingTable] = useState<TableRow | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="border border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-900/50">
          <span className="text-sm text-gray-400">{tables.length} table{tables.length !== 1 ? 's' : ''}</span>
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-semibold">
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
                <th className="text-left px-4 py-2 font-medium">Buy-in</th>
                <th className="text-left px-4 py-2 font-medium">Rake</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {tables.map((t, i) => {
                const sym = t.config.currencySymbol ?? '$';
                return (
                  <tr key={t.tableId} className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-900/30'}`}>
                    <td className="px-5 py-3">
                      <span className="font-mono text-gray-200">{t.tableId}</span>
                      <span className="ml-2 text-xs text-gray-500">{t.config.maxSeats} seats</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {fmtCents(t.config.smallBlindCents, sym)}/{fmtCents(t.config.bigBlindCents, sym)}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {fmtCents(t.config.minBuyInCents, sym)} – {fmtCents(t.config.maxBuyInCents, sym)}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {t.config.rakePercent}%{t.config.rakeCapCents > 0 ? ` / ${fmtCents(t.config.rakeCapCents, sym)} cap` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingTable(t)}
                          className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200"
                        >
                          Edit
                        </button>
                        <CopyLinkButton href={`${appUrl}/table/${t.tableId}`} />
                        <ResetButton tableId={t.tableId} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editingTable && (
        <EditTableModal
          table={editingTable}
          onClose={() => setEditingTable(null)}
          onSaved={() => { setEditingTable(null); refresh(); }}
        />
      )}

      {showCreate && (
        <CreateTableModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}

      <style>{`.input { background: #1f2937; border: 1px solid #374151; border-radius: 0.375rem; padding: 0.375rem 0.5rem; color: white; font-size: 0.875rem; outline: none; width: 100%; } .input:focus { border-color: #4b5563; }`}</style>
    </>
  );
}
