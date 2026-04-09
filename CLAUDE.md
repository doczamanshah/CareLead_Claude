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
| Client | Expo SDK 54 with React Native + TypeScript | Mobile app (iOS-first, Android soon after) |
| Navigation | Expo Router v4 (file-based routing) | Screen navigation |
| Server State | TanStack Query (React Query) v5 | Data fetching, caching, sync |
| Client State | Zustand | Local app state (active profile, UI state) |
| Backend | Supabase | Auth, Postgres DB, Storage, Edge Functions |
| ORM/Query | Supabase JS Client v2 | Type-safe database queries |
| AI | Anthropic Claude API (via Edge Functions) | Extraction, summarization, smart features |
| Forms | React Hook Form + Zod | Form handling and validation |
| Styling | React Native StyleSheet.create + color constants | Consistent styling |

### Key Rules
- **Never call AI APIs directly from the mobile app.** Always go through Supabase Edge Functions.
- **Never store API keys, secrets, or credentials in code.** Use environment variables only.
- **TypeScript strict mode is always on.** No `any` types. No `@ts-ignore` unless absolutely necessary with a comment explaining why.
- **All styling uses `StyleSheet.create()` with color constants from `lib/constants/colors.ts`.** No NativeWind, no Tailwind className syntax. Note: `nativewind`, `tailwindcss`, `tailwind.config.js`, `global.css`, and `nativewind-env.d.ts` still exist in the project as dead config — they are unused and can be removed in a cleanup pass.

---

## Supabase Setup Requirements

### Storage Bucket
A **private** storage bucket named `artifacts` must be created manually in the Supabase Dashboard (Storage > New Bucket > name: `artifacts`, private: true). This bucket stores all uploaded documents, photos, and files.

