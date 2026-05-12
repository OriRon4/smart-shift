import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  AllAvailabilityResponse,
  AvailabilityResponse
} from '../models/availability.models';

@Injectable({
  providedIn: 'root'
})
export class AvailabilityApiService {
  private readonly apiUrl = 'http://localhost:3000/api/availability';

  constructor(private readonly http: HttpClient) {}

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
