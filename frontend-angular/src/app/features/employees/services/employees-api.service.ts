import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../environments/environment';
import { Employee, EmployeeResponse, EmployeesResponse } from '../models/employee.models';

@Injectable({
  providedIn: 'root'
})
export class EmployeesApiService {
  private readonly apiUrl = `${environment.apiBaseUrl}/employees`;

  constructor(private readonly http: HttpClient) {}

  getEmployees(): Observable<EmployeesResponse> {
    return this.http.get<EmployeesResponse>(this.apiUrl).pipe(
      map((response) => ({
        employees: response.employees.map((employee) =>
          this.normalizeEmployee(employee)
        )
      }))
    );
  }

  getEmployee(employeeId: number): Observable<EmployeeResponse> {
    return this.http.get<EmployeeResponse>(`${this.apiUrl}/${employeeId}`).pipe(
      map((response) => ({
        employee: this.normalizeEmployee(response.employee)
      }))
    );
  }

  updateEmployee(employee: Employee): Observable<EmployeeResponse> {
    return this.http
      .patch<EmployeeResponse>(`${this.apiUrl}/${employee.id}`, {
        ...employee,
        phoneNumber: employee.phoneNumber || employee.phone_number || '',
        phone_number: employee.phoneNumber || employee.phone_number || ''
      })
      .pipe(
        map((response) => ({
          employee: this.normalizeEmployee(response.employee)
        }))
      );
  }

  deleteEmployee(employeeId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${employeeId}`);
  }

  private normalizeEmployee(employee: Employee): Employee {
    const jobRole =
      employee.jobRole || (employee.role === 'employee' ? undefined : employee.role);
    const phoneNumber = employee.phoneNumber || employee.phone_number || '';

    return {
      ...employee,
      phoneNumber,
      phone_number: phoneNumber,
      jobRole: jobRole as Employee['jobRole'],
      role: jobRole
    };
  }
}
