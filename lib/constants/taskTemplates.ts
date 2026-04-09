import type { TaskChainTemplate } from '@/lib/types/tasks';

export const NEW_MEDICATION_CHAIN: TaskChainTemplate = {
  id: 'new_medication',
  name: 'New Medication Action Plan',
  description: 'Get set up with a new medication — from reminders to your first check-in.',
  steps: [
    {
      title: 'Set up medication reminder',
      description: 'Create a daily alarm or reminder for this medication at the prescribed time.',
      priority: 'high',
      due_days_offset: 1,
      context_json: {
        instructions: [
          'Open your phone alarm or reminder app',
          'Set a recurring alarm at the prescribed time',
          'Label it with the medication name and dose',
        ],
      },
    },
    {
      title: 'Pick up medication from pharmacy',
      description: 'Confirm the prescription is ready and pick it up. Bring your insurance card.',
      priority: 'high',
      due_days_offset: 2,
      context_json: {
        instructions: [
          'Call pharmacy to confirm prescription is ready',
          'Bring insurance card and photo ID',
          'Ask pharmacist about food/drink interactions',
          'Ask about proper storage (refrigeration, light sensitivity)',
        ],
      },
    },
    {
      title: 'Take first dose and note any side effects',
      description: 'Start the medication as prescribed. Note how you feel for the first 24 hours.',
      priority: 'medium',
      due_days_offset: 3,
      context_json: {
        instructions: [
          'Take the medication exactly as prescribed',
          'Note the time you took it',
          'Write down any unusual feelings or side effects',
          'If you experience severe side effects, call your doctor immediately',
        ],
      },
    },
    {
      title: '7-day check-in: any issues?',
      description: 'After a week on this medication, assess how it\'s going and report any concerns to your doctor.',
      priority: 'medium',
      due_days_offset: 10,
      context_json: {
        instructions: [
          'Review your notes on side effects from the past week',
          'Are you able to take it at the same time each day?',
          'Any side effects that are persistent or worsening?',
          'Call your doctor if you have concerns',
        ],
      },
    },
  ],
};

export const NEW_APPOINTMENT_CHAIN: TaskChainTemplate = {
  id: 'new_appointment',
  name: 'Appointment Prep Plan',
  description: 'Be fully prepared — from confirming to post-visit follow-through.',
  steps: [
    {
      title: 'Confirm appointment 2 days before',
      description: 'Call or check the patient portal to confirm your upcoming appointment.',
      priority: 'medium',
      due_days_offset: -2,
      context_json: {
        instructions: [
          'Call the office or check the patient portal',
          'Confirm date, time, and location',
          'Ask about any paperwork or labs needed beforehand',
          'Ask about parking or check-in procedures',
        ],
      },
    },
    {
      title: 'Prepare questions list',
      description: 'Write down questions and concerns to discuss with your provider.',
      priority: 'medium',
      due_days_offset: -1,
      context_json: {
        instructions: [
          'Review any symptoms or concerns since your last visit',
          'Write down your top 3-5 questions',
          'Note any medication side effects to discuss',
          'Prepare to discuss any new conditions or changes',
        ],
      },
    },
    {
      title: 'Gather documents to bring',
      description: 'Collect insurance cards, medication list, and any relevant documents.',
      priority: 'medium',
      due_days_offset: -1,
      context_json: {
        instructions: [
          'Insurance card (front and back)',
          'Photo ID',
          'Current medication list',
          'Any recent lab results or imaging',
          'Referral letter if needed',
          'Copay or payment method',
        ],
      },
    },
    {
      title: 'Day-of: check-in and logistics',
      description: 'Arrive on time, check in, and have your questions ready.',
      priority: 'high',
      due_days_offset: 0,
      context_json: {
        instructions: [
          'Arrive 15 minutes early for check-in',
          'Have insurance card and ID ready',
          'Turn on Do Not Disturb on your phone',
          'Have your questions list accessible',
        ],
      },
    },
  ],
};

