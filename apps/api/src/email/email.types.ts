export type EmailDeliveryStatus = 'sent' | 'unavailable' | 'failed';

export interface OrganizationInvitationEmail {
  recipientEmail: string;
  organizationName: string;
  inviterName: string;
  invitationToken: string;
  expiresAt: Date;
}
