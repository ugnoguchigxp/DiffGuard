import { DEFAULT_RELATED_CODE_LIMIT, MIN_RELATED_CODE_SCORE } from "../constants/embedding";

export interface CodeCandidate {
  id: string;
  content: string;
}

export interface ScoredCodeCandidate extends CodeCandidate {
  score: number;
}

const TOKEN_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

const splitIdentifierToken = (token: string): string[] => {
  const expanded = token.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const parts = expanded
    .split(/[_$]|\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  return Array.from(new Set([...parts, token.toLowerCase()]));
};

export const tokenize = (value: string): string[] => {
  const matches = value.match(TOKEN_PATTERN);
  if (!matches) {
    return [];
  }

  return matches.flatMap((token) => splitIdentifierToken(token));
};

export const scoreCandidate = (query: string, candidate: string): number => {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);

  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);

  let intersection = 0;
  for (const token of querySet) {
    if (candidateSet.has(token)) {
      intersection += 1;
    }
  }

  if (intersection === 0) {
    return 0;
  }

  const union = new Set([...querySet, ...candidateSet]).size;
  return intersection / union;
};

export const selectRelatedCode = (
  query: string,
  candidates: CodeCandidate[],
  limit = DEFAULT_RELATED_CODE_LIMIT,
  minScore = MIN_RELATED_CODE_SCORE,
): ScoredCodeCandidate[] => {
  return candidates
    .map((candidate) => {
      return {
        ...candidate,
        score: scoreCandidate(query, candidate.content),
      };
    })
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
