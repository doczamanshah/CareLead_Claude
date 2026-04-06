# CLAUDE.md — CareLead Architectural Constitution

> **Read this file completely before making any changes to the codebase.**
> This document is the single source of truth for architecture, conventions, and patterns.
> Every file you create, every function you write, every component you build must follow these rules.

---

## Project Overview

**CareLead** — "Your care. In your hands."

CareLead is a patient-owned, AI-first care operations platform that helps patients and caregivers manage healthcare administration. It turns fragmented health information (bills, lab results, discharge papers, medication bottles, appointment notes) into structured, actionable, trackable workflows.

**What CareLead IS:** A healthcare admin companion that captures, organizes, and drives follow-through.
**What CareLead is NOT:** A diagnostic tool, medical advice system, or clinical decision support.

### Core Philosophy
- **Patient-owned interoperability** — data flows with the patient because they control it
- **AI-first, not AI-autonomous** — AI drafts, the user confirms. Nothing is silently committed.
- **Execution over storage** — every piece of information should become an actionable step
- **Trust through transparency** — provenance, confidence labels, and audit trails are product features

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Client | Expo SDK 52+ with React Native + TypeScript | Mobile app (iOS-first, Android soon after) |
| Navigation | Expo Router v4 (file-based routing) | Screen navigation |
| Server State | TanStack Query (React Query) v5 | Data fetching, caching, sync |
| Client State | Zustand | Local app state (active profile, UI state) |
| Backend | Supabase | Auth, Postgres DB, Storage, Edge Functions |
| ORM/Query | Supabase JS Client v2 | Type-safe database queries |
| AI | Anthropic Claude API (via Edge Functions) | Extraction, summarization, smart features |
| Forms | React Hook Form + Zod | Form handling and validation |
| Styling | NativeWind (Tailwind for React Native) | Consistent styling |

### Key Rules
- **Never call AI APIs directly from the mobile app.** Always go through Supabase Edge Functions.
- **Never store API keys, secrets, or credentials in code.** Use environment variables only.
- **TypeScript strict mode is always on.** No `any` types. No `@ts-ignore` unless absolutely necessary with a comment explaining why.

---

## Folder Structure

