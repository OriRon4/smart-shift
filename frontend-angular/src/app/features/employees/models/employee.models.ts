import { JobRole } from '../../schedule/models/schedule.models';

export interface Employee {
  id: number;
  fullName: string;
  phoneNumber?: string;
  phone_number?: string;
  email?: string | null;
  username?: string | null;
  jobRole?: JobRole;
  role?: string;
  isActive?: boolean;
  setupStatus?: 'pending' | 'complete';
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
