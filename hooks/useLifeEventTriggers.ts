/**
 * Dispatch hook for life-event triggers.
 *
 * Shared entry point used by every mutation that represents a "life event"
 * (new medication, new insurance, appointment created, etc.). Fetches the
 * profile's current facts, runs trigger detection, and queues any resulting
 * prompts into the shared store.
 *
 * Fire-and-forget: failures to fetch facts or dispatch prompts never block
 * the underlying mutation. The prompt system is an enhancement, not a
 * requirement.
 */

import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLifeEventStore } from '@/stores/lifeEventStore';
import {
  detectLifeEventTriggers,
  type DetectTriggersParams,
} from '@/services/lifeEventTriggers';
import type { LifeEventType } from '@/lib/types/lifeEvents';
import type { ProfileFact } from '@/lib/types/profile';

export function useDispatchLifeEventTriggers() {
  const addPrompts = useLifeEventStore((s) => s.addPrompts);

  return useCallback(
    async <T extends LifeEventType>(
      eventType: T,
      eventData: DetectTriggersParams<T>['eventData'],
      profileId: string,
      householdId: string,
    ): Promise<void> => {
      try {
        const { data } = await supabase
          .from('profile_facts')
          .select('*')
          .eq('profile_id', profileId)
          .is('deleted_at', null);
        const facts = (data ?? []) as ProfileFact[];

        const prompts = detectLifeEventTriggers({
          eventType,
          eventData,
          profileId,
          householdId,
          existingProfileFacts: facts,
        } as DetectTriggersParams<T>);

        if (prompts.length > 0) {
          addPrompts(prompts);
        }
      } catch {
        // Silent failure — prompts are supplemental; never block the caller.
      }
    },
    [addPrompts],
  );
}
