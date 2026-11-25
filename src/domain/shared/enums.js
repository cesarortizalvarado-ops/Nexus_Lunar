export const MODULE_STATUSES = Object.freeze([
  'AVAILABLE',
  'DISABLED',
  'PREPARING',
  'DEGRADED',
  'ERROR',
]);

export const MEMORY_INFORMATION_TYPES = Object.freeze([
  'FACT',
  'USER_STATEMENT',
  'PREFERENCE',
  'DECISION',
  'GOAL_REFERENCE',
  'INTENTION',
  'PLAN_REFERENCE',
  'ESTIMATE',
  'INFERENCE',
  'HYPOTHESIS',
  'PREDICTION',
  'UNKNOWN',
]);

export const SOURCE_TYPES = Object.freeze([
  'USER',
  'SYSTEM',
  'IMPORT',
  'CALCULATION',
  'AI_INFERENCE',
  'EXTERNAL_INTEGRATION',
  'CORRECTION',
]);

export const MEMORY_STATUSES = Object.freeze([
  'ACTIVE',
  'SUPERSEDED',
  'DISPUTED',
  'RETIRED',
  'ARCHIVED',
]);

export const MEMORY_CHANGE_TYPES = Object.freeze([
  'UPDATE',
  'OUTDATED',
  'CORRECTION_OF_ERROR',
  'PREFERENCE_CHANGED',
  'RETIRED',
  'ARCHIVED',
]);

export const GOAL_STATUSES = Object.freeze([
  'ACTIVE',
  'ON_HOLD',
  'ACHIEVED',
  'PARTIALLY_ACHIEVED',
  'ABANDONED',
  'ARCHIVED',
]);

export const PROJECT_STATUSES = Object.freeze([
  'PLANNING',
  'ACTIVE',
  'PAUSED',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
]);

export const TASK_STATUSES = Object.freeze([
  'PENDING',
  'PREPARATION',
  'IN_PROGRESS',
  'WAITING',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
]);

export const ACTIVITY_STATUSES = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'ARCHIVED',
]);

export const HABIT_STATUSES = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ABANDONED',
  'ARCHIVED',
]);

export const HABIT_FREQUENCY_TYPES = Object.freeze([
  'DAILY',
  'SPECIFIC_DAYS',
  'TIMES_PER_WEEK',
  'WEEKLY',
  'MONTHLY',
  'INTERVAL',
  'CUSTOM',
]);

export const HABIT_OCCURRENCE_STATUSES = Object.freeze([
  'COMPLETED',
  'PARTIAL',
  'MISSED',
  'SKIPPED',
  'UNKNOWN',
]);

export const ROUTINE_STATUSES = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'ARCHIVED',
]);

export const ROUTINE_EXECUTION_STATUSES = Object.freeze([
  'STARTED',
  'IN_PROGRESS',
  'PARTIAL',
  'COMPLETED',
  'INTERRUPTED',
  'CANCELLED',
]);

export const ROUTINE_STEP_EXECUTION_STATUSES = Object.freeze([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIAL',
  'SKIPPED',
  'MISSED',
  'UNKNOWN',
]);

export const CALENDAR_EVENT_STATUSES = Object.freeze([
  'PROPOSED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
]);

export const COMMITMENT_STATUSES = Object.freeze([
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
]);

export const AVAILABILITY_TYPES = Object.freeze([
  'CONFIRMED',
  'POTENTIAL',
  'RESERVED',
  'UNAVAILABLE',
  'UNKNOWN',
]);

export const TIME_BLOCK_TYPES = Object.freeze([
  'FIXED',
  'FLEXIBLE',
  'BUFFER',
  'OPTIONAL',
]);

export const EXECUTION_STATUSES = Object.freeze([
  'STARTED',
  'PAUSED',
  'COMPLETED',
  'INTERRUPTED',
  'CANCELLED',
]);

export const OUTCOME_TYPES = Object.freeze([
  'SUCCESS',
  'PARTIAL',
  'DIFFERENT',
  'FAILED',
  'UNKNOWN',
]);

export const TRANSACTION_TYPES = Object.freeze([
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'REFUND',
  'ADJUSTMENT',
]);

export const PURCHASE_STATUSES = Object.freeze([
  'PLANNED',
  'ORDERED',
  'RECEIVED_PARTIALLY',
  'RECEIVED',
  'CANCELLED',
]);

export const IMPORT_JOB_STATUSES = Object.freeze([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
]);

export const PLAN_TYPES = Object.freeze([
  'WEEKLY',
  'DAILY',
  'PROJECT',
  'CUSTOM',
]);

export const PROPOSAL_STATUSES = Object.freeze([
  'DRAFT',
  'PRESENTED',
  'ACCEPTED',
  'REJECTED',
  'SUPERSEDED',
]);

export const ADAPTATION_OBSERVATION_STATUSES = Object.freeze([
  'CANDIDATE',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
]);

export const ADAPTATION_SUGGESTION_STATUSES = Object.freeze([
  'PROPOSED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'APPLIED',
]);

export const INTERVENTION_CLASSIFICATIONS = Object.freeze([
  'INFO',
  'RECOMMENDATION',
  'WARNING',
  'CONFLICT',
  'PENDING_DECISION',
  'URGENT',
]);

export const AI_PROVIDER_TYPES = Object.freeze(['LOCAL', 'REMOTE', 'CUSTOM']);
export const AI_MESSAGE_ROLES = Object.freeze(['USER', 'ASSISTANT', 'SYSTEM', 'TOOL']);
export const AI_PROPOSAL_STATUSES = Object.freeze([
  'PROPOSED',
  'VALIDATED',
  'AUTHORIZED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
]);

export const SENSITIVITY_LEVELS = Object.freeze([
  'PUBLIC',
  'INTERNAL',
  'PERSONAL',
  'SENSITIVE',
  'RESTRICTED',
]);

export const PERMISSION_ACTIONS = Object.freeze([
  'READ',
  'CREATE',
  'UPDATE',
  'CORRECT',
  'APPROVE',
  'EXECUTE',
  'ARCHIVE',
  'RESTORE',
  'DELETE',
  'EXPORT',
  'SHARE_EXTERNALLY',
]);

export const DOMAIN_RELATION_TYPES = Object.freeze([
  'BELONGS_TO',
  'CONTRIBUTES_TO',
  'DEPENDS_ON',
  'SUPPORTS',
  'BLOCKS',
  'DERIVED_FROM',
  'REFERENCES',
  'RELATED_TO',
  'SUPERSEDES',
  'CONTRADICTS',
  'CONSUMES',
  'PRODUCES',
  'REQUIRES',
  'GENERATED_BY',
]);
