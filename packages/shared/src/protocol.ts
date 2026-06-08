/**
 * Typed WebSocket protocol contract between Next.js client and ws-service.
 * Both sides import from this package. Never drift these types.
 *
 * Message direction annotations:
 *   C→S = client sends to server
 *   S→C = server sends to client
 */

import type {
  Card,
  Cents,
  GameEvent,
  Phase,
  Pot,
  SeatStatus,
  ValidAction,
} from '@poker/engine';

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface WsMessage<T extends string, P> {
  type: T;
  payload: P;
  /** Monotonically increasing sequence number (server assigns on S→C) */
  seq?: number;
  /** ISO timestamp */
  ts: string;
}

export type AnyWsMessage = ClientMessage | ServerMessage;

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export type ClientMessage =
  | WsMessage<'auth', AuthPayload>
  | WsMessage<'table:join', TableJoinPayload>
  | WsMessage<'table:leave', TableLeavePayload>
  | WsMessage<'seat:sit', SeatSitPayload>
  | WsMessage<'seat:stand', SeatStandPayload>
  | WsMessage<'intent:fold', Record<string, never>>
  | WsMessage<'intent:check', Record<string, never>>
  | WsMessage<'intent:call', Record<string, never>>
  | WsMessage<'intent:bet', BetPayload>
  | WsMessage<'intent:raise', RaisePayload>
  | WsMessage<'intent:allIn', Record<string, never>>
  | WsMessage<'hand:seed', ClientSeedPayload>
  | WsMessage<'admin:reset', Record<string, never>>;

export interface AuthPayload {
  token: string; // JWT or session token — TODO: verify on server
}

export interface TableJoinPayload {
  tableId: string;
}

export interface TableLeavePayload {
  tableId: string;
}

export interface SeatSitPayload {
  tableId: string;
  seatIndex: number;
  buyInCents: Cents;
  clientSeed: string; // for provably-fair commit-reveal
}

export interface SeatStandPayload {
  tableId: string;
}

export interface BetPayload {
  amountCents: Cents;
}

export interface RaisePayload {
  amountCents: Cents; // total bet amount (not raise increment)
}

export interface ClientSeedPayload {
  tableId: string;
  seed: string;
}

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export type ServerMessage =
  | WsMessage<'error', ErrorPayload>
  | WsMessage<'table:state', TableStatePayload>
  | WsMessage<'table:event', GameEvent>
  | WsMessage<'hand:cards', HandCardsPayload>
  | WsMessage<'hand:verify', HandVerifyPayload>
  | WsMessage<'player:balance', PlayerBalancePayload>
  | WsMessage<'seat:updated', SeatUpdatePayload>;

export interface ErrorPayload {
  code: string;
  message: string;
}

/** Full table snapshot — sent on join and on reconnect. */
export interface TableStatePayload {
  tableId: string;
  config: {
    smallBlindCents: Cents;
    bigBlindCents: Cents;
    minBuyInCents: Cents;
    maxBuyInCents: Cents;
    maxSeats: number;
    rakePercent: number;
  };
  seats: PublicSeatView[];
  phase: Phase;
  communityCards: Card[];
  pots: Pot[];
  currentBetCents: Cents;
  actingSeatIndex: number;
  dealerSeatIndex: number;
  turnExpiresAt: number;
  handId?: string | undefined;
}

/** A seat as visible to all players — hole cards are absent. */
export interface PublicSeatView {
  seatIndex: number;
  playerId: string;
  displayName: string;
  stackCents: Cents;
  status: SeatStatus;
  currentStreetBetCents: Cents;
  isConnected: boolean;
  /** Only present for the seat that just showed at showdown */
  revealedHoleCards?: [Card, Card] | undefined;
}

/** Private message — hole cards only sent to the owning player. */
export interface HandCardsPayload {
  seatIndex: number;
  holeCards: [Card, Card];
}

/** Seed reveal for post-hand verification. */
export interface HandVerifyPayload {
  handId: string;
  serverSeed: string;
  clientSeed: string;
  shuffleIndex: number;
  serverSeedHash: string;
}

export interface PlayerBalancePayload {
  playerId: string;
  walletBalanceCents: Cents;
  tableStackCents?: Cents | undefined;
}

export interface SeatUpdatePayload {
  tableId: string;
  seat: PublicSeatView;
}

// ---------------------------------------------------------------------------
// Store interface (abstraction layer for horizontal scaling)
// ---------------------------------------------------------------------------

export interface TableRecord {
  tableId: string;
  handState?: string | undefined; // JSON-serialised HandState
  seats: string;                  // JSON-serialised SeatInfo[]
  shuffleIndex: number;
  config: string;                 // JSON-serialised TableConfig
  createdAt: number;
  lastActivityAt: number;
}

/**
 * TableStore interface — swap in-memory impl for Redis impl in production.
 *
 * TODO (production):
 *   - Redis impl with atomic WATCH/MULTI/EXEC for concurrent mutations.
 *   - Redis pub/sub for cross-node broadcasts so any ws-node can serve any table.
 *   - Separate hand history store (append-only, immutable for audit trail).
 */
export interface TableStore {
  getTable(tableId: string): Promise<TableRecord | undefined>;
  setTable(record: TableRecord): Promise<void>;
  deleteTable(tableId: string): Promise<void>;
  listTables(): Promise<TableRecord[]>;
}

// ---------------------------------------------------------------------------
// Type guards for incoming messages
// ---------------------------------------------------------------------------

export function isClientMessage(msg: unknown): msg is ClientMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}
