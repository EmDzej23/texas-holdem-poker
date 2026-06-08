/**
 * Poker engine — pure, framework-agnostic TypeScript.
 *
 * All I/O (database, sockets, timers) lives outside this module.
 * The engine takes state + an action and returns new state + events.
 * State is treated as immutable; mutations return fresh copies.
 */

import type {
  Card,
  Cents,
  DeckCommitment,
  EngineResult,
  GameEvent,
  HandAction,
  HandState,
  Phase,
  PlayerActionType,
  PlayerIntent,
  Pot,
  SeatInfo,
  SeatStatus,
  ShowdownResult,
  TableConfig,
  ValidAction,
} from './types.js';
import { evaluateHand, findWinners, type ShowdownHand } from './evaluator.js';
import { calculatePots, splitPot } from './pots.js';
import { createShuffledDeck } from './deck.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cloneState(s: HandState): HandState {
  return {
    ...s,
    seats: s.seats.map((seat) => ({ ...seat })),
    communityCards: [...s.communityCards],
    pots: s.pots.map((p) => ({ ...p, eligiblePlayerIds: [...p.eligiblePlayerIds] })),
    actionHistory: [...s.actionHistory],
  };
}

function activeSeatIndexes(seats: SeatInfo[]): number[] {
  return seats
    .filter((s) => s.status === 'active' || s.status === 'allIn')
    .map((s) => s.seatIndex);
}

function nonFoldedActiveSeatIndexes(seats: SeatInfo[]): number[] {
  return seats
    .filter((s) => s.status === 'active' || s.status === 'allIn')
    .map((s) => s.seatIndex);
}

function activeNonAllInSeats(seats: SeatInfo[]): SeatInfo[] {
  return seats.filter((s) => s.status === 'active');
}

function seatsInHandCount(seats: SeatInfo[]): number {
  return seats.filter(
    (s) => s.status === 'active' || s.status === 'allIn' || s.status === 'folded',
  ).length;
}

/** Rotate seatIndexes starting from afterSeat, wrapping around. */
function seatOrder(allSeats: SeatInfo[], afterSeatIndex: number): number[] {
  const seated = allSeats
    .filter((s) => s.status !== 'empty' && s.status !== 'sitOut' && s.status !== 'waiting')
    .map((s) => s.seatIndex)
    .sort((a, b) => a - b);
  const pivotIdx = seated.findIndex((i) => i > afterSeatIndex);
  const pivot = pivotIdx === -1 ? 0 : pivotIdx;
  return [...seated.slice(pivot), ...seated.slice(0, pivot)];
}

function nextActiveAfter(seats: SeatInfo[], afterSeatIndex: number): number {
  const order = seatOrder(
    seats.filter((s) => s.status === 'active' || s.status === 'allIn'),
    afterSeatIndex,
  );
  return order[0] ?? afterSeatIndex;
}

function dealCards(deck: Card[], count: number): { cards: Card[]; remaining: Card[] } {
  return { cards: deck.slice(0, count), remaining: deck.slice(count) };
}

function computePots(seats: SeatInfo[]): Pot[] {
  const contributions = seats
    .filter(
      (s) =>
        s.status === 'active' ||
        s.status === 'allIn' ||
        s.status === 'folded',
    )
    .map((s) => ({
      playerId: s.playerId,
      seatIndex: s.seatIndex,
      totalContributedCents: s.totalHandContributionCents,
      folded: s.status === 'folded',
    }));
  return calculatePots(contributions);
}

// ---------------------------------------------------------------------------
// Betting round helpers
// ---------------------------------------------------------------------------

/**
 * Build the ordered action queue for a new street.
 *
 * Preflop: starts at UTG (seat after BB), ends at BB (who gets option).
 * Postflop: starts at first active seat left of dealer, ends at dealer.
 */
function buildActingQueue(state: HandState, isPreflop: boolean): number[] {
  const activeSeats = state.seats
    .filter((s) => s.status === 'active')
    .map((s) => s.seatIndex)
    .sort((a, b) => a - b);

  if (activeSeats.length === 0) return [];

  const pivot = isPreflop ? state.bigBlindSeatIndex : state.dealerSeatIndex;
  const pivotIdx = activeSeats.findIndex((i) => i > pivot);
  const start = pivotIdx === -1 ? 0 : pivotIdx;

  return [...activeSeats.slice(start), ...activeSeats.slice(0, start)];
}

