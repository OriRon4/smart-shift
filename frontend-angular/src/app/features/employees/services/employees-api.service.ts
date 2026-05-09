import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { Employee, EmployeeResponse, EmployeesResponse } from '../models/employee.models';

@Injectable({
  providedIn: 'root'
})
export class EmployeesApiService {
  private readonly apiUrl = 'http://localhost:3000/api/employees';

  constructor(private readonly http: HttpClient) {}

  getEmployees(): Observable<EmployeesResponse> {
    return this.http.get<EmployeesResponse>(this.apiUrl);
  }

  getEmployee(employeeId: number): Observable<EmployeeResponse> {
    return this.http.get<EmployeeResponse>(`${this.apiUrl}/${employeeId}`);
  }

  updateEmployee(employee: Employee): Observable<EmployeeResponse> {
    return this.http.patch<EmployeeResponse>(`${this.apiUrl}/${employee.id}`, employee);
  }
}
