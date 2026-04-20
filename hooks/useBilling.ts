import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchBillingCases,
  fetchBillingCase,
  createBillingCase,
  updateBillingCase,
  deleteBillingCase,
  fetchBillingDocuments,
  uploadBillingDocument,
  deleteBillingDocument,
  triggerDocumentExtraction,
  triggerFreeformExtraction,
  fetchExtractionJobs,
  fetchLedgerLines,
  fetchFindings,
  upsertFindings,
  fetchDenialRecords,
  createDenialRecord,
  updateDenialRecord,
  fetchCasePayments,
  createPayment,
  updatePayment,
  deletePayment,
  fetchActions,
  createActions,
  activateActions,
  dismissAction,
  updateActionStatus,
  fetchCallLogs,
  createCallLog,
  fetchCaseParties,
  createCallFollowUpTask,
  fetchAppealPackets,
  createAppealPacket,
  updateAppealPacket,
  deleteAppealPacket,
  generateAppealLetter,
} from '@/services/billing';
import { reconcileBillingCase } from '@/services/billingReconciliation';
import { generateActionPlan } from '@/services/billingActionPlan';
import {
  fetchBillingBriefingItems,
  fetchBillingActiveCriticalCount,
} from '@/services/billingBriefing';
import { fetchBillingTimeline } from '@/services/billingTimeline';
import type {
  CreateBillingCaseInput,
  UpdateBillingCaseInput,
  CreatePaymentInput,
  UpdatePaymentInput,
  BillingDocType,
  BillingCaseAction,
  BillingActionStatus,
  CallParty,
  BillingDenialRecord,
  BillingCase,
  BillingCaseParty,
  DenialCategory,
  AppealPacketStatus,
  AppealChecklist,
} from '@/lib/types/billing';
import { invalidateAskByDomain } from '@/services/askInvalidation';

export function useBillingCases(profileId: string | null) {
  return useQuery({
    queryKey: ['billing', 'cases', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchBillingCases(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useBillingCase(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'case', caseId],
    queryFn: async () => {
      if (!caseId) throw new Error('No case ID');
      const result = await fetchBillingCase(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useBillingDocuments(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'documents', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchBillingDocuments(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useCreateBillingCase() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateBillingCaseInput) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createBillingCase(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'billing');
    },
  });
}

export function useUpdateBillingCase() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ caseId, updates }: { caseId: string; updates: UpdateBillingCaseInput }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateBillingCase(caseId, updates, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'timeline', data.id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'briefing', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'billing');
      queryClient.invalidateQueries({ queryKey: ['billing', 'activeCriticalCount', data.profile_id] });
    },
  });
}

export function useDeleteBillingCase() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ caseId, profileId }: { caseId: string; profileId: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deleteBillingCase(caseId, user.id);
      if (!result.success) throw new Error(result.error);
      return { profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
      invalidateAskByDomain(queryClient, data.profileId, 'billing');
    },
  });
}

export function useUploadBillingDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      profileId: string;
      householdId: string;
      docType: BillingDocType;
      fileUri: string;
      fileName: string;
      mimeType: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await uploadBillingDocument({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'documents', data.billing_case_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.billing_case_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profile_id] });
    },
  });
}

export function useDeleteBillingDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ docId, caseId, profileId }: { docId: string; caseId: string; profileId: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deleteBillingDocument(docId, user.id);
      if (!result.success) throw new Error(result.error);
      return { caseId, profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'documents', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
    },
  });
}

// ── Extraction ────────────────────────────────────────────────────────────

export function useTriggerDocumentExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      documentId: string;
      caseId: string;
      profileId: string;
      householdId: string;
    }) => {
      const result = await triggerDocumentExtraction(
        params.documentId,
        params.caseId,
        params.profileId,
        params.householdId,
      );
      if (!result.success) throw new Error(result.error);
      return { ...result.data, caseId: params.caseId, profileId: params.profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'extractionJobs', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'ledgerLines', data.caseId] });
    },
  });
}

export function useTriggerFreeformExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      profileId: string;
      householdId: string;
      text: string;
    }) => {
      const result = await triggerFreeformExtraction(
        params.caseId,
        params.profileId,
        params.householdId,
        params.text,
      );
      if (!result.success) throw new Error(result.error);
      return { ...result.data, caseId: params.caseId, profileId: params.profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'extractionJobs', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'ledgerLines', data.caseId] });
    },
  });
}

export function useExtractionJobs(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'extractionJobs', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchExtractionJobs(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = data?.some((j) => j.status === 'processing') ?? false;
      return hasProcessing ? 3000 : false;
    },
  });
}

