export function getWebCorsOrigin(
  environment: NodeJS.ProcessEnv,
): string | null {
  const configuredOrigin = environment.WEB_ORIGIN?.trim();
  const origin = configuredOrigin ||
    (environment.NODE_ENV === 'production' ? null : 'http://localhost:3000');
  if (!origin) return null;

  try {
    const url = new URL(origin);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.origin !== origin
    ) {
      throw new Error('Invalid web origin.');
    }
    return origin;
  } catch {
    throw new Error('WEB_ORIGIN must be an exact HTTP or HTTPS origin.');
  }
}
