import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  AvailableMissingShiftSlotsResponse,
  FillMissingShiftSlotResponse,
  FinishShiftFeedback,
  JobRole,
  SaveScheduleAssignment,
  ScheduleBoardResponse,
  ScheduleValidationResponse,
  ShiftRequirementsUpdate
} from '../models/schedule.models';

@Injectable({
  providedIn: 'root'
})
export class ScheduleApiService {
  // כתובת הבסיס לכל קריאות ה-schedule בשרת.
  private readonly apiUrl = `${environment.apiBaseUrl}/schedules`;

  // HttpClient מבצע את קריאות ה-HTTP בפועל.
  constructor(private readonly http: HttpClient) {}

  // מביא סידור קיים לשבוע; לא יוצר שיבוצים חדשים.
  getSchedule(weekStartDate: string): Observable<ScheduleBoardResponse> {
    // weekStartDate נשלח כ-query param אל GET /api/schedules.
    const params = new HttpParams().set('weekStartDate', weekStartDate);
    return this.http.get<ScheduleBoardResponse>(this.apiUrl, { params });
  }
  
  // יוצר סידור לשבוע: הקומפוננטה עושה subscribe לתוצאה.
  generateSchedule(weekStartDate: string): Observable<ScheduleBoardResponse> {
    // נשלח POST אל /api/schedules/generate עם weekStartDate בלבד.
    return this.http.post<ScheduleBoardResponse>(`${this.apiUrl}/generate`, {
      weekStartDate
    });
  }

  saveAssignments(
    scheduleId: number,
    weekStartDate: string,
    assignments: SaveScheduleAssignment[],
    overrideWarnings = false
  ): Observable<ScheduleBoardResponse> {
    return this.http.patch<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/assignments`,
      {
        weekStartDate,
        assignments,
        overrideWarnings
      }
    );
  }

  validateSchedule(
    scheduleId: number,
    weekStartDate: string,
    assignments?: SaveScheduleAssignment[],
    hasUnsavedChanges = false
  ): Observable<ScheduleValidationResponse> {
    // שולח בדיקת סידור ל-/validate ומחזיר דוח בעיות/אזהרות.
    return this.http.post<ScheduleValidationResponse>(
      `${this.apiUrl}/${scheduleId}/validate`,
      {
        weekStartDate,
        assignments,
        hasUnsavedChanges
      }
    );
  }

  clearScheduleAssignments(scheduleId: number): Observable<ScheduleBoardResponse> {
    return this.http.delete<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/assignments`
    );
  }

  publishSchedule(scheduleId: number): Observable<ScheduleBoardResponse> {
    // מפרסם סידור קיים: השרת מעדכן published_at.
    return this.http.post<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/publish`,
      {}
    );
  }

  unpublishSchedule(scheduleId: number): Observable<ScheduleBoardResponse> {
    // מבטל פרסום סידור קיים: השרת מאפס published_at.
    return this.http.delete<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/publish`
    );
  }

  updateShiftRequiredStrength(
    shiftId: number,
    requiredStrengthScore: number
  ): Observable<ScheduleBoardResponse> {
    return this.http.patch<ScheduleBoardResponse>(
      `${this.apiUrl}/shifts/${shiftId}/required-strength`,
      { requiredStrengthScore }
    );
  }

  updateShiftRequirements(
    requirements: ShiftRequirementsUpdate
  ): Observable<ScheduleBoardResponse> {
    return this.http.patch<ScheduleBoardResponse>(
      `${this.apiUrl}/shifts/${requirements.shiftId}/requirements`,
      requirements
    );
  }

  finishShift(
    shiftId: number,
    feedback: FinishShiftFeedback
  ): Observable<ScheduleBoardResponse> {
    return this.http.post<ScheduleBoardResponse>(
      `${this.apiUrl}/shifts/${shiftId}/finish`,
      feedback
    );
  }

  postMissingShiftSlot(
    scheduleId: number,
    shiftId: number,
    jobRole: JobRole,
    slotIndex: number
  ): Observable<ScheduleBoardResponse> {
    return this.http.post<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/missing-slots`,
      {
        shiftId,
        jobRole,
        slotIndex
      }
    );
  }

  unpostMissingShiftSlot(
    scheduleId: number,
    shiftId: number,
    jobRole: JobRole,
    slotIndex: number
  ): Observable<ScheduleBoardResponse> {
    return this.http.delete<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/missing-slots`,
      {
        body: {
          shiftId,
          jobRole,
          slotIndex
        }
      }
    );
  }

  getAvailableMissingShiftSlots(
    weekStartDate: string
  ): Observable<AvailableMissingShiftSlotsResponse> {
    const params = new HttpParams().set('weekStartDate', weekStartDate);
    return this.http.get<AvailableMissingShiftSlotsResponse>(
      `${this.apiUrl}/missing-slots/available`,
      { params }
    );
  }

  fillMissingShiftSlot(slotId: number): Observable<FillMissingShiftSlotResponse> {
    return this.http.post<FillMissingShiftSlotResponse>(
      `${this.apiUrl}/missing-slots/${slotId}/fill`,
      {}
    );
  }
}