### Edge Function Secrets
The following secrets must be set for Edge Functions:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref ccpxoidlqsolzypmkiul
```

Secret names are **case-sensitive** — `ANTHROPIC_API_KEY` must match exactly what the Edge Function reads via `Deno.env.get('ANTHROPIC_API_KEY')`.

### Edge Function Deployment
Deploy Edge Functions with JWT verification disabled (required for the current architecture):
```bash
supabase functions deploy extract-document --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
```

---

## Folder Structure

```
carelead/
├── CLAUDE.md                         # THIS FILE — read first, always
├── app.json                          # Expo configuration
├── package.json
├── package-lock.json
├── tsconfig.json
├── metro.config.js                   # Metro bundler configuration
├── .env.local                        # Local environment variables (NEVER commit)
├── .gitignore
├── tailwind.config.js                # UNUSED — legacy from abandoned NativeWind setup
├── global.css                        # UNUSED — legacy from abandoned NativeWind setup
├── nativewind-env.d.ts               # UNUSED — legacy from abandoned NativeWind setup
│
├── app/                              # ALL SCREENS (Expo Router file-based routing)
│   ├── _layout.tsx                   # Root layout (providers, auth gate)
│   ├── index.tsx                     # Entry redirect
│   ├── (auth)/                       # Auth screens
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (main)/                       # Authenticated app shell
│   │   ├── _layout.tsx               # Main layout wrapper
│   │   ├── (tabs)/                   # Bottom tab screens
│   │   │   ├── _layout.tsx           # Tab bar configuration
│   │   │   ├── index.tsx             # Home / Today
│   │   │   ├── tasks.tsx             # Tasks & Reminders
│   │   │   ├── documents.tsx         # Documents & Exports
│   │   │   ├── household.tsx         # Household & Profiles
│   │   │   └── settings.tsx          # Settings
│   │   ├── profile/                  # Profile module screens
│   │   │   ├── _layout.tsx
│   │   │   └── [profileId]/
│   │   │       ├── _layout.tsx
│   │   │       ├── index.tsx         # Profile overview (facts grouped by category + strengthen card)
│   │   │       ├── edit.tsx          # Edit profile sections
│   │   │       ├── add-fact.tsx      # Add new profile fact
│   │   │       └── strengthen.tsx    # Strengthen Your Profile (fill gaps)
│   │   ├── capture/                  # Data capture screens
│   │   │   ├── _layout.tsx
│   │   │   ├── camera.tsx            # Photo/scan capture (saves as JPEG)
│   │   │   ├── voice.tsx             # Text dictation screen (type or use iOS keyboard dictation)
│   │   │   └── upload.tsx            # Document upload (PDF/image picker)
│   │   ├── intent-sheet/             # Intent Sheet review screens
│   │   │   └── [intentSheetId].tsx   # Review and confirm extracted data
│   │   └── tasks/                    # Task management screens
│   │       ├── _layout.tsx
│   │       ├── [taskId].tsx          # Task detail/edit screen
│   │       └── create.tsx            # Create new task form
│
├── components/                       # REUSABLE UI COMPONENTS
│   ├── ui/                           # Generic, module-agnostic components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── EmptyState.tsx
│   │   ├── LoadingSpinner.tsx
│   │   └── ScreenLayout.tsx          # Consistent screen wrapper
│   └── modules/                      # Module-specific compound components
│       ├── ProfileCard.tsx           # Profile summary card
│       └── DocumentCard.tsx          # Document/artifact display card
│
├── hooks/                            # CUSTOM REACT HOOKS
│   ├── useActiveProfile.ts           # Get/set the currently active profile
│   ├── useAuth.ts                    # Authentication state and actions
│   ├── useProfiles.ts                # List profiles in household
│   ├── useProfileDetail.ts           # Fetch profile with facts
│   ├── useIntentSheet.ts             # Intent sheet fetch and trigger extraction
│   ├── useArtifacts.ts               # Upload and create note artifacts
│   ├── useCommitIntentSheet.ts       # Commit accepted intent items (tasks auto-generated silently)
│   ├── useTasks.ts                   # Task CRUD, chains, assignment with TanStack Query
│   ├── useProactiveChecks.ts         # Proactive task suggestions with daily cooldown
│   ├── usePreferences.ts            # User preferences (care guidance level, weekly digest)
│   └── useProfileGaps.ts            # Profile gap analysis and filling
│
├── services/                         # API/DATABASE CALLS (organized by module)
│   ├── auth.ts                       # Authentication service
│   ├── profiles.ts                   # Profile CRUD operations
│   ├── artifacts.ts                  # Document/artifact upload and creation
│   ├── extraction.ts                 # AI extraction pipeline calls
│   ├── commit.ts                     # Commit engine — SINGLE source of task generation, context gates, dedup
│   ├── tasks.ts                      # Task CRUD operations with assignment support
│   ├── taskChains.ts                 # Task chain creation, progression, and recurrence
│   ├── proactiveChecks.ts            # Proactive task suggestions (refills, appointments, overdue, stale)
│   ├── preferences.ts               # User preferences CRUD (care guidance, weekly digest)
│   └── profileGaps.ts               # Profile Intelligence — gap analysis and filling
│
├── stores/                           # ZUSTAND STORES (client-side state only)
│   ├── authStore.ts                  # Session, user object
│   ├── profileStore.ts               # Active profile ID, profile switching
│   └── uiStore.ts                    # UI state (modals, toasts, loading)
│
├── lib/                              # CORE UTILITIES AND CONFIGURATION
│   ├── supabase.ts                   # Supabase client initialization
│   ├── types/                        # TypeScript type definitions
│   │   ├── profile.ts                # Profile, Household, ProfileFact, ProfileFactCategory
│   │   ├── artifacts.ts              # Artifact, ArtifactWithUrl, upload params
│   │   ├── intent-sheet.ts           # IntentSheet, IntentItem, status enums
│   │   └── tasks.ts                  # Task, CreateTaskParams, TaskFilter, TaskChainTemplate, ProactiveSuggestion
│   ├── utils/
│   │   ├── formatProfileFact.ts      # Category-aware profile fact display formatting
│   │   ├── fieldLabels.ts            # Human-readable labels for field keys
│   │   ├── notifications.ts         # Push notification scheduling utilities
│   │   └── medicalInference.ts      # Smart defaults for medications and conditions (data entry assistance)
│   └── constants/
│       ├── colors.ts                 # COLORS object — design system colors
│       ├── typography.ts             # FONT_SIZES, FONT_WEIGHTS
│       ├── config.ts                 # App configuration values
│       └── taskTemplates.ts          # Pre-built task chain templates (NEW_MEDICATION_CHAIN, etc.)
│
├── assets/                           # Static assets
│   ├── images/
│   ├── fonts/
│   ├── adaptive-icon.png
│   ├── favicon.png
│   ├── icon.png
│   └── splash-icon.png
│
└── supabase/                         # SUPABASE BACKEND
    ├── migrations/                   # Database schema migrations (ordered)
    │   ├── 00001_foundation.sql      # Users, households, profiles, profile_facts, artifacts, extracted_fields, intent_sheets, intent_items
    │   ├── 00002_signup_function.sql  # RPC function for user signup (SECURITY DEFINER)
    │   ├── 00003_fix_rls_policies.sql     # RLS policy fixes (v1)
    │   ├── 00003_fix_rls_policies_v2.sql  # RLS policy fixes (v2)
    │   ├── 00004_task_enhancements.sql    # Task system enhancements (context, chains, dependencies, assignment, recurrence, triggers)
