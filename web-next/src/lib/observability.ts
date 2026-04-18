export function logError(err: unknown, ctx: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.error('[web-next]', err, ctx);
}
