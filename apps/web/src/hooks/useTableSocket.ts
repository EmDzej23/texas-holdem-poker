'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  TableStatePayload,
  PublicSeatView,
  HandCardsPayload,
  HandVerifyPayload,
  ServerMessage,
} from '@poker/shared';
import type { Pot, Phase, GameEvent } from '@poker/engine';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080';

export interface TableUiState {
  phase: Phase;
  seats: PublicSeatView[];
  communityCards: string[];
  pots: Pot[];
  currentBetCents: number;
  actingSeatIndex: number;
  dealerSeatIndex: number;
  turnExpiresAt: number;
  config: TableStatePayload['config'] | null;
  handId?: string | undefined;
}

export interface UseTableSocketReturn {
  connected: boolean;
  tableState: TableUiState | null;
  myHoleCards: HandCardsPayload | null;
  latestVerify: HandVerifyPayload | null;
  events: GameEvent[];
  sendMessage: (msg: object) => void;
  join: (tableId: string, playerId: string) => void;
  sit: (seatIndex: number, buyInCents: number) => void;
  stand: () => void;
  fold: () => void;
  check: () => void;
  call: () => void;
  bet: (amountCents: number) => void;
  raise: (amountCents: number) => void;
  allIn: () => void;
}

export function useTableSocket(tableId: string, playerId: string | null): UseTableSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [tableState, setTableState] = useState<TableUiState | null>(null);
  const [myHoleCards, setMyHoleCards] = useState<HandCardsPayload | null>(null);
  const [latestVerify, setLatestVerify] = useState<HandVerifyPayload | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ...msg, ts: new Date().toISOString() }));
    }
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (playerId) {
        ws.send(JSON.stringify({ type: 'auth', payload: { token: playerId }, ts: new Date().toISOString() }));
      }
      ws.send(JSON.stringify({ type: 'table:join', payload: { tableId }, ts: new Date().toISOString() }));
    };

    ws.onclose = () => setConnected(false);

    ws.onmessage = (rawEvt) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(rawEvt.data as string) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'table:state': {
          const p = msg.payload;
          setTableState({
            phase: p.phase,
            seats: p.seats,
            communityCards: p.communityCards,
            pots: p.pots,
            currentBetCents: p.currentBetCents,
            actingSeatIndex: p.actingSeatIndex,
            dealerSeatIndex: p.dealerSeatIndex,
            turnExpiresAt: p.turnExpiresAt,
            config: p.config,
            handId: p.handId,
          });
          break;
        }

        case 'table:event': {
          const evt = msg.payload;
          setEvents((prev) => [...prev.slice(-50), evt]); // keep last 50

          // Merge game events into table state
          setTableState((prev) => {
            if (!prev) return prev;
            return applyEventToState(prev, evt);
          });
          break;
        }

        case 'hand:cards':
          setMyHoleCards(msg.payload);
          break;

        case 'hand:verify':
          setLatestVerify(msg.payload);
          break;

        case 'seat:updated':
          setTableState((prev) => {
            if (!prev) return prev;
            const newSeats = prev.seats.map((s) =>
              s.seatIndex === msg.payload.seat.seatIndex ? msg.payload.seat : s,
            );
            return { ...prev, seats: newSeats };
          });
          break;

        default:
          break;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [tableId, playerId]);

  const join = useCallback((tid: string, pid: string) => {
    sendMessage({ type: 'auth', payload: { token: pid } });
    sendMessage({ type: 'table:join', payload: { tableId: tid } });
  }, [sendMessage]);

  const sit = useCallback((seatIndex: number, buyInCents: number) => {
    sendMessage({
      type: 'seat:sit',
      payload: { tableId, seatIndex, buyInCents, clientSeed: crypto.randomUUID() },
    });
  }, [sendMessage, tableId]);

  const stand = useCallback(() => sendMessage({ type: 'seat:stand', payload: { tableId } }), [sendMessage, tableId]);
  const fold = useCallback(() => sendMessage({ type: 'intent:fold', payload: {} }), [sendMessage]);
  const check = useCallback(() => sendMessage({ type: 'intent:check', payload: {} }), [sendMessage]);
  const call = useCallback(() => sendMessage({ type: 'intent:call', payload: {} }), [sendMessage]);
  const bet = useCallback((amountCents: number) => sendMessage({ type: 'intent:bet', payload: { amountCents } }), [sendMessage]);
  const raise = useCallback((amountCents: number) => sendMessage({ type: 'intent:raise', payload: { amountCents } }), [sendMessage]);
  const allIn = useCallback(() => sendMessage({ type: 'intent:allIn', payload: {} }), [sendMessage]);

  return {
    connected,
    tableState,
    myHoleCards,
    latestVerify,
    events,
    sendMessage,
    join,
    sit,
    stand,
    fold,
    check,
    call,
    bet,
    raise,
    allIn,
  };
}

function applyEventToState(state: TableUiState, evt: GameEvent): TableUiState {
  switch (evt.type) {
    case 'phase:changed':
      return { ...state, phase: evt.phase, communityCards: evt.communityCards };

    case 'pots:updated':
      return { ...state, pots: evt.pots };

    case 'turn:start':
      return { ...state, actingSeatIndex: evt.seatIndex, turnExpiresAt: evt.expiresAt };

    case 'player:acted': {
      const newSeats = state.seats.map((s) => {
        if (s.seatIndex !== evt.seatIndex) return s;
        if (evt.action === 'fold') return { ...s, status: 'folded' as const };
        return s;
      });
      return { ...state, seats: newSeats };
    }

    case 'hand:complete':
      return { ...state, phase: 'complete', myHoleCards: null } as TableUiState & { myHoleCards: null };

    default:
      return state;
  }
}
