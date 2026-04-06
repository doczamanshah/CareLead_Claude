export const APP_CONFIG = {
  name: 'CareLead',
  tagline: 'Your care. In your hands.',
  version: '1.0.0',
  signedUrlExpiry: 3600, // 1 hour in seconds
  maxConfidenceThreshold: 0.95,
  minConfidenceThreshold: 0.3,
  paginationLimit: 20,
} as const;
