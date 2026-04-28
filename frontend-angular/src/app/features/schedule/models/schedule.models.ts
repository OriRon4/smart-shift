export interface ScheduleBoardResponse {
  message: string;
  weekStartDate: string;
  weekEndDate: string;
  generatedAt: string;
  summary: ScheduleSummary;
  days: ScheduleDay[];
}

export interface ScheduleSummary {
  totalShifts: number;
  fullyCoveredShifts: number;
  underCoveredShifts: number;
  meetsStrengthTargetShifts: number;
  belowStrengthTargetShifts: number;
}

export interface ScheduleDay {
  date: string;
  dayName: string;
  shifts: ScheduleShift[];
}

export interface ScheduleShift {
  shiftId: number;
  shiftType: ScheduleShiftType;
  requiredWaiters: number;
  assignedCount: number;
  requestedCount: number;
  uncoveredSlots: number;
  requiredStrengthScore: number;
  assignedStrengthScore: number;
  meetsStrengthTarget: boolean;
  assignedWorkers: ScheduleWorker[];
}

export interface ScheduleWorker {
  employeeId: number;
  fullName: string;
  role: string;
  strengthScore: number;
  assignedShiftCount: number;
  requestedShiftCount: number;
}

export type ScheduleShiftType = 'morning' | 'evening';
