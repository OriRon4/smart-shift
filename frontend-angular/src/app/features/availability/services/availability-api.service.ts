import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  AllAvailabilityResponse,
  AvailabilityResponse
} from '../models/availability.models';

@Injectable({
  providedIn: 'root'
})
export class AvailabilityApiService {
  // כתובת הבסיס לכל קריאות הזמינות בשרת.
  private readonly apiUrl = `${environment.apiBaseUrl}/availability`;

  constructor(private readonly http: HttpClient) {}

  // טוען את הזמינות של המשתמש המחובר לשבוע מסוים.
  getMyAvailability(weekStartDate: string): Observable<AvailabilityResponse> {
    const params = new HttpParams().set('weekStartDate', weekStartDate);
    return this.http.get<AvailabilityResponse>(`${this.apiUrl}/me`, { params });
  }

  getAllAvailability(weekStartDate: string): Observable<AllAvailabilityResponse> {
    const params = new HttpParams().set('weekStartDate', weekStartDate);
    return this.http.get<AllAvailabilityResponse>(this.apiUrl, { params });
  }

  submitMyAvailability(
    weekStartDate: string,
    shiftIds: number[]
  ): Observable<AvailabilityResponse> {
    // POST אל /api/availability/me עם weekStartDate ו-shiftIds שנבחרו.
    return this.http.post<AvailabilityResponse>(`${this.apiUrl}/me`, {
      weekStartDate,
      shiftIds
    });
  }

  getEmployeeAvailability(
    employeeId: number,
    weekStartDate: string
  ): Observable<AvailabilityResponse> {
    const params = new HttpParams().set('weekStartDate', weekStartDate);
    return this.http.get<AvailabilityResponse>(
      `${this.apiUrl}/employees/${employeeId}`,
      { params }
    );
  }

  updateEmployeeAvailability(
    employeeId: number,
    weekStartDate: string,
    shiftIds: number[]
  ): Observable<AvailabilityResponse> {
    return this.http.put<AvailabilityResponse>(
      `${this.apiUrl}/employees/${employeeId}`,
      {
        weekStartDate,
        shiftIds
      }
    );
  }
}