export function useLedgerLines(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'ledgerLines', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchLedgerLines(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

// ── Findings / Reconciliation ─────────────────────────────────────────────

export function useFindings(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'findings', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchFindings(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useDenialRecords(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'denialRecords', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchDenialRecords(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useCasePayments(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'payments', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchCasePayments(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

function invalidatePaymentQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  caseId: string,
  profileId: string,
) {
  queryClient.invalidateQueries({ queryKey: ['billing', 'payments', caseId] });
  queryClient.invalidateQueries({ queryKey: ['billing', 'case', caseId] });
  queryClient.invalidateQueries({ queryKey: ['billing', 'cases', profileId] });
  queryClient.invalidateQueries({ queryKey: ['billing', 'findings', caseId] });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreatePaymentInput) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createPayment(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      invalidatePaymentQueries(queryClient, data.billing_case_id, data.profile_id);
    },
  });
}

export function useUpdatePayment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { paymentId: string; updates: UpdatePaymentInput }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updatePayment(params.paymentId, params.updates, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      invalidatePaymentQueries(queryClient, data.billing_case_id, data.profile_id);
    },
  });
}

export function useDeletePayment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (paymentId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deletePayment(paymentId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      invalidatePaymentQueries(queryClient, data.caseId, data.profileId);
    },
  });
}

/**
 * Runs the deterministic reconciliation engine against the current case data
 * and persists the resulting findings. Returns { reconcile, isReconciling }.
 */
export function useRunReconciliation(caseId: string | null) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!caseId) throw new Error('No case ID');

      const [caseRes, docsRes, linesRes, paymentsRes, denialsRes] = await Promise.all([
        fetchBillingCase(caseId),
        fetchBillingDocuments(caseId),
        fetchLedgerLines(caseId),
        fetchCasePayments(caseId),
        fetchDenialRecords(caseId),
      ]);

      if (!caseRes.success) throw new Error(caseRes.error);
      if (!docsRes.success) throw new Error(docsRes.error);
      if (!linesRes.success) throw new Error(linesRes.error);
      if (!paymentsRes.success) throw new Error(paymentsRes.error);
      if (!denialsRes.success) throw new Error(denialsRes.error);

      const billingCase = caseRes.data;
      const findings = reconcileBillingCase({
        billingCase,
        documents: docsRes.data,
        ledgerLines: linesRes.data,
        payments: paymentsRes.data,
        denialRecords: denialsRes.data,
      });

      const result = await upsertFindings(
        caseId,
        billingCase.profile_id,
        billingCase.household_id,
        findings,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      if (!caseId) return;
      queryClient.invalidateQueries({ queryKey: ['billing', 'findings', caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', caseId] });
    },
  });

  return {
    reconcile: mutation.mutate,
    isReconciling: mutation.isPending,
  };
}

// ── Actions / Action Plan ─────────────────────────────────────────────────

export function useActions(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'actions', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchActions(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

/**
 * Mutation: fetch findings + existing actions, generate proposed actions,
 * and persist any new ones (dedup on action_type).
 */
export function useGenerateActionPlan(caseId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!caseId) throw new Error('No case ID');

      const [findingsRes, actionsRes, caseRes] = await Promise.all([
        fetchFindings(caseId),
        fetchActions(caseId),
        fetchBillingCase(caseId),
      ]);

      if (!findingsRes.success) throw new Error(findingsRes.error);
      if (!actionsRes.success) throw new Error(actionsRes.error);
      if (!caseRes.success) throw new Error(caseRes.error);

      const billingCase = caseRes.data;

      const proposed = generateActionPlan({
        caseId,
        profileId: billingCase.profile_id,
        householdId: billingCase.household_id,
        findings: findingsRes.data,
        existingActions: actionsRes.data,
      });

      if (proposed.length === 0) return [];

      const insertResult = await createActions(
        proposed.map((p) => ({
          caseId,
          profileId: billingCase.profile_id,
          householdId: billingCase.household_id,
          actionType: p.action_type,
          title: p.title,
          description: p.description,
        })),
      );

      if (!insertResult.success) throw new Error(insertResult.error);
      return insertResult.data;
    },
    onSuccess: () => {
      if (!caseId) return;
      queryClient.invalidateQueries({ queryKey: ['billing', 'actions', caseId] });
    },
  });
}

export function useActivateActions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      actions: BillingCaseAction[];
      caseId: string;
      profileId: string;
      householdId: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await activateActions(
        params.actions,
        params.caseId,
        params.profileId,
        params.householdId,
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return { updated: result.data, caseId: params.caseId, profileId: params.profileId };
    },
    onSuccess: ({ caseId, profileId }) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'actions', caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', profileId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', profileId] });
    },
  });
}

