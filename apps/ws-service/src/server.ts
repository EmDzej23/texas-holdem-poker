/**
 * WebSocket service entry point.
 *
 * Runs as a separate process from Next.js.
 * Clients connect via ws://localhost:8080 (or behind a reverse proxy in prod).
 *
 * TODO (production):
 *   - TLS termination at load balancer / reverse proxy.
 *   - JWT auth middleware (verify token on `auth` message, reject otherwise).
 *   - Rate limiting per IP.
 *   - Health-check endpoint for k8s liveness probe.
 *   - Redis pub/sub adapter so multiple ws-service instances can serve the
 *     same table (horizontal scaling).
 *   - KYC/AML gate: players cannot sit until KYC is verified.
 *   - Regulatory: geo-block based on IP jurisdiction.
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { TableRoom } from './tableRoom.js';
import { createMemoryTableStore } from './store/memory.js';
import type { TableConfig } from '@poker/engine';
import { LedgerService } from '@poker/engine';
import type { ClientMessage } from '@poker/shared';
import { isClientMessage } from '@poker/shared';
import { createDb, createPgLedgerStore, createPgTableStore, createHandRepository } from '@poker/db';

const PORT = Number(process.env['WS_PORT'] ?? 8080);
const ADMIN_SECRET = process.env['WS_ADMIN_SECRET'] ?? '';

// DB-backed persistence (optional — degrades gracefully if DATABASE_URL is missing)
const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const db = DATABASE_URL ? createDb(DATABASE_URL) : undefined;
const ledger = db ? new LedgerService(createPgLedgerStore(db)) : undefined;
const handRepo = db ? createHandRepository(db) : undefined;
if (!db) console.warn('[ws-service] DATABASE_URL not set — hand results and ledger will not be persisted');

const tableStore = db ? createPgTableStore(db) : createMemoryTableStore();
const rooms = new Map<string, TableRoom>();

function makeRoom(config: TableConfig): TableRoom {
  return new TableRoom(config, tableStore, { ledger, handRepo });
}

// Bootstrap tables: load from DB or create a default
const existingTables = await tableStore.listTables();
if (existingTables.length > 0) {
  for (const record of existingTables) {
    const config = JSON.parse(record.config) as TableConfig;
    rooms.set(config.tableId, makeRoom(config));
    console.log(`[ws-service] loaded table ${config.tableId} from store`);
  }
} else {
  const defaultConfig: TableConfig = {
    tableId: 'table-1',
    smallBlindCents: 50,
    bigBlindCents: 100,
    minBuyInCents: 4000,
    maxBuyInCents: 20000,
    maxSeats: 6,
    rakePercent: 0,
    rakeCapCents: 0,
    turnTimeoutMs: 30_000,
  };
  const room = makeRoom(defaultConfig);
  rooms.set(defaultConfig.tableId, room);
  await tableStore.setTable({
    tableId: defaultConfig.tableId,
    seats: '[]',
    shuffleIndex: 0,
    config: JSON.stringify(defaultConfig),
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
  console.log('[ws-service] created default table-1');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

function requireAdminSecret(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// HTTP server — shared with WebSocket, handles admin REST endpoints
// ---------------------------------------------------------------------------

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-admin-secret');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  void handleRequest(req, res);
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '';

  if (req.method === 'GET' && url === '/health') {
    json(res, 200, { ok: true });
    return;
  }

  // GET /admin/tables — list all rooms with live player count
  if (req.method === 'GET' && url === '/admin/tables') {
    if (!requireAdminSecret(req, res)) return;
    const result = [...rooms.entries()].map(([, room]) => ({
      tableId: room.config.tableId,
      config: room.config,
      playerCount: room.getPlayerCount(),
    }));
    json(res, 200, result);
    return;
  }

  // POST /admin/create-table
  if (req.method === 'POST' && url === '/admin/create-table') {
    if (!requireAdminSecret(req, res)) return;
    const body = await readBody(req);
    let config: TableConfig;
    try {
      config = JSON.parse(body) as TableConfig;
      if (!config.tableId) throw new Error('tableId required');
    } catch (e) {
      json(res, 400, { error: String(e) });
      return;
    }
    if (rooms.has(config.tableId)) {
      json(res, 409, { error: `Table ${config.tableId} already exists` });
      return;
    }
    const room = makeRoom(config);
    rooms.set(config.tableId, room);
    await tableStore.setTable({
      tableId: config.tableId,
      seats: '[]',
      shuffleIndex: 0,
      config: JSON.stringify(config),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    json(res, 201, { ok: true, tableId: config.tableId });
    return;
  }

  // PATCH /admin/update-table — update rake (and optionally other settings)
  if (req.method === 'PATCH' && url === '/admin/update-table') {
    if (!requireAdminSecret(req, res)) return;
    const body = await readBody(req);
    const { tableId, rakePercent, rakeCapCents } =
      JSON.parse(body) as { tableId: string; rakePercent?: number; rakeCapCents?: number };
    const room = rooms.get(tableId);
    if (!room) { json(res, 404, { error: 'Table not found' }); return; }
    await room.updateConfig({ rakePercent, rakeCapCents });
    json(res, 200, { ok: true, tableId, rakePercent: room.config.rakePercent });
    return;
  }

  // POST /admin/reset-table
  if (req.method === 'POST' && url?.startsWith('/admin/reset-table')) {
    if (!requireAdminSecret(req, res)) return;
    const body = await readBody(req);
    const { tableId } = (body ? JSON.parse(body) : {}) as { tableId?: string };
    const room = rooms.get(tableId ?? 'table-1');
    if (room) room.clearAllSeats();
    json(res, 200, { ok: true, tableId: tableId ?? 'table-1' });
    return;
  }

  res.writeHead(404);
  res.end();
}

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => {
  console.log(`[ws-service] listening on ws://localhost:${PORT}`);
});

wss.on('connection', (ws: WebSocket, req) => {
  const connectionId = uuid();
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';

  let playerId: string | undefined;
  let displayName = 'Guest';
  let currentRoom: TableRoom | undefined;

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      const parsed: unknown = JSON.parse(raw.toString());
      if (!isClientMessage(parsed)) throw new Error('Invalid message');
      msg = parsed;
    } catch {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { code: 'PARSE_ERROR', message: 'Invalid JSON or message format' },
        ts: new Date().toISOString(),
      }));
      return;
    }

    switch (msg.type) {
      case 'auth': {
        playerId = msg.payload.token;
        displayName = (msg.payload as { token?: string; displayName?: string }).displayName
          ?? playerId
          ?? 'Guest';
        break;
      }

      case 'table:join': {
        const room = rooms.get(msg.payload.tableId);
        if (!room) {
          sendError(ws, 'TABLE_NOT_FOUND', `No table ${msg.payload.tableId}`);
          return;
        }
        currentRoom = room;
        room.addClient(connectionId, ws, playerId ?? '', displayName, ip);
        break;
      }

      case 'table:leave': {
        currentRoom?.removeClient(connectionId);
        currentRoom = undefined;
        break;
      }

      case 'seat:sit': {
        if (!playerId || !currentRoom) return;
        currentRoom.sitPlayer(
          connectionId,
          playerId,
          msg.payload.seatIndex,
          msg.payload.buyInCents,
          msg.payload.clientSeed,
        );
        break;
      }

      case 'seat:stand': {
        if (!playerId || !currentRoom) return;
        currentRoom.standPlayer(connectionId);
        break;
      }

      case 'intent:fold':
        if (playerId && currentRoom) currentRoom.applyPlayerAction(playerId, { type: 'fold' });
        break;

      case 'intent:check':
        if (playerId && currentRoom) currentRoom.applyPlayerAction(playerId, { type: 'check' });
        break;

      case 'intent:call':
        if (playerId && currentRoom) currentRoom.applyPlayerAction(playerId, { type: 'call' });
        break;

      case 'intent:bet':
        if (playerId && currentRoom)
          currentRoom.applyPlayerAction(playerId, { type: 'bet', amountCents: msg.payload.amountCents });
        break;

      case 'intent:raise':
        if (playerId && currentRoom)
          currentRoom.applyPlayerAction(playerId, { type: 'raise', amountCents: msg.payload.amountCents });
        break;

      case 'intent:allIn':
        if (playerId && currentRoom) currentRoom.applyPlayerAction(playerId, { type: 'allIn' });
        break;

      case 'admin:reset': {
        if (process.env['NODE_ENV'] !== 'production' && currentRoom) {
          currentRoom.clearAllSeats();
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => { currentRoom?.removeClient(connectionId); });
  ws.on('error', (err) => {
    console.error(`[ws-service] connection ${connectionId} error:`, err.message);
    currentRoom?.removeClient(connectionId);
  });
});

function sendError(ws: WebSocket, code: string, message: string): void {
  ws.send(JSON.stringify({
    type: 'error',
    payload: { code, message },
    ts: new Date().toISOString(),
  }));
}
