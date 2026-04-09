/**
 * Proactive Checks — scans profile data and existing tasks to suggest
 * new tasks that a care coordinator would recommend.
 *
 * Runs on app open with a daily cooldown.
 */

import { supabase } from '@/lib/supabase';
import type { ProactiveSuggestion } from '@/lib/types/tasks';
import type { ProfileFact } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Check medication facts for refill needs.
 * Looks at medication facts with refills_remaining or date_filled to estimate refill timing.
 */
export async function checkMedicationRefills(
  profileId: string,
): Promise<ProactiveSuggestion[]> {
  const suggestions: ProactiveSuggestion[] = [];

  const { data: medFacts } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', profileId)
    .eq('category', 'medication')
    .is('deleted_at', null);

  if (!medFacts) return suggestions;

  for (const fact of medFacts as ProfileFact[]) {
    const value = fact.value_json as Record<string, unknown>;
    const drugName = (value.drug_name as string) || (value.name as string);
    if (!drugName) continue;

    const refillsRemaining = value.refills_remaining;
    if (refillsRemaining !== undefined && Number(refillsRemaining) <= 2) {
      suggestions.push({
        id: `refill-${fact.id}`,
        title: `Request refill for ${drugName}`,
        description: `${drugName} has ${refillsRemaining} refill(s) remaining. Contact your pharmacy or doctor to ensure you don't run out.`,
        priority: Number(refillsRemaining) === 0 ? 'high' : 'medium',
        category: 'medication',
        trigger_source: 'Low refills detected',
        context_json: {
          profile_refs: [fact.id],
          instructions: [
            `Call your pharmacy to request a refill`,
            Number(refillsRemaining) === 0
              ? `No refills remaining — contact your doctor for a new prescription`
              : `${refillsRemaining} refill(s) remaining`,
          ],
          contact_info: value.pharmacy_phone
            ? { name: (value.pharmacy_name as string) || 'Pharmacy', phone: value.pharmacy_phone as string, role: 'Pharmacy' }
            : undefined,
        },
        due_days: Number(refillsRemaining) === 0 ? 1 : 7,
      });
    }
  }

  return suggestions;
}

/**
 * Check for tasks due within 48 hours that might need prep tasks.
 */
export async function checkUpcomingAppointments(
  profileId: string,
): Promise<ProactiveSuggestion[]> {
  const suggestions: ProactiveSuggestion[] = [];

  const now = new Date();
  const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: upcomingTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('profile_id', profileId)
    .in('status', ['pending', 'in_progress'])
    .is('deleted_at', null)
    .gte('due_date', now.toISOString())
    .lte('due_date', in48Hours.toISOString());

  if (!upcomingTasks || upcomingTasks.length === 0) return suggestions;

  // Check if any upcoming tasks are appointment-related without prep tasks
  for (const task of upcomingTasks) {
    if (
      task.source_type === 'appointment' ||
      task.title.toLowerCase().includes('appointment') ||
      task.title.toLowerCase().includes('visit')
    ) {
      // Check if a prep task already exists for this
      const { data: existingPrep } = await supabase
        .from('tasks')
        .select('id')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .ilike('title', '%prepare%questions%')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (!existingPrep || existingPrep.length === 0) {
        suggestions.push({
          id: `prep-${task.id}`,
          title: `Prepare questions for upcoming visit`,
          description: `You have "${task.title}" coming up soon. Write down your questions and concerns.`,
          priority: 'medium',
          category: 'appointment',
          trigger_source: 'Upcoming appointment detected',
          context_json: {
            instructions: [
              'Review any symptoms or concerns since your last visit',
              'Write down your top 3-5 questions',
              'Gather insurance card and medication list',
            ],
          },
          due_days: 0,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Find tasks overdue by more than 3 days and suggest escalation.
 */
export async function checkOverdueTasks(
  profileId: string,
): Promise<ProactiveSuggestion[]> {
  const suggestions: ProactiveSuggestion[] = [];

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const { data: overdueTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('profile_id', profileId)
    .in('status', ['pending', 'in_progress'])
    .is('deleted_at', null)
    .lt('due_date', threeDaysAgo.toISOString());

  if (!overdueTasks || overdueTasks.length === 0) return suggestions;

  if (overdueTasks.length >= 3) {
    suggestions.push({
      id: `overdue-batch-${profileId}`,
      title: `Review ${overdueTasks.length} overdue tasks`,
      description: `You have ${overdueTasks.length} tasks overdue by more than 3 days. Consider completing, rescheduling, or dismissing them.`,
      priority: 'high',
      category: 'general',
      trigger_source: 'Multiple overdue tasks',
      due_days: 0,
    });
  } else {
    for (const task of overdueTasks) {
      const daysOverdue = Math.floor(
        (Date.now() - new Date(task.due_date).getTime()) / (1000 * 60 * 60 * 24),
      );

      suggestions.push({
        id: `overdue-${task.id}`,
        title: `Overdue: ${task.title}`,
        description: `This task is ${daysOverdue} days overdue. Complete it, reschedule, or dismiss if no longer needed.`,
        priority: task.priority === 'urgent' ? 'urgent' : 'high',
        category: 'overdue',
        trigger_source: `${daysOverdue} days overdue`,
        due_days: 0,
      });
    }
  }

  return suggestions;
}

/**
 * Check for profile sections that haven't been updated in 6+ months.
 */
export async function checkStaleProfile(
  profileId: string,
): Promise<ProactiveSuggestion[]> {
  const suggestions: ProactiveSuggestion[] = [];
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const categoriesToCheck = [
    { key: 'medication', label: 'medications' },
    { key: 'insurance', label: 'insurance' },
    { key: 'allergy', label: 'allergies' },
    { key: 'care_team', label: 'care team' },
  ];

  for (const cat of categoriesToCheck) {
    const { data: facts } = await supabase
      .from('profile_facts')
      .select('updated_at')
      .eq('profile_id', profileId)
      .eq('category', cat.key)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (facts && facts.length > 0) {
      const lastUpdated = new Date(facts[0].updated_at);
      if (lastUpdated < sixMonthsAgo) {
        const monthsAgo = Math.floor(
          (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24 * 30),
        );
        suggestions.push({
          id: `stale-${cat.key}-${profileId}`,
          title: `Review your ${cat.label}`,
          description: `Your ${cat.label} haven't been updated in ${monthsAgo} months. A quick review ensures your records stay accurate.`,
          priority: 'low',
          category: cat.key,
          trigger_source: `Last updated ${monthsAgo} months ago`,
          due_days: 14,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Run all proactive checks and return combined suggestions.
 */
export async function runAllProactiveChecks(
  profileId: string,
): Promise<ServiceResult<ProactiveSuggestion[]>> {
  try {
    const [refills, upcoming, overdue, stale] = await Promise.all([
      checkMedicationRefills(profileId),
      checkUpcomingAppointments(profileId),
      checkOverdueTasks(profileId),
      checkStaleProfile(profileId),
    ]);

    const allSuggestions = [...overdue, ...refills, ...upcoming, ...stale];

    return { success: true, data: allSuggestions };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Proactive checks failed',
    };
  }
}
