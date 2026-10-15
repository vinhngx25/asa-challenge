/**
 * Greedy all-pairs test design. Every pair of values from any two parameters appears in at least one row,
 * with far fewer rows than the full combination of all parameters. Deterministic: the same input gives the same rows.
 */
export type Parameters = Record<string, readonly string[]>;
export type Row = Record<string, string>;

export function pairwise(parameters: Parameters): Row[] {
  const names = Object.keys(parameters);
  const values = names.map((n) => parameters[n] ?? []);
  const pairKey = (i: number, a: string, j: number, b: string) => `${i}\u0000${a}\u0001${j}\u0000${b}`;

  const uncovered = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      for (const a of values[i]!) for (const b of values[j]!) uncovered.add(pairKey(i, a, j, b));
    }
  }

  const rows: Row[] = [];
  while (uncovered.size > 0) {
    // Seed the row with the first pair still uncovered, then pick the value that covers most new pairs for each remaining parameter.
    const seed = uncovered.values().next().value as string;
    const [left, right] = seed.split('\u0001') as [string, string];
    const [i, a] = [Number(left.split('\u0000')[0]), left.split('\u0000')[1]!];
    const [j, b] = [Number(right.split('\u0000')[0]), right.split('\u0000')[1]!];
    const chosen: (string | undefined)[] = names.map(() => undefined);
    chosen[i] = a;
    chosen[j] = b;

    for (let k = 0; k < names.length; k++) {
      if (chosen[k] !== undefined) continue;
      let best = values[k]![0]!;
      let bestScore = -1;
      for (const candidate of values[k]!) {
        let score = 0;
        for (let m = 0; m < names.length; m++) {
          const other = chosen[m];
          if (m === k || other === undefined) continue;
          const key = m < k ? pairKey(m, other, k, candidate) : pairKey(k, candidate, m, other);
          if (uncovered.has(key)) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      chosen[k] = best;
    }

    for (let x = 0; x < names.length; x++) {
      for (let y = x + 1; y < names.length; y++) uncovered.delete(pairKey(x, chosen[x]!, y, chosen[y]!));
    }
    rows.push(Object.fromEntries(names.map((n, idx) => [n, chosen[idx]!])));
  }
  return rows;
}

export function allPairsCovered(parameters: Parameters, rows: Row[]): boolean {
  const names = Object.keys(parameters);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      for (const a of parameters[names[i]!]!) {
        for (const b of parameters[names[j]!]!) {
          if (!rows.some((r) => r[names[i]!] === a && r[names[j]!] === b)) return false;
        }
      }
    }
  }
  return true;
}