```
carelead/
├── CLAUDE.md                         # THIS FILE — read first, always
├── app.json                          # Expo configuration
├── package.json
├── tsconfig.json
├── .env.local                        # Local environment variables (NEVER commit)
├── .gitignore
│
├── app/                              # ALL SCREENS (Expo Router file-based routing)
│   ├── _layout.tsx                   # Root layout (providers, auth gate)
│   ├── index.tsx                     # Entry redirect
│   ├── (auth)/                       # Auth screens (sign-in, sign-up, forgot-password)
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   ├── sign-up.tsx
│   │   └── forgot-password.tsx
│   ├── (main)/                       # Authenticated app shell
│   │   ├── _layout.tsx               # Tab navigator layout
│   │   ├── (tabs)/                   # Bottom tab screens
│   │   │   ├── _layout.tsx           # Tab bar configuration
│   │   │   ├── index.tsx             # Home / Today
│   │   │   ├── tasks.tsx             # Tasks & Reminders
│   │   │   ├── documents.tsx         # Documents & Exports
│   │   │   ├── household.tsx         # Household & Profiles
│   │   │   └── settings.tsx          # Settings
│   │   ├── profile/                  # Profile module screens
│   │   │   ├── [profileId]/
│   │   │   │   ├── index.tsx         # Profile snapshot/overview
│   │   │   │   ├── edit.tsx          # Edit profile sections
│   │   │   │   ├── medications.tsx   # Medications list for this profile
│   │   │   │   ├── conditions.tsx    # Conditions list
│   │   │   │   ├── allergies.tsx     # Allergies list
│   │   │   │   ├── insurance.tsx     # Insurance details
│   │   │   │   ├── care-team.tsx     # Care team & pharmacy
│   │   │   │   └── history.tsx       # Surgical/family history
│   │   ├── appointments/             # Appointment module screens
│   │   │   ├── index.tsx             # Appointments list
│   │   │   ├── [appointmentId]/
│   │   │   │   ├── index.tsx         # Appointment detail
│   │   │   │   ├── prep.tsx          # Pre-visit preparation
│   │   │   │   └── closeout.tsx      # Post-visit closeout
│   │   │   └── create.tsx            # New appointment
│   │   ├── medications/              # Medications module screens
│   │   │   ├── index.tsx             # Full medications management
│   │   │   ├── [medicationId].tsx    # Medication detail
│   │   │   └── reconcile.tsx         # Medication reconciliation
│   │   ├── capture/                  # Data capture screens
│   │   │   ├── camera.tsx            # Photo/scan capture
│   │   │   ├── voice.tsx             # Voice recording
│   │   │   └── upload.tsx            # Document upload
│   │   ├── intent-sheet/             # Intent Sheet review screens
│   │   │   └── [intentSheetId].tsx   # Review and confirm extracted data
│   │   └── caregivers/              # Caregiver management
│   │       ├── index.tsx             # Manage caregivers
│   │       └── invite.tsx            # Invite a caregiver
│
├── components/                       # REUSABLE UI COMPONENTS
│   ├── ui/                           # Generic, module-agnostic components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── LoadingSpinner.tsx
│   │   ├── EmptyState.tsx
│   │   ├── ConfidenceIndicator.tsx   # Shows AI confidence level
│   │   ├── ProvenanceBadge.tsx       # Shows data source/verification state
│   │   └── ScreenLayout.tsx          # Consistent screen wrapper
│   └── modules/                      # Module-specific compound components
│       ├── IntentSheet.tsx           # The review-and-confirm component
│       ├── IntentItem.tsx            # Single item in an Intent Sheet
│       ├── ProfileCard.tsx           # Profile summary card
│       ├── ProfileSnapshot.tsx       # Full profile snapshot view
│       ├── TaskCard.tsx              # Task display card
│       ├── MedicationCard.tsx        # Medication display card
│       ├── AppointmentCard.tsx       # Appointment display card
│       ├── DocumentCard.tsx          # Document/artifact display card
│       ├── AuditTimeline.tsx         # Timeline of changes/actions
│       └── CaptureButton.tsx         # Global floating action for capture
│
├── hooks/                            # CUSTOM REACT HOOKS
│   ├── useActiveProfile.ts           # Get/set the currently active profile
│   ├── useAuth.ts                    # Authentication state and actions
│   ├── useProfile.ts                 # Fetch profile data
│   ├── useTasks.ts                   # Fetch and manage tasks
│   ├── useAppointments.ts            # Fetch and manage appointments
│   ├── useMedications.ts             # Fetch and manage medications
│   ├── useIntentSheet.ts             # Intent sheet operations
│   ├── useArtifacts.ts               # Document/artifact operations
│   └── useAudit.ts                   # Audit trail queries
│
├── services/                         # API/DATABASE CALLS (organized by module)
│   ├── auth.ts                       # Authentication service
│   ├── profiles.ts                   # Profile CRUD operations
│   ├── artifacts.ts                  # Document/artifact operations
│   ├── extraction.ts                 # AI extraction pipeline calls
│   ├── intent-sheets.ts              # Intent sheet CRUD and commit
│   ├── tasks.ts                      # Tasks and reminders
│   ├── appointments.ts               # Appointments CRUD
│   ├── medications.ts                # Medications CRUD
│   ├── caregivers.ts                 # Caregiver/permission management
│   └── audit.ts                      # Audit trail logging
│
├── stores/                           # ZUSTAND STORES (client-side state only)
│   ├── authStore.ts                  # Session, user object
│   ├── profileStore.ts               # Active profile ID, profile switching
│   └── uiStore.ts                    # UI state (modals, toasts, loading)
│
├── lib/                              # CORE UTILITIES AND CONFIGURATION
│   ├── supabase.ts                   # Supabase client initialization
│   ├── types/                        # TypeScript type definitions
│   │   ├── database.ts               # Auto-generated Supabase types
│   │   ├── profile.ts                # Profile-related types
│   │   ├── artifacts.ts              # Artifact/document types
│   │   ├── intent-sheet.ts           # Intent sheet types
│   │   ├── tasks.ts                  # Task types
│   │   ├── appointments.ts           # Appointment types
│   │   ├── medications.ts            # Medication types
│   │   └── caregivers.ts             # Caregiver/permission types
│   ├── utils/
│   │   ├── formatting.ts             # Date, currency, text formatting
│   │   ├── validation.ts             # Zod schemas for form validation
│   │   └── helpers.ts                # General utility functions
│   └── constants/
│       ├── colors.ts                 # Design system colors
│       ├── typography.ts             # Font sizes, weights
│       ├── taxonomy.ts               # Field taxonomy keys (conditions, meds, allergies, etc.)
│       └── config.ts                 # App configuration values
│
├── assets/                           # Static assets
│   ├── images/
│   └── fonts/
│
└── supabase/                         # SUPABASE BACKEND
    ├── config.toml                   # Supabase local dev config
    ├── migrations/                   # Database schema migrations (ordered)
    │   ├── 00001_foundation.sql      # Users, households, profiles
    │   ├── 00002_artifacts.sql       # Documents, notes, processing jobs
    │   ├── 00003_extraction.sql      # Extracted fields, intent sheets
    │   ├── 00004_profile_facts.sql   # Verified profile data tables
    │   ├── 00005_tasks.sql           # Tasks and reminders
    │   ├── 00006_appointments.sql    # Appointments module
    │   ├── 00007_medications.sql     # Medications module
    │   ├── 00008_caregivers.sql      # Permissions and consent
    │   └── 00009_audit.sql           # Audit trail
    └── functions/                    # Edge Functions (server-side code)
        ├── extract-document/         # AI document extraction
        ├── process-voice/            # Voice transcription + extraction
        └── generate-intent-sheet/    # Intent sheet generation
```

