import { useQuery } from '@tanstack/react-query';
import {
  fetchPreAppointmentBriefingItems,
  runPreAppointmentCheck,
} from '@/services/preAppointmentCheck';

/**
 * Run the pre-appointment profile accuracy check for a specific appointment.
 * Re-runs whenever the appointment's provider or date changes.
 */
export function usePreAppointmentCheck(
  profileId: string | null,
  householdId: string | null,
  appointmentId: string | null,
  appointmentDate: string | null,
  appointmentProvider: string | null,
) {
  return useQuery({
    queryKey: [
      'preAppointmentCheck',
      profileId,
      appointmentId,
      appointmentDate,
      appointmentProvider,
    ],
    queryFn: async () => {
      if (!profileId || !householdId || !appointmentDate) {
        throw new Error('Missing check params');
      }
      const result = await runPreAppointmentCheck({
        profileId,
        householdId,
        appointmentDate,
        appointmentProvider: appointmentProvider ?? undefined,
      });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId && !!householdId && !!appointmentId && !!appointmentDate,
  });
}

/**
 * Fetch pre-appointment briefing items for the Home screen — any upcoming
 * appointment (1-3 days out or today) whose profile readiness isn't green.
 */
export function usePreAppointmentBriefing(
  profileId: string | null,
  householdId: string | null,
  max: number = 2,
) {
  return useQuery({
    queryKey: ['preAppointmentBriefing', profileId, householdId, max],
    queryFn: async () => {
      if (!profileId || !householdId) return [];
      const result = await fetchPreAppointmentBriefingItems(
        profileId,
        householdId,
        max,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId && !!householdId,
  });
}
