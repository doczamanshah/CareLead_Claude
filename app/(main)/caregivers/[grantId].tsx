import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Modal, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useAccessGrants,
  useGrantConsentHistory,
  useRevokeAccess,
  useUpdatePermissions,
} from '@/hooks/useCaregivers';
import { PERMISSION_TEMPLATES, PERMISSION_TEMPLATE_MAP } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId } from '@/lib/constants/permissionTemplates';
import type { AccessGrantWithName, ConsentRecord } from '@/lib/types/caregivers';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function CaregiverDetailScreen() {
  const { grantId } = useLocalSearchParams<{ grantId: string }>();
  const router = useRouter();

  // We need to find the grant — fetch grants for the profile that owns it
  // Since we don't know profile_id from the route, we query consent history which is by grant
  const { data: consentHistory, isLoading: historyLoading } = useGrantConsentHistory(grantId ?? null);

  // Get the profile_id from consent history to then fetch the grant
  const profileId = consentHistory?.[0]?.profile_id ?? null;
  const { data: allGrants, isLoading: grantsLoading } = useAccessGrants(profileId);

  const grant = allGrants?.find((g) => g.id === grantId) ?? null;

  const revokeAccessMutation = useRevokeAccess();
  const updatePermissionsMutation = useUpdatePermissions();

  const [showPermissionPicker, setShowPermissionPicker] = useState(false);

  const isLoading = historyLoading || grantsLoading;

  if (isLoading) return <ScreenLayout loading />;
  if (!grant) return <ScreenLayout error={new Error('Access grant not found')} />;

  const tmpl = PERMISSION_TEMPLATE_MAP[grant.permission_template as PermissionTemplateId];

  function handleRevokeAccess() {
    Alert.alert(
      'Revoke Access',
      `Are you sure you want to revoke ${grant!.grantee_display_name ?? 'this caregiver'}'s access? This takes effect immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            revokeAccessMutation.mutate(grant!.id, {
              onSuccess: () => router.back(),
              onError: (err) => Alert.alert('Error', err.message),
            });
          },
        },
      ],
    );
  }

  function handleChangePermissions(newTemplate: PermissionTemplateId) {
    setShowPermissionPicker(false);
    updatePermissionsMutation.mutate(
      { grantId: grant!.id, newTemplate },
      {
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  }

  return (
    <ScreenLayout>
      {/* Caregiver Info */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(grant.grantee_display_name ?? '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>
            {grant.grantee_display_name ?? 'Unknown'}
          </Text>
          {grant.grantee_email && (
            <Text style={styles.headerEmail}>{grant.grantee_email}</Text>
          )}
          <Text style={styles.headerDate}>
            Access granted {new Date(grant.granted_at).toLocaleDateString()}
          </Text>
        </View>
      </View>

      {/* Current Permissions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Permissions</Text>
        <Card>
          <View style={styles.permissionRow}>
            <View>
              <Text style={styles.permissionName}>{tmpl?.name ?? grant.permission_template}</Text>
              <Text style={styles.permissionDesc}>{tmpl?.description ?? ''}</Text>
            </View>
          </View>
          <View style={styles.scopeGrid}>
            {(grant.scopes ?? []).map((scope) => (
              <View key={scope} style={styles.scopeTag}>
                <Text style={styles.scopeTagText}>{formatScope(scope)}</Text>
              </View>
            ))}
          </View>
        </Card>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Button
          title="Change Permissions"
          variant="outline"
          onPress={() => setShowPermissionPicker(true)}
          loading={updatePermissionsMutation.isPending}
        />
        <Button
          title="Revoke Access"
          variant="outline"
          onPress={handleRevokeAccess}
          loading={revokeAccessMutation.isPending}
        />
      </View>

      {/* Consent History Timeline */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Access History</Text>
        {(consentHistory ?? []).length > 0 ? (
          (consentHistory ?? []).map((record) => (
            <ConsentTimelineItem key={record.id} record={record} />
          ))
        ) : (
          <Text style={styles.emptyHistory}>No history recorded yet.</Text>
        )}
      </View>

      {/* Permission Picker Modal */}
      <Modal
        visible={showPermissionPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPermissionPicker(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Change Permissions</Text>
            <Button
              title="Cancel"
              variant="ghost"
              size="sm"
              onPress={() => setShowPermissionPicker(false)}
            />
          </View>
          {PERMISSION_TEMPLATES.map((template) => {
            const isCurrent = template.id === grant.permission_template;
            return (
              <TouchableOpacity
                key={template.id}
                style={[styles.templateOption, isCurrent && styles.templateOptionCurrent]}
                onPress={() => {
                  if (!isCurrent) handleChangePermissions(template.id);
                }}
              >
                <Text style={styles.templateOptionName}>
                  {template.name}
                  {isCurrent ? ' (current)' : ''}
                </Text>
                <Text style={styles.templateOptionDesc}>{template.description}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </ScreenLayout>
  );
}

function ConsentTimelineItem({ record }: { record: ConsentRecord }) {
  const tmpl = PERMISSION_TEMPLATE_MAP[record.permission_template as PermissionTemplateId];

  let label = '';
  let dotColor: string = COLORS.text.tertiary;

  switch (record.consent_type) {
    case 'access_granted':
      label = `Access granted — ${tmpl?.name ?? record.permission_template}`;
      dotColor = COLORS.success.DEFAULT;
      break;
    case 'access_modified':
      label = `Permissions changed to ${tmpl?.name ?? record.permission_template}`;
      dotColor = COLORS.accent.DEFAULT;
      break;
    case 'access_revoked':
      label = 'Access revoked';
      dotColor = COLORS.error.DEFAULT;
      break;
  }

  return (
    <View style={styles.timelineItem}>
      <View style={[styles.timelineDot, { backgroundColor: dotColor }]} />
      <View style={styles.timelineContent}>
        <Text style={styles.timelineLabel}>{label}</Text>
        <Text style={styles.timelineDate}>
          {new Date(record.created_at).toLocaleDateString()}{' '}
          {new Date(record.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
        {record.notes && <Text style={styles.timelineNotes}>{record.notes}</Text>}
      </View>
    </View>
  );
}

function formatScope(scope: string): string {
  return scope
    .replace('.', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 16,
  },
  headerName: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  headerEmail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  headerDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  permissionRow: {
    marginBottom: 12,
  },
  permissionName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 4,
  },
  permissionDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  scopeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  scopeTag: {
    backgroundColor: COLORS.primary.light,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  scopeTagText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  actions: {
    gap: 10,
    marginBottom: 24,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    marginRight: 12,
  },
  timelineContent: {
    flex: 1,
  },
  timelineLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  timelineDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  timelineNotes: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  emptyHistory: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    paddingVertical: 16,
  },
  modal: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  templateOption: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 8,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  templateOptionCurrent: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.light,
  },
  templateOptionName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  templateOptionDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
});
