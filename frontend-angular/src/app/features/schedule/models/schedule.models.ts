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
  assignedWorkers: ScheduleWorker[];
}

export interface ScheduleWorker {
  employeeId: number;
  fullName: string;
  jobRole: JobRole;
  strengthScore?: number;
  assignedShiftCount?: number;
  requestedShiftCount?: number;
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

export interface ScheduleValidationResponse {
  message: string;
  warnings: ScheduleWarning[];
  summary: ScheduleSummary;
}

export interface ScheduleWarning {
  shiftId: number;
  jobRole: JobRole;
  uncoveredSlots: number;
  meetsStrengthTarget: boolean;
}

export type JobRole = 'waiter' | 'bartender' | 'shift_leader' | 'manager';
export type ScheduleShiftType = 'morning' | 'evening';
