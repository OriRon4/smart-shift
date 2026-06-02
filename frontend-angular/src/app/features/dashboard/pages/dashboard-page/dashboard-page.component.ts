import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../../../core/auth/auth.service';
import { PermissionService } from '../../../../core/permissions/permission.service';
import { AvailabilityApiService } from '../../../availability/services/availability-api.service';
import { AvailabilitySubmission } from '../../../availability/models/availability.models';
import { Employee } from '../../../employees/models/employee.models';
import { EmployeesApiService } from '../../../employees/services/employees-api.service';
import {
  AvailableMissingShiftSlot,
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
  timeRange: string;
  roleLabel: string;
  status: string;
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

interface TodayStaffMember {
  employeeId: number;
  fullName: string;
  roleLabel: string;
  shiftTime: string;
  phoneNumber?: string | null;
}

interface WeeklyStaffingDay {
  date: string;
  dayName: string;
  assigned: number;
  target: number;
  isBelowTarget: boolean;
}

interface ManagerAttentionItem {
  key: string;
  dayName: string;
  shiftType: string;
  issue: string;
  status: 'missing' | 'strength' | 'posted';
}

interface TodayRoleSnapshot {
  roleLabel: string;
  assigned: number;
  target: number;
}

const SHIFT_TIME_RANGES: Record<string, string> = {
  morning: '10:00 - 16:00',
  evening: '16:00 - 23:00',
};

const AVAILABILITY_DEADLINE_LABEL = 'Thursday 18:00';
const AVAILABILITY_DEADLINE_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const AVAILABILITY_DEADLINE_TIMES = ['12:00', '15:00', '18:00', '21:00'];

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
  protected availableMissingSlots: AvailableMissingShiftSlot[] = [];
  protected pendingFillSlot: AvailableMissingShiftSlot | null = null;
  protected missingShiftMessage = '';
  protected isFillingMissingSlot = false;
  protected selectedAvailabilityCount = 0;
  protected isLoading = false;
  protected isWorkloadModalOpen = false;
  protected selectedDeadlineDay = 'Thursday';
  protected selectedDeadlineTime = '18:00';
  protected availabilityDeadlineMessage = '';
  protected readonly availabilityDeadlineDays = AVAILABILITY_DEADLINE_DAYS;
  protected readonly availabilityDeadlineTimes = AVAILABILITY_DEADLINE_TIMES;

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
    return this.getAllRoleGroups().filter(
      (roleGroup) =>
        roleGroup.requiredStrengthScore !== undefined &&
        roleGroup.assignedStrengthScore !== undefined &&
        roleGroup.assignedStrengthScore < roleGroup.requiredStrengthScore
    ).length;
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

  protected get openPostedSlotCount(): number {
    return this.getAllRoleGroups().reduce(
      (total, roleGroup) => total + (roleGroup.postedMissingSlots?.length || 0),
      0
    );
  }

  protected get weeklyStaffingBalance(): WeeklyStaffingDay[] {
    if (!this.board) {
      return [];
    }

    return this.board.days.map((day) => {
      const roleGroups = day.shifts.flatMap((shift) => shift.roleGroups);
      const assigned = roleGroups.reduce(
        (total, roleGroup) => total + roleGroup.assignedCount,
        0
      );
      const target = roleGroups.reduce(
        (total, roleGroup) => total + roleGroup.requiredCount,
        0
      );

      return {
        date: day.date,
        dayName: day.dayName,
        assigned,
        target,
        isBelowTarget: assigned < target,
      };
    });
  }

  protected get maxWeeklyStaffingTarget(): number {
    return Math.max(
      1,
      ...this.weeklyStaffingBalance.map((day) => Math.max(day.assigned, day.target))
    );
  }

  protected get topWorkloadGaps(): EmployeeWorkloadMetric[] {
    return this.allWorkloadGaps.slice(0, 5);
  }

  protected get allWorkloadGaps(): EmployeeWorkloadMetric[] {
    return this.employeeWorkloadMetrics
      .filter((employee) => employee.gap > 0)
      .sort(
        (left, right) =>
          right.gap - left.gap ||
          left.assigned - right.assigned ||
          left.fullName.localeCompare(right.fullName)
      );
  }

  protected get managerAttentionItems(): ManagerAttentionItem[] {
    if (!this.board) {
      return [];
    }

    const items: ManagerAttentionItem[] = [];

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        for (const roleGroup of shift.roleGroups) {
          const missingCount = roleGroup.uncoveredSlots || 0;
          const postedCount = roleGroup.postedMissingSlots?.length || 0;

          if (missingCount > 0) {
            items.push({
              key: `${shift.shiftId}:${roleGroup.jobRole}:missing`,
              dayName: day.dayName,
              shiftType: this.formatShiftType(shift),
              issue: `Missing ${this.getSingularRoleLabel(roleGroup.label)}`,
              status: 'missing',
            });
          }

          if (
            roleGroup.requiredStrengthScore !== undefined &&
            roleGroup.assignedStrengthScore !== undefined &&
            roleGroup.assignedStrengthScore < roleGroup.requiredStrengthScore
          ) {
            items.push({
              key: `${shift.shiftId}:${roleGroup.jobRole}:strength`,
              dayName: day.dayName,
              shiftType: this.formatShiftType(shift),
              issue: 'Below strength',
              status: 'strength',
            });
          }

          if (postedCount > 0) {
            items.push({
              key: `${shift.shiftId}:${roleGroup.jobRole}:posted`,
              dayName: day.dayName,
              shiftType: this.formatShiftType(shift),
              issue: 'Posted open slot',
              status: 'posted',
            });
          }
        }
      }
    }

    return items.slice(0, 5);
  }

  protected get todayRoleSnapshots(): TodayRoleSnapshot[] {
    const todayKey = this.getTodayDateKey();
    const today = this.board?.days.find((day) => day.date === todayKey);

    if (!today) {
      return [];
    }

    return today.shifts
      .flatMap((shift) => shift.roleGroups)
      .reduce<TodayRoleSnapshot[]>((snapshots, roleGroup) => {
        const existing = snapshots.find(
          (snapshot) => snapshot.roleLabel === roleGroup.label
        );

        if (existing) {
          existing.assigned += roleGroup.assignedCount;
          existing.target += roleGroup.requiredCount;
        } else {
          snapshots.push({
            roleLabel: roleGroup.label,
            assigned: roleGroup.assignedCount,
            target: roleGroup.requiredCount,
          });
        }

        return snapshots;
      }, []);
  }

  protected get todayAssignedTotal(): number {
    return this.todayRoleSnapshots.reduce(
      (total, snapshot) => total + snapshot.assigned,
      0
    );
  }

  protected get todayTargetTotal(): number {
    return this.todayRoleSnapshots.reduce(
      (total, snapshot) => total + snapshot.target,
      0
    );
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
            timeRange: this.getShiftTimeRange(shift.shiftType),
            roleLabel: this.formatRoleLabel(roleGroup.label),
            status: this.board?.publishedAt ? 'Published' : '',
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

  protected get availabilityDeadlineLabel(): string {
    return AVAILABILITY_DEADLINE_LABEL;
  }

  protected get fillableShiftTitle(): string {
    return this.isShiftLeader()
      ? 'Shift manager shifts to fill'
      : 'Missing shifts to fill';
  }

  protected get noAvailableMissingSlotsText(): string {
    return 'No shifts to fill';
  }

  protected get todayStaffMembers(): TodayStaffMember[] {
    const todayKey = this.getTodayDateKey();
    const today = this.board?.days.find((day) => day.date === todayKey);

    if (!today) {
      return [];
    }

    return today.shifts.flatMap((shift) =>
      shift.roleGroups.flatMap((roleGroup) =>
        roleGroup.assignedWorkers.map((worker) => ({
          employeeId: worker.employeeId,
          fullName: worker.fullName,
          roleLabel: this.formatRoleLabel(roleGroup.label),
          shiftTime: this.getShiftTimeRange(shift.shiftType),
          phoneNumber: worker.phoneNumber,
        }))
      )
    );
  }

  protected getStaffingBarWidth(assigned: number, target: number): number {
    if (!target) {
      return assigned > 0 ? 100 : 0;
    }

    return Math.min(100, Math.round((assigned / target) * 100));
  }

  protected getWorkloadGapDisplay(employee: EmployeeWorkloadMetric): string {
    return employee.gap > 0 ? `-${employee.gap}` : '0';
  }

  protected getAttentionStatusLabel(status: ManagerAttentionItem['status']): string {
    if (status === 'missing') {
      return 'Missing';
    }

    if (status === 'strength') {
      return 'Strength';
    }

    return 'Posted';
  }

  protected openWorkloadModal(): void {
    this.isWorkloadModalOpen = true;
  }

  protected closeWorkloadModal(): void {
    this.isWorkloadModalOpen = false;
  }

  protected updateDeadlineDay(event: Event): void {
    this.selectedDeadlineDay = (event.target as HTMLSelectElement).value;
    this.availabilityDeadlineMessage = '';
  }

  protected updateDeadlineTime(event: Event): void {
    this.selectedDeadlineTime = (event.target as HTMLSelectElement).value;
    this.availabilityDeadlineMessage = '';
  }

  protected changeAvailabilityDeadline(): void {
    this.availabilityDeadlineMessage =
      'Deadline settings are not connected to backend storage yet. Current deadline remains Thursday 18:00.';
  }

  protected openFillConfirmation(slot: AvailableMissingShiftSlot): void {
    this.pendingFillSlot = slot;
    this.missingShiftMessage = '';
  }

  protected closeFillConfirmation(): void {
    if (!this.isFillingMissingSlot) {
      this.pendingFillSlot = null;
    }
  }

  protected confirmFillMissingShift(): void {
    if (!this.pendingFillSlot || this.isFillingMissingSlot) {
      return;
    }

    this.isFillingMissingSlot = true;
    this.scheduleApiService.fillMissingShiftSlot(this.pendingFillSlot.slotId).subscribe({
      next: () => {
        this.pendingFillSlot = null;
        this.isFillingMissingSlot = false;
        this.loadDashboardWeek(this.selectedWeekStartDate);
      },
      error: (error) => {
        this.missingShiftMessage =
          error?.error?.message || 'This shift is no longer available.';
        this.pendingFillSlot = null;
        this.isFillingMissingSlot = false;
        this.loadDashboardWeek(this.selectedWeekStartDate);
      }
    });
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

  private formatRoleLabel(roleLabel: string): string {
    return roleLabel === 'Shift managers' ? 'Shift manager' : roleLabel;
  }

  private getSingularRoleLabel(roleLabel: string): string {
    if (roleLabel === 'Waiters') {
      return 'waiter';
    }

    if (roleLabel === 'Bartenders') {
      return 'bartender';
    }

    if (roleLabel === 'Shift managers') {
      return 'shift manager';
    }

    return roleLabel.toLowerCase();
  }

  private formatShiftType(shift: ScheduleShift): string {
    return shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1);
  }

  protected formatShiftTypeLabel(shiftType: string): string {
    return shiftType.charAt(0).toUpperCase() + shiftType.slice(1);
  }

  protected getShiftTimeRange(shiftType: string): string {
    return SHIFT_TIME_RANGES[shiftType] || '';
  }

  private getTodayDateKey(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
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

    if (!this.isManager()) {
      this.scheduleApiService.getAvailableMissingShiftSlots(weekStartDate).subscribe({
        next: (response) => {
          this.availableMissingSlots = response.availableSlots;
        },
        error: () => {
          this.availableMissingSlots = [];
        }
      });
    } else {
      this.availableMissingSlots = [];
    }

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
