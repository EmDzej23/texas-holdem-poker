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
  LedgerService,
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
import type { HandRepository } from '@poker/db';

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
  private pendingStand = new Set<string>(); // playerIds who requested leave mid-hand
  private handEventBuffer: GameEvent[] = []; // accumulates events for the current hand
  private readonly ledger: LedgerService | undefined;
  private readonly handRepo: HandRepository | undefined;
  // Per-seat session keys: deterministic idempotency for buy-in/cashout pairs
  private seatSessionKeys = new Map<number, string>();

  constructor(
    public config: TableConfig,
    private readonly store: TableStore,
    persist?: { ledger?: LedgerService | undefined; handRepo?: HandRepository | undefined },
  ) {
    this.ledger = persist?.ledger;
    this.handRepo = persist?.handRepo;
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
    // If same player reconnects from a new tab/window, remove the stale entry
    // so only one connectionId is ever live for a given playerId.
    if (playerId) {
      const staleConnId = [...this.clients.entries()].find(([, c]) => c.playerId === playerId)?.[0];
      if (staleConnId && staleConnId !== connectionId) {
        const stale = this.clients.get(staleConnId)!;
        this.clients.delete(staleConnId);
        // Re-use the stale seat association on the new connection
        const seat = this.tableSeats.find((s) => s.seatIndex === stale.seatIndex);
        if (seat) {
          seat.isConnected = true;
          delete seat.disconnectedAt;
        }
        this.clients.set(connectionId, { ...stale, ws, displayName });
        this.sendTableState(connectionId);
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
        return;
      }
    }

    this.clients.set(connectionId, { ws, playerId, displayName, ip });

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

  async sitPlayer(
    connectionId: string,
    verifiedPlayerId: string, // server-verified, not from stale client state
    seatIndex: number,
    buyInCents: number,
    clientSeed: string,
  ): Promise<void> {
    const client = this.clients.get(connectionId);
    if (!client) return;

    const alreadySat = this.tableSeats.find(
      (s) => s.playerId !== '' && s.playerId === verifiedPlayerId && s.status !== 'empty',
    );
    if (alreadySat) {
      this.sendError(connectionId, 'ALREADY_SEATED', 'You are already seated at this table');
      return;
    }

    const seat = this.tableSeats[seatIndex];
    if (!seat || seat.status !== 'empty') {
      this.sendError(connectionId, 'SEAT_TAKEN', 'Seat is not available');
      return;
    }

    if (buyInCents < this.config.minBuyInCents || buyInCents > this.config.maxBuyInCents) {
      this.sendError(connectionId, 'INVALID_BUYIN', 'Buy-in out of range');
      return;
    }

    // Reserve seat immediately to block concurrent sit attempts for same seat
    const sessionKey = uuid();
    this.seatSessionKeys.set(seatIndex, sessionKey);
    seat.playerId = verifiedPlayerId;
    seat.displayName = client.displayName;
    seat.status = 'waiting';
    seat.isConnected = true;
    client.seatIndex = seatIndex;

    // Enforce wallet balance and record buy-in as a single awaited operation
    if (this.ledger) {
      let balance: number;
      try {
        balance = await this.ledger.getBalance({ type: 'player_wallet', ownerId: verifiedPlayerId });
      } catch (err) {
        console.error('[TableRoom] balance check error:', err);
        this.releaseSeatReservation(seat, client);
        this.seatSessionKeys.delete(seatIndex);
        this.sendError(connectionId, 'INTERNAL_ERROR', 'Could not verify balance. Try again.');
        return;
      }

      if (balance < buyInCents) {
        this.releaseSeatReservation(seat, client);
        this.seatSessionKeys.delete(seatIndex);
        this.sendError(
          connectionId,
          'INSUFFICIENT_FUNDS',
          `Insufficient balance: you have ${balance} but need ${buyInCents}`,
        );
        return;
      }

      try {
        await this.ledger.record({
          idempotencyKey: `buyin:${sessionKey}`,
          description: `Buy-in: ${client.displayName} at ${this.config.tableId}`,
          debit: { type: 'player_wallet', ownerId: verifiedPlayerId },
          credit: { type: 'player_table_stack', ownerId: `${verifiedPlayerId}:${this.config.tableId}` },
          amountCents: buyInCents,
        });
      } catch (err) {
        console.error('[TableRoom] buy-in ledger error:', err);
        this.releaseSeatReservation(seat, client);
        this.seatSessionKeys.delete(seatIndex);
        this.sendError(connectionId, 'BUYIN_FAILED', 'Failed to record buy-in. Please try again.');
        return;
      }
    }

    seat.stackCents = buyInCents;

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

  /** Undo a provisional seat reservation after a failed async buy-in. */
  private releaseSeatReservation(seat: SeatInfo, client: ConnectedClient): void {
    seat.playerId = '';
    seat.displayName = '';
    seat.status = 'empty';
    seat.isConnected = false;
    client.seatIndex = undefined;
  }

  standPlayer(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (!client || client.seatIndex === undefined) return;

    const seatIndex = client.seatIndex;
    const seat = this.tableSeats.find((s) => s.seatIndex === seatIndex);
    if (!seat) return;

    // If in an active hand, schedule a fold and defer the seat cleanup
    if (this.handState && this.handState.phase !== 'complete') {
      const handSeat = this.handState.seats.find((s) => s.seatIndex === seatIndex);
      if (handSeat && handSeat.status === 'active') {
        this.pendingStand.add(client.playerId);
        if (this.handState.actingSeatIndex === seatIndex) {
          // Their turn — fold now; seat will clear after hand completes
          this.applyPlayerAction(client.playerId, { type: 'fold' });
        }
        // Not their turn — will auto-fold in scheduleTurnTimer when their turn comes
        return;
      }
    }

    this.completeSeatStand(connectionId);
  }

  /** Zero out a seat and broadcast the empty state. */
  private completeSeatStand(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (!client || client.seatIndex === undefined) return;

    const seatIndex = client.seatIndex;
    const seat = this.tableSeats.find((s) => s.seatIndex === seatIndex);
    if (!seat) return;

    // Return remaining chips to wallet — use the session key from buy-in for idempotency
    if (this.ledger && seat.stackCents > 0) {
      const playerId = seat.playerId;
      const amount = seat.stackCents;
      const sessionKey = this.seatSessionKeys.get(seatIndex) ?? uuid();
      void this.ledger.record({
        idempotencyKey: `cashout:${sessionKey}`,
        description: `Cash-out: ${seat.displayName} from ${this.config.tableId}`,
        debit: { type: 'player_table_stack', ownerId: `${playerId}:${this.config.tableId}` },
        credit: { type: 'player_wallet', ownerId: playerId },
        amountCents: amount,
      }).catch((err: unknown) => console.error('[TableRoom] cash-out ledger error:', err));
    }

    this.seatSessionKeys.delete(seatIndex);
    seat.playerId = '';
    seat.displayName = '';
    seat.stackCents = 0;
    seat.status = 'empty';
    seat.isConnected = false;
    seat.currentStreetBetCents = 0;
    client.seatIndex = undefined;

    this.broadcast({
      type: 'seat:updated',
      payload: { tableId: this.config.tableId, seat: toPublicSeatView(seat) },
      ts: new Date().toISOString(),
    });
  }

  /** After hand completion, resolve any players who requested to leave mid-hand. */
  private processPendingStands(): void {
    if (this.pendingStand.size === 0) return;
    if (this.handState && this.handState.phase !== 'complete') return;
    for (const playerId of [...this.pendingStand]) {
      this.pendingStand.delete(playerId);
      const connId = this.connectionIdForPlayer(playerId);
      if (connId) this.completeSeatStand(connId);
    }
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
    this.processPendingStands();
    this.broadcastSeatUpdates();
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
    // Buffer all events for the current hand so we can persist on hand:complete
    for (const event of events) {
      if (event.type === 'hand:started') this.handEventBuffer = [];
      this.handEventBuffer.push(event);
    }

    // Count phase:changed events — more than 1 means an all-in runout (cards dealt without action)
    const phaseChangedCount = events.filter((e) => e.type === 'phase:changed').length;

    if (phaseChangedCount <= 1) {
      // Normal hand action: broadcast everything immediately
      for (const event of events) {
        this.handleEvent(event);
      }
      return;
    }

    // All-in runout: stagger each street reveal so players can see the cards unfold
    const STREET_GAP_MS = 1400;   // pause between each new street
    const POST_RIVER_MS  = 500;   // brief pause after river before showing result

    let streetsSeen = 0;
    let lastStreetDelay = 0;

    for (const event of events) {
      let delay: number;

      if (event.type === 'phase:changed') {
        delay = streetsSeen * STREET_GAP_MS;
        lastStreetDelay = delay;
        streetsSeen++;
      } else if (streetsSeen >= phaseChangedCount) {
        // Everything after the last street card (showdown / pot:awarded / hand:complete)
        delay = lastStreetDelay + POST_RIVER_MS;
      } else {
        // pots:updated and other non-street events between streets
        delay = lastStreetDelay;
      }

      const capturedEvent = event;
      setTimeout(() => this.handleEvent(capturedEvent), delay);
    }
  }

  /** Broadcast one event and apply any side-effects (hole cards, next-hand timer, etc). */
  private handleEvent(event: GameEvent): void {
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

      // Persist hand results and actions to DB
      if (this.handRepo) {
        const state = this.handState;
        const events = [...this.handEventBuffer];
        const tableId = this.config.tableId;
        void this.handRepo.recordCompletedHand(state, events, tableId)
          .catch((err: unknown) => console.error('[TableRoom] hand persist error:', err));
      }

      // Start next hand after delay — gives clients time to display winner overlay
      setTimeout(() => {
        this.processPendingStands();
        this.removeZeroChipPlayers();
        this.maybeStartHand();
      }, 5500);
    }
  }

  // ---------------------------------------------------------------------------
  // Turn timer
  // ---------------------------------------------------------------------------

  private scheduleTurnTimer(): void {
    if (!this.handState || this.handState.phase === 'complete') return;

    // Auto-fold acting player if they've requested to leave
    const actingSeat = this.handState.seats.find(
      (s) => s.seatIndex === this.handState!.actingSeatIndex,
    );
    if (actingSeat && this.pendingStand.has(actingSeat.playerId)) {
      const pid = actingSeat.playerId;
      setTimeout(() => this.applyPlayerAction(pid, { type: 'fold' }), 0);
      return;
    }

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
    this.processPendingStands();
    this.broadcastSeatUpdates();
    this.saveState();
    this.scheduleTurnTimer();
  }

  // ---------------------------------------------------------------------------
  // State sync
  // ---------------------------------------------------------------------------

  /** Mirror hand seat stacks/bets/status back to table seats after each action. */
  private updateTableSeatsFromHand(): void {
    if (!this.handState) return;
    for (const handSeat of this.handState.seats) {
      const tableSeat = this.tableSeats.find((s) => s.seatIndex === handSeat.seatIndex);
      if (tableSeat) {
        tableSeat.stackCents = handSeat.stackCents;
        tableSeat.currentStreetBetCents = handSeat.currentStreetBetCents;
        if (this.handState.phase === 'complete') {
          // Reset to waiting (with chips) so next hand can include them
          tableSeat.status = handSeat.stackCents > 0 ? 'waiting' : handSeat.status as SeatStatus;
        } else {
          tableSeat.status = handSeat.status as SeatStatus;
        }
      }
    }
  }

  /** Remove seated players who have 0 chips and broadcast the empty seats. */
  private removeZeroChipPlayers(): void {
    for (const seat of this.tableSeats) {
      if (seat.status === 'empty' || seat.stackCents > 0) continue;
      // No cashout ledger entry needed: wallet was already debited on buy-in,
      // and there are no chips to return. Net wallet correctly reflects the loss.
      this.seatSessionKeys.delete(seat.seatIndex);
      for (const [, client] of this.clients.entries()) {
        if (client.seatIndex === seat.seatIndex) {
          client.seatIndex = undefined;
          break;
        }
      }
      seat.playerId = '';
      seat.displayName = '';
      seat.status = 'empty';
      seat.isConnected = false;
      seat.currentStreetBetCents = 0;
      this.broadcast({
        type: 'seat:updated',
        payload: { tableId: this.config.tableId, seat: toPublicSeatView(seat) },
        ts: new Date().toISOString(),
      });
    }
  }

  /** Broadcast current seat state for all occupied seats. */
  private broadcastSeatUpdates(): void {
    for (const seat of this.tableSeats) {
      if (seat.status !== 'empty') {
        this.broadcast({
          type: 'seat:updated',
          payload: { tableId: this.config.tableId, seat: toPublicSeatView(seat) },
          ts: new Date().toISOString(),
        });
      }
    }
  }

  getPlayerCount(): number {
    return this.tableSeats.filter((s) => s.status !== 'empty').length;
  }

  /** Update table settings (takes effect on the next hand). */
  async updateConfig(patch: {
    smallBlindCents?: number | undefined;
    bigBlindCents?: number | undefined;
    minBuyInCents?: number | undefined;
    maxBuyInCents?: number | undefined;
    rakePercent?: number | undefined;
    rakeCapCents?: number | undefined;
    currencySymbol?: string | undefined;
  }): Promise<void> {
    if (patch.smallBlindCents !== undefined) this.config.smallBlindCents = patch.smallBlindCents;
    if (patch.bigBlindCents !== undefined) this.config.bigBlindCents = patch.bigBlindCents;
    if (patch.minBuyInCents !== undefined) this.config.minBuyInCents = patch.minBuyInCents;
    if (patch.maxBuyInCents !== undefined) this.config.maxBuyInCents = patch.maxBuyInCents;
    if (patch.rakePercent !== undefined) this.config.rakePercent = patch.rakePercent;
    if (patch.rakeCapCents !== undefined) this.config.rakeCapCents = patch.rakeCapCents;
    if (patch.currencySymbol !== undefined) this.config.currencySymbol = patch.currencySymbol;
    await this.saveState();
  }

  /** Remove all players from all seats and cancel any active hand. */
  clearAllSeats(): void {
    this.clearTurnTimer();
    this.handState = undefined;
    this.handEventBuffer = [];
    this.pendingStand.clear();
    for (const seat of this.tableSeats) {
      if (this.ledger && seat.stackCents > 0 && seat.playerId) {
        const playerId = seat.playerId;
        const amount = seat.stackCents;
        const sessionKey = this.seatSessionKeys.get(seat.seatIndex) ?? uuid();
        void this.ledger.record({
          idempotencyKey: `cashout:${sessionKey}`,
          description: `Admin reset cash-out: ${seat.displayName} from ${this.config.tableId}`,
          debit: { type: 'player_table_stack', ownerId: `${playerId}:${this.config.tableId}` },
          credit: { type: 'player_wallet', ownerId: playerId },
          amountCents: amount,
        }).catch((err: unknown) => console.error('[TableRoom] admin reset cash-out error:', err));
      }
      this.seatSessionKeys.delete(seat.seatIndex);
      seat.playerId = '';
      seat.displayName = '';
      seat.stackCents = 0;
      seat.status = 'empty';
      seat.isConnected = false;
      seat.currentStreetBetCents = 0;
    }
    for (const client of this.clients.values()) {
      client.seatIndex = undefined;
    }
    for (const connId of this.clients.keys()) {
      this.sendTableState(connId);
    }
    void this.saveState();
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
        currencySymbol: this.config.currencySymbol ?? '$',
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
