"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  consumeNotificationStream,
  deleteNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NexusNotification,
} from "@/lib/notifications";
import { Icon } from "./icons";

type NotificationCenterProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function getNotificationPath(notification: NexusNotification): string {
  const organizationId = encodeURIComponent(notification.organizationId);
  if (notification.resourceType === "TASK" && notification.projectId) {
    return `/organizations/${organizationId}/projects/${encodeURIComponent(notification.projectId)}/tasks/${encodeURIComponent(notification.resourceId)}`;
  }
  if (notification.resourceType === "PROJECT") {
    return `/organizations/${organizationId}/projects/${encodeURIComponent(notification.resourceId)}`;
  }
  if (notification.resourceType === "ORGANIZATION_INVITATION") {
    return `/invitations/accept?invitationId=${encodeURIComponent(notification.resourceId)}`;
  }
  return `/organizations/${organizationId}/members`;
}

export function NotificationCenter({
  isOpen,
  onOpenChange,
}: NotificationCenterProps) {
  const { getToken, isSignedIn } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<NexusNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const loadNotifications = useCallback(
    async (append = false) => {
      setError(null);
      setIsLoading(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const requestedPage = append ? pageRef.current + 1 : 1;
        const [result, count] = await Promise.all([
          listNotifications(token, requestedPage),
          getUnreadNotificationCount(token),
        ]);
        setItems((current) => {
          const currentById = new Map(current.map((item) => [item.id, item]));
          const pageItems = result.items.map(
            (item) => currentById.get(item.id) ?? item,
          );
          const pageIds = new Set(pageItems.map((item) => item.id));
          const streamedItems = current.filter((item) => !pageIds.has(item.id));
          const nextItems = append
            ? [
                ...current,
                ...result.items.filter(
                  (item) => !currentById.has(item.id),
                ),
              ]
            : [...pageItems, ...streamedItems];
          itemsRef.current = nextItems;
          return nextItems;
        });
        pageRef.current = requestedPage;
        setHasMore(result.hasMore);
        setUnreadCount(count);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "We couldn’t load your notifications.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [getToken],
  );

  useEffect(() => {
    let active = true;
    async function loadCount() {
      try {
        const token = await getToken();
        if (!token) return;
        const count = await getUnreadNotificationCount(token);
        if (active) setUnreadCount(count);
      } catch {
        if (active) setError("We couldn’t refresh your notification count.");
      }
    }
    void loadCount();
    const intervalId = window.setInterval(() => void loadCount(), 60_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [getToken]);

  useEffect(() => {
    if (!isSignedIn) return;
    let active = true;
    let retryDelay = 1_000;
    let controller: AbortController | undefined;
    let connectedAt: number | null = null;

    async function refreshPersistedData(token: string) {
      try {
        const [result, count] = await Promise.all([
          listNotifications(token, 1),
          getUnreadNotificationCount(token),
        ]);
        if (!active) return;
        setItems((current) => {
          const currentById = new Map(current.map((item) => [item.id, item]));
          const pageItems = result.items.map(
            (item) => currentById.get(item.id) ?? item,
          );
          const pageIds = new Set(pageItems.map((item) => item.id));
          const nextItems = [
            ...pageItems,
            ...current.filter((item) => !pageIds.has(item.id)),
          ];
          itemsRef.current = nextItems;
          return nextItems;
        });
        pageRef.current = 1;
        setHasMore(result.hasMore);
        setUnreadCount(count);
      } catch {
        if (active && isOpen) {
          setError("We couldn’t refresh your notifications.");
        }
      }
    }

    async function connect() {
      while (active) {
        controller = new AbortController();
        try {
          const token = await getToken();
          if (!token) {
            throw new Error("Your session has expired. Sign in again.");
          }
          await consumeNotificationStream(
            token,
            controller.signal,
            (notification) => {
              const isNew = !itemsRef.current.some(
                (item) => item.id === notification.id,
              );
              if (!isNew) return;
              itemsRef.current = [notification, ...itemsRef.current];
              setItems((current) =>
                current.some((item) => item.id === notification.id)
                  ? current
                  : [notification, ...current],
              );
              if (!notification.readAt) {
                setUnreadCount((count) => count + 1);
              }
            },
            () => {
              connectedAt = Date.now();
              void refreshPersistedData(token);
            },
          );
        } catch {
          // The existing API polling remains available while the stream reconnects.
        }
        if (!active) return;
        if (connectedAt !== null && Date.now() - connectedAt >= 30_000) {
          retryDelay = 1_000;
        }
        connectedAt = null;
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
  }, [getToken, isOpen, isSignedIn]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => void loadNotifications(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, loadNotifications]);

  async function markAllRead() {
    setError(null);
    setIsUpdating(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      await markAllNotificationsRead(token);
      setItems((current) =>
        current.map((item) => ({
          ...item,
          readAt: item.readAt ?? new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t mark notifications as read.",
      );
    } finally {
      setIsUpdating(false);
    }
  }

  async function openNotification(notification: NexusNotification) {
    if (!notification.readAt) {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const updated = await markNotificationRead(token, notification.id);
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setUnreadCount((count) => Math.max(0, count - 1));
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "We couldn’t mark this notification as read.",
        );
        return;
      }
    }
    onOpenChange(false);
    if (notification.type === "TEAM_UPDATED") return;
    router.push(getNotificationPath(notification));
  }

  async function removeNotification(
    event: MouseEvent<HTMLButtonElement>,
    notification: NexusNotification,
  ) {
    event.stopPropagation();
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      await deleteNotification(token, notification.id);
      setItems((current) => current.filter((item) => item.id !== notification.id));
      if (!notification.readAt) {
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t delete this notification.",
      );
    }
  }

  return (
    <div className="notification-wrap">
      <button
        aria-expanded={isOpen}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        className="icon-button"
        onClick={() => onOpenChange(!isOpen)}
        type="button"
      >
        <Icon name="bell" width={18} height={18} />
        {unreadCount > 0 && (
          <span className="notification-count-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {isOpen && (
        <section
          aria-label="Notifications"
          className="notification-popover notification-center-panel"
        >
          <div className="popover-heading">
            <div>
              <strong>Notifications</strong>
              <span className="notification-unread-label">
                {unreadCount > 0 ? `${unreadCount} unread` : "You’re all caught up"}
              </span>
            </div>
            {unreadCount > 0 && (
              <button
                className="text-button"
                disabled={isUpdating}
                onClick={() => void markAllRead()}
                type="button"
              >
                Mark all read
              </button>
            )}
          </div>
          {error && (
            <div className="notification-error" role="alert">
              <span>{error}</span>
              <button
                className="text-button"
                onClick={() => void loadNotifications()}
                type="button"
              >
                Retry
              </button>
            </div>
          )}
          <div className="notification-list" aria-live="polite">
            {isLoading && items.length === 0 ? (
              <p className="notification-state">Loading notifications…</p>
            ) : error && items.length === 0 ? (
              <p className="notification-state">
                Notifications aren’t available right now.
              </p>
            ) : items.length === 0 ? (
              <div className="notification-empty-state">
                <span className="notification-empty-icon">
                  <Icon name="bell" width={18} height={18} />
                </span>
                <strong>No notifications yet</strong>
                <p>Important updates for your projects and team will show up here.</p>
              </div>
            ) : (
              items.map((item) => (
                <article
                  className={`notification-card${item.readAt ? " is-read" : " is-unread"}`}
                  key={item.id}
                >
                  <button
                    className="notification-item-main"
                    onClick={() => void openNotification(item)}
                    type="button"
                  >
                    <span className="notification-indicator" aria-hidden="true" />
                    <span className="notification-copy">
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                      <time dateTime={item.createdAt}>
                        {relativeTime(item.createdAt)}
                      </time>
                    </span>
                  </button>
                  <button
                    aria-label={`Delete notification: ${item.title}`}
                    className="notification-delete"
                    onClick={(event) => void removeNotification(event, item)}
                    type="button"
                  >
                    <Icon name="close" width={13} height={13} />
                  </button>
                </article>
              ))
            )}
            {hasMore && (
              <button
                className="notification-load-more"
                disabled={isLoading}
                onClick={() => void loadNotifications(true)}
                type="button"
              >
                {isLoading ? "Loading…" : "Load older notifications"}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
