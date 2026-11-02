import type { OrganizationInvitationEmail } from './email.types.js';

export interface TransactionalEmailContent {
  subject: string;
  htmlContent: string;
  textContent: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

export function organizationInvitationTemplate(
  input: OrganizationInvitationEmail,
  invitationUrl: string,
): TransactionalEmailContent {
  const organizationName = escapeHtml(input.organizationName);
  const inviterName = escapeHtml(input.inviterName);
  const safeInvitationUrl = escapeHtml(invitationUrl);
  const expiration = `${new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(input.expiresAt)} UTC`;
  const subjectOrganization = input.organizationName
    .replace(/[\r\n\t]+/gu, ' ')
    .trim();
  const subject = `You’re invited to join ${subjectOrganization} on NEXUS`;

  return {
    subject,
    htmlContent: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;background:#f4f6fb;color:#172033;font-family:Arial,Helvetica,sans-serif">
          <div style="max-width:560px;margin:40px auto;padding:36px 32px;background:#ffffff;border:1px solid #e6eaf2;border-radius:16px">
            <p style="margin:0 0 24px;color:#5165e8;font-size:13px;font-weight:700;letter-spacing:2px">NEXUS</p>
            <h1 style="margin:0 0 16px;font-size:25px;line-height:1.3">You’re invited to collaborate</h1>
            <p style="margin:0 0 12px;color:#4b5568;line-height:1.65">
              <strong>${inviterName}</strong> invited you to join <strong>${organizationName}</strong> on NEXUS.
            </p>
            <p style="margin:26px 0">
              <a href="${safeInvitationUrl}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#5165e8;color:#ffffff;font-weight:700;text-decoration:none">Accept invitation</a>
            </p>
            <p style="margin:0;color:#667085;font-size:13px;line-height:1.6">
              This invitation expires on ${escapeHtml(expiration)}. If you weren’t expecting this invitation, you can ignore this email.
            </p>
            <p style="margin:28px 0 0;color:#98a1b2;font-size:12px">NEXUS — your team, moving together.</p>
          </div>
        </body>
      </html>
    `.trim(),
    textContent: [
      `NEXUS invitation`,
      ``,
      `${input.inviterName} invited you to join ${input.organizationName} on NEXUS.`,
      ``,
      `Accept your invitation: ${invitationUrl}`,
      ``,
      `This invitation expires on ${expiration}. If you weren’t expecting this invitation, you can ignore this email.`,
    ].join('\n'),
  };
}
