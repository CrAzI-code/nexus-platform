import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createClerkClient,
  verifyToken,
  type ClerkClient,
} from '@clerk/backend';
import {
  TokenVerificationError,
  TokenVerificationErrorReason,
} from '@clerk/backend/errors';

export interface VerifiedClerkSession {
  subject: string;
}

@Injectable()
export class ClerkBackendService {
  private readonly logger = new Logger(ClerkBackendService.name);
  private clerkClient: ClerkClient | undefined;

  async verifySessionToken(token: string): Promise<VerifiedClerkSession> {
    const secretKey = this.getSecretKey();
    const authorizedParties = this.getAuthorizedParties();

    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(token, { secretKey, authorizedParties });
    } catch (error) {
      const category = this.getVerificationFailureCategory(error);
      this.logger.warn(`Clerk session verification failed: ${category}`);

      if (category === 'invalid_secret_key') {
        throw new ServiceUnavailableException(
          'Authentication server configuration is invalid.',
        );
      }

      throw new UnauthorizedException('Invalid or expired session token.');
    }

    if (
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string'
    ) {
      this.logger.warn('Clerk session verification failed: missing_session_claims');
      throw new UnauthorizedException('Invalid or expired session token.');
    }

    if (claims.sts === 'pending') {
      this.logger.warn('Clerk session verification failed: pending_session');
      throw new UnauthorizedException('Invalid or expired session token.');
    }

    return { subject: claims.sub };
  }

  private getVerificationFailureCategory(error: unknown): string {
    if (!(error instanceof TokenVerificationError)) {
      return 'unexpected_verifier_error';
    }

    switch (error.reason) {
      case TokenVerificationErrorReason.InvalidSecretKey:
        return 'invalid_secret_key';
      case TokenVerificationErrorReason.TokenExpired:
        return 'token_expired';
      case TokenVerificationErrorReason.TokenInvalidAuthorizedParties:
        return 'authorized_party_mismatch';
      case TokenVerificationErrorReason.TokenInvalidIssuer:
        return 'issuer_mismatch';
      case TokenVerificationErrorReason.TokenInvalidSignature:
        return 'invalid_signature';
      case TokenVerificationErrorReason.TokenInvalidAlgorithm:
        return 'invalid_algorithm';
      case TokenVerificationErrorReason.TokenNotActiveYet:
        return 'token_not_active';
      case TokenVerificationErrorReason.TokenIatInTheFuture:
        return 'token_issued_in_future';
      case TokenVerificationErrorReason.LocalJWKMissing:
      case TokenVerificationErrorReason.RemoteJWKFailedToLoad:
      case TokenVerificationErrorReason.RemoteJWKInvalid:
      case TokenVerificationErrorReason.RemoteJWKMissing:
      case TokenVerificationErrorReason.JWKFailedToResolve:
      case TokenVerificationErrorReason.JWKKidMismatch:
        return 'verification_key_unavailable';
      case TokenVerificationErrorReason.TokenInvalid:
        return 'invalid_token';
      default:
        return 'verification_failed';
    }
  }

  async getUser(subject: string) {
    try {
      return await this.getClient().users.getUser(subject);
    } catch {
      throw new ServiceUnavailableException(
        'Unable to retrieve account details from the identity provider.',
      );
    }
  }

  private getClient(): ClerkClient {
    if (!this.clerkClient) {
      this.clerkClient = createClerkClient({
        secretKey: this.getSecretKey(),
      });
    }

    return this.clerkClient;
  }

  private getSecretKey(): string {
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new ServiceUnavailableException(
        'Authentication is not configured.',
      );
    }

    return secretKey;
  }

  private getAuthorizedParties(): string[] {
    const parties = process.env.CLERK_AUTHORIZED_PARTIES
      ?.split(',')
      .map((party) => party.trim())
      .filter(Boolean);

    if (!parties?.length || parties.some((party) => !this.isOrigin(party))) {
      throw new ServiceUnavailableException(
        'Authentication is not configured.',
      );
    }

    return parties;
  }

  private isOrigin(value: string): boolean {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.origin === value
      );
    } catch {
      return false;
    }
  }
}
