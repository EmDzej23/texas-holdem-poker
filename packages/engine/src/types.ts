// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Card = `${Rank}${Suit}`;

// ---------------------------------------------------------------------------
// Money — always integer cents (or smallest denomination chips)
// ---------------------------------------------------------------------------
export type Cents = number; // branded opaque in real money apps; kept simple here

// ---------------------------------------------------------------------------
// Commit-reveal for provably-fair shuffles
// ---------------------------------------------------------------------------
export interface DeckCommitment {
  serverSeedHash: string;   // SHA-256(serverSeed) published before dealing
  clientSeed: string;       // contributed by client/seat before dealing
  serverSeed?: string;      // revealed after hand ends
  shuffleIndex: number;     // monotonically increasing per table, prevents replay
}

// ---------------------------------------------------------------------------
// Table configuration
// ---------------------------------------------------------------------------
export interface TableConfig {
  tableId: string;
  smallBlindCents: Cents;
  bigBlindCents: Cents;
  minBuyInCents: Cents;
  maxBuyInCents: Cents;
  maxSeats: number;         // 2–9
  rakePercent: number;      // e.g. 5 = 5 %
  rakeCapCents: Cents;
  turnTimeoutMs: number;    // ms before auto-fold/check
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------
export type SeatStatus =
  | 'empty'
  | 'waiting'   // seated but not yet in a hand
  | 'active'    // in current hand
  | 'folded'    // folded this hand
  | 'allIn'     // all-in this hand
  | 'sitOut';   // seated but sitting out

export interface SeatInfo {
  seatIndex: number;
  playerId: string;
  displayName: string;
  stackCents: Cents;
  status: SeatStatus;
  holeCards?: [Card, Card];         // server-side only; sent individually
  currentStreetBetCents: Cents;     // amount wagered in current betting street
  totalHandContributionCents: Cents; // total wagered across all streets this hand
  postedBlindCents: Cents;          // blinds posted (for preflop BB option logic)
  hasActedThisStreet: boolean;
  isConnected: boolean;
  disconnectedAt?: number;
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------
export interface Pot {
  amountCents: Cents;
  eligiblePlayerIds: string[];
}

// ---------------------------------------------------------------------------
// Betting phases
// ---------------------------------------------------------------------------
export type Phase =
  | 'waiting'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'complete';

// ---------------------------------------------------------------------------
// Hand state — the single source of truth owned by the engine
// ---------------------------------------------------------------------------
export interface HandState {
  handId: string;
  phase: Phase;
  dealerSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;
  actingSeatIndex: number;          // whose turn it is
  seats: SeatInfo[];
  communityCards: Card[];
  pots: Pot[];
  currentBetCents: Cents;           // highest bet on this street
  lastRaiseAmountCents: Cents;      // size of the last raise (for min-raise calc)
  lastAggressorSeatIndex: number;   // seat that last bet/raised
  commitment: DeckCommitment;
  deck: Card[];                     // remaining deck (server only, never sent to clients)
  actionHistory: HandAction[];
  turnExpiresAt: number;            // unix ms
  streetActionCount: number;        // guard: 0-actions-remaining fast-path
  rakeCollectedCents: Cents;
}

// ---------------------------------------------------------------------------
// Player intents (client → server)
// ---------------------------------------------------------------------------
export type PlayerActionType =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allIn';

export interface PlayerIntent {
  type: PlayerActionType;
  amountCents?: Cents; // required for bet/raise
}

// ---------------------------------------------------------------------------
// Recorded action in history
// ---------------------------------------------------------------------------
export interface HandAction {
  seatIndex: number;
  playerId: string;
  type: PlayerActionType | 'blind' | 'timeout';
  amountCents: Cents;
  phase: Phase;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Events emitted by the engine after each mutation
// ---------------------------------------------------------------------------
export type GameEvent =
  | { type: 'hand:started'; handId: string; dealerSeat: number; sbSeat: number; bbSeat: number }
  | { type: 'blind:posted'; seatIndex: number; playerId: string; amountCents: Cents; blindType: 'small' | 'big' | 'ante' }
  | { type: 'cards:dealt'; seatIndex: number; playerId: string } // hole cards sent separately
  | { type: 'turn:start'; seatIndex: number; playerId: string; validActions: ValidAction[]; expiresAt: number }
  | { type: 'player:acted'; seatIndex: number; playerId: string; action: PlayerActionType | 'timeout'; amountCents: Cents }
  | { type: 'phase:changed'; phase: Phase; communityCards: Card[] }
  | { type: 'pots:updated'; pots: Pot[] }
  | { type: 'showdown'; results: ShowdownResult[] }
  | { type: 'pot:awarded'; potIndex: number; amountCents: Cents; winners: PotWinner[] }
  | { type: 'hand:complete'; seedReveal: string; handId: string }
  | { type: 'hand:cancelled'; reason: string }
  | { type: 'error'; message: string };

export interface ValidAction {
  type: PlayerActionType;
  minCents?: Cents;
  maxCents?: Cents;
}

export interface ShowdownResult {
  seatIndex: number;
  playerId: string;
  holeCards: [Card, Card];
  bestHandCards: Card[];
  handRank: string;
  handDescription: string;
}

export interface PotWinner {
  seatIndex: number;
  playerId: string;
  amountCents: Cents;
}

// ---------------------------------------------------------------------------
// Engine result
// ---------------------------------------------------------------------------
export interface EngineResult {
  state: HandState;
  events: GameEvent[];
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------
export type LedgerAccountType =
  | 'player_wallet'
  | 'player_table_stack'
  | 'table_pot'
  | 'house_rake'
  | 'player_cashout_hold'; // tokens held pending real-money payout

export interface LedgerAccount {
  type: LedgerAccountType;
  ownerId: string; // playerId or tableId or 'house'
}

export interface LedgerEntry {
  id: string;
  idempotencyKey: string;
  timestamp: number;
  handId?: string | undefined;
  description: string;
  debit: LedgerAccount;
  credit: LedgerAccount;
  amountCents: Cents;
}

export interface LedgerQueryResult {
  account: LedgerAccount;
  balanceCents: Cents;
  entries: LedgerEntry[];
}

export type LedgerTransactionType =
  | 'buy_in'
  | 'cash_out'
  | 'blind'
  | 'bet'
  | 'win'
  | 'rake'
  | 'refund';
