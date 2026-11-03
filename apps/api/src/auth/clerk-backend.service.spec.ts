import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import {
  TokenVerificationError,
  TokenVerificationErrorReason,
} from '@clerk/backend/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClerkBackendService } from './clerk-backend.service.js';

vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(),
  verifyToken: vi.fn(),
}));

describe('ClerkBackendService', () => {
  let service: ClerkBackendService;

  beforeEach(() => {
    vi.stubEnv('CLERK_SECRET_KEY', 'test-secret');
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', 'http://localhost:3000');
    vi.mocked(verifyToken).mockReset();
    service = new ClerkBackendService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a verified Clerk session and returns only its subject', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      sub: 'user_123',
      sid: 'sess_123',
      sts: 'active',
    } as never);

    await expect(
      service.verifySessionToken('valid-session-token'),
    ).resolves.toEqual({
      subject: 'user_123',
    });
    expect(verifyToken).toHaveBeenCalledWith('valid-session-token', {
      secretKey: 'test-secret',
      authorizedParties: ['http://localhost:3000'],
    });
  });

  it('rejects invalid session tokens without returning verifier details', async () => {
    vi.mocked(verifyToken).mockRejectedValue(
      new TokenVerificationError({
        message: 'Sensitive token verification details',
        reason: TokenVerificationErrorReason.TokenExpired,
      }),
    );

    await expect(service.verifySessionToken('invalid-token')).rejects.toThrow(
      new UnauthorizedException('Invalid or expired session token.'),
    );
  });

  it('logs an authorized-party mismatch category without logging verifier details', async () => {
    const logger = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    vi.mocked(verifyToken).mockRejectedValue(
      new TokenVerificationError({
        message: 'Sensitive token and origin details',
        reason: TokenVerificationErrorReason.TokenInvalidAuthorizedParties,
      }),
    );

    await expect(service.verifySessionToken('invalid-token')).rejects.toThrow(
      UnauthorizedException,
    );

    expect(logger).toHaveBeenCalledWith(
      'Clerk session verification failed: authorized_party_mismatch',
    );
    expect(logger).toHaveBeenCalledTimes(1);
    logger.mockRestore();
  });

  it('reports an invalid backend secret as a configuration failure', async () => {
    const logger = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    vi.mocked(verifyToken).mockRejectedValue(
      new TokenVerificationError({
        message: 'Sensitive secret key details',
        reason: TokenVerificationErrorReason.InvalidSecretKey,
      }),
    );

    await expect(service.verifySessionToken('session-token')).rejects.toThrow(
      new ServiceUnavailableException(
        'Authentication server configuration is invalid.',
      ),
    );

    expect(logger).toHaveBeenCalledWith(
      'Clerk session verification failed: invalid_secret_key',
    );
    expect(logger).toHaveBeenCalledTimes(1);
    logger.mockRestore();
  });

  it('rejects tokens that do not contain Clerk session claims', async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'user_123' } as never);

    await expect(
      service.verifySessionToken('not-a-session-token'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('fails closed when the authorized-party allowlist is missing', async () => {
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', '');

    await expect(service.verifySessionToken('session-token')).rejects.toThrow(
      'Authentication is not configured.',
    );
    expect(verifyToken).not.toHaveBeenCalled();
  });
});