/**
 * When a raise happens, everyone who hasn't yet acted since the raise
 * must act again. The raiser does NOT need to act again (unless re-raised).
 *
 * We rebuild the queue: all active seats in order, starting after the
 * raiser, up to and including the raiser's position — but excluding the
 * raiser themselves.
 */
function buildPostRaiseQueue(state: HandState, raiserSeatIndex: number): number[] {
  const activeSeats = state.seats
    .filter((s) => s.status === 'active')
    .map((s) => s.seatIndex)
    .sort((a, b) => a - b);

  const pivotIdx = activeSeats.findIndex((i) => i > raiserSeatIndex);
  const start = pivotIdx === -1 ? 0 : pivotIdx;
  const ordered = [...activeSeats.slice(start), ...activeSeats.slice(0, start)];

  // Exclude the raiser; they're at the "end" conceptually and only need to act
  // if someone re-raises after them.
  return ordered.filter((i) => i !== raiserSeatIndex);
}

/**
 * Determine valid actions for the current actor.
 */
export function getValidActions(state: HandState): ValidAction[] {
  const seat = state.seats.find((s) => s.seatIndex === state.actingSeatIndex);
  if (!seat || seat.status !== 'active') return [];

  const actions: ValidAction[] = [];
  const callAmount = Math.min(
    state.currentBetCents - seat.currentStreetBetCents,
    seat.stackCents,
  );
  const isAllIn = seat.stackCents <= callAmount;

  // Always can fold (unless check is free)
  const canCheck = state.currentBetCents === seat.currentStreetBetCents;

  if (canCheck) {
    actions.push({ type: 'check' });
  } else {
    actions.push({ type: 'fold' });
    actions.push({ type: 'call', minCents: callAmount, maxCents: callAmount });
  }

  if (!isAllIn) {
    // Bet or raise
    const minRaiseTotal = state.currentBetCents + state.lastRaiseAmountCents;
    const maxBet = seat.stackCents + seat.currentStreetBetCents; // max total bet

    if (state.currentBetCents === 0) {
      // No bet yet — can bet
      const minBet = Math.min(state.currentBetCents + state.lastRaiseAmountCents, seat.stackCents);
      if (seat.stackCents > 0) {
        actions.push({ type: 'bet', minCents: minBet, maxCents: maxBet });
      }
    } else {
      // Bet exists — can raise
      const minRaiseChipTotal = Math.min(minRaiseTotal, maxBet);
      if (minRaiseChipTotal <= maxBet) {
        actions.push({
          type: 'raise',
          minCents: minRaiseChipTotal,
          maxCents: maxBet,
        });
      }
    }

    // All-in is always available
    actions.push({ type: 'allIn', minCents: seat.stackCents, maxCents: seat.stackCents });
  } else {
    // Only remaining option when call ≥ stack is all-in
    if (!canCheck) {
      actions.push({ type: 'allIn', minCents: seat.stackCents, maxCents: seat.stackCents });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function collectBetsIntoPot(state: HandState): HandState {
  const s = cloneState(state);
  // Move all street bets into pot (recalculate pots from total contributions)
  s.pots = computePots(s.seats);
  // Reset street bets
  for (const seat of s.seats) {
    seat.currentStreetBetCents = 0;
    seat.hasActedThisStreet = false;
  }
  s.currentBetCents = 0;
  s.lastRaiseAmountCents = s.currentBetCents; // reset; will be set to BB on new streets
  return s;
}

function transitionToFlop(state: HandState): EngineResult {
  let s = collectBetsIntoPot(state);
  s = cloneState(s);

  // Deal 3 community cards (burn 1 first — standard poker protocol)
  const { cards: burned, remaining: afterBurn } = dealCards(s.deck, 1);
  void burned; // burn card discarded
  const { cards: flop, remaining } = dealCards(afterBurn, 3);

  s.deck = remaining;
  s.communityCards = flop;
  s.phase = 'flop';
  s.lastRaiseAmountCents = state.commitment
    ? (state as HandState & { _config?: TableConfig })._config?.bigBlindCents ?? 0
    : 0;

  const firstToAct = buildActingQueue(s, false)[0];
  if (firstToAct === undefined) return runAllInRunout(s);

  s.actingSeatIndex = firstToAct;
  s.streetActionCount = 0;
  s.turnExpiresAt = Date.now() + 30_000;

  const events: GameEvent[] = [
    { type: 'phase:changed', phase: 'flop', communityCards: s.communityCards },
    { type: 'pots:updated', pots: s.pots },
    {
      type: 'turn:start',
      seatIndex: firstToAct,
      playerId: s.seats.find((x) => x.seatIndex === firstToAct)!.playerId,
      validActions: getValidActions(s),
      expiresAt: s.turnExpiresAt,
    },
  ];

  return { state: s, events };
}

function transitionToTurn(state: HandState): EngineResult {
  let s = collectBetsIntoPot(state);
  s = cloneState(s);

  const { cards: burned, remaining: afterBurn } = dealCards(s.deck, 1);
  void burned;
  const { cards: turnCard, remaining } = dealCards(afterBurn, 1);

  s.deck = remaining;
  s.communityCards = [...s.communityCards, ...turnCard];
  s.phase = 'turn';

  const firstToAct = buildActingQueue(s, false)[0];
  if (firstToAct === undefined) return runAllInRunout(s);

  s.actingSeatIndex = firstToAct;
  s.streetActionCount = 0;
  s.turnExpiresAt = Date.now() + 30_000;

  const events: GameEvent[] = [
    { type: 'phase:changed', phase: 'turn', communityCards: s.communityCards },
    { type: 'pots:updated', pots: s.pots },
    {
      type: 'turn:start',
      seatIndex: firstToAct,
      playerId: s.seats.find((x) => x.seatIndex === firstToAct)!.playerId,
      validActions: getValidActions(s),
      expiresAt: s.turnExpiresAt,
    },
  ];

  return { state: s, events };
}

function transitionToRiver(state: HandState): EngineResult {
  let s = collectBetsIntoPot(state);
  s = cloneState(s);

  const { cards: burned, remaining: afterBurn } = dealCards(s.deck, 1);
  void burned;
  const { cards: river, remaining } = dealCards(afterBurn, 1);

  s.deck = remaining;
  s.communityCards = [...s.communityCards, ...river];
  s.phase = 'river';

  const firstToAct = buildActingQueue(s, false)[0];
  if (firstToAct === undefined) return runAllInRunout(s);

  s.actingSeatIndex = firstToAct;
  s.streetActionCount = 0;
  s.turnExpiresAt = Date.now() + 30_000;

  const events: GameEvent[] = [
    { type: 'phase:changed', phase: 'river', communityCards: s.communityCards },
    { type: 'pots:updated', pots: s.pots },
    {
      type: 'turn:start',
      seatIndex: firstToAct,
      playerId: s.seats.find((x) => x.seatIndex === firstToAct)!.playerId,
      validActions: getValidActions(s),
      expiresAt: s.turnExpiresAt,
    },
  ];

  return { state: s, events };
}

/** When all active players are all-in, run out remaining community cards automatically. */
function runAllInRunout(state: HandState): EngineResult {
  let s = cloneState(state);
  const events: GameEvent[] = [];

  while (s.communityCards.length < 5) {
    const { cards: burned, remaining: afterBurn } = dealCards(s.deck, 1);
    void burned;

    if (s.communityCards.length === 0) {
      const { cards: flop, remaining } = dealCards(afterBurn, 3);
      s.deck = remaining;
      s.communityCards = [...s.communityCards, ...flop];
      events.push({ type: 'phase:changed', phase: 'flop', communityCards: [...s.communityCards] });
    } else {
      const { cards: card, remaining } = dealCards(afterBurn, 1);
      s.deck = remaining;
      s.communityCards = [...s.communityCards, ...card];
      const phase: Phase = s.communityCards.length === 4 ? 'turn' : 'river';
      events.push({ type: 'phase:changed', phase, communityCards: [...s.communityCards] });
    }
  }

  const showdownResult = runShowdown(s);
  return { state: showdownResult.state, events: [...events, ...showdownResult.events] };
}

// ---------------------------------------------------------------------------
// Showdown
// ---------------------------------------------------------------------------

function runShowdown(state: HandState): EngineResult {
  let s = cloneState(state);
  s = collectBetsIntoPot(s);
  s.phase = 'showdown';

  const events: GameEvent[] = [
    { type: 'pots:updated', pots: s.pots },
  ];

  // Seats eligible to show (not folded, in hand)
  const showdownSeats = s.seats.filter(
    (seat) => seat.status === 'active' || seat.status === 'allIn',
  );

  // If only one player remains (everyone else folded), award pot without showdown
  if (showdownSeats.length === 1) {
    const winner = showdownSeats[0]!;
    const totalPot = s.pots.reduce((sum, p) => sum + p.amountCents, 0);
    const rake = computeRake(totalPot, state);
    const winnings = totalPot - rake;
    winner.stackCents += winnings;
    s.rakeCollectedCents += rake;

    events.push({
      type: 'pot:awarded',
      potIndex: 0,
      amountCents: winnings,
      winners: [{ seatIndex: winner.seatIndex, playerId: winner.playerId, amountCents: winnings }],
    });

    s.pots = [];
    return finishHand(s, events);
  }

  // Evaluate all showdown hands
  const hands: ShowdownHand[] = showdownSeats.map((seat) => {
    const evaluated = evaluateHand(seat.holeCards!, s.communityCards as Card[]);
    return {
      playerId: seat.playerId,
      seatIndex: seat.seatIndex,
      holeCards: seat.holeCards!,
      evaluated,
    };
  });

  const showdownResults: ShowdownResult[] = hands.map((h) => ({
    seatIndex: h.seatIndex,
    playerId: h.playerId,
    holeCards: h.holeCards,
    bestHandCards: h.evaluated.bestCards,
    handRank: h.evaluated.name,
    handDescription: h.evaluated.description,
  }));

  events.push({ type: 'showdown', results: showdownResults });

  // Award each pot
  for (let potIdx = 0; potIdx < s.pots.length; potIdx++) {
    const pot = s.pots[potIdx]!;
    const eligibleHands = hands.filter((h) => pot.eligiblePlayerIds.includes(h.playerId));

    if (eligibleHands.length === 0) continue;

    const rake = computeRake(pot.amountCents, state);
    const potAfterRake = pot.amountCents - rake;
    s.rakeCollectedCents += rake;

    const ranked = findWinners(eligibleHands);
    const topGroup = ranked[0]!;
    const { perWinner, remainder } = splitPot(potAfterRake, topGroup.length);

    const potWinners = topGroup.map((h, i) => {
      // Remainder chip(s) go to the player closest left of the dealer
      const extra = i === 0 ? remainder : 0;
      return { seatIndex: h.seatIndex, playerId: h.playerId, amountCents: perWinner + extra };
    });

    for (const winner of potWinners) {
      const seat = s.seats.find((seat) => seat.seatIndex === winner.seatIndex)!;
      seat.stackCents += winner.amountCents;
    }

    events.push({
      type: 'pot:awarded',
      potIndex: potIdx,
      amountCents: potAfterRake,
      winners: potWinners,
    });
  }

  s.pots = [];
  return finishHand(s, events);
}

function computeRake(potCents: Cents, state: HandState): Cents {
  // Access config stored on state — see deal() which stashes it
  const cfg = (state as HandState & { _config?: TableConfig })._config;
  if (!cfg) return 0;
  const rake = Math.floor((potCents * cfg.rakePercent) / 100);
  return Math.min(rake, cfg.rakeCapCents);
}

function finishHand(state: HandState, events: GameEvent[]): EngineResult {
  const s = cloneState(state);
  s.phase = 'complete';

  // Reset seat statuses for next hand
  for (const seat of s.seats) {
    if (seat.status === 'active' || seat.status === 'allIn' || seat.status === 'folded') {
      seat.status = seat.stackCents > 0 ? 'waiting' : 'sitOut';
    }
    delete seat.holeCards;
    seat.currentStreetBetCents = 0;
    seat.totalHandContributionCents = 0;
    seat.postedBlindCents = 0;
    seat.hasActedThisStreet = false;
  }

  events.push({
    type: 'hand:complete',
    handId: state.handId,
    seedReveal: state.commitment.serverSeed ?? '',
  });

  return { state: s, events };
}

// ---------------------------------------------------------------------------
// Street end check
// ---------------------------------------------------------------------------

/**
 * Returns true if the current betting street is complete.
 * A street ends when:
 *   - Only one player remains (everyone else folded) → hand over
 *   - All active (non-all-in) players have acted AND their current bet
 *     equals the highest bet (or they're all-in).
 */
function isStreetComplete(state: HandState): boolean {
  const inHand = state.seats.filter(
    (s) => s.status === 'active' || s.status === 'allIn',
  );

  // Only one player left — hand is over
  if (inHand.length <= 1) return true;

  const active = inHand.filter((s) => s.status === 'active');

  // No active players (all all-in) — run out boards
  if (active.length === 0) return true;

  // All active players must have acted and matched the current bet
  return active.every(
    (s) => s.hasActedThisStreet && s.currentStreetBetCents === state.currentBetCents,
  );
}

function advanceStreet(state: HandState): EngineResult {
  switch (state.phase) {
    case 'preflop':
      return transitionToFlop(state);
    case 'flop':
      return transitionToTurn(state);
    case 'turn':
      return transitionToRiver(state);
    case 'river':
      return runShowdown(state);
    default:
      return { state, events: [{ type: 'error', message: `Cannot advance from ${state.phase}` }] };
  }
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

export function deal(
  config: TableConfig,
  seats: SeatInfo[],
  handId: string,
  clientSeed: string,
  shuffleIndex: number,
  dealerSeatIndex: number,
  nowMs: number = Date.now(),
): EngineResult {
  const { deck, commitment } = createShuffledDeck(clientSeed, shuffleIndex);

  // Determine SB and BB positions
  const activeSeats = seats
    .filter((s) => s.status === 'waiting' || s.status === 'active')
    .map((s) => s.seatIndex)
    .sort((a, b) => a - b);

  if (activeSeats.length < 2) {
    return {
      state: createEmptyState(handId, commitment, dealerSeatIndex, seats, config),
      events: [{ type: 'hand:cancelled', reason: 'Not enough players' }],
    };
  }

  function nextSeatAfter(idx: number): number {
    const pos = activeSeats.findIndex((i) => i > idx);
    return pos === -1 ? activeSeats[0]! : activeSeats[pos]!;
  }

  const sbSeat = nextSeatAfter(dealerSeatIndex);
  const bbSeat = nextSeatAfter(sbSeat);

  // Clone seats and set statuses
  const updatedSeats: SeatInfo[] = seats.map((seat) => {
    const { holeCards: _dropped, ...rest } = seat;
    void _dropped;
    return {
      ...rest,
      status: activeSeats.includes(seat.seatIndex) ? ('active' as SeatStatus) : seat.status,
      currentStreetBetCents: 0,
      totalHandContributionCents: 0,
      postedBlindCents: 0,
      hasActedThisStreet: false,
    };
  });

  const events: GameEvent[] = [
    { type: 'hand:started', handId, dealerSeat: dealerSeatIndex, sbSeat, bbSeat },
  ];

  // Post blinds
  let remainingDeck = deck;
  let stackCopy = updatedSeats;

  function postBlind(
    seatIdx: number,
    amount: Cents,
    blindType: 'small' | 'big',
  ): void {
    const seat = stackCopy.find((s) => s.seatIndex === seatIdx)!;
    const actual = Math.min(amount, seat.stackCents);
    seat.stackCents -= actual;
    seat.currentStreetBetCents += actual;
    seat.totalHandContributionCents += actual;
    seat.postedBlindCents = actual;
    if (seat.stackCents === 0) seat.status = 'allIn';
    events.push({
      type: 'blind:posted',
      seatIndex: seatIdx,
      playerId: seat.playerId,
      amountCents: actual,
      blindType,
    });
  }

  postBlind(sbSeat, config.smallBlindCents, 'small');
  postBlind(bbSeat, config.bigBlindCents, 'big');

  // Deal hole cards
  for (const seat of stackCopy.filter((s) => s.status === 'active' || s.status === 'allIn')) {
    const { cards, remaining } = dealCards(remainingDeck, 2);
    seat.holeCards = [cards[0]!, cards[1]!];
    remainingDeck = remaining;
    events.push({ type: 'cards:dealt', seatIndex: seat.seatIndex, playerId: seat.playerId });
  }

  // UTG is first to act preflop (seat after BB)
  const utgSeat = nextSeatAfter(bbSeat);

  const currentBet = config.bigBlindCents;
  const minRaise = config.bigBlindCents;

  const handState: HandState & { _config?: TableConfig } = {
    handId,
    phase: 'preflop',
    dealerSeatIndex,
    smallBlindSeatIndex: sbSeat,
    bigBlindSeatIndex: bbSeat,
    actingSeatIndex: utgSeat,
    seats: stackCopy,
    communityCards: [],
    pots: [],
    currentBetCents: currentBet,
    lastRaiseAmountCents: minRaise,
    lastAggressorSeatIndex: bbSeat,
    commitment,
    deck: remainingDeck,
    actionHistory: [],
    turnExpiresAt: nowMs + config.turnTimeoutMs,
    streetActionCount: 0,
    rakeCollectedCents: 0,
    _config: config,
  };

  events.push({
    type: 'turn:start',
    seatIndex: utgSeat,
    playerId: handState.seats.find((s) => s.seatIndex === utgSeat)!.playerId,
    validActions: getValidActions(handState),
    expiresAt: handState.turnExpiresAt,
  });

  return { state: handState, events };
}

function createEmptyState(
  handId: string,
  commitment: DeckCommitment,
  dealerSeatIndex: number,
  seats: SeatInfo[],
  _config: TableConfig,
): HandState {
  return {
    handId,
    phase: 'waiting',
    dealerSeatIndex,
    smallBlindSeatIndex: -1,
    bigBlindSeatIndex: -1,
    actingSeatIndex: -1,
    seats,
    communityCards: [],
    pots: [],
    currentBetCents: 0,
    lastRaiseAmountCents: 0,
    lastAggressorSeatIndex: -1,
    commitment,
    deck: [],
    actionHistory: [],
    turnExpiresAt: 0,
    streetActionCount: 0,
    rakeCollectedCents: 0,
  };
}

// ---------------------------------------------------------------------------
// Apply player action
// ---------------------------------------------------------------------------

export function applyAction(
  state: HandState,
  intent: PlayerIntent,
  nowMs: number = Date.now(),
): EngineResult {
  if (state.phase === 'complete' || state.phase === 'showdown') {
    return { state, events: [{ type: 'error', message: 'Hand is not in a betting phase' }] };
  }

  const seat = state.seats.find((s) => s.seatIndex === state.actingSeatIndex);
  if (!seat || seat.status !== 'active') {
    return { state, events: [{ type: 'error', message: 'Not your turn or invalid seat' }] };
  }

  let s = cloneState(state);
  const events: GameEvent[] = [];
  const cfg = (state as HandState & { _config?: TableConfig })._config;

  function recordAction(type: PlayerActionType | 'timeout', amountCents: Cents): void {
    const action: HandAction = {
      seatIndex: seat!.seatIndex,
      playerId: seat!.playerId,
      type,
      amountCents,
      phase: s.phase,
      timestamp: nowMs,
    };
    s.actionHistory.push(action);
    events.push({
      type: 'player:acted',
      seatIndex: seat!.seatIndex,
      playerId: seat!.playerId,
      action: type,
      amountCents,
    });
  }

  const actingSeat = s.seats.find((x) => x.seatIndex === s.actingSeatIndex)!;

  switch (intent.type) {
    case 'fold': {
      actingSeat.status = 'folded';
      actingSeat.hasActedThisStreet = true;
      recordAction('fold', 0);
      break;
    }

    case 'check': {
      if (s.currentBetCents !== actingSeat.currentStreetBetCents) {
        return { state, events: [{ type: 'error', message: 'Cannot check — there is a bet to call' }] };
      }
      actingSeat.hasActedThisStreet = true;
      recordAction('check', 0);
      break;
    }

    case 'call': {
      const toCall = Math.min(
        s.currentBetCents - actingSeat.currentStreetBetCents,
        actingSeat.stackCents,
      );
      actingSeat.stackCents -= toCall;
      actingSeat.currentStreetBetCents += toCall;
      actingSeat.totalHandContributionCents += toCall;
      actingSeat.hasActedThisStreet = true;
      if (actingSeat.stackCents === 0) actingSeat.status = 'allIn';
      recordAction('call', toCall);
      break;
    }

    case 'bet': {
      if (s.currentBetCents !== actingSeat.currentStreetBetCents) {
        return { state, events: [{ type: 'error', message: 'There is already a bet — use raise' }] };
      }
      const betAmount = intent.amountCents ?? 0;
      const minBet = cfg?.bigBlindCents ?? s.lastRaiseAmountCents;
      if (betAmount < minBet && betAmount !== actingSeat.stackCents) {
        return { state, events: [{ type: 'error', message: `Bet must be at least ${minBet} cents` }] };
      }
      const actualBet = Math.min(betAmount, actingSeat.stackCents);
      actingSeat.stackCents -= actualBet;
      actingSeat.currentStreetBetCents += actualBet;
      actingSeat.totalHandContributionCents += actualBet;
      actingSeat.hasActedThisStreet = true;

      const isFullBet = actualBet >= (cfg?.bigBlindCents ?? 0);
      if (isFullBet) {
        s.lastRaiseAmountCents = actualBet;
        s.lastAggressorSeatIndex = actingSeat.seatIndex;
        s.currentBetCents = actingSeat.currentStreetBetCents;
        // Everyone else needs to act again
        const queue = buildPostRaiseQueue(s, actingSeat.seatIndex);
        for (const idx of queue) {
          const otherSeat = s.seats.find((x) => x.seatIndex === idx)!;
          otherSeat.hasActedThisStreet = false;
        }
      }

      if (actingSeat.stackCents === 0) actingSeat.status = 'allIn';
      recordAction('bet', actualBet);
      break;
    }

    case 'raise': {
      if (s.currentBetCents === 0) {
        return { state, events: [{ type: 'error', message: 'No bet to raise — use bet' }] };
      }
      const raiseToTotal = intent.amountCents ?? 0;
      const minRaiseToTotal = s.currentBetCents + s.lastRaiseAmountCents;

      const isShortAllIn =
        raiseToTotal < minRaiseToTotal && raiseToTotal === actingSeat.stackCents + actingSeat.currentStreetBetCents;

      const prevBet = s.currentBetCents;
      const toAdd = raiseToTotal - actingSeat.currentStreetBetCents;
      const actualAdd = Math.min(toAdd, actingSeat.stackCents);
      const newBetTotal = actingSeat.currentStreetBetCents + actualAdd;

      actingSeat.stackCents -= actualAdd;
      actingSeat.currentStreetBetCents = newBetTotal;
      actingSeat.totalHandContributionCents += actualAdd;
      actingSeat.hasActedThisStreet = true;

      if (actingSeat.stackCents === 0) actingSeat.status = 'allIn';

      if (newBetTotal > s.currentBetCents) {
        if (!isShortAllIn) {
          // Full raise — reopen action
          s.lastRaiseAmountCents = newBetTotal - prevBet;
          s.lastAggressorSeatIndex = actingSeat.seatIndex;
          s.currentBetCents = newBetTotal;
          const queue = buildPostRaiseQueue(s, actingSeat.seatIndex);
          for (const idx of queue) {
            const otherSeat = s.seats.find((x) => x.seatIndex === idx)!;
            otherSeat.hasActedThisStreet = false;
          }
        } else {
          // Short all-in — does NOT reopen action
          s.currentBetCents = Math.max(s.currentBetCents, newBetTotal);
        }
      }

      recordAction('raise', actualAdd);
      break;
    }

    case 'allIn': {
      const stack = actingSeat.stackCents;
      const prevBet = s.currentBetCents;
      const newBetTotal = actingSeat.currentStreetBetCents + stack;

      actingSeat.totalHandContributionCents += stack;
      actingSeat.currentStreetBetCents = newBetTotal;
      actingSeat.stackCents = 0;
      actingSeat.status = 'allIn';
      actingSeat.hasActedThisStreet = true;

      if (newBetTotal > s.currentBetCents) {
        const raiseSize = newBetTotal - prevBet;
        const isFullRaise = raiseSize >= s.lastRaiseAmountCents;

        if (isFullRaise) {
          s.lastRaiseAmountCents = raiseSize;
          s.lastAggressorSeatIndex = actingSeat.seatIndex;
          s.currentBetCents = newBetTotal;
          const queue = buildPostRaiseQueue(s, actingSeat.seatIndex);
          for (const idx of queue) {
            const otherSeat = s.seats.find((x) => x.seatIndex === idx)!;
            otherSeat.hasActedThisStreet = false;
          }
        } else {
          // Short all-in
          s.currentBetCents = Math.max(s.currentBetCents, newBetTotal);
        }
      }

      recordAction('allIn', stack);
      break;
    }
  }

  s.streetActionCount++;
  s.pots = computePots(s.seats);

  events.push({ type: 'pots:updated', pots: s.pots });

  // Check if street complete
  if (isStreetComplete(s)) {
    // Check if only one player left (everyone else folded)
    const stillInHand = s.seats.filter(
      (x) => x.status === 'active' || x.status === 'allIn',
    );

    if (stillInHand.length <= 1) {
      const showdown = runShowdown(s);
      return { state: showdown.state, events: [...events, ...showdown.events] };
    }

    const next = advanceStreet(s);
    return { state: next.state, events: [...events, ...next.events] };
  }

  // Find next actor
  const nextSeat = findNextActor(s);
  if (nextSeat === -1) {
    // Should not happen, but guard
    const next = advanceStreet(s);
    return { state: next.state, events: [...events, ...next.events] };
  }

  s.actingSeatIndex = nextSeat;
  s.turnExpiresAt = nowMs + (cfg?.turnTimeoutMs ?? 30_000);

  events.push({
    type: 'turn:start',
    seatIndex: nextSeat,
    playerId: s.seats.find((x) => x.seatIndex === nextSeat)!.playerId,
    validActions: getValidActions(s),
    expiresAt: s.turnExpiresAt,
  });

  return { state: s, events };
}

function findNextActor(state: HandState): number {
  const queue = buildActingQueue(state, state.phase === 'preflop');

  // Find the next seat that still needs to act
  // Start search after the current actor
  const currentIdx = queue.indexOf(state.actingSeatIndex);
  const searchOrder =
    currentIdx === -1
      ? queue
      : [...queue.slice(currentIdx + 1), ...queue.slice(0, currentIdx + 1)];

  for (const seatIdx of searchOrder) {
    const seat = state.seats.find((s) => s.seatIndex === seatIdx);
    if (seat && seat.status === 'active' && !seat.hasActedThisStreet) {
      return seatIdx;
    }
    if (
      seat &&
      seat.status === 'active' &&
      seat.currentStreetBetCents < state.currentBetCents
    ) {
      return seatIdx;
    }
  }

  return -1;
}

// ---------------------------------------------------------------------------
// Timeout handler (auto-fold or auto-check)
// ---------------------------------------------------------------------------

export function applyTimeout(state: HandState, nowMs: number = Date.now()): EngineResult {
  if (nowMs < state.turnExpiresAt) {
    return { state, events: [] }; // not expired yet
  }

  const seat = state.seats.find((s) => s.seatIndex === state.actingSeatIndex);
  if (!seat) return { state, events: [] };

  const canCheck = state.currentBetCents === seat.currentStreetBetCents;
  const autoAction: PlayerIntent = canCheck ? { type: 'check' } : { type: 'fold' };

  return applyAction(state, autoAction, nowMs);
}
