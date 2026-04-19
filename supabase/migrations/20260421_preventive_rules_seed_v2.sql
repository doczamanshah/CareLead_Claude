-- ══════════════════════════════════════════════════════════════════════
-- Migration: Preventive Care Ruleset v2 (Phase 3 Item 5, Part 1)
-- Updates the 10 existing rules with the new v2 fields and adds 15 new
-- rules covering the diabetes care bundle, cardiovascular, behavioral
-- health, additional cancer screening, wellness visits, and additional
-- immunizations.
-- ══════════════════════════════════════════════════════════════════════

-- ── Update existing rules with v2 fields ────────────────────────────────

-- 1. Colorectal Cancer Screening — multiple screening methods
UPDATE preventive_rules
SET
  screening_methods = '[
    {"method_id":"colonoscopy","name":"Colonoscopy","cadence_months":120,"description":"Visual examination of the entire colon. Recommended every 10 years."},
    {"method_id":"cologuard","name":"Cologuard (Stool DNA)","cadence_months":36,"description":"At-home stool test that detects DNA markers. Every 3 years."},
    {"method_id":"fit","name":"FIT (Stool Test)","cadence_months":12,"description":"Simple at-home stool test for blood. Annual."},
    {"method_id":"flex_sig","name":"Flexible Sigmoidoscopy","cadence_months":60,"description":"Examination of the lower colon. Every 5 years."}
  ]'::jsonb,
  hedis_measure_code = 'COL',
  measure_type = 'screening'
WHERE code = 'crc_screening';

-- 2. Breast Cancer Screening
UPDATE preventive_rules
SET
  screening_methods = '[
    {"method_id":"mammogram","name":"Mammography","cadence_months":24,"description":"Standard mammogram. Recommended every 2 years."},
    {"method_id":"mammogram_annual","name":"Annual Mammography","cadence_months":12,"description":"Annual mammogram for higher-risk women."}
  ]'::jsonb,
  hedis_measure_code = 'BCS',
  measure_type = 'screening'
WHERE code = 'breast_cancer_screening';

-- 3. Cervical Cancer Screening
UPDATE preventive_rules
SET
  screening_methods = '[
    {"method_id":"pap","name":"Pap Smear","cadence_months":36,"description":"Pap test alone. Every 3 years for ages 21-29."},
    {"method_id":"pap_hpv","name":"Pap + HPV Co-testing","cadence_months":60,"description":"Combined Pap and HPV test. Every 5 years for ages 30-65."},
    {"method_id":"hpv_primary","name":"HPV Primary Testing","cadence_months":60,"description":"HPV test alone. Every 5 years for ages 25-65."}
  ]'::jsonb,
  hedis_measure_code = 'CCS',
  measure_type = 'screening'
WHERE code = 'cervical_cancer_screening';

-- 4. Flu Vaccine — seasonal window
UPDATE preventive_rules
SET
  seasonal_window = '{"start_month":9,"end_month":11,"label":"Fall flu season"}'::jsonb,
  hedis_measure_code = 'FLU',
  measure_type = 'immunization'
WHERE code = 'flu_vaccine';

-- 5. Shingles Vaccine
UPDATE preventive_rules
SET measure_type = 'immunization'
WHERE code = 'shingles_vaccine';

-- 6. Pneumococcal Vaccine
UPDATE preventive_rules
SET measure_type = 'immunization'
WHERE code = 'pneumococcal_vaccine';

-- 7. Lipid Screening
UPDATE preventive_rules
SET measure_type = 'screening'
WHERE code = 'lipid_screening';

-- 8. Blood Pressure Screening
UPDATE preventive_rules
SET
  hedis_measure_code = 'CBP',
  measure_type = 'screening'
WHERE code = 'bp_screening';

-- 9. Diabetes Screening
UPDATE preventive_rules
SET measure_type = 'screening'
WHERE code = 'diabetes_screening';

-- 10. Bone Density Screening
UPDATE preventive_rules
SET
  hedis_measure_code = 'OMW',
  measure_type = 'screening'
WHERE code = 'bone_density_screening';


-- ── New rules (v2) ─────────────────────────────────────────────────────

INSERT INTO preventive_rules (
  code, title, description, category, eligibility_criteria, cadence_months,
  guideline_source, guideline_version,
  condition_triggers, is_condition_dependent, hedis_measure_code,
  seasonal_window, measure_type
) VALUES

-- ── Diabetes Care Bundle ───────────────────────────────────────────────

