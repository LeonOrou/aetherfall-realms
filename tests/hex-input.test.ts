import { describe, expect, it } from 'vitest';
import { pointyHexHitArea } from '../src/game/hex';

function polygonContains(points: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const crosses = (a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

describe('hex pointer hit area', () => {
  it('uses the complete visible bounds of a pointy-top hex', () => {
    const hitArea = pointyHexHitArea(41);
    expect(hitArea.width).toBeCloseTo(Math.sqrt(3) * 41);
    expect(hitArea.height).toBe(82);
    expect(Math.min(...hitArea.points.map((point) => point.x))).toBeCloseTo(0);
    expect(Math.max(...hitArea.points.map((point) => point.x))).toBeCloseTo(hitArea.width);
    expect(Math.min(...hitArea.points.map((point) => point.y))).toBeCloseTo(0);
    expect(Math.max(...hitArea.points.map((point) => point.y))).toBeCloseTo(hitArea.height);
  });

  it('accepts the center and rejects the transparent bounding-box corners', () => {
    const hitArea = pointyHexHitArea(41);
    expect(polygonContains(hitArea.points, hitArea.width / 2, hitArea.height / 2)).toBe(true);
    expect(polygonContains(hitArea.points, 1, 1)).toBe(false);
    expect(polygonContains(hitArea.points, hitArea.width - 1, 1)).toBe(false);
    expect(polygonContains(hitArea.points, 1, hitArea.height - 1)).toBe(false);
    expect(polygonContains(hitArea.points, hitArea.width - 1, hitArea.height - 1)).toBe(false);
  });
});
