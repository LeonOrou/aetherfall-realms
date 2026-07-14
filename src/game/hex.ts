import type { HexCoord } from './types';

export const HEX_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function sameHex(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function hexNeighbors(coord: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map((direction) => ({
    q: coord.q + direction.q,
    r: coord.r + direction.r
  }));
}

export function hexesInRadius(center: HexCoord, radius: number): HexCoord[] {
  const result: HexCoord[] = [];
  for (let dq = -radius; dq <= radius; dq += 1) {
    const minDr = Math.max(-radius, -dq - radius);
    const maxDr = Math.min(radius, -dq + radius);
    for (let dr = minDr; dr <= maxDr; dr += 1) {
      result.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return result;
}

export function axialToWorld(coord: HexCoord, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: size * 1.5 * coord.r
  };
}
