import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/dashboard/icons";

export function LoadingState({
  label = "Loading",
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="ui-loading-state" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <span className="ui-skeleton" key={index} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon = "info",
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty-state">
      <span className="ui-state-icon" aria-hidden="true">
        <Icon name={icon} width={20} height={20} />
      </span>
      <strong>{title}</strong>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="ui-error-state" role="alert">
      <span className="ui-state-icon" aria-hidden="true">
        <Icon name="info" width={20} height={20} />
      </span>
      <div>
        <strong>Something went wrong</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button className="button button-secondary button-small" onClick={onRetry} type="button">
          Try again
        </button>
      )}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}