### Folder Rules
- **Screens go in `app/` only.** Never put screen components elsewhere.
- **Reusable components go in `components/`.** If it's used on more than one screen, extract it.
- **Data fetching logic goes in `services/`.** Components never call Supabase directly.
- **Hooks wrap services for React components.** Hooks call services; components call hooks.
- **Types go in `lib/types/`.** Never define types inline unless they're component-only props.
- **No cross-module imports in services.** `services/medications.ts` must not import from `services/appointments.ts`. Shared logic goes in a shared service.

---

## The Canonical Data Flow

**This is the most important pattern in the entire codebase.** Every module follows this flow:

```
CAPTURE → ARTIFACT → PROCESS → INTENT SHEET → COMMIT → ACTION
```

### Step by step:

1. **CAPTURE**: User provides input (photo, voice, text, document upload)
2. **ARTIFACT**: Input is stored as a canonical artifact (Document or Note) in Supabase Storage + `artifacts` table
3. **PROCESS**: Edge Function runs AI extraction → produces structured suggestions with confidence scores and evidence
4. **INTENT SHEET**: Suggestions are stored as `intent_items` in an `intent_sheet`, presented to user for review
5. **COMMIT**: User reviews each item (accept / edit+accept / reject). Accepted items are committed atomically:
   - Profile facts are created/updated in verified tables
   - Tasks and reminders are created
   - Audit events are logged
6. **ACTION**: Committed items appear in Home, Tasks, Profile, and relevant module screens

### Rules for this flow:
- **Nothing becomes verified data without user confirmation.** No exceptions.
- **AI outputs are always "suggestions" until committed.** They live in `extracted_fields` and `intent_items`, never in profile fact tables.
- **Commits are atomic.** If 5 items are accepted, all 5 are written in a single transaction. If one fails, none persist.
- **Every commit creates audit events.** No silent writes.

---

## Five Shared Primitives

These are built ONCE and reused by every module:

### 1. Artifact Pipeline
- Accepts: photos, scans, PDFs, voice recordings, typed text
- Stores: file in Supabase Storage, metadata in `artifacts` table
- Processes: OCR → classification → extraction (via Edge Functions)
- Status tracking: `pending` → `processing` → `completed` → `failed`

