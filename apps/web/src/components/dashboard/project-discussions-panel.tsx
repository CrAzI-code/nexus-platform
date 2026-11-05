"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  consumeNotificationStream,
  type NexusNotification,
} from "@/lib/notifications";
import {
  createProjectDiscussion,
  deleteDiscussionMessage,
  editDiscussionMessage,
  listDiscussionMessages,
  listProjectDiscussions,
  markProjectDiscussionRead,
  postDiscussionMessage,
  type DiscussionMessage,
  type ProjectDiscussion,
} from "@/lib/project-discussions";

type ProjectDiscussionsPanelProps = {
  organizationId: string;
  projectId: string;
  projectStatus: "ACTIVE" | "ARCHIVED";
};

function messageTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function mergeMessages(
  current: DiscussionMessage[],
  incoming: DiscussionMessage[],
): DiscussionMessage[] {
  const messages = new Map(current.map((item) => [item.id, item]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function ProjectDiscussionsPanel({
  organizationId,
  projectId,
  projectStatus,
}: ProjectDiscussionsPanelProps) {
  const { getToken } = useAuth();
  const [discussions, setDiscussions] = useState<ProjectDiscussion[]>([]);
  const [discussionsProjectKey, setDiscussionsProjectKey] = useState("");
  const [loadedDiscussionsRequestKey, setLoadedDiscussionsRequestKey] = useState("");
  const [discussionCursor, setDiscussionCursor] = useState<string | null>(null);
  const [selectedDiscussionState, setSelectedDiscussionState] = useState<string | null>(null);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [loadedMessagesKey, setLoadedMessagesKey] = useState("");
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [liveStatus, setLiveStatus] = useState("Connecting to live updates…");
  const projectKey = `${organizationId}:${projectId}`;
  const discussionsRequestKey = `${projectKey}:${retry}`;
  const isLoadingDiscussions =
    loadedDiscussionsRequestKey !== discussionsRequestKey;
  const visibleDiscussions =
    discussionsProjectKey === projectKey ? discussions : [];
  const selectedDiscussionId = visibleDiscussions.some(
    (item) => item.id === selectedDiscussionState,
  )
    ? selectedDiscussionState
    : null;
  const isLoadingMessages =
    selectedDiscussionId !== null &&
    loadedMessagesKey !== `${projectKey}:${selectedDiscussionId}`;
  const selectedDiscussion =
    visibleDiscussions.find((item) => item.id === selectedDiscussionId) ?? null;
  const selectedDiscussionRef = useRef<string | null>(null);
  const discussionsProjectKeyRef = useRef("");
  const lastEventIdRef = useRef<string | undefined>(undefined);
  const seenNotificationIdsRef = useRef(new Set<string>());

  useEffect(() => {
    selectedDiscussionRef.current = selectedDiscussionId;
  }, [selectedDiscussionId]);

  useEffect(() => {
    let active = true;

    async function loadDiscussions() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const page = await listProjectDiscussions(
          token,
          organizationId,
          projectId,
        );
        if (!active) return;
        setDiscussions(page.items);
        setDiscussionsProjectKey(projectKey);
        discussionsProjectKeyRef.current = projectKey;
        setDiscussionCursor(page.nextCursor);
        setSelectedDiscussionState(page.items[0]?.id ?? null);
        setError(null);
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn’t load project discussions.",
          );
        }
      } finally {
        if (active) setLoadedDiscussionsRequestKey(discussionsRequestKey);
      }
    }

    void loadDiscussions();
    return () => {
      active = false;
    };
  }, [discussionsRequestKey, getToken, organizationId, projectId, projectKey]);

  useEffect(() => {
    if (!selectedDiscussionId) {
      return;
    }
    const targetDiscussionId = selectedDiscussionId;
    const targetMessagesKey = `${projectKey}:${targetDiscussionId}`;
    let active = true;

    async function loadMessages() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const page = await listDiscussionMessages(
          token,
          organizationId,
          projectId,
          targetDiscussionId,
        );
        await markProjectDiscussionRead(
          token,
          organizationId,
          projectId,
          targetDiscussionId,
        );
        if (!active) return;
        setMessages(page.items);
        setHasOlderMessages(page.hasMore);
        setMessageCursor(page.nextCursor);
        setError(null);
        setDiscussions((current) =>
          current.map((item) =>
            item.id === targetDiscussionId ? { ...item, isUnread: false } : item,
          ),
        );
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn’t load this discussion.",
          );
        }
      } finally {
        if (active) setLoadedMessagesKey(targetMessagesKey);
      }
    }

    void loadMessages();
    return () => {
      active = false;
    };
  }, [getToken, organizationId, projectId, projectKey, selectedDiscussionId]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    let retryDelay = 1000;
    lastEventIdRef.current = undefined;
    seenNotificationIdsRef.current.clear();

    async function refreshFromNotification(
      token: string,
      notification: NexusNotification,
    ) {
      if (
        notification.type !== "PROJECT_DISCUSSION_MESSAGE" ||
        notification.projectId !== projectId
      ) {
        return;
      }
      const page = await listProjectDiscussions(
        token,
        organizationId,
        projectId,
      );
      if (!active) return;
      const hadCurrentProjectData =
        discussionsProjectKeyRef.current === projectKey;
      setDiscussionsProjectKey(projectKey);
      discussionsProjectKeyRef.current = projectKey;
      setDiscussions((current) => {
        const existing = new Map(
          (hadCurrentProjectData ? current : []).map((item) => [item.id, item]),
        );
        for (const item of page.items) {
          existing.set(item.id, {
            ...item,
            isUnread:
              item.id === selectedDiscussionRef.current ? false : item.isUnread,
          });
        }
        return [...existing.values()].sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        );
      });
      const selectedId = selectedDiscussionRef.current;
      if (!selectedId) return;
      const messagesPage = await listDiscussionMessages(
        token,
        organizationId,
        projectId,
        selectedId,
      );
      if (!active) return;
      setMessages((current) => mergeMessages(current, messagesPage.items));
      setHasOlderMessages(messagesPage.hasMore);
      setMessageCursor(messagesPage.nextCursor);
      setLoadedMessagesKey(`${projectKey}:${selectedId}`);
      await markProjectDiscussionRead(
        token,
        organizationId,
        projectId,
        selectedId,
      );
      if (!active) return;
      setLoadedMessagesKey(`${projectKey}:${selectedId}`);
      setDiscussions((current) =>
        current.map((item) =>
          item.id === selectedId ? { ...item, isUnread: false } : item,
        ),
      );
    }

    async function connect() {
      while (active) {
        controller = new AbortController();
        try {
          const token = await getToken();
          if (!token) throw new Error("Your session has expired. Sign in again.");
          await consumeNotificationStream(
            token,
            controller.signal,
            (notification, eventId) => {
              lastEventIdRef.current = eventId;
              if (seenNotificationIdsRef.current.has(notification.id)) return;
              seenNotificationIdsRef.current.add(notification.id);
              if (seenNotificationIdsRef.current.size > 200) {
                const oldestId = seenNotificationIdsRef.current.values().next().value;
                if (oldestId) seenNotificationIdsRef.current.delete(oldestId);
              }
              void refreshFromNotification(token, notification).catch(() => {
                if (active) {
                  setLiveStatus("Live updates are reconnecting…");
                }
              });
            },
            () => setLiveStatus("Live updates connected"),
            lastEventIdRef.current,
          );
        } catch {
          if (active) setLiveStatus("Live updates are reconnecting…");
        }
        if (!active) return;
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 30_000);
        await new Promise<void>((resolve) => {
          const timeoutId = window.setTimeout(resolve, delay);
          controller?.signal.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timeoutId);
              resolve();
            },
            { once: true },
          );
        });
      }
    }

    void connect();
    return () => {
      active = false;
      controller?.abort();
    };
  }, [getToken, organizationId, projectId, projectKey]);

  async function loadOlderDiscussions() {
    if (!discussionCursor) return;
    setIsLoadingOlder(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const page = await listProjectDiscussions(
        token,
        organizationId,
        projectId,
        discussionCursor,
      );
      setDiscussions((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !existing.has(item.id))];
      });
      setDiscussionCursor(page.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t load older discussions.",
      );
    } finally {
      setIsLoadingOlder(false);
    }
  }

  async function loadOlderMessages() {
    if (!selectedDiscussionId || !messageCursor) return;
    setIsLoadingOlder(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const page = await listDiscussionMessages(
        token,
        organizationId,
        projectId,
        selectedDiscussionId,
        messageCursor,
      );
      setMessages((current) => mergeMessages(page.items, current));
      setHasOlderMessages(page.hasMore);
      setMessageCursor(page.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t load older messages.",
      );
    } finally {
      setIsLoadingOlder(false);
    }
  }

  function updateDiscussionPreview(message: DiscussionMessage) {
    setDiscussions((current) =>
      current.map((item) =>
        item.id === selectedDiscussionId
          ? {
              ...item,
              updatedAt: message.createdAt,
              lastMessage: {
                id: message.id,
                authorName: message.authorName,
                body: message.body,
                createdAt: message.createdAt,
                deletedAt: message.deletedAt,
              },
              isUnread: false,
            }
          : item,
      ),
    );
  }

  async function createDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPosting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const discussion = await createProjectDiscussion(
        token,
        organizationId,
        projectId,
        draftTitle,
        draftMessage,
      );
      setDiscussionsProjectKey(projectKey);
      discussionsProjectKeyRef.current = projectKey;
      setDiscussions((current) => [
        discussion,
        ...current.filter((item) => item.id !== discussion.id),
      ]);
      setDraftTitle("");
      setDraftMessage("");
      setIsCreating(false);
      setSelectedDiscussionState(discussion.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t start this discussion.",
      );
    } finally {
      setIsPosting(false);
    }
  }

  async function postMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDiscussionId || !messageDraft.trim()) return;
    setError(null);
    setIsPosting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const message = await postDiscussionMessage(
        token,
        organizationId,
        projectId,
        selectedDiscussionId,
        messageDraft,
      );
      setMessages((current) => mergeMessages(current, [message]));
      updateDiscussionPreview(message);
      setMessageDraft("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t post your message.",
      );
    } finally {
      setIsPosting(false);
    }
  }

  async function saveEdit(messageId: string) {
    if (!selectedDiscussionId || !editDraft.trim()) return;
    setError(null);
    setIsPosting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const updated = await editDiscussionMessage(
        token,
        organizationId,
        projectId,
        selectedDiscussionId,
        messageId,
        editDraft,
      );
      setMessages((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (updated.id === visibleDiscussions.find((item) => item.id === selectedDiscussionId)?.lastMessage?.id) {
        updateDiscussionPreview(updated);
      }
      setIsEditing(null);
      setEditDraft("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t edit this message.",
      );
    } finally {
      setIsPosting(false);
    }
  }

  async function removeMessage(message: DiscussionMessage) {
    if (
      !selectedDiscussionId ||
      !window.confirm("Delete this message? Its text will be removed.")
    ) {
      return;
    }
    setError(null);
    setIsPosting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const deleted = await deleteDiscussionMessage(
        token,
        organizationId,
        projectId,
        selectedDiscussionId,
        message.id,
      );
      setMessages((current) =>
        current.map((item) => (item.id === deleted.id ? deleted : item)),
      );
      if (deleted.id === visibleDiscussions.find((item) => item.id === selectedDiscussionId)?.lastMessage?.id) {
        updateDiscussionPreview(deleted);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t delete this message.",
      );
    } finally {
      setIsPosting(false);
    }
  }

  const canWrite = projectStatus === "ACTIVE";

  return (
    <section
      aria-labelledby="project-discussions-title"
      className="project-discussions-card"
    >
      <header className="project-discussions-heading">
        <div>
          <h2 id="project-discussions-title">Project discussions</h2>
          <p>Share updates and decisions with people on this project.</p>
        </div>
        <span className="project-discussions-live" aria-live="polite">
          <i aria-hidden="true" />
          {liveStatus}
        </span>
      </header>

      {error && (
        <div className="project-discussions-error" role="alert">
          <span>{error}</span>
          {!isLoadingDiscussions && visibleDiscussions.length === 0 && (
            <button onClick={() => setRetry((value) => value + 1)} type="button">
              Retry
            </button>
          )}
        </div>
      )}

      <div className="project-discussions-layout">
        <aside className="project-discussions-sidebar" aria-label="Discussion topics">
          {canWrite && (
            <button
              className="primary-button project-discussion-new"
              onClick={() => setIsCreating((current) => !current)}
              type="button"
            >
              {isCreating ? "Cancel" : "Start a discussion"}
            </button>
          )}
          {isLoadingDiscussions ? (
            <p className="project-discussion-state">Loading discussions…</p>
          ) : visibleDiscussions.length > 0 ? (
            <div className="project-discussion-list">
              {visibleDiscussions.map((discussion) => (
                <button
                  aria-current={discussion.id === selectedDiscussionId ? "true" : undefined}
                  className={`project-discussion-item${discussion.id === selectedDiscussionId ? " is-active" : ""}`}
                  key={discussion.id}
                  onClick={() => {
                    setIsCreating(false);
                    setError(null);
                    setSelectedDiscussionState(discussion.id);
                  }}
                  type="button"
                >
                  <span className="project-discussion-item-title">
                    <strong>{discussion.title}</strong>
                    {discussion.isUnread && <i aria-label="Unread" />}
                  </span>
                  <span>{discussion.lastMessage?.body || "Message deleted"}</span>
                </button>
              ))}
              {discussionCursor && (
                <button
                  className="project-discussion-load"
                  disabled={isLoadingOlder}
                  onClick={() => void loadOlderDiscussions()}
                  type="button"
                >
                  {isLoadingOlder ? "Loading…" : "Load older discussions"}
                </button>
              )}
            </div>
          ) : (
            <p className="project-discussion-state">
              No discussions yet. Start one to bring your project team together.
            </p>
          )}
        </aside>

        <div className="project-discussion-conversation">
          {isCreating ? (
            <form className="project-discussion-create-form" onSubmit={createDiscussion}>
              <h3>Start a discussion</h3>
              <label>
                Topic
                <input
                  maxLength={160}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  required
                  value={draftTitle}
                />
              </label>
              <label>
                First message
                <textarea
                  maxLength={5000}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  required
                  rows={4}
                  value={draftMessage}
                />
              </label>
              <button
                className="primary-button"
                disabled={isPosting || !draftTitle.trim() || !draftMessage.trim()}
                type="submit"
              >
                {isPosting ? "Starting…" : "Start discussion"}
              </button>
            </form>
          ) : selectedDiscussion ? (
            <>
              <div className="project-discussion-conversation-heading">
                <div>
                  <h3>{selectedDiscussion.title}</h3>
                  <span>Started by {selectedDiscussion.createdByName}</span>
                </div>
              </div>
              {hasOlderMessages && messageCursor && (
                <button
                  className="project-discussion-load"
                  disabled={isLoadingOlder}
                  onClick={() => void loadOlderMessages()}
                  type="button"
                >
                  {isLoadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              )}
              <div
                aria-live="polite"
                aria-label={`Messages in ${selectedDiscussion.title}`}
                className="project-discussion-messages"
              >
                {isLoadingMessages ? (
                  <p className="project-discussion-state">Loading messages…</p>
                ) : messages.length > 0 ? (
                  messages.map((message) => (
                    <article
                      className={`project-discussion-message${message.authorId === selectedDiscussion.createdById ? " is-starter" : ""}`}
                      key={message.id}
                    >
                      <div className="project-discussion-message-meta">
                        <strong>{message.authorName}</strong>
                        <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
                        {message.editedAt && !message.deletedAt && <span>Edited</span>}
                      </div>
                      {isEditing === message.id ? (
                        <form
                          className="project-discussion-edit-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveEdit(message.id);
                          }}
                        >
                          <textarea
                            autoFocus
                            maxLength={5000}
                            onChange={(event) => setEditDraft(event.target.value)}
                            required
                            rows={3}
                            value={editDraft}
                          />
                          <button disabled={isPosting || !editDraft.trim()} type="submit">
                            Save
                          </button>
                          <button
                            onClick={() => setIsEditing(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : message.deletedAt ? (
                        <p className="project-discussion-deleted">This message was deleted.</p>
                      ) : (
                        <>
                          <p className="project-discussion-message-body">{message.body}</p>
                          {(message.canEdit || message.canDelete) && (
                            <div className="project-discussion-message-actions">
                              {message.canEdit && (
                                <button
                                  disabled={isPosting}
                                  onClick={() => {
                                    setIsEditing(message.id);
                                    setEditDraft(message.body);
                                  }}
                                  type="button"
                                >
                                  Edit
                                </button>
                              )}
                              {message.canDelete && (
                                <button
                                  disabled={isPosting}
                                  onClick={() => void removeMessage(message)}
                                  type="button"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="project-discussion-state">No messages yet.</p>
                )}
              </div>
              {canWrite ? (
                <form className="project-discussion-reply" onSubmit={postMessage}>
                  <label className="sr-only" htmlFor="project-discussion-reply">
                    Write a message
                  </label>
                  <textarea
                    id="project-discussion-reply"
                    maxLength={5000}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    placeholder="Write a message…"
                    rows={3}
                    value={messageDraft}
                  />
                  <button
                    className="primary-button"
                    disabled={isPosting || !messageDraft.trim()}
                    type="submit"
                  >
                    {isPosting ? "Sending…" : "Send message"}
                  </button>
                </form>
              ) : (
                <p className="project-discussion-archived">
                  This project is archived. Discussions are read-only.
                </p>
              )}
            </>
          ) : (
            <div className="project-discussion-empty">
              <strong>Choose a discussion</strong>
              <p>Select a topic to read the conversation or start a new one.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
