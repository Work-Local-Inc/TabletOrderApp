/**
 * Sentry stub — Sentry was removed but call-sites remain.
 * These are no-ops so the rest of the codebase compiles and runs unchanged.
 */

export const initSentry = () => {};

export const setSentryContext = (_key: string, _ctx: Record<string, unknown>) => {};

export const addBreadcrumb = (
  _message: string,
  _category?: string,
  _data?: Record<string, unknown>
) => {};

export const captureException = (_error: unknown, _extra?: Record<string, unknown>) => {};