### 2. Intent Sheet
- Generated after extraction completes
- Contains `intent_items`, each with:
  - `field_key` (taxonomy key like `medication.name`, `allergy.substance`)
  - `proposed_value` (what AI found)
  - `confidence` (0.0 to 1.0)
  - `evidence` (reference to source location in artifact)
  - `status`: `pending` → `accepted` | `edited` | `rejected`
- UI component: `<IntentSheet>` renders all items with accept/edit/reject controls

### 3. Commit Engine
- Takes accepted intent items and writes them to verified tables
- All writes happen in a single database transaction
- Creates corresponding tasks/reminders if the intent item implies action
- Logs audit events for every committed change
- Returns a commit receipt with summary of what was written

### 4. Task System
- Tasks are the operational output of CareLead
- Fields: `title`, `description`, `due_date`, `priority`, `status`, `profile_id`, `source_type`, `source_ref`
- Statuses: `pending` → `in_progress` → `completed` | `dismissed`
- Tasks can be auto-generated (from Intent Sheet commit) or manually created
- Reminders are scheduled via push notifications
- Every task links back to its source (which document/appointment/medication created it)

### 5. Audit Trail
- Append-only `audit_events` table
- Every significant action creates an audit event:
  - `event_type` (e.g., `profile_fact.created`, `intent_item.accepted`, `task.completed`)
  - `actor_id` (user who performed the action)
  - `profile_id` (which profile was affected)
  - `metadata` (JSON with non-PHI context — IDs, counts, status changes)
  - `created_at` (timestamp)
- **No PHI in audit metadata.** Only IDs, counts, and status values.
- Audit events are never deleted or modified.

---

## Database Conventions

### Table Naming
- Use `snake_case` for all table and column names
- Module-prefixed tables: `med_medications`, `apt_appointments`, `bill_cases`
- Shared tables have no prefix: `profiles`, `artifacts`, `tasks`, `audit_events`

### Required Columns (every table)
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Profile Scoping
- Every patient-data table MUST have a `profile_id UUID REFERENCES profiles(id)` column
- This is the foundation of data isolation — one profile's data never leaks to another
- Row Level Security (RLS) policies enforce this at the database level

### Row Level Security (RLS)
- **RLS is enabled on every table that contains patient data.**
- Policies check that the requesting user has access to the `profile_id` on each row
- Access is determined through the `household_members` and `caregiver_access` tables
- Service role (Edge Functions) bypasses RLS only for system operations (extraction, processing)

### Soft Deletes
- Use `deleted_at TIMESTAMPTZ` column instead of hard deletes for patient data
- Filter with `WHERE deleted_at IS NULL` in all queries
- Hard deletes only via explicit user data deletion request

---

## Component Patterns

### Screen Components (in `app/`)
Every screen follows this structure:
```tsx
import { ScreenLayout } from '@/components/ui/ScreenLayout';

export default function MedicationsScreen() {
  const { activeProfileId } = useActiveProfile();
  const { data, isLoading, error } = useMedications(activeProfileId);

  if (isLoading) return <ScreenLayout loading />;
  if (error) return <ScreenLayout error={error} />;

  return (
    <ScreenLayout title="Medications">
      {/* Screen content */}
    </ScreenLayout>
  );
}
```

### Rules:
- Screens use `ScreenLayout` wrapper for consistent headers, padding, and scroll behavior
- Screens call hooks for data — never call services directly
- Screens handle three states: loading, error, and content
- Screens never contain business logic — they orchestrate components

### Reusable Components (in `components/`)
```tsx
interface MedicationCardProps {
  medication: Medication;
  onPress?: () => void;
}

export function MedicationCard({ medication, onPress }: MedicationCardProps) {
  // Component logic and rendering
}
```

### Rules:
- Every component has a typed Props interface
- Components are functional (no class components)
- Components receive data via props — they don't fetch their own data
- Components use NativeWind (Tailwind) classes for styling

---

## State Management Rules

