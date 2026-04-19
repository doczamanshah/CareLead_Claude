import { supabase } from '@/lib/supabase';
import type { Task } from '@/lib/types/tasks';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Look up display names for all (source_type, source_ref) references used
 * across a list of tasks. Returns a flat map `{ [source_ref]: name }` that
 * bundling + context-line generation consume.
 *
 * Queries are grouped per source_type so we only hit each table once. All
 * reads are already RLS-guarded.
 */
export async function resolveTaskEntityNames(
  tasks: Task[],
): Promise<ServiceResult<Record<string, string>>> {
  const byType: Record<string, Set<string>> = {};
  for (const t of tasks) {
    if (!t.source_ref) continue;
    (byType[t.source_type] ??= new Set()).add(t.source_ref);
  }

  const names: Record<string, string> = {};

  // Appointments → title
  if (byType.appointment?.size) {
    const ids = Array.from(byType.appointment);
    const { data, error } = await supabase
      .from('apt_appointments')
      .select('id, title, provider_name')
      .in('id', ids);
    if (error) return { success: false, error: error.message };
    for (const row of data ?? []) {
      const r = row as { id: string; title: string | null; provider_name: string | null };
      names[r.id] = r.provider_name ?? r.title ?? 'Appointment';
    }
  }

  // Billing → provider_name
  if (byType.billing?.size) {
    const ids = Array.from(byType.billing);
    const { data, error } = await supabase
      .from('billing_cases')
      .select('id, provider_name, facility_name')
      .in('id', ids);
    if (error) return { success: false, error: error.message };
    for (const row of data ?? []) {
      const r = row as {
        id: string;
        provider_name: string | null;
        facility_name: string | null;
      };
      names[r.id] = r.provider_name ?? r.facility_name ?? 'Bill';
    }
  }

  // Medications → drug_name
  if (byType.medication?.size) {
    const ids = Array.from(byType.medication);
    const { data, error } = await supabase
      .from('med_medications')
      .select('id, drug_name')
      .in('id', ids);
    if (error) return { success: false, error: error.message };
    for (const row of data ?? []) {
      const r = row as { id: string; drug_name: string | null };
      names[r.id] = r.drug_name ?? 'Medication';
    }
  }

  // Preventive → rule title via preventive_items.rule
  if (byType.preventive?.size) {
    const ids = Array.from(byType.preventive);
    const { data, error } = await supabase
      .from('preventive_items')
      .select('id, rule:preventive_rules(title)')
      .in('id', ids);
    if (error) return { success: false, error: error.message };
    for (const row of data ?? []) {
      const r = row as { id: string; rule: { title: string } | { title: string }[] | null };
      const rule = Array.isArray(r.rule) ? r.rule[0] : r.rule;
      names[r.id] = rule?.title ?? 'Screening';
    }
  }

  return { success: true, data: names };
}
