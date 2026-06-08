'use client';

interface NewHandBannerProps {
  dealerName: string | null;
}

export function NewHandBanner({ dealerName }: NewHandBannerProps) {
  return (
    <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-new-hand">
      <div className="bg-gray-900/95 border border-gray-600 rounded-2xl px-6 py-3 shadow-2xl text-center">
        <div className="text-yellow-400 font-black text-lg sm:text-xl tracking-widest uppercase">
          New Hand
        </div>
        {dealerName && (
          <div className="text-gray-400 text-xs mt-0.5">
            Dealer: <span className="text-white font-semibold">{dealerName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