### Server State (TanStack Query)
- **All data from Supabase goes through TanStack Query.**
- Query keys follow the pattern: `[module, action, ...params]`
  - Example: `['medications', 'list', profileId]`
  - Example: `['profile', 'detail', profileId]`
- Mutations use `useMutation` with `onSuccess` invalidation
- Optimistic updates are allowed for simple status changes (task completion)

### Client State (Zustand)
- **Only for UI state that doesn't come from the server:**
  - Active profile ID
  - Authentication session
  - Modal/toast visibility
  - Form draft state
- Zustand stores are small and focused — one store per concern
- Never duplicate server data in Zustand

### Rules:
- If the data comes from the database → TanStack Query
- If the data is local UI state → Zustand
- If the data is form input → React Hook Form
- **Never mix these.** No storing server data in Zustand. No fetching data inside Zustand stores.

---

## Naming Conventions

### Files and Folders
- **Screens**: `kebab-case.tsx` (e.g., `care-team.tsx`, `sign-in.tsx`)
- **Components**: `PascalCase.tsx` (e.g., `MedicationCard.tsx`, `IntentSheet.tsx`)
- **Hooks**: `camelCase.ts` starting with `use` (e.g., `useMedications.ts`)
- **Services**: `camelCase.ts` (e.g., `medications.ts`, `profiles.ts`)
- **Types**: `camelCase.ts` (e.g., `medications.ts` inside `lib/types/`)
- **Utils**: `camelCase.ts` (e.g., `formatting.ts`)

