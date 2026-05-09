import { JobRole } from '../../schedule/models/schedule.models';

export interface Employee {
  id: number;
  fullName: string;
  jobRole?: JobRole;
  isActive?: boolean;
  professionalism?: number;
  responsibility?: number;
  pressureHandling?: number;
  seniorityMonths?: number;
  potential?: number;
}

export interface EmployeesResponse {
  employees: Employee[];
}

export interface EmployeeResponse {
  employee: Employee;
}