│   └── 00005_user_preferences.sql    # User preferences table (care guidance level, weekly digest)
    └── functions/                    # Edge Functions (server-side code)
        ├── _shared/
        │   └── cors.ts               # Shared CORS headers
        └── extract-document/
            └── index.ts              # AI document extraction via Claude API
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

1. **CAPTURE**: User provides input via one of three methods:
   - **Camera** (`capture/camera.tsx`): Takes a photo, saved as JPEG (not HEIC — Claude API doesn't support HEIC)
   - **Text dictation** (`capture/voice.tsx`): User types text or uses iOS keyboard dictation. Saved as a note artifact with `ocr_text` populated directly — no audio file is uploaded.
   - **Document upload** (`capture/upload.tsx`): User picks a PDF or image file from their device
2. **ARTIFACT**: Input is stored as a canonical artifact in Supabase:
   - File artifacts (photo/upload): file uploaded to `artifacts` storage bucket, metadata in `artifacts` table
   - Note artifacts (text dictation): no file upload, text stored directly in `artifacts.ocr_text`
3. **PROCESS**: The `extract-document` Edge Function runs AI extraction via Claude API → produces structured entries with confidence scores and evidence
4. **INTENT SHEET**: Extracted entries are stored as `intent_items` in an `intent_sheet` (status: `pending_review`), presented to user for review. **Only data items** — no task suggestions in the Intent Sheet.
5. **COMMIT**: User reviews each item (accept / edit+accept / reject). Accepted items are committed atomically via `services/commit.ts`:
   - Profile facts are created/updated in the `profile_facts` table
   - Tasks are auto-generated silently based on care guidance level, with context gates and deduplication
   - A Smart Follow-Up card appears asking for optional enrichment data
   - Audit events are logged
6. **ACTION**: Committed items appear in the Profile overview, grouped by category. Profile gaps feed into the "Strengthen Your Profile" system.

### Rules for this flow:
- **Nothing becomes verified data without user confirmation.** No exceptions.
- **AI outputs are always "suggestions" until committed.** They live in `extracted_fields` and `intent_items`, never in profile fact tables.
- **Commits are atomic.** If 5 items are accepted, all 5 are written in a single transaction. If one fails, none persist.
- **Every commit creates audit events.** No silent writes.

---

## Extraction Architecture: Structured Entries

The extraction pipeline produces **structured entries**, not fragmented individual fields. Each intent item represents a complete, coherent entity.

### Example: Medication extraction
One intent item contains the full medication as a structured JSON value:
```json
{
  "field_key": "medication",
  "proposed_value": {
    "drug_name": "lisinopril",
    "dose": "25mg",
    "frequency": "once daily",
    "route": "oral"
  },
  "confidence": 0.95,
  "evidence_json": { "source_text": "Lisinopril 25mg PO daily" }
}
```

This is **one** intent item — not four separate items for drug_name, dose, frequency, and route.

### Other structured entry examples:
- **Allergy**: `{ "substance": "penicillin", "reaction": "hives", "severity": "moderate" }`
- **Condition**: `{ "condition_name": "Type 2 Diabetes", "status": "active", "diagnosed_date": "2019" }`
- **Insurance**: `{ "plan_name": "Blue Cross PPO", "member_id": "XYZ123", "group_number": "G456" }`

### Profile Facts Display
Profile facts store their values as structured JSON. The `lib/utils/formatProfileFact.ts` utility provides category-aware formatting — it knows how to render a medication fact differently from an allergy fact or insurance fact. Each category has its own display logic that extracts the title and detail lines from the JSON value.

---

## Six Shared Primitives

These are built ONCE and reused by every module:

### 1. Artifact Pipeline
- Accepts: photos (JPEG), document uploads (PDF/images), typed text (note artifacts)
- Stores: files in private `artifacts` Supabase Storage bucket, metadata in `artifacts` table
- Note artifacts have no file — text goes directly into `artifacts.ocr_text`
- Processes: extraction via `extract-document` Edge Function
- Status tracking: `pending` → `processing` → `completed` → `failed`
- Key column: `file_size` (not `file_size_bytes`)

### 2. Intent Sheet
- Generated after extraction completes
- Contains `intent_items`, each with:
  - `field_key` (category key like `medication`, `allergy`, `condition`, `insurance`)
  - `proposed_value` (structured JSON object — a complete entry, not a single field)
  - `confidence` (0.0 to 1.0)
  - `evidence_json` (reference to source text in artifact)
  - `status`: `pending` → `accepted` | `edited` | `rejected`
- Sheet statuses: `draft` → `pending_review` → `partially_committed` | `committed` | `dismissed`
- UI component: Intent Sheet review screen renders all items with accept/edit/reject controls

### 3. Commit Engine
- Implemented in `services/commit.ts` with hook `hooks/useCommitIntentSheet.ts`
- Takes accepted intent items and writes them to `profile_facts` table
- **SINGLE source of AI-suggested task generation** — no task items in Intent Sheet
- Fetches user's care guidance level and filters tasks by tier (essentials/balanced/comprehensive)
- **Context gates**: tasks are only generated when sufficient data exists (e.g., "fill prescription" requires pharmacy on file)
- **Deduplication**: checks for existing similar tasks before creating
- When context is insufficient, creates profile gap entries instead of low-quality tasks
- Returns committed items info for the Smart Follow-Up card
- All writes happen in a single database transaction
- Logs audit events for every committed change and every skipped task generation

### 4. Task System
- Tasks are the operational output of CareLead — a smart care operations engine
- Core fields: `title`, `description`, `due_date`, `priority`, `status`, `profile_id`, `source_type`, `source_ref`
- Enhanced fields: `context_json` (call scripts, contact info, instructions, reference numbers), `parent_task_id`, `chain_order`, `depends_on_task_id`, `dependency_status`, `assigned_to_user_id`, `recurrence_rule`, `trigger_type`, `trigger_source`
- Statuses: `pending` → `in_progress` → `completed` | `dismissed`
- Trigger types: `manual` | `extraction` | `proactive` | `time_based` | `chain`
- Tasks can be auto-generated (from Intent Sheet commit with AI-suggested tasks), created from task chain templates, proactively suggested, or manually created
- **Smart Task Generation**: AI extraction suggests contextual follow-up tasks based on committed data category (medication, allergy, insurance, condition)
- **Task Chains**: Sequences of linked tasks where each depends on the previous one completing (e.g., NEW_MEDICATION_CHAIN, POST_VISIT_CHAIN)
- **Proactive Checks**: Runs on app open (daily cooldown) to suggest refill reminders, appointment prep, overdue escalation, and stale profile reviews
- **Caregiver Assignment**: Tasks can be assigned to household members
- Reminders are scheduled via push notifications
- Every task links back to its source and includes rich context (call scripts, instructions, contact info)

### 5. Profile Intelligence (Gaps)
- Implemented in `services/profileGaps.ts` with hook `hooks/useProfileGaps.ts`
- Analyzes profile facts to identify missing data that would unlock better functionality
- Gap categories: medication (dose, frequency, pharmacy, prescriber), condition (managing provider, status), allergy (reaction, severity), insurance (PCP), general (emergency contact, care team, pharmacy)
- Gaps are prioritized by impact: HIGH = unlocks task generation, MEDIUM = improves context, LOW = nice to have
- "Strengthen Your Profile" card on profile overview links to fill-gaps screen
- Filling a gap triggers task query invalidation — newly unlocked tasks appear automatically

### 6. Audit Trail
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
- Components use `StyleSheet.create()` for styling with colors from `lib/constants/colors.ts`

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
- **Components**: `PascalCase.tsx` (e.g., `MedicationCard.tsx`, `ProfileCard.tsx`)
- **Hooks**: `camelCase.ts` starting with `use` (e.g., `useProfiles.ts`)
- **Services**: `camelCase.ts` (e.g., `commit.ts`, `profiles.ts`)
- **Types**: `camelCase.ts` (e.g., `profile.ts` inside `lib/types/`)
- **Utils**: `camelCase.ts` (e.g., `formatProfileFact.ts`)

### Code
- **Functions**: `camelCase` (e.g., `fetchMedications`, `commitIntentSheet`)
- **Components**: `PascalCase` (e.g., `MedicationCard`, `ProfileCard`)
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
- JWT verification is disabled on Edge Functions (`--no-verify-jwt` during deployment)
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

## Known Patterns and Gotchas

Patterns that emerged during development — read these before building new features:

### RLS Chicken-and-Egg Problem
When a new user signs up, they need to create a household and profile — but RLS policies require the user to already be a household member to insert rows. This was solved with a `SECURITY DEFINER` RPC function (`00002_signup_function.sql`) that runs with elevated privileges to bootstrap the user's household, membership, and first profile in a single transaction.

### Edge Function Secrets
Secret names are **case-sensitive** and must match exactly what the code reads via `Deno.env.get()`. A mismatch silently returns `undefined`. Always verify with `supabase secrets list`.

### expo-file-system Legacy Import
In Expo SDK 54, `expo-file-system` requires importing from the legacy path:
```typescript
import * as FileSystem from 'expo-file-system/legacy';
```
Not `from 'expo-file-system'` — the default export has breaking changes in SDK 54.

### HEIC Files Not Supported
iPhone cameras default to HEIC format, which the Claude API does not accept. The camera capture screen is configured to save photos as **JPEG** to avoid this issue. Any future file upload flow must also reject or convert HEIC files.

### Artifacts Table Column Name
The column for file size in the `artifacts` table is `file_size` (not `file_size_bytes`). This has caused bugs when the wrong name was assumed.

### Profile Facts Use Structured JSON
Profile facts store their `value` as structured JSON (not flat strings). The `formatProfileFact.ts` utility handles category-aware display formatting. When adding new profile fact categories, add a corresponding formatter in that file.

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
- [x] Data Entry: text input, text dictation, photo/scan capture, document upload
- [x] Smart Extraction pipeline (AI-powered)
- [x] Intent Sheet (review and confirm)
- [x] Commit Engine
- [x] Tasks & Reminders with push notifications, smart generation, chains, proactive checks, caregiver assignment
- [ ] Appointments (CRUD, pre-visit prep, post-visit closeout)
- [ ] Medications (list, detail, schedules, reconciliation)
- [ ] Caregivers (invite, permissions, consent, revocation)
- [ ] Profile Snapshot & Export
- [ ] Audit Trail (append-only logging)

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

### Phase 0: Foundation — COMPLETE
- [x] Expo project scaffold with folder structure
- [x] Supabase connection and auth flow
- [x] Design system (colors, typography, shared components)
- [x] Navigation skeleton (tabs, auth gate)
- [x] Database: foundation migration (users, households, profiles)

### Phase 1: Profile + Data Entry + Intent Sheet — IN PROGRESS
- [x] **Step 1**: Database schema — foundation tables, RLS policies, signup RPC function
- [x] **Step 2**: Profile system — household, profile facts, family members, profile overview screen
- [x] **Step 3**: Data capture — photo capture, document upload, text dictation screen
- [x] **Step 4**: AI extraction — Edge Function with Claude API, extraction service and hooks
- [x] **Step 5**: Intent Sheet review, commit engine, smart extraction, profile fact display with formatProfileFact
- [x] **Step 6**: Tasks & reminders — full task management, push notifications, home screen action items
- [ ] **Step 7**: Appointment module screens
- [ ] **Step 8**: Medication module screens
- [ ] **Step 9**: Caregiver management

### Phase 2: Appointments
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
