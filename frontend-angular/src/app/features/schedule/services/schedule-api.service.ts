import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  SaveScheduleAssignment,
  ScheduleBoardResponse,
  ScheduleValidationResponse,
  ShiftRequirementsUpdate
} from '../models/schedule.models';

@Injectable({
  providedIn: 'root'
})
export class ScheduleApiService {
  private readonly apiUrl = `${environment.apiBaseUrl}/schedules`;

  constructor(private readonly http: HttpClient) {}

  getSchedule(weekStartDate: string): Observable<ScheduleBoardResponse> {
    const params = new HttpParams().set('weekStartDate', weekStartDate);
    return this.http.get<ScheduleBoardResponse>(this.apiUrl, { params });
  }

  generateSchedule(weekStartDate: string): Observable<ScheduleBoardResponse> {
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
    weekStartDate: string
  ): Observable<ScheduleValidationResponse> {
    return this.http.post<ScheduleValidationResponse>(
      `${this.apiUrl}/${scheduleId}/validate`,
      {
        weekStartDate
      }
    );
  }

  clearScheduleAssignments(scheduleId: number): Observable<ScheduleBoardResponse> {
    return this.http.delete<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/assignments`
    );
  }

  publishSchedule(scheduleId: number): Observable<ScheduleBoardResponse> {
    return this.http.post<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/publish`,
      {}
    );
  }

  unpublishSchedule(scheduleId: number): Observable<ScheduleBoardResponse> {
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
}
