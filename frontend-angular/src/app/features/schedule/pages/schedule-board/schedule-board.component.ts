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
  ScheduleShift,
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
  protected boardFilter: 'all' | 'issues' | 'strength' = 'all';
  protected focusedShiftId: number | null = null;

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

  protected get scheduleStatusValue(): string {
    if (!this.board) {
      return 'Draft';
    }

    if (this.board.scheduleId && this.unfilledSlots === 0 && this.belowStrengthShiftCount === 0) {
      return 'Published';
    }

    if (this.unfilledSlots > 0) {
      return 'Missing assignments';
    }

    if (this.belowStrengthShiftCount > 0) {
      return 'Needs review';
    }

    return 'Ready to publish';
  }

  protected get scheduleStatusTone(): string {
    if (!this.board) {
      return 'neutral';
    }

    if (this.unfilledSlots > 0) {
      return 'critical';
    }

    if (this.belowStrengthShiftCount > 0) {
      return 'warning';
    }

    return 'good';
  }

  protected get scheduleStatusHelper(): string {
    if (!this.board) {
      return 'No schedule generated yet';
    }

    const attentionCount = this.getProblemShiftIds('issues').size;

    if (attentionCount > 0) {
      return `${attentionCount} shifts need attention`;
    }

    return 'All required slots are filled';
  }

  protected get openIssueCount(): number {
    return this.unfilledSlots + this.belowStrengthShiftCount;
  }

  protected get openIssuesHelper(): string {
    if (!this.openIssueCount) {
      return 'No critical issues';
    }

    const parts: string[] = [];

    if (this.unfilledSlots) {
      parts.push(`${this.unfilledSlots} unfilled slot${this.unfilledSlots === 1 ? '' : 's'}`);
    }

    if (this.belowStrengthShiftCount) {
      parts.push(`${this.belowStrengthShiftCount} below strength`);
    }

    return parts.join(', ');
  }

  protected get coverageQualityHelper(): string {
    const required = this.board?.summary?.totalRoleRequirements || 0;
    return `${this.totalAssignedEmployees} of ${required} required assignments filled`;
  }

  protected get strengthRiskValue(): string {
    if (this.belowStrengthShiftCount === 0) {
      return 'Low';
    }

    if (this.belowStrengthShiftCount <= 3) {
      return 'Medium';
    }

    return 'High';
  }

  protected get strengthRiskTone(): string {
    if (this.belowStrengthShiftCount === 0) {
      return 'good';
    }

    if (this.belowStrengthShiftCount <= 3) {
      return 'warning';
    }

    return 'critical';
  }

  protected get strengthRiskHelper(): string {
    if (!this.belowStrengthShiftCount) {
      return 'All shifts meet strength target';
    }

    return `${this.belowStrengthShiftCount} shifts below required strength`;
  }

  protected get fairnessGap(): number {
    const assignedCounts = this.getAssignedCountsByEmployee();
    const counts = [...assignedCounts.values()];

    if (!counts.length) {
      return 0;
    }

    return Math.max(...counts) - Math.min(...counts);
  }

  protected get fairnessBalanceValue(): string {
    if (this.fairnessGap <= 1) {
      return 'Balanced';
    }

    if (this.fairnessGap <= 2) {
      return 'Slightly uneven';
    }

    return 'Uneven';
  }

  protected get fairnessBalanceTone(): string {
    if (this.fairnessGap <= 1) {
      return 'good';
    }

    if (this.fairnessGap <= 2) {
      return 'warning';
    }

    return 'critical';
  }

  protected get fairnessBalanceHelper(): string {
    if (!this.board) {
      return 'No assignments yet';
    }

    if (this.fairnessGap <= 1) {
      return 'Assignments are balanced';
    }

    return `Max gap: ${this.fairnessGap} shifts between employees`;
  }

  protected get mostCriticalShiftValue(): string {
    const criticalShift = this.mostCriticalShift;
    return criticalShift?.label || 'No critical shifts';
  }

  protected get mostCriticalShiftHelper(): string {
    const criticalShift = this.mostCriticalShift;
    return criticalShift?.helper || 'All shifts look good';
  }

  protected get mostCriticalShiftTone(): string {
    const criticalShift = this.mostCriticalShift;

    if (!criticalShift) {
      return 'good';
    }

    return criticalShift.unfilledSlots > 0 ? 'critical' : 'warning';
  }

  protected get mostCriticalShift(): {
    shiftId: number;
    label: string;
    helper: string;
    unfilledSlots: number;
    strengthGap: number;
  } | null {
    if (!this.board) {
      return null;
    }

    const candidates = this.board.days.flatMap((day) =>
      day.shifts.map((shift) => {
        const unfilledSlots = shift.roleGroups.reduce(
          (total, roleGroup) => total + (roleGroup.uncoveredSlots || 0),
          0
        );
        const strengthGap = shift.roleGroups.reduce(
          (maxGap, roleGroup) =>
            Math.max(
              maxGap,
              Math.max(
                0,
                (roleGroup.requiredStrengthScore || 0) -
                  (roleGroup.assignedStrengthScore || 0)
              )
            ),
          0
        );

        return {
          shiftId: shift.shiftId,
          label: `${day.dayName} ${this.formatShiftType(shift)}`,
          helper:
            unfilledSlots > 0
              ? `${unfilledSlots} missing assignment${unfilledSlots === 1 ? '' : 's'}`
              : `Strength gap: ${Number(strengthGap.toFixed(1))}`,
          unfilledSlots,
          strengthGap,
        };
      })
    );

    const missingAssignments = candidates
      .filter((candidate) => candidate.unfilledSlots > 0)
      .sort((left, right) => right.unfilledSlots - left.unfilledSlots);

    if (missingAssignments.length) {
      return missingAssignments[0];
    }

    const strengthRisks = candidates
      .filter((candidate) => candidate.strengthGap > 0)
      .sort((left, right) => right.strengthGap - left.strengthGap);

    return strengthRisks[0] || null;
  }

  protected setBoardFilter(filter: 'all' | 'issues' | 'strength'): void {
    this.boardFilter = this.boardFilter === filter ? 'all' : filter;
    this.focusedShiftId = null;
  }

  protected focusMostCriticalShift(): void {
    const criticalShift = this.mostCriticalShift;

    if (!criticalShift) {
      this.boardFilter = 'all';
      this.focusedShiftId = null;
      return;
    }

    this.boardFilter = 'all';
    this.focusedShiftId = criticalShift.shiftId;
  }

  protected get activeShiftIds(): Set<number> {
    if (this.focusedShiftId) {
      return new Set([this.focusedShiftId]);
    }

    if (this.boardFilter === 'issues') {
      return this.getProblemShiftIds('issues');
    }

    if (this.boardFilter === 'strength') {
      return this.getProblemShiftIds('strength');
    }

    return new Set<number>();
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

  private getAssignedCountsByEmployee(): Map<number, number> {
    const assignedCounts = new Map<number, number>();

    if (!this.board) {
      return assignedCounts;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        for (const roleGroup of shift.roleGroups) {
          for (const worker of roleGroup.assignedWorkers) {
            assignedCounts.set(
              worker.employeeId,
              (assignedCounts.get(worker.employeeId) || 0) + 1
            );
          }
        }
      }
    }

    return assignedCounts;
  }

  private getProblemShiftIds(filter: 'issues' | 'strength'): Set<number> {
    const problemShiftIds = new Set<number>();

    if (!this.board) {
      return problemShiftIds;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        const hasUnfilledSlot = shift.roleGroups.some(
          (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
        );
        const hasStrengthRisk = shift.roleGroups.some(
          (roleGroup) => roleGroup.meetsStrengthTarget === false
        );

        if (
          (filter === 'issues' && (hasUnfilledSlot || hasStrengthRisk)) ||
          (filter === 'strength' && hasStrengthRisk)
        ) {
          problemShiftIds.add(shift.shiftId);
        }
      }
    }

    return problemShiftIds;
  }

  private formatShiftType(shift: ScheduleShift): string {
    return shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1);
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
