import { Injectable, Logger } from '@nestjs/common';
import type {
  EmailDeliveryStatus,
  OrganizationInvitationEmail,
} from './email.types.js';
import { organizationInvitationTemplate } from './organization-invitation.template.js';

const BREVO_TRANSACTIONAL_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 10_000;

interface BrevoEmailRequest {
  sender: { email: string; name: string };
  to: [{ email: string }];
  subject: string;
  htmlContent: string;
  textContent: string;
}

interface BrevoErrorResponse {
  code?: string;
  message?: string;
}

@Injectable()
export class BrevoEmailService {
  private readonly logger = new Logger(BrevoEmailService.name);

  async sendOrganizationInvitation(
    invitation: OrganizationInvitationEmail,
  ): Promise<EmailDeliveryStatus> {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
    const senderName = process.env.BREVO_SENDER_NAME?.trim();
    const webOrigin = this.getWebOrigin();

    const missingConfiguration = [
      !apiKey && 'BREVO_API_KEY',
      !senderEmail && 'BREVO_SENDER_EMAIL',
      !senderName && 'BREVO_SENDER_NAME',
      !webOrigin && 'WEB_ORIGIN',
    ].filter((name): name is string => Boolean(name));
    if (!apiKey || !senderEmail || !senderName || !webOrigin) {
      this.logger.warn(
        JSON.stringify({
          event: 'transactional_email_unavailable',
          reason: 'missing_configuration',
          missingConfiguration,
        }),
      );
      return 'unavailable';
    }

    let invitationUrl: string;
    try {
      const url = new URL(webOrigin);
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username ||
        url.password
      ) {
        throw new Error('Unsupported frontend origin.');
      }
      url.pathname = '/invitations/accept';
      url.search = '';
      url.hash = `token=${invitation.invitationToken}`;
      invitationUrl = url.toString();
    } catch {
      this.logger.warn(
        JSON.stringify({
          event: 'transactional_email_unavailable',
          reason: 'invalid_web_origin',
        }),
      );
      return 'unavailable';
    }

    const content = organizationInvitationTemplate(invitation, invitationUrl);
    const body: BrevoEmailRequest = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: invitation.recipientEmail }],
      subject: content.subject,
      htmlContent: content.htmlContent,
      textContent: content.textContent,
    };

    let response: Response;
    try {
      response = await fetch(BREVO_TRANSACTIONAL_EMAIL_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      this.logger.warn(
        JSON.stringify({
          event: 'transactional_email_failed',
          reason: 'transport_error',
        }),
      );
      return 'failed';
    }

    if (!response.ok) {
      const providerError = await this.readProviderError(response);
      this.logger.warn(
        JSON.stringify({
          event: 'transactional_email_failed',
          reason: this.classifyProviderFailure(response.status),
          providerStatus: response.status,
          ...(providerError.code && {
            providerCode: this.sanitizeProviderMessage(
              providerError.code,
              [
                apiKey,
                senderEmail,
                senderName,
                invitation.recipientEmail,
                invitation.invitationToken,
                invitationUrl,
                invitation.organizationName,
                invitation.inviterName,
              ],
            ),
          }),
          ...(providerError.message && {
            providerMessage: this.sanitizeProviderMessage(
              providerError.message,
              [
                apiKey,
                senderEmail,
                senderName,
                invitation.recipientEmail,
                invitation.invitationToken,
                invitationUrl,
                invitation.organizationName,
                invitation.inviterName,
              ],
            ),
          }),
        }),
      );
      return 'failed';
    }

    this.logger.log(JSON.stringify({ event: 'transactional_email_sent' }));
    return 'sent';
  }

  private getWebOrigin(): string | null {
    const configuredOrigin = process.env.WEB_ORIGIN?.trim();
    if (configuredOrigin) return configuredOrigin;
    return process.env.NODE_ENV === 'production'
      ? null
      : 'http://localhost:3000';
  }

  private async readProviderError(
    response: Response,
  ): Promise<BrevoErrorResponse> {
    try {
      const responseBody: unknown = await response.json();
      if (typeof responseBody !== 'object' || responseBody === null) {
        return {};
      }
      const error = responseBody as Record<string, unknown>;
      return {
        ...(typeof error.code === 'string'
          ? { code: error.code.slice(0, 100) }
          : {}),
        ...(typeof error.message === 'string'
          ? { message: error.message.slice(0, 2000) }
          : {}),
      };
    } catch {
      return {};
    }
  }

  private sanitizeProviderMessage(
    message: string,
    secrets: string[],
  ): string {
    let sanitized = message
      .replace(/https?:\/\/\S+/giu, '[redacted-url]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[redacted-email]')
      .replace(/\b[a-f0-9]{64}\b/giu, '[redacted-token]');
    for (const secret of secrets) {
      if (secret) sanitized = sanitized.split(secret).join('[redacted]');
    }
    return sanitized
      .replace(/[\r\n\t]+/gu, ' ')
      .slice(0, 240);
  }

  private classifyProviderFailure(status: number): string {
    if (status === 401 || status === 403) return 'provider_auth_or_account';
    if (status === 400 || status === 422) return 'invalid_request_or_sender';
    if (status === 429) return 'provider_rate_limited';
    if (status >= 500) return 'provider_unavailable';
    return 'provider_rejected_request';
  }
}
