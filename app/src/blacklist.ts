import type { BlacklistRule, Post } from './types';

interface Term { value: string; negated: boolean; optional: boolean }
const compiledRules = new WeakMap<BlacklistRule[], Term[][]>();

function termsFor(line: string): Term[] {
  const expression = line.split(/\s+#/, 1)[0].trim();
  if (!expression || expression.startsWith('#')) return [];
  const seen = new Set<string>();
  return expression.split(/\s+/).flatMap(raw => {
    const normalized = raw.toLowerCase();
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    const prefix = raw.match(/^[-~]+/)?.[0] || '';
    const value = raw.slice(prefix.length).toLowerCase();
    return value ? [{ value, negated: prefix.includes('-'), optional: prefix.includes('~') }] : [];
  });
}

function rulesFor(rules: BlacklistRule[]): Term[][] {
  let compiled = compiledRules.get(rules);
  if (!compiled) {
    compiled = rules.filter(rule => rule.enabled).map(rule => termsFor(rule.text)).filter(terms => terms.length > 0);
    compiledRules.set(rules, compiled);
  }
  return compiled;
}

function metric(value: string, units = false): number | null {
  const match = value.match(/^(-?\d+(?:\.\d+)?)(kb|mb|b)?$/i);
  if (!match || (!units && match[2])) return null;
  const multiplier = match[2]?.toLowerCase() === 'kb' ? 1024 : match[2]?.toLowerCase() === 'mb' ? 1024 * 1024 : 1;
  return Number(match[1]) * multiplier;
}

function compare(actual: number, expression: string, units = false): boolean {
  if (expression.includes('..')) {
    const bounds = expression.split('..');
    if (bounds.length !== 2) return false;
    const low = bounds[0] ? metric(bounds[0], units) : null;
    const high = bounds[1] ? metric(bounds[1], units) : null;
    if ((bounds[0] && low === null) || (bounds[1] && high === null)) return false;
    return (low !== null || high !== null) && (low === null || actual >= low) && (high === null || actual <= high);
  }
  const match = expression.match(/^(>=|<=|=>|=<|>|<|=)?(.+)$/);
  const wanted = match && metric(match[2], units);
  if (!match || wanted === null) return false;
  switch (match[1]) {
    case '>': return actual > wanted;
    case '<': return actual < wanted;
    case '>=': case '=>': return actual >= wanted;
    case '<=': case '=<': return actual <= wanted;
    default: return actual === wanted;
  }
}

function matches(value: string, post: Post, tags: Set<string>): boolean {
  const separator = value.indexOf(':');
  const field = separator >= 0 ? value.slice(0, separator) : '';
  const wanted = separator >= 0 ? value.slice(separator + 1) : '';
  switch (field) {
    case 'rating': {
      const rating = ({ safe: 's', questionable: 'q', explicit: 'e' } as Record<string, string>)[wanted] || wanted;
      return rating === post.rating?.toLowerCase();
    }
    case 'type': {
      const ext = post.file_ext?.toLowerCase() || '';
      if (wanted === 'video') return ['mp4', 'webm', 'mkv', 'mov'].includes(ext);
      if (wanted === 'animation') return ['gif', 'apng', 'webp'].includes(ext);
      if (wanted === 'image') return !['mp4', 'webm', 'mkv', 'mov', 'gif', 'apng'].includes(ext);
      return ext === wanted;
    }
    case 'status': return (post.flags || '').toLowerCase().split(/\s+/).includes(wanted);
    case 'user': case 'username': case 'uploader':
      return wanted.startsWith('!') ? compare(post.uploader_id || 0, wanted.slice(1)) : post.uploader?.toLowerCase() === wanted;
    case 'userid': return compare(post.uploader_id || 0, wanted);
    case 'pool': return (post.pools || '').split(/[,;\s]+/).includes(wanted);
    case 'score': return compare(post.score || 0, wanted);
    case 'favcount': return compare(post.fav_count || 0, wanted);
    case 'width': return compare(post.width || 0, wanted);
    case 'height': return compare(post.height || 0, wanted);
    case 'id': return compare(post.id, wanted);
    case 'filesize': return compare(post.size || 0, wanted, true);
    case 'tagcount': return compare(tags.size, wanted);
    case 'fav':
      if (wanted === 'me' || wanted === 'true') return post.is_favorited;
      if (wanted === 'false') return !post.is_favorited;
      break;
    default: break;
  }
  if (value === 'fav') return post.is_favorited;
  if (value.includes('*') || value.includes('?')) {
    const pattern = new RegExp(`^${value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    return [...tags].some(tag => pattern.test(tag));
  }
  return tags.has(value);
}

export function allowedPost(post: Post, rules: BlacklistRule[]): boolean {
  const compiled = rulesFor(rules);
  if (!compiled.length) return true;
  const tags = new Set((post.tags || '').toLowerCase().split(/\s+/).filter(Boolean));
  return !compiled.some(rule => {
    let optionalCount = 0;
    let optionalMatches = 0;
    for (const term of rule) {
      const matched = matches(term.value, post, tags) !== term.negated;
      if (term.optional) {
        optionalCount++;
        if (matched) optionalMatches++;
      } else if (!matched) return false;
    }
    return optionalCount === 0 || optionalMatches > 0;
  });
}

export function parseBlacklist(profileText: string, disabled: string[]): BlacklistRule[] {
  const active = profileText.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
  const activeSet = new Set(active.map(text => text.toLowerCase()));
  const disabledSet = new Set(disabled.map(text => text.toLowerCase()));
  return [...active.map(text => ({ text, enabled: !disabledSet.has(text.toLowerCase()) })),
    ...disabled.filter(text => !activeSet.has(text.toLowerCase())).map(text => ({ text, enabled: false }))];
}