(
  'diabetes_a1c',
  'Hemoglobin A1c Test',
  'Regular A1c testing monitors long-term blood sugar control. Recommended every 3-6 months for people with diabetes.',
  'metabolic',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  6,
  'ADA',
  '2025',
  '["diabetes","type 2 diabetes","type 1 diabetes","prediabetes"]'::jsonb,
  TRUE,
  'HBD',
  NULL,
  'monitoring'
),
(
  'diabetes_eye_exam',
  'Diabetic Eye Exam',
  'Annual dilated eye exam to check for diabetic retinopathy. Early detection prevents vision loss.',
  'other',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'ADA',
  '2025',
  '["diabetes","type 2 diabetes","type 1 diabetes"]'::jsonb,
  TRUE,
  'EED',
  NULL,
  'screening'
),
(
  'diabetes_kidney',
  'Kidney Health Check (eGFR + uACR)',
  'Annual kidney function testing for people with diabetes. Monitors for diabetic kidney disease.',
  'metabolic',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'ADA/KDIGO',
  '2025',
  '["diabetes","type 2 diabetes","type 1 diabetes","ckd","chronic kidney disease"]'::jsonb,
  TRUE,
  'KED',
  NULL,
  'monitoring'
),
(
  'diabetes_foot_exam',
  'Diabetic Foot Exam',
  'Annual comprehensive foot exam for people with diabetes. Checks for neuropathy and circulation issues.',
  'other',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'ADA',
  '2025',
  '["diabetes","type 2 diabetes","type 1 diabetes"]'::jsonb,
  TRUE,
  NULL,
  NULL,
  'screening'
),

-- ── Cardiovascular ─────────────────────────────────────────────────────

(
  'statin_evaluation',
  'Statin Therapy Review',
  'For people with cardiovascular disease or diabetes, discuss statin therapy with your doctor.',
  'cardiovascular',
  '{"min_age":40,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'ACC/AHA',
  '2023',
  '["heart disease","cardiovascular disease","diabetes","high cholesterol","hyperlipidemia"]'::jsonb,
  TRUE,
  'SPC',
  NULL,
  'counseling'
),

-- ── Behavioral Health ──────────────────────────────────────────────────

(
  'depression_screening',
  'Depression Screening',
  'Regular screening for depression is recommended for all adults. A simple questionnaire your doctor can provide.',
  'other',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'USPSTF',
  '2023',
  NULL,
  FALSE,
  'PHQ9',
  NULL,
  'screening'
),
(
  'tobacco_screening',
  'Tobacco Use Screening & Cessation',
  'Annual screening for tobacco use with cessation counseling for users.',
  'other',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'USPSTF',
  '2021',
  NULL,
  FALSE,
  NULL,
  NULL,
  'counseling'
),
(
  'alcohol_screening',
  'Alcohol Use Screening (SBIRT)',
  'Screening for unhealthy alcohol use with brief intervention when needed.',
  'other',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'USPSTF',
  '2018',
  NULL,
  FALSE,
  NULL,
  NULL,
  'counseling'
),

-- ── Additional Cancer Screening ────────────────────────────────────────

(
  'lung_cancer_screening',
  'Lung Cancer Screening (Low-Dose CT)',
  'Annual low-dose CT scan for adults 50-80 with a significant smoking history (20+ pack-years).',
  'cancer_screening',
  '{"min_age":50,"max_age":80,"sex":"any"}'::jsonb,
  12,
  'USPSTF',
  '2021',
  '["smoking","tobacco use","former smoker"]'::jsonb,
  TRUE,
  'LCS',
  NULL,
  'screening'
),

-- ── Wellness ───────────────────────────────────────────────────────────

(
  'annual_wellness_visit',
  'Annual Wellness Visit',
  'A preventive visit to review your health, update screenings, and create a prevention plan. Covered by most insurance with no copay.',
  'other',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'CMS',
  '2025',
  NULL,
  FALSE,
  'AWV',
  NULL,
  'visit'
),
(
  'bmi_screening',
  'BMI Screening & Follow-up',
  'Regular BMI screening with follow-up plan for patients outside the healthy range.',
  'other',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'USPSTF',
  '2018',
  NULL,
  FALSE,
  NULL,
  NULL,
  'screening'
),

-- ── Additional Immunizations ───────────────────────────────────────────

(
  'covid_vaccine',
  'COVID-19 Vaccine (Updated)',
  'Updated COVID-19 vaccine recommended annually for most adults.',
  'immunization',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  12,
  'CDC',
  '2025',
  NULL,
  FALSE,
  NULL,
  '{"start_month":9,"end_month":12,"label":"Fall/Winter"}'::jsonb,
  'immunization'
),
(
  'tdap_booster',
  'Tetanus/Diphtheria/Pertussis Booster',
  'Td or Tdap booster every 10 years for all adults.',
  'immunization',
  '{"min_age":18,"max_age":null,"sex":"any"}'::jsonb,
  120,
  'CDC',
  '2024',
  NULL,
  FALSE,
  NULL,
  NULL,
  'immunization'
),
(
  'hep_b_screening',
  'Hepatitis B Screening',
  'One-time screening for hepatitis B for adults 18-79.',
  'other',
  '{"min_age":18,"max_age":79,"sex":"any"}'::jsonb,
  NULL,
  'USPSTF',
  '2020',
  NULL,
  FALSE,
  NULL,
  NULL,
  'screening'
),
(
  'hpv_vaccine',
  'HPV Vaccine',
  'HPV vaccination recommended for adults through age 26 who have not been vaccinated.',
  'immunization',
  '{"min_age":18,"max_age":26,"sex":"any"}'::jsonb,
  NULL,
  'CDC',
  '2024',
  NULL,
  FALSE,
  NULL,
  NULL,
  'immunization'
);
