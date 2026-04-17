/**
 * Format an ISO timestamp as a short human-friendly relative time.
 * Under 1 minute → "Just now"
 * Under 1 hour → "{n}m ago"
 * Under 1 day → "{n}h ago"
 * Under 7 days → "{n}d ago"
 * Otherwise → "Mar 15" or "Mar 15, 2025" if different year.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) {
    // Future timestamp — fall through to date display.
  } else {
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;

    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
