import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  SaveScheduleAssignment,
  ScheduleBoardResponse,
  ScheduleValidationResponse
} from '../models/schedule.models';

@Injectable({
  providedIn: 'root'
})
export class ScheduleApiService {
  private readonly apiUrl = 'http://localhost:3000/api/schedules';

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
    assignments: SaveScheduleAssignment[]
  ): Observable<ScheduleBoardResponse> {
    return this.http.patch<ScheduleBoardResponse>(
      `${this.apiUrl}/${scheduleId}/assignments`,
      {
        weekStartDate,
        assignments
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
}