export function useDismissAction(caseId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (actionId: string) => {
      const result = await dismissAction(actionId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      if (!caseId) return;
      queryClient.invalidateQueries({ queryKey: ['billing', 'actions', caseId] });
    },
  });
}

export function useUpdateActionStatus(caseId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { actionId: string; status: BillingActionStatus }) => {
      const result = await updateActionStatus(params.actionId, params.status);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      if (!caseId) return;
      queryClient.invalidateQueries({ queryKey: ['billing', 'actions', caseId] });
      if (data?.profile_id) {
        queryClient.invalidateQueries({ queryKey: ['tasks', 'list', data.profile_id] });
      }
    },
  });
}

// ── Call Logs & Parties ───────────────────────────────────────────────────

export function useCallLogs(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'callLogs', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchCallLogs(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useCaseParties(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'caseParties', caseId],
    queryFn: async () => {
      if (!caseId) return null;
      const result = await fetchCaseParties(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useCreateCallLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      actionId?: string;
      profileId: string;
      householdId: string;
      party: CallParty;
      partyName?: string;
      phoneNumber?: string;
      calledAt?: string;
      durationMinutes?: number;
      repName?: string;
      referenceNumber?: string;
      outcome?: string;
      nextSteps?: string;
      followUpDue?: string;
    }) => {
      const result = await createCallLog(params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'callLogs', data.billing_case_id] });
    },
  });
}

export function useCreateCallFollowUp() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      callLogId: string;
      caseId: string;
      profileId: string;
      householdId: string;
      title: string;
      description?: string;
      dueDate?: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createCallFollowUpTask({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return { ...result.data, caseId: params.caseId, profileId: params.profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'callLogs', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', data.profileId] });
    },
  });
}

// ── Denials (mutations) ───────────────────────────────────────────────────

export function useCreateDenialRecord() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      profileId: string;
      householdId: string;
      documentId?: string | null;
      category?: DenialCategory | null;
      denialReason?: string | null;
      deadline?: string | null;
      confidence?: number | null;
      evidence?: Record<string, unknown> | null;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createDenialRecord(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'denialRecords', data.billing_case_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.billing_case_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'findings', data.billing_case_id] });
    },
  });
}

export function useUpdateDenialRecord() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      denialId: string;
      updates: Partial<
        Pick<BillingDenialRecord, 'category' | 'denial_reason' | 'deadline' | 'confidence' | 'evidence'>
      >;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateDenialRecord(params.denialId, params.updates, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'denialRecords', data.billing_case_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.billing_case_id] });
    },
  });
}

// ── Appeal Packets ────────────────────────────────────────────────────────

export function useAppealPackets(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'appealPackets', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchAppealPackets(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useCreateAppealPacket() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      profileId: string;
      householdId: string;
      denialId?: string | null;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createAppealPacket(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'appealPackets', data.billing_case_id] });
    },
  });
}

export function useUpdateAppealPacket() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      packetId: string;
      updates: {
        status?: AppealPacketStatus;
        letterDraft?: string | null;
        checklist?: AppealChecklist;
        includedDocIds?: string[];
        submittedAt?: string | null;
        outcome?: string | null;
      };
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateAppealPacket(params.packetId, params.updates, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'appealPackets', data.billing_case_id] });
    },
  });
}

export function useDeleteAppealPacket() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (packetId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deleteAppealPacket(packetId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'appealPackets', data.caseId] });
    },
  });
}

// ── Timeline ──────────────────────────────────────────────────────────────

export function useBillingTimeline(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'timeline', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchBillingTimeline(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

// ── Briefing ──────────────────────────────────────────────────────────────

export function useBillingBriefing(profileId: string | null, max: number = 3) {
  return useQuery({
    queryKey: ['billing', 'briefing', profileId, max],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchBillingBriefingItems(profileId, max);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useBillingActiveCriticalCount(profileId: string | null) {
  return useQuery({
    queryKey: ['billing', 'activeCriticalCount', profileId],
    queryFn: async () => {
      if (!profileId) return 0;
      const result = await fetchBillingActiveCriticalCount(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useGenerateAppealLetter() {
  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      profileId: string;
      denialRecord: BillingDenialRecord;
      billingCase: BillingCase;
      caseParties: BillingCaseParty | null;
    }) => {
      const result = await generateAppealLetter(params);
      if (!result.success) throw new Error(result.error);
      return result.data.letter;
    },
  });
}
