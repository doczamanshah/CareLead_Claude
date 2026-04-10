export type PermissionScope =
  | 'profile.read'
  | 'profile.write'
  | 'health.read'
  | 'health.write'
  | 'docs.read'
  | 'docs.write'
  | 'tasks.read'
  | 'tasks.write'
  | 'appointments.read'
  | 'appointments.write'
  | 'medications.read'
  | 'medications.write'
  | 'export.generate'
  | 'intent.confirm';

export type PermissionTemplateId =
  | 'full_helper'
  | 'bills_insurance'
  | 'medications'
  | 'appointments_tasks'
  | 'documents_only'
  | 'view_only';

export interface PermissionTemplateDefinition {
  id: PermissionTemplateId;
  name: string;
  description: string;
  icon: string;
  scopes: PermissionScope[];
}

export const PERMISSION_TEMPLATES: PermissionTemplateDefinition[] = [
  {
    id: 'full_helper',
    name: 'Full Helper',
    description: 'Full access to manage care — profile, health records, documents, tasks, appointments, and medications.',
    icon: 'shield-checkmark',
    scopes: [
      'profile.read',
      'profile.write',
      'health.read',
      'health.write',
      'docs.read',
      'docs.write',
      'tasks.read',
      'tasks.write',
      'appointments.read',
      'appointments.write',
      'medications.read',
      'medications.write',
      'export.generate',
      'intent.confirm',
    ],
  },
  {
    id: 'bills_insurance',
    name: 'Bills & Insurance',
    description: 'Manage billing documents, insurance info, and related tasks.',
    icon: 'document-text',
    scopes: [
      'profile.read',
      'health.read',
      'docs.read',
      'docs.write',
      'tasks.read',
      'tasks.write',
    ],
  },
  {
    id: 'medications',
    name: 'Medications',
    description: 'View and manage medications, refills, and pharmacy info.',
    icon: 'medkit',
    scopes: [
      'profile.read',
      'health.read',
      'medications.read',
      'medications.write',
      'tasks.read',
    ],
  },
  {
    id: 'appointments_tasks',
    name: 'Appointments & Tasks',
    description: 'Manage appointments, visit prep, and care tasks.',
    icon: 'calendar',
    scopes: [
      'profile.read',
      'appointments.read',
      'appointments.write',
      'tasks.read',
      'tasks.write',
    ],
  },
  {
    id: 'documents_only',
    name: 'Documents Only',
    description: 'View uploaded documents and records. No editing.',
    icon: 'folder-open',
    scopes: [
      'profile.read',
      'docs.read',
    ],
  },
  {
    id: 'view_only',
    name: 'View Only',
    description: 'Read-only access to profile and health information.',
    icon: 'eye',
    scopes: [
      'profile.read',
      'health.read',
    ],
  },
];

export const PERMISSION_TEMPLATE_MAP: Record<PermissionTemplateId, PermissionTemplateDefinition> =
  Object.fromEntries(PERMISSION_TEMPLATES.map((t) => [t.id, t])) as Record<
    PermissionTemplateId,
    PermissionTemplateDefinition
  >;
