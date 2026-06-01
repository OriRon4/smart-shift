import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { AuthService } from '../../../../core/auth/auth.service';
import { PermissionService } from '../../../../core/permissions/permission.service';
import { AvailabilityResponse } from '../../../availability/models/availability.models';
import { AvailabilityApiService } from '../../../availability/services/availability-api.service';
import { Employee } from '../../models/employee.models';
import { EmployeesApiService } from '../../services/employees-api.service';
import {
  addDaysToDateKey,
  getCurrentWeekStartDate
} from '../../../../shared/date/week-date.util';

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
  protected availabilityWeekStartDate = getCurrentWeekStartDate();
  protected employeeAvailability: AvailabilityResponse | null = null;
  protected selectedAvailabilityShiftIds = new Set<number>();
  protected isAvailabilityLoading = false;
  protected isAvailabilityReviewOpen = false;
  protected isEmployeeSavedIndicator = false;
  protected isAvailabilitySavedIndicator = false;
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

  protected canShowStatusColumn(): boolean {
    return this.canEdit();
  }

  protected needsManagerSetup(employee: Employee | null): boolean {
    if (!employee || employee.jobRole === 'manager') {
      return false;
    }

    if (employee.setupStatus === 'pending') {
      return true;
    }

    return (
      (employee.professionalism || 0) === 0 &&
      (employee.responsibility || 0) === 0 &&
      (employee.pressureHandling || 0) === 0 &&
      (employee.potential || 0) === 0 &&
      (employee.seniorityMonths || 0) === 0
    );
  }

  protected shouldShowSetupStatus(employee: Employee | null): boolean {
    return this.canEdit() && this.needsManagerSetup(employee);
  }

  protected formatJobRole(jobRole: string | undefined): string {
    if (!jobRole || jobRole === 'employee') {
      return '-';
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
        this.employees = response.employees.map((employee) =>
          this.normalizeEmployee(employee)
        );
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
        this.selectedEmployee = this.normalizeEmployee(response.employee);
        this.editableEmployee = { ...this.selectedEmployee };
        this.isAvailabilityReviewOpen = false;
        this.employeeAvailability = null;
        this.selectedAvailabilityShiftIds = new Set();
        this.isLoading = false;
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
        this.selectedEmployee = this.normalizeEmployee(response.employee);
        this.editableEmployee = { ...this.selectedEmployee };
        this.showEmployeeSavedIndicator();
        this.successMessage = 'Employee saved.';
        this.loadEmployees();
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }

  protected updateStringField(
    fieldName: 'fullName' | 'phoneNumber' | 'jobRole',
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

  protected openAvailabilityReview(): void {
    if (!this.canEdit()) {
      return;
    }

    if (this.isAvailabilityReviewOpen) {
      this.closeAvailabilityReview();
      return;
    }

    this.isAvailabilityReviewOpen = true;
    this.loadEmployeeAvailability();
  }

  protected closeAvailabilityReview(): void {
    this.isAvailabilityReviewOpen = false;
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
          this.showAvailabilitySavedIndicator();
          this.successMessage = 'Employee availability saved.';
          this.isAvailabilityLoading = false;
          window.setTimeout(() => {
            this.isAvailabilityReviewOpen = false;
          }, 700);
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
    return addDaysToDateKey(dateKey, dayOffset);
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
      role: jobRole,
    };
  }

  protected get saveEmployeeButtonLabel(): string {
    return this.isEmployeeSavedIndicator ? 'Saved ✓' : 'Save employee';
  }

  protected get saveAvailabilityButtonLabel(): string {
    return this.isAvailabilitySavedIndicator ? 'Saved ✓' : 'Save availability';
  }

  protected get availabilityToggleButtonLabel(): string {
    if (this.isAvailabilitySavedIndicator) {
      return 'Saved ✓';
    }

    return this.isAvailabilityReviewOpen
      ? 'Close Availability'
      : 'Review Availability';
  }

  private showEmployeeSavedIndicator(): void {
    this.isEmployeeSavedIndicator = true;
    window.setTimeout(() => {
      this.isEmployeeSavedIndicator = false;
    }, 1600);
  }

  private showAvailabilitySavedIndicator(): void {
    this.isAvailabilitySavedIndicator = true;
    window.setTimeout(() => {
      this.isAvailabilitySavedIndicator = false;
    }, 1600);
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.error?.message) {
      return error.error.message;
    }

    return 'Employee action failed. Check that the backend is running and try again.';
  }
}
