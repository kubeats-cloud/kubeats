import type { ReactNode } from "react";
import { Loader2Icon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The three states every screen needs. Sharing them keeps a slow list, an empty
 * list and a failed list looking like the same app, and means no screen has to
 * reinvent what "nothing here yet" looks like.
 */

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "text-muted-foreground flex flex-col items-center justify-center gap-3 px-5 py-16",
        className,
      )}
    >
      <Loader2Icon className="size-5 animate-spin" aria-hidden />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-card flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <Icon className="text-muted-foreground mb-1 size-6" aria-hidden />
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "That did not work",
  message,
  onRetry,
  retryLabel = "Try again",
  className,
}: {
  title?: string;
  /** Always pass something from toFriendlyMessage(), never a raw error. */
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "border-danger-subtle bg-danger-subtle text-danger-subtle-foreground flex flex-col items-center justify-center gap-2 rounded-lg border px-6 py-10 text-center",
        className,
      )}
    >
      <TriangleAlertIcon className="mb-1 size-6" aria-hidden />
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-prose text-sm">{message}</p>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className="mt-3 h-11 bg-transparent"
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
