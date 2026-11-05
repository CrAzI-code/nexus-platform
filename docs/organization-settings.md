# Organization settings

The organization Settings page is available to active organization members.
Owners and Admins can edit the shared organization name; Managers and Members
can view it but cannot submit changes. The API independently enforces this
role check against the authenticated user's active organization membership,
so frontend visibility is not an authorization boundary.

Names are trimmed, required, limited to 100 Unicode code points, and reject
control characters. Updating the name preserves the existing organization
slug and ID, so current organization links remain valid. The sidebar workspace
name and initials update immediately after the API confirms the change.

The page also links to the existing team-management workflow and embeds the
Clerk-managed personal account profile. Organization-wide preferences are not
stored by NEXUS yet and are shown as unavailable rather than presented as
editable settings.
