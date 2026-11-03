import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrevoEmailService } from './brevo-email.service.js';

const invitation = {
  recipientEmail: 'invitee@example.com',
  organizationName: 'Acme Studio',
  inviterName: 'NEXUS Owner',
  invitationToken: 'a'.repeat(64),
  expiresAt: new Date('2026-11-09T12:00:00.000Z'),
};

describe('BrevoEmailService', () => {
  const service = new BrevoEmailService();
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('BREVO_API_KEY', 'test-api-key');
    vi.stubEnv('BREVO_SENDER_EMAIL', 'nexus@example.com');
    vi.stubEnv('BREVO_SENDER_NAME', 'NEXUS');
    vi.stubEnv('WEB_ORIGIN', 'https://nexus.example.com');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends a branded transactional email using Brevo REST API', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

    await expect(service.sendOrganizationInvitation(invitation)).resolves.toBe(
      'sent',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'api-key': 'test-api-key',
          'content-type': 'application/json',
        }),
      }),
    );

    const request = fetchMock.mock.calls[0]?.[1];
    if (!request || typeof request.body !== 'string') {
      throw new Error('Brevo request body was not serialized.');
    }
    const body = JSON.parse(request.body) as {
      to: Array<{ email: string }>;
      sender: { email: string; name: string };
      htmlContent: string;
      textContent: string;
    };
    expect(body.to).toEqual([{ email: 'invitee@example.com' }]);
    expect(body.sender).toEqual({
      email: 'nexus@example.com',
      name: 'NEXUS',
    });
    expect(body.htmlContent).toContain('Acme Studio');
    expect(body.htmlContent).toContain(
      'https://nexus.example.com/invitations/accept#token=' +
        invitation.invitationToken,
    );
    expect(body.textContent).toContain('November 9, 2026 at 12:00 PM UTC');
  });

  it('reports missing configuration without calling Brevo', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    await expect(service.sendOrganizationInvitation(invitation)).resolves.toBe(
      'unavailable',
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      invitation.recipientEmail,
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      invitation.invitationToken,
    );
  });

  it('reports provider errors without exposing response content', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'invalid_parameter',
          message:
            'Invalid sender invitee@example.com; token ' +
            invitation.invitationToken +
            ' at https://nexus.example.com/invitations/accept#token=secret',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    await expect(service.sendOrganizationInvitation(invitation)).resolves.toBe(
      'failed',
    );

    const loggedMessage = warning.mock.calls[0]?.[0] ?? '';
    expect(loggedMessage).toContain('"providerStatus":400');
    expect(loggedMessage).toContain('"providerCode":"invalid_parameter"');
    expect(loggedMessage).toContain('"reason":"invalid_request_or_sender"');
    expect(loggedMessage).toContain('[redacted-email]');
    expect(loggedMessage).toContain('[redacted-token]');
    expect(loggedMessage).toContain('[redacted-url]');
    expect(loggedMessage).not.toContain(invitation.recipientEmail);
    expect(loggedMessage).not.toContain(invitation.invitationToken);
    expect(loggedMessage).not.toContain('secret');
  });

  it('classifies Brevo credential rejection without logging credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'unauthorized', message: 'Invalid api-key' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    await expect(service.sendOrganizationInvitation(invitation)).resolves.toBe(
      'failed',
    );

    const loggedMessage = warning.mock.calls[0]?.[0] ?? '';
    expect(loggedMessage).toContain('"providerStatus":401');
    expect(loggedMessage).toContain('"reason":"provider_auth_or_account"');
    expect(loggedMessage).not.toContain('test-api-key');
  });

  it('reports network failures without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));

    await expect(service.sendOrganizationInvitation(invitation)).resolves.toBe(
      'failed',
    );
  });
});
