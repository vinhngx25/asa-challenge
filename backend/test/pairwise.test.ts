import { describe, expect, it } from 'vitest';
import { allPairsCovered, pairwise } from './helpers/pairwise.js';

describe('pairwise generator', () => {
  it('covers every pair of values with far fewer rows than the full product', () => {
    const params = {
      dealership: ['a', 'b', 'c'],
      service: ['1', '2', '3', '4', '5', '6', '7'],
      day: ['mon', 'sat', 'sun'],
      position: ['first', 'mid', 'last', 'after', 'before'],
      contention: ['none', 'bay', 'techs', 'vehicle', 'bays'],
      customer: ['wick', 'bond'],
    };
    const rows = pairwise(params);
    const full = 3 * 7 * 3 * 5 * 5 * 2;
    expect(allPairsCovered(params, rows)).toBe(true);
    expect(rows.length).toBeLessThan(full / 20);
  });

  it('is deterministic', () => {
    const params = { x: ['1', '2'], y: ['a', 'b', 'c'], z: ['p', 'q'] };
    expect(pairwise(params)).toEqual(pairwise(params));
  });

  it('handles a single parameter and two parameters', () => {
    expect(pairwise({ x: ['1', '2'] })).toEqual([]);
    const two = { x: ['1', '2'], y: ['a', 'b'] };
    expect(pairwise(two)).toHaveLength(4);
    expect(allPairsCovered(two, pairwise(two))).toBe(true);
  });
});
