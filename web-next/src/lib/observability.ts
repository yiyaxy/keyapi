export function logError(err: unknown, ctx: Record<string, unknown> = {}): void {
  console.error('[web-next]', err, ctx);
}