### Code
- **Functions**: `camelCase` (e.g., `fetchMedications`, `commitIntentSheet`)
- **Components**: `PascalCase` (e.g., `MedicationCard`, `IntentSheet`)
- **Types/Interfaces**: `PascalCase` (e.g., `Medication`, `IntentItem`, `ProfileFact`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_CONFIDENCE_THRESHOLD`)
- **Database columns**: `snake_case` (e.g., `profile_id`, `created_at`)
- **Enum values**: `snake_case` strings (e.g., `status: 'in_progress'`)

### Module Prefixes (Database)
- Profile/Core: no prefix (`profiles`, `artifacts`, `tasks`)
- Medications: `med_` (`med_medications`, `med_adherence_events`)
- Appointments: `apt_` (`apt_appointments`, `apt_visit_plans`)
- Billing: `bill_` (`bill_cases`, `bill_documents`)
- Caregivers: no prefix (`caregiver_access`, `consent_records`)

---

## Security Rules (HIPAA-Aligned Skeleton)

### PHI Handling
- **PHI-allowed zones**: Supabase database (RLS-protected), Supabase Storage (private buckets), encrypted transport
- **PHI-forbidden zones**: console.log, error tracking payloads, analytics events, crash reports, Git repository
- **Never log PHI.** Use IDs and counts only in any logging.
- **Never put PHI in URL parameters or query strings.**

### Authentication
- Supabase Auth handles sign-up, sign-in, and session management
- Tokens stored in secure device storage (expo-secure-store), never AsyncStorage
- Session refresh handled automatically by Supabase client

### Authorization
- Every data query is scoped to profiles the user has access to
- Access is checked server-side via RLS policies — never trust client-side checks alone
- Caregiver access is permission-scoped and revocable

### Storage
- All document uploads go to private Supabase Storage buckets
- Access via short-lived signed URLs (expire after 1 hour)
- Never generate public URLs for patient documents

### Edge Functions
- All AI processing happens in Edge Functions (server-side)
- API keys for AI providers are stored as Supabase secrets
- Edge Functions minimize data sent to AI providers — only send what's needed
- AI provider responses are not logged in full — only non-PHI metadata (model, latency, token count, status)

---

## Error Handling

### Service Layer
```typescript
// Services return typed results, never throw to the UI
type ServiceResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code?: string };
```

### UI Layer
- Every screen handles: loading state, error state, empty state, and content state
- Errors are shown to users in plain, non-technical language
- Network errors prompt retry options
- Never show raw error messages or stack traces to users

---

## Git Workflow

### Commit Messages
Use conventional commits:
- `feat: add medication list screen`
- `fix: correct profile snapshot date formatting`
- `chore: update dependencies`
- `refactor: extract IntentSheet into shared component`

### Branch Strategy
- `main` — stable, deployable code
- `feat/module-name` — feature branches for new modules
- `fix/description` — bug fix branches

### Rules
- Never commit `.env.local` or any file containing secrets
- Commit frequently — small, focused commits are better than large ones
- Every commit should leave the app in a working state

---

## Testing Approach

### Priority (what to test first)
1. **Authorization**: Can a user only see their own profile's data?
2. **Intent Sheet commit**: Do accepted items correctly become verified data?
3. **Task creation**: Are tasks correctly created from committed intent items?
4. **Profile scoping**: Does switching profiles correctly isolate data?

### Approach
- Use Expo's built-in testing support with Jest
- Focus on service layer tests (data logic) over UI tests initially
- Edge Function tests for extraction pipeline

---

## Adding New Modules (Checklist)

When building a new module, follow this exact sequence:

1. **Database migration**: Create tables in `supabase/migrations/` following naming conventions
2. **Types**: Add TypeScript types in `lib/types/`
3. **Service**: Create service file in `services/` with CRUD operations
4. **Hook**: Create hook in `hooks/` that wraps the service with TanStack Query
5. **Components**: Build module-specific components in `components/modules/`
6. **Screens**: Create screen files in `app/(main)/module-name/`
7. **Navigation**: Add to tab bar or navigation if needed
8. **Integration**: Connect to Intent Sheet commit engine if the module receives extracted data
9. **Tasks**: Define what tasks/reminders this module can generate
10. **Audit**: Add audit event types for this module's key actions

**Every module follows this sequence. No exceptions.**

---

## V1 Module Scope

### Included in V1
- [x] Authentication (sign up, sign in, session)
- [x] Household & Profile foundation
- [x] Profile management (all sections: meds, allergies, conditions, insurance, care team, history)
- [x] Data Entry: text input, voice capture, photo/scan capture, document upload
- [x] Smart Extraction pipeline (AI-powered)
- [x] Intent Sheet (review and confirm)
- [x] Commit Engine
- [x] Tasks & Reminders with push notifications
- [x] Appointments (CRUD, pre-visit prep, post-visit closeout)
- [x] Medications (list, detail, schedules, reconciliation)
- [x] Caregivers (invite, permissions, consent, revocation)
- [x] Profile Snapshot & Export
- [x] Audit Trail (append-only logging)

### NOT in V1 (future modules)
- [ ] Bills & EOBs
- [ ] Results (labs/imaging)
- [ ] Voice Retrieval ("Ask Profile")
- [ ] Calling Agent
- [ ] Preventive Care
- [ ] Analytics & Dashboards
- [ ] During-Visit Capture
- [ ] Email Intake

---

## Build Phases

### Phase 0: Foundation
- Expo project scaffold with folder structure
- Supabase connection and auth flow
- Design system (colors, typography, shared components)
- Navigation skeleton (tabs, auth gate)
- Database: foundation migration (users, households, profiles)

### Phase 1: Profile + Data Entry + Intent Sheet
- Profile CRUD screens (all sections)
- Photo capture, voice recording, document upload
- Artifact storage pipeline
- AI extraction Edge Function
- Intent Sheet component and review flow
- Commit engine
- Profile Snapshot view
- Audit trail logging

### Phase 2: Tasks & Reminders + Appointments
- Task system (create, list, complete, dismiss)
- Push notification setup
- Reminder scheduling
- Appointment CRUD
- Pre-visit plan generation
- Post-visit closeout
- Appointment packet export

### Phase 3: Medications
- Medication list management
- Medication detail (sig, schedule, supply, instructions)
- Schedule and adherence tracking
- Medication reconciliation from documents
- Refill workflows

### Phase 4: Caregivers & Household
- Multi-profile management and switching
- Caregiver invitation flow
- Permission templates and assignment
- Consent recording
- Access revocation
- Profile isolation verification

### Phase 5: Polish & Launch Prep
- Error handling hardening
- Performance optimization
- App Store preparation
- Privacy policy and terms integration
- Final testing pass
