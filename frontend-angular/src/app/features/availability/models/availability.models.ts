import { ScheduleShiftType } from '../../schedule/models/schedule.models';

export interface AvailabilityResponse {
  message?: string;
  employeeId: number;
  weekStartDate: string;
  selectedShiftIds: number[];
  days: AvailabilityDay[];
}

export interface AllAvailabilityResponse {
  weekStartDate: string;
  submissions: AvailabilitySubmission[];
}

export interface AvailabilitySubmission {
  employeeId: number;
  fullName: string;
  jobRole: string;
  shiftIds: number[];
}

export interface AvailabilityDay {
  date: string;
  dayName: string;
  shifts: AvailabilityShift[];
}

export interface AvailabilityShift {
  shiftId: number;
  shiftType: ScheduleShiftType;
  selected: boolean;
}
