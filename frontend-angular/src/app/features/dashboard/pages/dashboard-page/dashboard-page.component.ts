import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../../../core/auth/auth.service';
import { PermissionService } from '../../../../core/permissions/permission.service';
import { AvailabilityApiService } from '../../../availability/services/availability-api.service';
import { AvailabilitySubmission } from '../../../availability/models/availability.models';
import { Employee } from '../../../employees/models/employee.models';
import { EmployeesApiService } from '../../../employees/services/employees-api.service';
import {
  ScheduleBoardResponse,
  ScheduleRoleGroup,
  ScheduleShift
} from '../../../schedule/models/schedule.models';
import { ScheduleApiService } from '../../../schedule/services/schedule-api.service';

interface PersonalShift {
  date: string;
  dayName: string;
  shiftType: string;
  roleLabel: string;
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    RouterLink
  ],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css'
})
export class DashboardPageComponent implements OnInit {
  protected readonly selectedWeekStartDate = '2026-04-19';
  protected readonly currentUser = this.authService.currentUser;
  protected board: ScheduleBoardResponse | null = null;
  protected employees: Employee[] = [];
  protected availabilitySubmissions: AvailabilitySubmission[] = [];
  protected selectedAvailabilityCount = 0;
  protected isLoading = false;

  constructor(
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly scheduleApiService: ScheduleApiService,
    private readonly employeesApiService: EmployeesApiService,
    private readonly availabilityApiService: AvailabilityApiService
  ) {}

  ngOnInit(): void {
    this.isLoading = true;

    this.scheduleApiService.getSchedule(this.selectedWeekStartDate).subscribe({
      next: (board) => {
        this.board = board.days.length ? board : null;
        this.isLoading = false;
      },
      error: () => {
        this.board = null;
        this.isLoading = false;
      }
    });

    if (this.isManager() || this.isShiftLeader()) {
      this.employeesApiService.getEmployees().subscribe({
        next: (response) => {
          this.employees = response.employees;
        }
      });
    }

    if (this.isManager()) {
      this.availabilityApiService
        .getAllAvailability(this.selectedWeekStartDate)
        .subscribe({
          next: (availability) => {
            this.availabilitySubmissions = availability.submissions;
          }
        });
    }

    this.availabilityApiService
      .getMyAvailability(this.selectedWeekStartDate)
      .subscribe({
        next: (availability) => {
          this.selectedAvailabilityCount = availability.selectedShiftIds.length;
        }
      });
  }

  protected isManager(): boolean {
    return this.permissionService.isManager(this.currentUser());
  }

  protected isShiftLeader(): boolean {
    return this.permissionService.isShiftLeader(this.currentUser());
  }

  protected get dashboardTitle(): string {
    if (this.isManager()) {
      return 'Manager Dashboard';
    }

    if (this.isShiftLeader()) {
      return 'Shift Manager Dashboard';
    }

    return 'My Week';
  }

  protected get activeEmployeeCount(): number {
    return this.employees.filter((employee) => employee.isActive).length;
  }

  protected get totalAssignments(): number {
    return this.getAllRoleGroups().reduce(
      (total, roleGroup) => total + roleGroup.assignedCount,
      0
    );
  }

  protected get openRoleGroups(): number {
    return this.getAllRoleGroups().filter(
      (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
    ).length;
  }

  protected get totalRequiredSlots(): number {
    return this.board?.summary?.totalRoleRequirements || 0;
  }

  protected get coveragePercent(): number {
    if (!this.totalRequiredSlots) {
      return 0;
    }

    return Math.round((this.totalAssignments / this.totalRequiredSlots) * 100);
  }

  protected get unfilledSlots(): number {
    return this.getAllRoleGroups().reduce(
      (total, roleGroup) => total + (roleGroup.uncoveredSlots || 0),
      0
    );
  }

  protected get strengthRiskGroups(): number {
    return this.board?.summary?.belowStrengthTargetRoleGroups || 0;
  }

  protected get availabilitySubmissionCount(): number {
    return this.availabilitySubmissions.filter(
      (submission) => submission.shiftIds.length > 0
    ).length;
  }

  protected get availabilityShiftCount(): number {
    return this.availabilitySubmissions.reduce(
      (total, submission) => total + submission.shiftIds.length,
      0
    );
  }

  protected get waiterCount(): number {
    return this.countActiveEmployeesByRole('waiter');
  }

  protected get bartenderCount(): number {
    return this.countActiveEmployeesByRole('bartender');
  }

  protected get shiftLeaderCount(): number {
    return this.countActiveEmployeesByRole('shift_leader');
  }

  protected get managerAlerts(): string[] {
    const alerts: string[] = [];

    if (!this.board) {
      alerts.push('No schedule is published for the selected week.');
      return alerts;
    }

    if (this.unfilledSlots > 0) {
      alerts.push(`${this.unfilledSlots} required slots are still unfilled.`);
    }

    if (this.strengthRiskGroups > 0) {
      alerts.push(`${this.strengthRiskGroups} role groups are below strength target.`);
    }

    if (this.availabilitySubmissionCount < this.activeEmployeeCount) {
      alerts.push(`${this.activeEmployeeCount - this.availabilitySubmissionCount} active employees have not submitted availability.`);
    }

    return alerts.length ? alerts : ['Schedule coverage and availability look healthy.'];
  }

  protected get myShifts(): PersonalShift[] {
    const employeeId = this.currentUser()?.employeeId;

    if (!employeeId || !this.board) {
      return [];
    }

    return this.board.days.flatMap((day) =>
      day.shifts.flatMap((shift) =>
        shift.roleGroups
          .filter((roleGroup) =>
            roleGroup.assignedWorkers.some(
              (worker) => worker.employeeId === employeeId
            )
          )
          .map((roleGroup) => ({
            date: day.date,
            dayName: day.dayName,
            shiftType: this.formatShiftType(shift),
            roleLabel: roleGroup.label
          }))
      )
    );
  }

  protected get roleCoverageLabel(): string {
    if (!this.board?.summary) {
      return 'No published schedule';
    }

    return `${this.board.summary.fullyCoveredRoleGroups}/${this.board.summary.totalShifts * 3}`;
  }

  protected get nextPersonalShift(): PersonalShift | null {
    return this.myShifts[0] || null;
  }

  private getAllRoleGroups(): ScheduleRoleGroup[] {
    if (!this.board) {
      return [];
    }

    return this.board.days.flatMap((day) =>
      day.shifts.flatMap((shift) => shift.roleGroups)
    );
  }

  private countActiveEmployeesByRole(jobRole: string): number {
    return this.employees.filter(
      (employee) => employee.isActive && employee.jobRole === jobRole
    ).length;
  }

  private formatShiftType(shift: ScheduleShift): string {
    return shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1);
  }
}
