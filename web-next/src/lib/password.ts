export type Strength = 'none' | 'weak' | 'fair' | 'good' | 'strong';

export function estimateStrength(pw: string): Strength {
  if (!pw) return 'none';
  const len = pw.length;
  const classes =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/\d/.test(pw) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);

  if (len < 6) return 'weak';
  if (classes <= 1) return 'weak';
  if (classes === 2 && len >= 8) return 'fair';
  if (classes === 3 && len >= 10) return 'good';
  if (classes === 4 && len >= 12) return 'strong';
  if (classes >= 3) return 'good';
  return 'fair';
}
