import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  MlPredictionsResponse,
  ScheduleBoardResponse
} from '../models/schedule.models';

@Injectable({
  providedIn: 'root'
})
export class MlRecommendationsApiService {
  private readonly apiUrl = `${environment.apiBaseUrl}/ml`;

  constructor(private readonly http: HttpClient) {}

  generateWeekPredictions(
    weekStartDate: string
  ): Observable<MlPredictionsResponse> {
    return this.http.post<MlPredictionsResponse>(
      `${this.apiUrl}/shift-requirements/predict-week`,
      { weekStartDate }
    );
  }

  getPredictions(weekStartDate: string): Observable<MlPredictionsResponse> {
    const params = new HttpParams().set('weekStartDate', weekStartDate);
    return this.http.get<MlPredictionsResponse>(
      `${this.apiUrl}/predictions`,
      { params }
    );
  }

  applyWeekPredictions(weekStartDate: string): Observable<ScheduleBoardResponse> {
    return this.http.post<ScheduleBoardResponse>(
      `${this.apiUrl}/predictions/apply-week`,
      { weekStartDate }
    );
  }
}
