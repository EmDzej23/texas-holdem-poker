'use client';

const SUIT_SYMBOLS: Record<string, { symbol: string; color: string }> = {
  c: { symbol: '♣', color: '#1a7d1a' },
  d: { symbol: '♦', color: '#cc1111' },
  h: { symbol: '♥', color: '#cc1111' },
  s: { symbol: '♠', color: '#111111' },
};

const RANK_DISPLAY: Record<string, string> = {
  T: '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
};

interface CardProps {
  card?: string; // e.g. "Ah", "Td"
  faceDown?: boolean;
  small?: boolean;
  animate?: boolean; // play deal animation on mount
}

export function Card({ card, faceDown, small, animate = true }: CardProps) {
  const size = small ? 'w-8 h-12 text-xs' : 'w-14 h-20 text-sm';

  if (faceDown || !card) {
    return (
      <div
        className={`${size} ${animate ? 'animate-deal' : ''} rounded-lg border-2 border-gray-400 bg-blue-800 flex items-center justify-center`}
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, #1e40af 0 4px, #1e3a8a 4px 8px)' }}
      />
    );
  }

  const rank = card.slice(0, -1)!;
  const suit = card.slice(-1)!;
  const suitInfo = SUIT_SYMBOLS[suit] ?? { symbol: '?', color: '#000' };
  const rankDisplay = RANK_DISPLAY[rank] ?? rank;

  return (
    <div
      className={`${size} ${animate ? 'animate-deal' : ''} rounded-lg border-2 border-gray-300 bg-white flex flex-col items-start justify-between p-1 shadow-md select-none`}
    >
      <span className="font-bold leading-none" style={{ color: suitInfo.color }}>
        {rankDisplay}
      </span>
      <span className="self-center text-lg leading-none" style={{ color: suitInfo.color }}>
        {suitInfo.symbol}
      </span>
      <span className="font-bold leading-none self-end rotate-180" style={{ color: suitInfo.color }}>
        {rankDisplay}
      </span>
    </div>
  );
}
