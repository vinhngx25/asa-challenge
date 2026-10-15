"""Greedy all-pairs generator (the same algorithm as backend/test/helpers/pairwise.ts)."""


def pairwise(parameters):
    """parameters: dict name -> list of values. Returns rows (dicts) covering every pair of values at least once."""
    names = list(parameters)
    uncovered = set()
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            for a in parameters[names[i]]:
                for b in parameters[names[j]]:
                    uncovered.add((i, a, j, b))

    rows = []
    while uncovered:
        i, a, j, b = sorted(uncovered, key=lambda p: (p[0], p[2], str(p[1]), str(p[3])))[0]
        chosen = {i: a, j: b}
        for k in range(len(names)):
            if k in chosen:
                continue
            best, best_score = parameters[names[k]][0], -1
            for cand in parameters[names[k]]:
                score = 0
                for m, other in chosen.items():
                    key = (m, other, k, cand) if m < k else (k, cand, m, other)
                    score += key in uncovered
                if score > best_score:
                    best, best_score = cand, score
            chosen[k] = best
        for x in range(len(names)):
            for y in range(x + 1, len(names)):
                uncovered.discard((x, chosen[x], y, chosen[y]))
        rows.append({names[k]: chosen[k] for k in range(len(names))})
    return rows


def all_pairs_covered(parameters, rows):
    names = list(parameters)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            for a in parameters[names[i]]:
                for b in parameters[names[j]]:
                    if not any(r[names[i]] == a and r[names[j]] == b for r in rows):
                        return False
    return True
