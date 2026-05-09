import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import {
  ReplaceAssignmentRequest,
  ScheduleGridComponent
} from '../../components/schedule-grid/schedule-grid.component';
import { WeekSelectorComponent } from '../../components/week-selector/week-selector.component';
import {
  JobRole,
  SaveScheduleAssignment,
  ScheduleBoardResponse,
  ScheduleValidationResponse
} from '../../models/schedule.models';
import { ScheduleApiService } from '../../services/schedule-api.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { PermissionService } from '../../../../core/permissions/permission.service';
import { Employee } from '../../../employees/models/employee.models';
import { EmployeesApiService } from '../../../employees/services/employees-api.service';

@Component({
  selector: 'app-schedule-board',
  standalone: true,
  imports: [
    ScheduleGridComponent,
    WeekSelectorComponent
  ],
  templateUrl: './schedule-board.component.html',
  styleUrl: './schedule-board.component.css'
})
export class ScheduleBoardComponent implements OnInit {
  protected selectedWeekStartDate = '2026-04-19';
  protected board: ScheduleBoardResponse | null = null;
  protected employees: Employee[] = [];
  protected pendingReplacement: ReplaceAssignmentRequest | null = null;
  protected selectedReplacementEmployeeId: number | null = null;
  protected validationResult: ScheduleValidationResponse | null = null;
  protected isLoading = false;
  protected errorMessage = '';
  protected successMessage = '';

  protected readonly currentUser = this.authService.currentUser;

  constructor(
    private readonly scheduleApiService: ScheduleApiService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly employeesApiService: EmployeesApiService
  ) {}

  ngOnInit(): void {
    this.loadSchedule();

    if (this.canManageSchedule()) {
      this.employeesApiService.getEmployees().subscribe({
        next: (response) => {
          this.employees = response.employees;
        }
      });
    }
  }

  protected get weekRangeLabel(): string {
    return `${this.formatDisplayDate(this.selectedWeekStartDate)} - ${this.formatDisplayDate(
      this.addDays(this.selectedWeekStartDate, 6)
    )}`;
  }

  protected canManageSchedule(): boolean {
    return this.permissionService.canManageSchedule(this.currentUser());
  }

  protected get totalAssignedEmployees(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.reduce(
          (shiftTotal, shift) =>
            shiftTotal +
            shift.roleGroups.reduce(
              (roleTotal, roleGroup) => roleTotal + roleGroup.assignedCount,
              0
            ),
          0
        ),
      0
    );
  }

  protected get unfilledSlots(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.reduce(
          (shiftTotal, shift) =>
            shiftTotal +
            shift.roleGroups.reduce(
              (roleTotal, roleGroup) => roleTotal + (roleGroup.uncoveredSlots || 0),
              0
            ),
          0
        ),
      0
    );
  }

  protected get coveragePercent(): number {
    const required = this.board?.summary?.totalRoleRequirements || 0;

    if (!required) {
      return 0;
    }

    return Math.round((this.totalAssignedEmployees / required) * 100);
  }

  protected get strengthRiskGroups(): number {
    return this.board?.summary?.belowStrengthTargetRoleGroups || 0;
  }

  protected get belowStrengthShiftCount(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.filter((shift) =>
          shift.roleGroups.some(
            (roleGroup) => roleGroup.meetsStrengthTarget === false
          )
        ).length,
      0
    );
  }

  protected previousWeek(): void {
    this.changeSelectedWeek(-7);
  }

  protected nextWeek(): void {
    this.changeSelectedWeek(7);
  }

  protected loadSchedule(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.validationResult = null;
    this.pendingReplacement = null;

    this.scheduleApiService.getSchedule(this.selectedWeekStartDate).subscribe({
      next: (board) => {
        this.board = board.days.length ? board : null;
        this.isLoading = false;
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }

  protected generateSchedule(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.validationResult = null;

    this.scheduleApiService
      .generateSchedule(this.selectedWeekStartDate)
      .subscribe({
        next: (board) => {
          this.board = board;
          this.successMessage = 'Schedule generated.';
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected openReplacement(request: ReplaceAssignmentRequest): void {
    if (!this.canManageSchedule()) {
      return;
    }

    this.pendingReplacement = request;
    this.selectedReplacementEmployeeId = null;
  }

  protected getReplacementCandidates(): Employee[] {
    const pendingReplacement = this.pendingReplacement;

    if (!pendingReplacement) {
      return [];
    }

    return this.employees.filter(
      (employee) =>
        employee.isActive &&
        employee.jobRole === pendingReplacement.jobRole &&
        employee.id !== pendingReplacement.employeeId
    );
  }

  protected updateSelectedReplacement(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedReplacementEmployeeId = value ? Number(value) : null;
  }

  protected applyReplacement(): void {
    if (!this.board || !this.pendingReplacement || !this.selectedReplacementEmployeeId) {
      return;
    }

    const replacementEmployee = this.employees.find(
      (employee) => employee.id === Number(this.selectedReplacementEmployeeId)
    );

    if (!replacementEmployee) {
      return;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        if (shift.shiftId !== this.pendingReplacement.shiftId) {
          continue;
        }

        const roleGroup = shift.roleGroups.find(
          (group) => group.jobRole === this.pendingReplacement?.jobRole
        );
        const worker = roleGroup?.assignedWorkers.find(
          (assignedWorker) =>
            assignedWorker.employeeId === this.pendingReplacement?.employeeId
        );

        if (worker) {
          worker.employeeId = replacementEmployee.id;
          worker.fullName = replacementEmployee.fullName;
          worker.jobRole = replacementEmployee.jobRole as JobRole;
        }
      }
    }

    this.successMessage = 'Replacement staged. Save changes to persist it.';
    this.pendingReplacement = null;
    this.selectedReplacementEmployeeId = null;
  }

  protected saveChanges(): void {
    if (!this.board?.scheduleId) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.scheduleApiService
      .saveAssignments(
        this.board.scheduleId,
        this.selectedWeekStartDate,
        this.flattenAssignments(this.board)
      )
      .subscribe({
        next: (board) => {
          this.board = board;
          this.successMessage = 'Schedule changes saved.';
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected validateSchedule(): void {
    if (!this.board?.scheduleId) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.scheduleApiService
      .validateSchedule(this.board.scheduleId, this.selectedWeekStartDate)
      .subscribe({
        next: (result) => {
          this.validationResult = result;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private flattenAssignments(board: ScheduleBoardResponse): SaveScheduleAssignment[] {
    return board.days.flatMap((day) =>
      day.shifts.flatMap((shift) =>
        shift.roleGroups.flatMap((roleGroup) =>
          roleGroup.assignedWorkers.map((worker) => ({
            shiftId: shift.shiftId,
            employeeId: worker.employeeId,
            jobRole: roleGroup.jobRole
          }))
        )
      )
    );
  }

  private changeSelectedWeek(dayOffset: number): void {
    this.selectedWeekStartDate = this.addDays(
      this.selectedWeekStartDate,
      dayOffset
    );
    this.loadSchedule();
  }

  private addDays(dateKey: string, dayOffset: number): string {
    const date = new Date(`${dateKey}T00:00:00`);
    date.setDate(date.getDate() + dayOffset);

    return this.formatDateKey(date);
  }

  private formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private formatDisplayDate(dateKey: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(`${dateKey}T00:00:00`));
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.error?.message) {
      return error.error.message;
    }

    return 'Schedule action failed. Check that the backend is running and try again.';
  }
}
