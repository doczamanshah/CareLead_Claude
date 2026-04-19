/**
 * Shareable Preventive Care Summary Report.
 *
 * Produces a plain-text report the patient can copy or share — useful for
 * annual wellness visits, second-opinion consults, and VBC/HEDIS reporting.
 * PHI stays in the report body; the caller is responsible for where it's
 * sent.
 */

import { PREVENTIVE_CATEGORY_LABELS } from '@/lib/types/preventive';
import type {
  PreventiveItemWithRule,
  PreventiveMetrics,
  PreventiveReport,
  ScreeningMethod,
} from '@/lib/types/preventive';

interface ReportParams {
  profileId: string;
  profileName: string;
  items: PreventiveItemWithRule[];
  metrics: PreventiveMetrics;
}

export function generatePreventiveCareReport(
  params: ReportParams,
): PreventiveReport {
  const { profileName, items, metrics } = params;

  const generatedAt = new Date();
  const generatedOn = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const upToDate: PreventiveItemWithRule[] = [];
  const gaps: PreventiveItemWithRule[] = [];
  const upcoming: PreventiveItemWithRule[] = [];
  for (const item of items) {
    if (item.status === 'up_to_date' || item.status === 'completed') {
      upToDate.push(item);
    } else if (item.status === 'due' || item.status === 'needs_review') {
      gaps.push(item);
    } else if (item.status === 'due_soon' || item.status === 'scheduled') {
      upcoming.push(item);
    }
  }

  const lines: string[] = [];

  lines.push('---');
  lines.push('PREVENTIVE CARE SUMMARY');
  lines.push(`Prepared by CareLead for ${profileName}`);
  lines.push(`Generated on ${generatedOn}`);
  lines.push('---');
  lines.push('');
  lines.push(
    `OVERALL STATUS: ${metrics.upToDate} of ${metrics.totalMeasures} recommended screenings are current (${metrics.complianceRate}%)`,
  );
  lines.push('');

  if (upToDate.length > 0) {
    lines.push('UP TO DATE:');
    for (const item of sortByCategoryThenTitle(upToDate)) {
      const last = formatDate(item.last_done_date);
      const next = formatDate(item.next_due_date);
      const method = selectedMethodName(item);
      const label = method ? `${item.rule.title} (${method})` : item.rule.title;
      const parts: string[] = [];
      if (last) parts.push(`completed ${last}`);
      if (next) parts.push(`next due ${next}`);
      const meta = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
      lines.push(`✓ ${label}${meta}`);
    }
    lines.push('');
  }

  if (gaps.length > 0) {
    lines.push('GAPS (Action Needed):');
    for (const item of sortByCategoryThenTitle(gaps)) {
      const last = formatDate(item.last_done_date);
      const tail =
        last
          ? ` — last done ${last}`
          : item.status === 'needs_review'
          ? ' — needs info'
          : ' — never recorded';
      const statusLabel = item.status === 'due' ? 'due now' : 'needs review';
      lines.push(`○ ${item.rule.title} — ${statusLabel}${tail}`);
    }
    lines.push('');
  }

  if (upcoming.length > 0) {
    lines.push('UPCOMING:');
    for (const item of sortByCategoryThenTitle(upcoming)) {
      const next = formatDate(item.next_due_date) ?? formatDate(item.due_date);
      const when = next
        ? ` — due ${next}`
        : item.status === 'scheduled'
        ? ' — scheduled'
        : ' — coming up';
      lines.push(`→ ${item.rule.title}${when}`);
    }
    lines.push('');
  }

  const hedisKeys = Object.keys(metrics.hedisCompliance).sort();
  if (hedisKeys.length > 0) {
    lines.push('HEDIS MEASURE COMPLIANCE:');
    for (const code of hedisKeys) {
      const status = metrics.hedisCompliance[code] ? 'Compliant' : 'Gap';
      const title = HEDIS_CODE_LABELS[code] ?? code;
      lines.push(`${code} (${title}): ${status}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('This report is generated from patient-managed records.');
  lines.push('Discuss with your healthcare provider for clinical guidance.');
  lines.push('---');

  return {
    title: `Preventive Care Summary — ${profileName}`,
    generatedAt: generatedAt.toISOString(),
    text: lines.join('\n'),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function selectedMethodName(item: PreventiveItemWithRule): string | null {
  const methods = item.rule.screening_methods as ScreeningMethod[] | null;
  if (!methods || !item.selected_method) return null;
  return methods.find((m) => m.method_id === item.selected_method)?.name ?? null;
}

function sortByCategoryThenTitle(
  list: PreventiveItemWithRule[],
): PreventiveItemWithRule[] {
  return [...list].sort((a, b) => {
    const ca = PREVENTIVE_CATEGORY_LABELS[a.rule.category] ?? a.rule.category;
    const cb = PREVENTIVE_CATEGORY_LABELS[b.rule.category] ?? b.rule.category;
    if (ca !== cb) return ca.localeCompare(cb);
    return a.rule.title.localeCompare(b.rule.title);
  });
}

// Human-readable labels for HEDIS codes in the report. Internal-only — the
// patient doesn't need to know what HBD means, but the provider does.
const HEDIS_CODE_LABELS: Record<string, string> = {
  COL: 'Colorectal Cancer Screening',
  BCS: 'Breast Cancer Screening',
  CCS: 'Cervical Cancer Screening',
  FLU: 'Flu Vaccine',
  CBP: 'Blood Pressure',
  OMW: 'Osteoporosis Management',
  HBD: 'A1c Testing',
  EED: 'Diabetic Eye Exam',
  KED: 'Kidney Health',
  SPC: 'Statin Therapy',
  PHQ9: 'Depression Screening',
  LCS: 'Lung Cancer Screening',
  AWV: 'Annual Wellness Visit',
};
