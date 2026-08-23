// Bond price notation: handle-32nds+eighths, e.g. 99.515625 -> "99-16+".
// Rounds to the nearest 1/256 (an eighth of a 32nd); an eighths value of 4
// (exactly half a 32nd) is conventionally shown as "+" rather than "4".
export function decimalToThirtySeconds(price: number): string {
  if (price == null || !Number.isFinite(price)) {
    return '';
  }
  const sign = price < 0 ? '-' : '';
  const abs = Math.abs(price);
  const handle = Math.floor(abs);
  const frac = abs - handle;

  const total256 = Math.round(frac * 256);
  const thirtySeconds = Math.floor(total256 / 8);
  const eighths = total256 % 8;

  const eighthStr = eighths === 0 ? '' : eighths === 4 ? '+' : String(eighths);
  const thirtySecondsStr = String(thirtySeconds).padStart(2, '0');

  return `${sign}${handle}-${thirtySecondsStr}${eighthStr}`;
}
