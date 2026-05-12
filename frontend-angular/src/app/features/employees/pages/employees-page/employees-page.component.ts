import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { AuthService } from '../../../../core/auth/auth.service';
import { PermissionService } from '../../../../core/permissions/permission.service';
import { AvailabilityResponse } from '../../../availability/models/availability.models';
import { AvailabilityApiService } from '../../../availability/services/availability-api.service';
import { Employee } from '../../models/employee.models';
import { EmployeesApiService } from '../../services/employees-api.service';

@Component({
  selector: 'app-employees-page',
  standalone: true,
  templateUrl: './employees-page.component.html',
  styleUrl: './employees-page.component.css'
})
export class EmployeesPageComponent implements OnInit {
  protected employees: Employee[] = [];
  protected selectedEmployee: Employee | null = null;
  protected editableEmployee: Employee | null = null;
  protected isLoading = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected availabilityWeekStartDate = '2026-04-19';
  protected employeeAvailability: AvailabilityResponse | null = null;
  protected selectedAvailabilityShiftIds = new Set<number>();
  protected isAvailabilityLoading = false;
  protected readonly currentUser = this.authService.currentUser;

  protected readonly jobRoles = [
    'waiter',
    'bartender',
    'shift_leader',
    'manager'
  ];

  constructor(
    private readonly employeesApiService: EmployeesApiService,
    private readonly availabilityApiService: AvailabilityApiService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
  }

  protected canViewDetails(): boolean {
    return this.permissionService.canViewEmployeeDetails(this.currentUser());
  }

  protected canEdit(): boolean {
    return this.permissionService.canEditEmployees(this.currentUser());
  }

  protected needsManagerSetup(employee: Employee | null): boolean {
    if (!employee || employee.jobRole === 'manager') {
      return false;
    }

    return (
      (employee.professionalism || 0) === 0 &&
      (employee.responsibility || 0) === 0 &&
      (employee.pressureHandling || 0) === 0 &&
      (employee.potential || 0) === 0 &&
      (employee.seniorityMonths || 0) === 0
    );
  }

  protected formatJobRole(jobRole: string | undefined): string {
    if (!jobRole) {
      return 'Employee';
    }

    if (jobRole === 'shift_leader') {
      return 'Shift manager';
    }

    return jobRole.replace('_', ' ');
  }

  protected loadEmployees(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.employeesApiService.getEmployees().subscribe({
      next: (response) => {
        this.employees = response.employees;
        this.isLoading = false;
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }

  protected openEmployee(employee: Employee): void {
    if (!this.canViewDetails()) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.employeesApiService.getEmployee(employee.id).subscribe({
      next: (response) => {
        this.selectedEmployee = response.employee;
        this.editableEmployee = { ...response.employee };
        this.isLoading = false;

        if (this.canEdit()) {
          this.loadEmployeeAvailability();
        }
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }

  protected saveEmployee(): void {
    if (!this.editableEmployee || !this.canEdit()) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.employeesApiService.updateEmployee(this.editableEmployee).subscribe({
      next: (response) => {
        this.selectedEmployee = response.employee;
        this.editableEmployee = { ...response.employee };
        this.successMessage = 'Employee saved.';
        this.loadEmployees();
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }

  protected deactivateEmployee(): void {
    if (!this.editableEmployee || !this.canEdit()) {
      return;
    }

    const confirmed = window.confirm(
      'Are you sure you want to deactivate this employee?\nThis employee will no longer be available for future schedules.'
    );

    if (!confirmed) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.employeesApiService
      .deactivateEmployee(this.editableEmployee.id)
      .subscribe({
        next: (response) => {
          this.selectedEmployee = response.employee;
          this.editableEmployee = { ...response.employee };
          this.successMessage = 'Employee deactivated.';
          this.loadEmployees();
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected updateStringField(
    fieldName: 'fullName' | 'jobRole',
    event: Event
  ): void {
    if (!this.editableEmployee) {
      return;
    }

    this.editableEmployee = {
      ...this.editableEmployee,
      [fieldName]: (event.target as HTMLInputElement | HTMLSelectElement).value
    };
  }

  protected updateNumberField(
    fieldName:
      | 'professionalism'
      | 'responsibility'
      | 'pressureHandling'
      | 'seniorityMonths'
      | 'potential',
    event: Event
  ): void {
    if (!this.editableEmployee) {
      return;
    }

    this.editableEmployee = {
      ...this.editableEmployee,
      [fieldName]: Number((event.target as HTMLInputElement).value)
    };
  }

  protected updateActive(event: Event): void {
    if (!this.editableEmployee) {
      return;
    }

    this.editableEmployee = {
      ...this.editableEmployee,
      isActive: (event.target as HTMLInputElement).checked
    };
  }

  protected previousAvailabilityWeek(): void {
    this.availabilityWeekStartDate = this.addDays(
      this.availabilityWeekStartDate,
      -7
    );
    this.loadEmployeeAvailability();
  }

  protected nextAvailabilityWeek(): void {
    this.availabilityWeekStartDate = this.addDays(
      this.availabilityWeekStartDate,
      7
    );
    this.loadEmployeeAvailability();
  }

  protected isEmployeeAvailabilitySelected(shiftId: number): boolean {
    return this.selectedAvailabilityShiftIds.has(shiftId);
  }

  protected toggleEmployeeAvailabilityShift(shiftId: number): void {
    const updatedShiftIds = new Set(this.selectedAvailabilityShiftIds);

    if (updatedShiftIds.has(shiftId)) {
      updatedShiftIds.delete(shiftId);
    } else {
      updatedShiftIds.add(shiftId);
    }

    this.selectedAvailabilityShiftIds = updatedShiftIds;
  }

  protected saveEmployeeAvailability(): void {
    if (!this.editableEmployee || !this.canEdit()) {
      return;
    }

    this.isAvailabilityLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.availabilityApiService
      .updateEmployeeAvailability(
        this.editableEmployee.id,
        this.availabilityWeekStartDate,
        [...this.selectedAvailabilityShiftIds]
      )
      .subscribe({
        next: (availability) => {
          this.employeeAvailability = availability;
          this.selectedAvailabilityShiftIds = new Set(
            availability.selectedShiftIds
          );
          this.successMessage = 'Employee availability saved.';
          this.isAvailabilityLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isAvailabilityLoading = false;
        }
      });
  }

  protected formatAvailabilityShiftType(shiftType: string): string {
    return shiftType.charAt(0).toUpperCase() + shiftType.slice(1);
  }

  private loadEmployeeAvailability(): void {
    if (!this.editableEmployee || !this.canEdit()) {
      this.employeeAvailability = null;
      this.selectedAvailabilityShiftIds = new Set();
      return;
    }

    this.isAvailabilityLoading = true;

    this.availabilityApiService
      .getEmployeeAvailability(
        this.editableEmployee.id,
        this.availabilityWeekStartDate
      )
      .subscribe({
        next: (availability) => {
          this.employeeAvailability = availability;
          this.selectedAvailabilityShiftIds = new Set(
            availability.selectedShiftIds
          );
          this.isAvailabilityLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.employeeAvailability = null;
          this.selectedAvailabilityShiftIds = new Set();
          this.isAvailabilityLoading = false;
        }
      });
  }

  private addDays(dateKey: string, dayOffset: number): string {
    const date = new Date(`${dateKey}T00:00:00`);
    date.setDate(date.getDate() + dayOffset);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.error?.message) {
      return error.error.message;
    }

    return 'Employee action failed. Check that the backend is running and try again.';
  }
}
