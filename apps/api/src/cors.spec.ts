import { getWebCorsOrigin } from './cors.js';

describe('getWebCorsOrigin', () => {
  it('uses the configured exact origin in production', () => {
    expect(
      getWebCorsOrigin({
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://nexus.example.com',
      }),
    ).toBe('https://nexus.example.com');
  });

  it('keeps the local development default without enabling a production wildcard', () => {
    expect(getWebCorsOrigin({ NODE_ENV: 'development' })).toBe(
      'http://localhost:3000',
    );
    expect(getWebCorsOrigin({ NODE_ENV: 'production' })).toBeNull();
  });

  it('rejects paths, credentials, and unsupported protocols', () => {
    expect(() =>
      getWebCorsOrigin({ WEB_ORIGIN: 'https://nexus.example.com/app' }),
    ).toThrow('WEB_ORIGIN must be an exact HTTP or HTTPS origin.');
    expect(() =>
      getWebCorsOrigin({ WEB_ORIGIN: 'https://user:pass@nexus.example.com' }),
    ).toThrow('WEB_ORIGIN must be an exact HTTP or HTTPS origin.');
    expect(() =>
      getWebCorsOrigin({ WEB_ORIGIN: 'file:///nexus' }),
    ).toThrow('WEB_ORIGIN must be an exact HTTP or HTTPS origin.');
  });
});
