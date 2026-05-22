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
  ScheduleDay,
  ScheduleRoleGroup,
  ScheduleShift
} from '../../../schedule/models/schedule.models';
import { ScheduleApiService } from '../../../schedule/services/schedule-api.service';
import { getCurrentWeekStartDate } from '../../../../shared/date/week-date.util';

interface PersonalShift {
  date: string;
  dayName: string;
  shiftType: string;
  roleLabel: string;
}

interface ManagerShiftMetric {
  shiftId: number;
  label: string;
  requiredWaiters: number;
  assignedWaiters: number;
  requiredStrength: number;
  assignedStrength: number;
  unfilledSlots: number;
  strengthGap: number;
}

interface EmployeeWorkloadMetric {
  employeeId: number;
  fullName: string;
  roleLabel: string;
  assigned: number;
  requested: number;
  target: number;
  gap: number;
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
  protected selectedWeekStartDate = getCurrentWeekStartDate();
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
    if (this.isManager() || this.isShiftLeader()) {
      this.employeesApiService.getEmployees().subscribe({
        next: (response) => {
          this.employees = response.employees;
        }
      });
    }

    this.loadDashboardWeek(this.selectedWeekStartDate);
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

  protected get totalShiftsThisWeek(): number {
    return this.getAllShifts().length;
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

  protected get coverageProblemShifts(): number {
    return this.managerShiftMetrics.filter(
      (shift) => shift.unfilledSlots > 0 || shift.strengthGap > 0
    ).length;
  }

  protected get missingCoverageShiftCount(): number {
    return this.managerShiftMetrics.filter((shift) => shift.unfilledSlots > 0).length;
  }

  protected get belowStrengthShiftCount(): number {
    return this.managerShiftMetrics.filter((shift) => shift.strengthGap >= 1).length;
  }

  protected get averageAssignedTeamStrength(): number {
    const metrics = this.managerShiftMetrics.filter(
      (shift) => shift.assignedStrength > 0
    );

    if (!metrics.length) {
      return 0;
    }

    const average =
      metrics.reduce((total, shift) => total + shift.assignedStrength, 0) /
      metrics.length;

    return Number(average.toFixed(1));
  }

  protected get employeesAssignedThisWeek(): number {
    const employeeIds = new Set<number>();

    for (const roleGroup of this.getAllRoleGroups()) {
      for (const worker of roleGroup.assignedWorkers) {
        employeeIds.add(worker.employeeId);
      }
    }

    return employeeIds.size;
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

  protected get managerShiftMetrics(): ManagerShiftMetric[] {
    if (!this.board) {
      return [];
    }

    return this.board.days.flatMap((day) =>
      day.shifts.map((shift) => this.buildManagerShiftMetric(day, shift))
    );
  }

  protected get shiftsNeedingAttention(): ManagerShiftMetric[] {
    return this.managerShiftMetrics.filter(
      (shift) => shift.unfilledSlots > 0 || shift.strengthGap > 0
    );
  }

  protected get hasManagerDashboardData(): boolean {
    return Boolean(this.board && this.managerShiftMetrics.length);
  }

  protected get coverageSummaryText(): string {
    if (!this.totalRequiredSlots) {
      return 'No required slots';
    }

    return `${this.totalAssignments}/${this.totalRequiredSlots} assigned`;
  }

  protected get employeeWorkloadMetrics(): EmployeeWorkloadMetric[] {
    const assignedCounts = this.getAssignedCountsByEmployee();
    const requestedCounts = new Map(
      this.availabilitySubmissions.map((submission) => [
        submission.employeeId,
        submission.shiftIds.length,
      ])
    );

    return this.employees
      .filter((employee) => employee.isActive !== false)
      .map((employee) => {
        const assigned = assignedCounts.get(employee.id) || 0;
        const requested = requestedCounts.get(employee.id) || 0;
        const target = this.calculateTargetShifts(employee, requested);

        return {
          employeeId: employee.id,
          fullName: employee.fullName,
          roleLabel: this.formatEmployeeRole(employee),
          assigned,
          requested,
          target,
          gap: Number((target - assigned).toFixed(1)),
        };
      })
      .filter((employee) => employee.assigned > 0 || employee.requested > 0)
      .sort(
        (left, right) =>
          right.gap - left.gap ||
          right.assigned - left.assigned ||
          left.fullName.localeCompare(right.fullName)
      );
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

  private getAllShifts(): ScheduleShift[] {
    if (!this.board) {
      return [];
    }

    return this.board.days.flatMap((day) => day.shifts);
  }

  private buildManagerShiftMetric(
    day: ScheduleDay,
    shift: ScheduleShift
  ): ManagerShiftMetric {
    const waiterGroup = this.getRoleGroup(shift, 'waiter');
    const assignedStrength = Number(
      shift.roleGroups
        .reduce(
          (total, roleGroup) => total + (roleGroup.assignedStrengthScore || 0),
          0
        )
        .toFixed(1)
    );
    const unfilledSlots = shift.roleGroups.reduce(
      (total, roleGroup) => total + (roleGroup.uncoveredSlots || 0),
      0
    );
    const requiredStrength = shift.requiredStrengthScore || 0;

    return {
      shiftId: shift.shiftId,
      label: `${day.dayName} ${this.formatShiftType(shift)}`,
      requiredWaiters: waiterGroup?.requiredCount || 0,
      assignedWaiters: waiterGroup?.assignedCount || 0,
      requiredStrength,
      assignedStrength,
      unfilledSlots,
      strengthGap: Number(Math.max(0, requiredStrength - assignedStrength).toFixed(1)),
    };
  }

  private getRoleGroup(
    shift: ScheduleShift,
    jobRole: string
  ): ScheduleRoleGroup | null {
    return (
      shift.roleGroups.find((roleGroup) => roleGroup.jobRole === jobRole) ||
      null
    );
  }

  private countActiveEmployeesByRole(jobRole: string): number {
    return this.employees.filter(
      (employee) => employee.isActive && employee.jobRole === jobRole
    ).length;
  }

  private getAssignedCountsByEmployee(): Map<number, number> {
    const assignedCounts = new Map<number, number>();

    for (const roleGroup of this.getAllRoleGroups()) {
      for (const worker of roleGroup.assignedWorkers) {
        assignedCounts.set(
          worker.employeeId,
          (assignedCounts.get(worker.employeeId) || 0) + 1
        );
      }
    }

    return assignedCounts;
  }

  private calculateTargetShifts(employee: Employee, requestedShifts: number): number {
    const strengthScore = this.calculateEmployeeStrength(employee);
    const normalizedStrength = strengthScore / 10;

    return Number((requestedShifts * (0.55 + 0.45 * normalizedStrength)).toFixed(1));
  }

  private calculateEmployeeStrength(employee: Employee): number {
    const seniorityScore = Math.min(10, ((employee.seniorityMonths || 0) / 24) * 10);

    return (
      0.35 * Number(employee.professionalism || 0) +
      0.3 * Number(employee.responsibility || 0) +
      0.2 * Number(employee.pressureHandling || 0) +
      0.1 * seniorityScore +
      0.05 * Number(employee.potential || 0)
    );
  }

  private formatEmployeeRole(employee: Employee): string {
    if (employee.jobRole === 'shift_leader') {
      return 'Shift manager';
    }

    return (employee.jobRole || 'employee').replace('_', ' ');
  }

  private formatShiftType(shift: ScheduleShift): string {
    return shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1);
  }

  private loadDashboardWeek(weekStartDate: string): void {
    this.isLoading = true;
    this.board = null;

    this.scheduleApiService.getSchedule(weekStartDate).subscribe({
      next: (board) => {
        this.board = board.scheduleId && board.days.length ? board : null;
        this.isLoading = false;
      },
      error: () => {
        this.board = null;
        this.isLoading = false;
      }
    });

    if (this.isManager()) {
      this.availabilityApiService.getAllAvailability(weekStartDate).subscribe({
        next: (availability) => {
          this.availabilitySubmissions = availability.submissions;
        },
        error: () => {
          this.availabilitySubmissions = [];
        }
      });
    }

    this.availabilityApiService.getMyAvailability(weekStartDate).subscribe({
      next: (availability) => {
        this.selectedAvailabilityCount = availability.selectedShiftIds.length;
      },
      error: () => {
        this.selectedAvailabilityCount = 0;
      }
    });
  }

}
