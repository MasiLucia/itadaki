export {
  ROLES,
  type Role,
  PERMISSIONS,
  type Permission,
  can,
  permissionsOf,
  isRole,
} from './lib/role';
export {
  type StaffUser,
  type StaffSession,
  type CredentialError,
  MIN_PASSWORD_LENGTH,
  normaliseEmail,
  validateCredentials,
  isTooCommon,
  validatePassword,
  isSessionValid,
} from './lib/staff';
export {
  type Tenant,
  type SignUpError,
  slugify,
  prepareTenant,
  uniqueSlug,
} from './lib/tenant';
export {
  TRIAL_DAYS,
  WARN_WITHIN_DAYS,
  type SubscriptionStatus,
  type Subscription,
  type TrialInput,
  daysUntil,
  trialEndFor,
  describeSubscription,
  canEditConfiguration,
} from './lib/subscription';
