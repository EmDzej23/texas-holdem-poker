/**
 * TableRoom — manages one table's live state and client connections.
 *
 * Responsibilities:
 *   - Accept player intents and route them to the engine.
 *   - Broadcast game events to all connected clients, with personalisation
 *     (hole cards go only to the owning seat, never broadcast).
 *   - Manage per-turn timers and auto-act on timeout.
 *   - Track seat <-> WebSocket associations for reconnect.
 *   - Persist state snapshots to the TableStore after each mutation.
 *
 * Anti-collusion seam:
 *   - TODO: flag when two connections share the same IP and are at the same
 *     table — log for manual review or automatic sit-out.
 */

import type { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import {
  deal,
  applyAction,
  applyTimeout,
  type HandState,
  type SeatInfo,
  type TableConfig,
  type GameEvent,
  type PlayerIntent,
  type SeatStatus,
} from '@poker/engine';
import type {
  TableStore,
  PublicSeatView,
  ServerMessage,
  TableStatePayload,
} from '@poker/shared';

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  displayName: string;
  seatIndex?: number | undefined;
  ip: string;
}

export class TableRoom {
  private clients = new Map<string, ConnectedClient>(); // connectionId → client
  private handState?: HandState | undefined;
  private tableSeats: SeatInfo[] = [];
  private shuffleIndex = 0;
  private dealerSeatIndex = 0;
  private turnTimer?: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor(
    public readonly config: TableConfig,
    private readonly store: TableStore,
  ) {
    // Initialise empty seats
    for (let i = 0; i < config.maxSeats; i++) {
      this.tableSeats.push({
        seatIndex: i,
        playerId: '',
        displayName: '',
        stackCents: 0,
        status: 'empty',
        currentStreetBetCents: 0,
        totalHandContributionCents: 0,
        postedBlindCents: 0,
        hasActedThisStreet: false,
        isConnected: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  addClient(
    connectionId: string,
    ws: WebSocket,
    playerId: string,
    displayName: string,
    ip: string,
  ): void {
    // TODO (anti-collusion): check if another connection from same IP already
    // seated at this table and flag for review.

    const existing = [...this.clients.values()].find((c) => c.playerId === playerId);
    if (existing) {
      // Reconnect: replace socket, mark seat connected
      existing.ws = ws;
      this.clients.set(connectionId, { ...existing, ws });
      const seat = this.tableSeats.find((s) => s.seatIndex === existing.seatIndex);
      if (seat) {
        seat.isConnected = true;
        delete seat.disconnectedAt;
      }
    } else {
      this.clients.set(connectionId, { ws, playerId, displayName, ip });
    }

    // Send full table snapshot to the new/reconnected client
    this.sendTableState(connectionId);

    // If player is in a hand, send their private hole cards
    if (this.handState) {
      const playerSeat = this.handState.seats.find((s) => s.playerId === playerId);
      if (playerSeat?.holeCards) {
        this.sendToConnection(connectionId, {
          type: 'hand:cards',
          payload: { seatIndex: playerSeat.seatIndex, holeCards: playerSeat.holeCards },
          ts: new Date().toISOString(),
        });
      }
    }
  }

  removeClient(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (!client) return;

    this.clients.delete(connectionId);

    if (client.seatIndex !== undefined) {
      const seat = this.tableSeats.find((s) => s.seatIndex === client.seatIndex);
      if (seat) {
        seat.isConnected = false;
        seat.disconnectedAt = Date.now();
      }

      // If player is active in a hand, start away-timer.
      // After AWAY_TIMEOUT_MS, auto-fold their hand.
      const AWAY_TIMEOUT_MS = 60_000;
      setTimeout(() => {
        const stillGone = !([...this.clients.values()].find((c) => c.playerId === client.playerId));
        if (stillGone && this.handState) {
          const handSeat = this.handState.seats.find(
            (s) => s.seatIndex === client.seatIndex && s.status === 'active',
          );
          if (handSeat && this.handState.actingSeatIndex === client.seatIndex) {
            this.applyPlayerAction(client.playerId, { type: 'fold' });
          }
        }
      }, AWAY_TIMEOUT_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Seat management
  // ---------------------------------------------------------------------------

  sitPlayer(
    connectionId: string,
    seatIndex: number,
    buyInCents: number,
    clientSeed: string,
  ): void {
    const client = this.clients.get(connectionId);
    if (!client) return;

    const seat = this.tableSeats[seatIndex];
    if (!seat || seat.status !== 'empty') {
      this.sendError(connectionId, 'SEAT_TAKEN', 'Seat is not available');
      return;
    }

    if (buyInCents < this.config.minBuyInCents || buyInCents > this.config.maxBuyInCents) {
      this.sendError(connectionId, 'INVALID_BUYIN', 'Buy-in out of range');
      return;
    }

    // TODO (production): verify player has sufficient ledger balance and
    // record a buy-in ledger transaction before crediting the stack.

    seat.playerId = client.playerId;
    seat.displayName = client.displayName;
    seat.stackCents = buyInCents;
    seat.status = 'waiting';
    seat.isConnected = true;

    client.seatIndex = seatIndex;

    this.broadcast({
      type: 'seat:updated',
      payload: {
        tableId: this.config.tableId,
        seat: toPublicSeatView(seat),
      },
      ts: new Date().toISOString(),
    });

    this.maybeStartHand();
  }

  standPlayer(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (!client || client.seatIndex === undefined) return;

    const seat = this.tableSeats.find((s) => s.seatIndex === client.seatIndex);
    if (!seat) return;

    // If in an active hand, fold first
    if (this.handState) {
      const handSeat = this.handState.seats.find((s) => s.seatIndex === client.seatIndex);
      if (handSeat && handSeat.status === 'active') {
        this.applyPlayerAction(client.playerId, { type: 'fold' });
      }
    }

    // TODO (production): record cash-out ledger transaction for seat.stackCents

    seat.playerId = '';
    seat.displayName = '';
    seat.stackCents = 0;
    seat.status = 'empty';
    seat.isConnected = false;
    client.seatIndex = undefined;

    this.broadcast({
      type: 'seat:updated',
      payload: { tableId: this.config.tableId, seat: toPublicSeatView(seat) },
      ts: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Game actions
  // ---------------------------------------------------------------------------

  applyPlayerAction(playerId: string, intent: PlayerIntent): void {
    if (!this.handState) return;

    const actingSeat = this.handState.seats.find(
      (s) => s.seatIndex === this.handState!.actingSeatIndex,
    );
    if (!actingSeat || actingSeat.playerId !== playerId) {
      const connId = this.connectionIdForPlayer(playerId);
      if (connId) this.sendError(connId, 'NOT_YOUR_TURN', 'It is not your turn');
      return;
    }

    this.clearTurnTimer();
    const result = applyAction(this.handState, intent);
    this.handState = result.state;
    this.processEvents(result.events);
    this.updateTableSeatsFromHand();
    this.saveState();
    this.scheduleTurnTimer();
  }

  // ---------------------------------------------------------------------------
  // Hand lifecycle
  // ---------------------------------------------------------------------------

  private maybeStartHand(): void {
    if (this.handState && this.handState.phase !== 'complete') return;

    const eligible = this.tableSeats.filter(
      (s) => s.status === 'waiting' && s.stackCents >= this.config.bigBlindCents,
    );
    if (eligible.length < 2) return;

    // Mark eligible seats as active for the new hand
    for (const seat of eligible) {
      seat.status = 'active';
    }

    // Rotate dealer button
    const activeSeatIndexes = eligible.map((s) => s.seatIndex).sort((a, b) => a - b);
    const nextDealerIdx = activeSeatIndexes.find((i) => i > this.dealerSeatIndex);
    this.dealerSeatIndex = nextDealerIdx ?? activeSeatIndexes[0]!;

    const handId = uuid();
    const clientSeed = [...this.clients.values()]
      .filter((c) => c.seatIndex !== undefined)
      .map((c) => c.playerId)
      .sort()
      .join(':');

    const result = deal(
      this.config,
      this.tableSeats,
      handId,
      clientSeed,
      this.shuffleIndex++,
      this.dealerSeatIndex,
    );

    this.handState = result.state;
    this.processEvents(result.events);
    this.saveState();
    this.scheduleTurnTimer();
  }

  // ---------------------------------------------------------------------------
  // Event processing — fan out events to clients
  // ---------------------------------------------------------------------------

  private processEvents(events: GameEvent[]): void {
    for (const event of events) {
      this.broadcastEvent(event);

      if (event.type === 'cards:dealt') {
        // Send private hole cards only to the owning player
        const seat = this.handState?.seats.find((s) => s.seatIndex === event.seatIndex);
        if (seat?.holeCards) {
          const connId = this.connectionIdForPlayer(event.playerId);
          if (connId) {
            this.sendToConnection(connId, {
              type: 'hand:cards',
              payload: { seatIndex: seat.seatIndex, holeCards: seat.holeCards },
              ts: new Date().toISOString(),
            });
          }
        }
      }

      if (event.type === 'hand:complete' && this.handState?.commitment.serverSeed) {
        // Reveal seed to all players for verification
        this.broadcast({
          type: 'hand:verify',
          payload: {
            handId: event.handId,
            serverSeed: this.handState.commitment.serverSeed,
            clientSeed: this.handState.commitment.clientSeed,
            shuffleIndex: this.handState.commitment.shuffleIndex,
            serverSeedHash: this.handState.commitment.serverSeedHash,
          },
          ts: new Date().toISOString(),
        });

        // Start next hand after a short delay
        setTimeout(() => this.maybeStartHand(), 3000);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Turn timer
  // ---------------------------------------------------------------------------

  private scheduleTurnTimer(): void {
    if (!this.handState || this.handState.phase === 'complete') return;
    const delay = Math.max(0, this.handState.turnExpiresAt - Date.now()) + 500; // +500ms grace
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), delay);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer !== undefined) {
      clearTimeout(this.turnTimer);
      this.turnTimer = undefined;
    }
  }

  private onTurnTimeout(): void {
    if (!this.handState) return;
    const result = applyTimeout(this.handState);
    if (result.events.length === 0) return; // not actually expired
    this.handState = result.state;
    this.processEvents(result.events);
    this.updateTableSeatsFromHand();
    this.saveState();
    this.scheduleTurnTimer();
  }

  // ---------------------------------------------------------------------------
  // State sync
  // ---------------------------------------------------------------------------

  /** Mirror hand seat stacks back to table seats after each action. */
  private updateTableSeatsFromHand(): void {
    if (!this.handState) return;
    for (const handSeat of this.handState.seats) {
      const tableSeat = this.tableSeats.find((s) => s.seatIndex === handSeat.seatIndex);
      if (tableSeat) {
        tableSeat.stackCents = handSeat.stackCents;
        tableSeat.status = handSeat.status as SeatStatus;
      }
    }
  }

  private async saveState(): Promise<void> {
    try {
      await this.store.setTable({
        tableId: this.config.tableId,
        handState: this.handState ? JSON.stringify(this.handState) : undefined,
        seats: JSON.stringify(this.tableSeats),
        shuffleIndex: this.shuffleIndex,
        config: JSON.stringify(this.config),
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    } catch (err) {
      console.error('[TableRoom] Failed to save state:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Messaging helpers
  // ---------------------------------------------------------------------------

  private sendTableState(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (!client) return;

    const payload: TableStatePayload = {
      tableId: this.config.tableId,
      config: {
        smallBlindCents: this.config.smallBlindCents,
        bigBlindCents: this.config.bigBlindCents,
        minBuyInCents: this.config.minBuyInCents,
        maxBuyInCents: this.config.maxBuyInCents,
        maxSeats: this.config.maxSeats,
        rakePercent: this.config.rakePercent,
      },
      seats: this.tableSeats.map(toPublicSeatView),
      phase: this.handState?.phase ?? 'waiting',
      communityCards: this.handState?.communityCards ?? [],
      pots: this.handState?.pots ?? [],
      currentBetCents: this.handState?.currentBetCents ?? 0,
      actingSeatIndex: this.handState?.actingSeatIndex ?? -1,
      dealerSeatIndex: this.dealerSeatIndex,
      turnExpiresAt: this.handState?.turnExpiresAt ?? 0,
      ...(this.handState && { handId: this.handState.handId }),
    };

    this.sendToConnection(connectionId, {
      type: 'table:state',
      payload,
      ts: new Date().toISOString(),
    });
  }

  private broadcastEvent(event: GameEvent): void {
    // Never include hole cards in broadcast — those are sent privately
    if (event.type === 'cards:dealt') {
      // Notify everyone a card was dealt, but without the card values
      this.broadcast({ type: 'table:event', payload: event, ts: new Date().toISOString() });
      return;
    }
    this.broadcast({ type: 'table:event', payload: event, ts: new Date().toISOString() });
  }

  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify({ ...msg, seq: ++this.seq });
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1 /* OPEN */) {
        client.ws.send(json);
      }
    }
  }

  private sendToConnection(connectionId: string, msg: ServerMessage): void {
    const client = this.clients.get(connectionId);
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify({ ...msg, seq: ++this.seq }));
    }
  }

  private sendError(connectionId: string, code: string, message: string): void {
    this.sendToConnection(connectionId, {
      type: 'error',
      payload: { code, message },
      ts: new Date().toISOString(),
    });
  }

  private connectionIdForPlayer(playerId: string): string | undefined {
    for (const [connId, client] of this.clients.entries()) {
      if (client.playerId === playerId) return connId;
    }
    return undefined;
  }
}

function toPublicSeatView(seat: SeatInfo): PublicSeatView {
  return {
    seatIndex: seat.seatIndex,
    playerId: seat.playerId,
    displayName: seat.displayName,
    stackCents: seat.stackCents,
    status: seat.status,
    currentStreetBetCents: seat.currentStreetBetCents,
    isConnected: seat.isConnected,
  };
}
