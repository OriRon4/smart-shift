export interface ScheduleBoardResponse {
  // תגובת הלוח הראשית שמוצגת במסך הסידור.
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
  // כרטיס משמרת בוקר או ערב בתוך עמודת יום.
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
  // שורת עובד משובץ בתוך כרטיס משמרת.
  employeeId: number;
  fullName: string;
  role: string;
  strengthScore: number;
  assignedShiftCount: number;
  requestedShiftCount: number;
}

export type ScheduleShiftType = 'morning' | 'evening';
