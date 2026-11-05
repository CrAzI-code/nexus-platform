# Organization members and invitations

Organization Owners and Admins can invite people as Admins, Managers, or Members, and manage existing member roles and access. The API enforces these permissions; hiding controls in the web interface is not an authorization boundary. The Owner cannot be demoted or removed.

Invitations are normalized to a lowercase email address, expire after seven days, and store only a hash of the invitation token. Acceptance and decline require a verified primary email matching the invited address. A pending invitation can be revoked or resent by an Owner or Admin. Resending rotates the token and extends the expiry, so the prior link becomes invalid.

Invitees can accept or decline using either the emailed invitation link or an invitation notification. Expired, revoked, accepted, and declined invitations cannot be used again. The API records invitation creation, resend, revocation, acceptance, and decline in the organization audit log.

Invitation email delivery is reported separately from invitation creation. If email delivery is unavailable or fails, an authorized manager can share the one-time link shown in the team interface. A resend produces a new link; copy it before leaving the page.
