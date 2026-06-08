declare module 'pokersolver' {
  interface PokerCard {
    value: string;
    suit: string;
    rank: number;
    wildValue?: string;
  }

  interface PokerHand {
    name: string;
    descr: string;
    cards: PokerCard[];
    cardPool: PokerCard[];
    rank: number;
    toString(): string;
  }

  interface HandConstructor {
    solve(cards: string[], game?: string, canDisqualify?: boolean): PokerHand;
    winners(hands: PokerHand[]): PokerHand[];
  }

  const Hand: HandConstructor;
  export { Hand };
  export default { Hand };
}
