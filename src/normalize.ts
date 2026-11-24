// Word normalisation + fuzzy similarity shared by the script and the speech
// recogniser output, so "5", "five", "Five," and "five." all compare equal.

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under1000(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) {
    out.push(ONES[Math.floor(n / 100)], 'hundred');
    n %= 100;
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)]);
    if (n % 10) out.push(ONES[n % 10]);
  } else if (n > 0 || out.length === 0) {
    out.push(ONES[n]);
  }
  return out;
}

export function numberToWords(n: number): string[] {
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999) return [String(n)];
  if (n === 0) return ['zero'];
  const out: string[] = [];
  const scales: [number, string][] = [[1_000_000, 'million'], [1000, 'thousand']];
  for (const [size, name] of scales) {
    if (n >= size) {
      out.push(...under1000(Math.floor(n / size)), name);
      n %= size;
    }
  }
  if (n > 0) out.push(...under1000(n));
  return out;
}

function yearToWords(n: number): string[] {
  // 1987 -> nineteen eighty seven, 2024 -> twenty twenty four, 2005 -> two thousand five
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return [...under1000(hi), 'hundred'];
  if (hi % 10 === 0 && lo < 10) return numberToWords(n);
  return [...under1000(hi), ...(lo < 10 ? ['oh', ONES[lo]] : under1000(lo))];
}

const ORD_IRREG: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};
function toOrdinal(words: string[]): string[] {
  const last = words[words.length - 1];
  let ord = ORD_IRREG[last];
  if (!ord) ord = last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th';
  return [...words.slice(0, -1), ord];
}

const SYMBOLS: Record<string, string> = { '&': ' and ', '%': ' percent ', '+': ' plus ', '@': ' at ', '=': ' equals ' };

/**
 * Split raw text into normalised comparison tokens.
 * Lower-cases, strips punctuation, expands numbers into words.
 */
export function tokenize(raw: string): string[] {
  let s = raw
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[&%+@=]/g, (c) => SYMBOLS[c] ?? ' ')
    // $5 -> 5 dollars
    .replace(/\$(\d[\d,]*(?:\.\d+)?)/g, '$1 dollars');
  const out: string[] = [];
  for (let piece of s.split(/[\s\-–—/\\_]+/)) {
    piece = piece.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    if (!piece) continue;
    const num = piece.match(/^(\d[\d,]*)(?:\.(\d+))?(st|nd|rd|th|'?s)?$/);
    if (num) {
      const n = parseInt(num[1].replace(/,/g, ''), 10);
      const isYear = !num[1].includes(',') && num[1].length === 4 && n >= 1100 && n <= 2099;
      let words = isYear ? yearToWords(n) : numberToWords(n);
      const plural = num[3] === 's' || num[3] === "'s";
      if (num[3] && !plural) words = toOrdinal(words);
      if (plural) words = [...words.slice(0, -1), words[words.length - 1].replace(/y$/, 'ie') + 's'];
      out.push(...words);
      if (num[2]) out.push('point', ...num[2].split('').map((d) => ONES[+d]));
      continue;
    }
    // Strip apostrophes: don't -> dont, rock'n'roll -> rocknroll, 'cause -> cause
    piece = piece.replace(/'/g, '');
    const parts = piece.split(/[^a-z0-9]+/).filter(Boolean);
    out.push(...parts);
  }
  return out;
}

export const STOPWORDS = new Set(
  ('a an the and or but so of to in on at by for with from as is are was were be been am ' +
    'i im you we they he she it its this that these those my your our their me us them ' +
    'do does did not no yes if then than there here what which who how when where why ' +
    'will would can could should just very really also up out about into over oh uh um ' +
    'ah er like okay ok well now get got have has had').split(' '),
);

/** How much a matched word counts as evidence of position. */
export function wordWeight(w: string): number {
  if (STOPWORDS.has(w)) return 0.35;
  if (w.length <= 2) return 0.5;
  if (w.length <= 3) return 0.8;
  return 1;
}

function stem(w: string): string {
  if (w.length <= 4) return w;
  return w.replace(/(ingly|edly|ing|ed|es|ly|s|er|est)$/, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Crude phonetic key: first letter + consonant skeleton. */
function phoneticKey(w: string): string {
  const s = w
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1');
  return s[0] + s.slice(1).replace(/[aeiouyhw]/g, '');
}

const simCache = new Map<string, number>();

/** 0..1 similarity between two normalised tokens. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const key = a < b ? a + '|' + b : b + '|' + a;
  const hit = simCache.get(key);
  if (hit !== undefined) return hit;
  let s = 0;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 4) {
    if (stem(a) === stem(b)) s = 0.9;
    else {
      const d = levenshtein(a, b);
      const r = 1 - d / Math.max(a.length, b.length);
      if (r >= 0.7) s = r * 0.9;
      else if (phoneticKey(a) === phoneticKey(b)) s = 0.7;
    }
  }
  if (simCache.size > 50_000) simCache.clear();
  simCache.set(key, s);
  return s;
}
