import type { Settings } from './types';

type Rating = Settings['rating'];

export function searchTokenAtCaret(query: string, caret: number): { start: number; end: number; text: string } | null {
  const position = Math.max(0, Math.min(caret, query.length));
  let start = position;
  let end = position;
  while (start > 0 && !/\s/.test(query[start - 1])) start--;
  while (end < query.length && !/\s/.test(query[end])) end++;
  return start === end ? null : { start, end, text: query.slice(start, end) };
}

export function completeSearchToken(query: string, caret: number, tag: string): { query: string; caret: number } {
  const token = searchTokenAtCaret(query, caret);
  if (!token) return { query, caret };
  const prefix = query.slice(0, token.start);
  const suffix = query.slice(token.end);
  const separator = suffix && /^\s/.test(suffix) ? '' : ' ';
  return { query: prefix + tag + separator + suffix, caret: prefix.length + tag.length + separator.length };
}

export function explicitRating(query: string): Rating | null {
  const term = query.split(/\s+/).find(value => /^rating:\S+$/i.test(value));
  const value = term?.slice(7).toLowerCase();
  if (value === 'safe' || value === 's') return 's';
  if (value === 'questionable' || value === 'q') return 'q';
  if (value === 'explicit' || value === 'e') return 'e';
  if (value === 'all') return 'all';
  return null;
}

export function applyRatingFilter(query: string, rating: Rating): string {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const index = terms.findIndex(term => /^rating:\S+$/i.test(term));
  const withoutRating = terms.filter(term => !/^rating:\S+$/i.test(term));
  if (index >= 0 && rating !== 'all') withoutRating.splice(Math.min(index, withoutRating.length), 0, `rating:${rating}`);
  return withoutRating.join(' ');
}
