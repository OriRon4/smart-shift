import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ScheduleBoardResponse } from '../models/schedule.models';

@Injectable({
  providedIn: 'root'
})
export class ScheduleApiService {
  // בגרסה הראשונה הפרונט פונה ישירות לשרת המקומי.
  private readonly apiUrl = 'http://localhost:3000/api/schedules';

  constructor(private readonly http: HttpClient) {}

  generateSchedule(weekStartDate: string): Observable<ScheduleBoardResponse> {
    return this.http.post<ScheduleBoardResponse>(`${this.apiUrl}/generate`, {
      weekStartDate
    });
  }
}
