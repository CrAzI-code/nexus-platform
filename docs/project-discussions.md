# Project discussions

Projects have separate discussion topics so team conversations are not mixed
into task comments or task activity. Each discussion is created with its first
message; later messages are stored chronologically and can be loaded in stable,
cursor-paginated history pages.

The API scopes every request to the organization and project in the route.
Active organization Owners and Admins can access discussions in their
organization's projects. Managers and Members must have an active membership
in the specific project. Archived projects are readable but cannot be changed.
Authors can edit or delete their own messages; project Owners, Admins, and
Managers can delete messages in projects they are authorized to manage.
Deletion clears the body and leaves a timestamped placeholder in the history.

Discussion messages, read cursors, and member notifications are written in one
database transaction. Notifications contain a generic message rather than the
discussion text and are delivered through the authenticated, persisted SSE
stream. The client resumes from its last notification cursor and refreshes the
selected discussion when a project message notification arrives.