export const NEW_BILL_CHAIN: TaskChainTemplate = {
  id: 'new_bill',
  name: 'Bill Review Plan',
  description: 'Review, verify, and resolve a medical bill step by step.',
  steps: [
    {
      title: 'Review bill for accuracy',
      description: 'Check that the services listed match what you actually received.',
      priority: 'high',
      due_days_offset: 1,
      context_json: {
        instructions: [
          'Check the date of service — does it match your visit?',
          'Review each line item — were these services performed?',
          'Verify your insurance was applied',
          'Check the patient responsibility amount',
          'Look for duplicate charges',
        ],
      },
    },
    {
      title: 'Compare with EOB',
      description: 'Match the bill against your Explanation of Benefits from insurance.',
      priority: 'medium',
      due_days_offset: 3,
      context_json: {
        instructions: [
          'Find the matching EOB from your insurance (check mail or portal)',
          'Compare: does insurance-applied amount match?',
          'Verify your copay/coinsurance matches what was agreed',
          'Note any denials or partially covered items',
        ],
      },
    },
    {
      title: 'Call billing office if discrepancy',
      description: 'Contact the billing department to resolve any errors or questions.',
      priority: 'medium',
      due_days_offset: 7,
      context_json: {
        instructions: [
          'Have the bill and EOB in front of you',
          'Note the specific discrepancy before calling',
          'Ask for an itemized bill if not provided',
          'Request a corrected bill if errors are found',
          'Ask about payment plans if needed',
        ],
      },
    },
    {
      title: 'Follow up if unresolved in 14 days',
      description: 'If the billing issue is still unresolved, escalate or follow up.',
      priority: 'medium',
      due_days_offset: 21,
      context_json: {
        instructions: [
          'Call billing office again with reference number from previous call',
          'If unresolved, ask to speak with a supervisor',
          'Consider filing a complaint with your insurance if billing is incorrect',
          'Keep records of all calls (date, person, reference number)',
        ],
      },
    },
  ],
};

export const POST_VISIT_CHAIN: TaskChainTemplate = {
  id: 'post_visit',
  name: 'Post-Visit Follow-Through',
  description: 'Don\'t let anything fall through the cracks after a doctor visit.',
  steps: [
    {
      title: 'Upload after-visit summary',
      description: 'Capture or upload the visit summary or discharge papers into CareLead.',
      priority: 'high',
      due_days_offset: 0,
      context_json: {
        instructions: [
          'Take a photo of the after-visit summary',
          'Or download it from the patient portal',
          'Upload it into CareLead for processing',
        ],
      },
    },
    {
      title: 'Review medication changes',
      description: 'Check if any medications were added, changed, or stopped during the visit.',
      priority: 'high',
      due_days_offset: 1,
      context_json: {
        instructions: [
          'Compare your current medication list with the visit notes',
          'Note any new prescriptions — do they need to be picked up?',
          'Note any stopped medications — remove reminders',
          'Update your CareLead profile with changes',
        ],
      },
    },
    {
      title: 'Schedule follow-up appointments',
      description: 'Book any follow-up visits or referrals recommended during the appointment.',
      priority: 'medium',
      due_days_offset: 3,
      context_json: {
        instructions: [
          'Check the after-visit summary for follow-up recommendations',
          'Schedule recommended follow-up visits',
          'Book any specialist referrals',
          'Note the appointments in your calendar',
        ],
      },
    },
    {
      title: 'Complete any ordered tests',
      description: 'Get any lab work, imaging, or other tests that were ordered.',
      priority: 'medium',
      due_days_offset: 7,
      context_json: {
        instructions: [
          'Check which tests were ordered (labs, imaging, etc.)',
          'Find the nearest facility or schedule with preferred lab',
          'Check if fasting is required before lab work',
          'Bring the test order form if provided',
        ],
      },
    },
  ],
};

export const NEW_INSURANCE_CHAIN: TaskChainTemplate = {
  id: 'new_insurance',
  name: 'New Insurance Setup Plan',
  description: 'Update everyone with your new insurance information.',
  steps: [
    {
      title: 'Update pharmacy with new insurance',
      description: 'Bring your new insurance card to the pharmacy for billing updates.',
      priority: 'high',
      due_days_offset: 1,
      context_json: {
        instructions: [
          'Visit or call your pharmacy',
          'Provide the new insurance card (front and back)',
          'Ask them to run a test claim on a current medication',
          'Confirm copay amounts',
        ],
      },
    },
    {
      title: 'Verify coverage for current medications',
      description: 'Check that all your current prescriptions are covered under the new plan.',
      priority: 'high',
      due_days_offset: 3,
      context_json: {
        instructions: [
          'Call member services or check the formulary online',
          'Check each current medication for coverage',
          'Ask about prior authorization requirements',
          'Ask about step therapy or preferred alternatives',
        ],
      },
    },
    {
      title: 'Update all provider offices',
      description: 'Contact each healthcare provider to update your insurance on file.',
      priority: 'medium',
      due_days_offset: 7,
      context_json: {
        instructions: [
          'Make a list of all providers to update',
          'Call or visit each office',
          'Bring or fax a copy of your new card',
          'Confirm your providers are in-network with the new plan',
        ],
      },
    },
  ],
};

/** All available task chain templates */
export const TASK_CHAIN_TEMPLATES: TaskChainTemplate[] = [
  NEW_MEDICATION_CHAIN,
  NEW_APPOINTMENT_CHAIN,
  NEW_BILL_CHAIN,
  POST_VISIT_CHAIN,
  NEW_INSURANCE_CHAIN,
];

/** Map from category to applicable chain template */
export const CATEGORY_CHAIN_MAP: Record<string, TaskChainTemplate> = {
  medication: NEW_MEDICATION_CHAIN,
  insurance: NEW_INSURANCE_CHAIN,
};
