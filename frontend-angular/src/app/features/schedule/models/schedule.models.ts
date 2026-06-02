export interface ScheduleBoardResponse {
  message?: string;
  scheduleId: number | null;
  weekStartDate: string;
  weekEndDate: string;
  publishedAt?: string | null;
  generatedAt?: string;
  canEdit: boolean;
  canManage: boolean;
  summary?: ScheduleSummary;
  improvementSummary?: ScheduleImprovementSummary;
  warnings?: ScheduleAssignmentWarning[];
  days: ScheduleDay[];
}

export interface ScheduleSummary {
  totalShifts: number;
  totalRoleRequirements: number;
  fullyCoveredRoleGroups: number;
  underCoveredRoleGroups: number;
  meetsStrengthTargetRoleGroups: number;
  belowStrengthTargetRoleGroups: number;
}

export interface ScheduleDay {
  date: string;
  dayName: string;
  shifts: ScheduleShift[];
}

export interface ScheduleShift {
  shiftId: number;
  shiftType: ScheduleShiftType;
  requiredStrengthScore?: number;
  hasPerformanceFeedback?: boolean;
  roleGroups: ScheduleRoleGroup[];
}

export interface ScheduleRoleGroup {
  jobRole: JobRole;
  label: string;
  requiredCount: number;
  assignedCount: number;
  requestedCount?: number;
  uncoveredSlots?: number;
  requiredStrengthScore?: number;
  assignedStrengthScore?: number;
  meetsStrengthTarget?: boolean;
  postedMissingSlots?: PostedMissingSlot[];
  assignedWorkers: ScheduleWorker[];
}

export interface PostedMissingSlot {
  slotId: number;
  slotIndex: number;
  postedAt: string | null;
}

export interface AvailableMissingShiftSlot {
  slotId: number;
  scheduleId: number;
  shiftId: number;
  shiftDate: string;
  dayName: string;
  shiftType: ScheduleShiftType;
  weekStartDate: string;
  jobRole: JobRole;
  roleLabel: string;
  slotIndex: number;
  postedAt: string | null;
}

export interface AvailableMissingShiftSlotsResponse {
  weekStartDate: string;
  availableSlots: AvailableMissingShiftSlot[];
}

export interface FillMissingShiftSlotResponse {
  message: string;
  filledSlot: {
    scheduleId: number;
    weekStartDate: string;
    shiftId: number;
    jobRole: JobRole;
    slotId: number;
  };
}

export interface ScheduleWorker {
  employeeId: number;
  fullName: string;
  jobRole: JobRole;
  phoneNumber?: string | null;
  strengthScore?: number;
  assignedShiftCount?: number;
  requestedShiftCount?: number;
  targetShiftCount?: number;
}

export interface SaveScheduleAssignment {
  shiftId: number;
  employeeId: number;
  jobRole: JobRole;
}

export interface ShiftRequirementsUpdate {
  shiftId: number;
  requiredWaiters: number;
  requiredBartenders: number;
  requiredShiftLeaders: number;
  requiredStrengthScore: number;
}

export interface FinishShiftFeedback {
  actualCustomers: number | null;
  actualWaitersNeeded: number | null;
  managerRating: number | null;
}

export interface ShiftMlPrediction {
  shiftId: number;
  shiftDate: string;
  shiftType: ScheduleShiftType;
  currentWaiters: number;
  currentStrengthScore: number;
  recommendedWaiters: number | null;
  recommendedStrengthScore: number | null;
  modelVersion: string | null;
  createdAt: string | null;
}

export interface MlPredictionsResponse {
  message?: string;
  weekStartDate: string;
  weekEndDate: string;
  predictions: ShiftMlPrediction[];
}

export interface ScheduleValidationResponse {
  message: string;
  status: ScheduleValidationStatus;
  recommendation: string;
  summary: ScheduleValidationSummary;
  coverageIssues: ScheduleCoverageIssue[];
  strengthIssues: ScheduleStrengthIssue[];
  availabilityIssues: ScheduleAssignmentIssue[];
  invalidAssignments: ScheduleAssignmentIssue[];
  fairnessWarnings: ScheduleFairnessWarning[];
  warnings: ScheduleValidationIssue[];
  legacySummary?: ScheduleSummary;
}

export type ScheduleValidationStatus = 'ready_to_save' | 'ready_with_warnings' | 'needs_fixes';
export type ScheduleIssueSeverity = 'error' | 'warning';

export interface ScheduleValidationSummary extends ScheduleSummary {
  totalAssignments: number;
  assignedShifts: number;
  shiftsWithCoverageIssues: number;
  shiftsWithStrengthIssues: number;
  belowStrengthRoleGroups: number;
  uniqueAssignedEmployees: number;
  unsavedChanges: number;
}

export interface ScheduleCoverageIssue {
  severity: ScheduleIssueSeverity;
  type: string;
  shiftId: number;
  date?: string;
  dayName?: string;
  shiftType?: ScheduleShiftType;
  jobRole: JobRole;
  roleLabel?: string;
  requiredCount: number;
  assignedCount: number;
  missingCount: number;
  message: string;
}

export interface ScheduleStrengthIssue {
  severity: ScheduleIssueSeverity;
  type: string;
  shiftId: number;
  date?: string;
  dayName?: string;
  shiftType?: ScheduleShiftType;
  jobRole: JobRole;
  roleLabel?: string;
  requiredStrengthScore: number;
  assignedStrengthScore: number;
  deficit: number;
  message: string;
}

export interface ScheduleAssignmentIssue {
  severity: ScheduleIssueSeverity;
  type: string;
  shiftId: number;
  date?: string;
  dayName?: string;
  shiftType?: ScheduleShiftType;
  employeeId: number;
  employeeName: string;
  jobRole: JobRole;
  roleLabel?: string;
  actualRole?: string;
  message: string;
}

export interface ScheduleFairnessWarning {
  severity: ScheduleIssueSeverity;
  type: string;
  employeeId: number;
  employeeName: string;
  requestedShifts: number;
  assignedShifts: number;
  targetShifts: number;
  gap: number;
  message: string;
}

export type ScheduleValidationIssue =
  | ScheduleCoverageIssue
  | ScheduleStrengthIssue
  | ScheduleAssignmentIssue
  | ScheduleFairnessWarning;

export interface ScheduleImprovementSummary {
  enabled: boolean;
  phase?: string;
  maxIterations?: number;
  iterationsRun?: number;
  stopReason?: string;
  rejectedRepeatedStateCandidatesCount?: number;
  acceptedChangesCount?: number;
  acceptedChanges?: unknown[];
  iterationHistory?: unknown[];
  initialScore?: number;
  finalScore?: number;
  scoreImprovement?: number;
  initialCoveragePenalty?: number;
  finalCoveragePenalty?: number;
  initialStrengthPenalty?: number;
  finalStrengthPenalty?: number;
  initialFairnessPenalty?: number;
  finalFairnessPenalty?: number;
  replaceCandidatesCount?: number;
  validReplaceCandidatesCount?: number;
  swapCandidatesCount?: number;
  validSwapCandidatesCount?: number;
  failed?: boolean;
  error?: string;
}

export interface ScheduleAssignmentWarning {
  type: string;
  shiftId: number;
  employeeId: number;
  jobRole: JobRole;
  message: string;
}

export type JobRole = 'waiter' | 'bartender' | 'shift_leader' | 'manager';
export type ScheduleShiftType = 'morning' | 'evening';
