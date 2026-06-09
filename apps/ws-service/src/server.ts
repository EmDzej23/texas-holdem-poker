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
import type { ClientMessage } from '@poker/shared';
import { isClientMessage } from '@poker/shared';

const PORT = Number(process.env['WS_PORT'] ?? 8080);
const ADMIN_SECRET = process.env['WS_ADMIN_SECRET'] ?? '';

const store = createMemoryTableStore();
const rooms = new Map<string, TableRoom>();

// Bootstrap a default table for development
const defaultConfig: TableConfig = {
  tableId: 'table-1',
  smallBlindCents: 50,
  bigBlindCents: 100,
  minBuyInCents: 4000,
  maxBuyInCents: 20000,
  maxSeats: 6,
  rakePercent: 5,
  rakeCapCents: 300,
  turnTimeoutMs: 30_000,
};

const defaultRoom = new TableRoom(defaultConfig, store);
rooms.set(defaultConfig.tableId, defaultRoom);

await store.setTable({
  tableId: defaultConfig.tableId,
  seats: '[]',
  shuffleIndex: 0,
  config: JSON.stringify(defaultConfig),
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
});

// HTTP server — shared with WebSocket server, also handles admin REST endpoints
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-admin-secret');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/admin/reset-table')) {
    if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      const { tableId } = (body ? JSON.parse(body) : {}) as { tableId?: string };
      const room = rooms.get(tableId ?? 'table-1');
      if (room) room.clearAllSeats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tableId: tableId ?? 'table-1' }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

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
        // TODO (production): verify JWT, extract playerId and displayName from claims.
        // For now, use a simple token=playerId scheme for dev.
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
          playerId,             // pass server-verified identity
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
          currentRoom.applyPlayerAction(playerId, {
            type: 'bet',
            amountCents: msg.payload.amountCents,
          });
        break;

      case 'intent:raise':
        if (playerId && currentRoom)
          currentRoom.applyPlayerAction(playerId, {
            type: 'raise',
            amountCents: msg.payload.amountCents,
          });
        break;

      case 'intent:allIn':
        if (playerId && currentRoom) currentRoom.applyPlayerAction(playerId, { type: 'allIn' });
        break;

      case 'admin:reset': {
        // Dev-only: clear all seats on the current room
        if (process.env['NODE_ENV'] !== 'production' && currentRoom) {
          currentRoom.clearAllSeats();
        }
        break;
      }

      default:
        // Unknown message type — ignore silently
        break;
    }
  });

  ws.on('close', () => {
    currentRoom?.removeClient(connectionId);
  });

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
