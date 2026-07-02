// Dice rolling.

export function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

export function rollDice() {
  const d1 = rollDie();
  const d2 = rollDie();
  return { d1, d2, sum: d1 + d2 };
}
