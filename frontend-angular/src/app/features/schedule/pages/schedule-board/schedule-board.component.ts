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
import { AvailabilityApiService } from '../../../availability/services/availability-api.service';

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
  protected availableShiftIdsByEmployeeId = new Map<number, Set<number>>();
  protected pendingReplacement: ReplaceAssignmentRequest | null = null;
  protected replacementSearch = '';
  protected validationResult: ScheduleValidationResponse | null = null;
  protected isLoading = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected boardFilter: 'all' | 'gaps' | 'strength' = 'all';
  protected focusedShiftId: number | null = null;
  protected hasUnsavedChanges = false;
  protected showEmployeesUnderTarget = false;

  protected readonly currentUser = this.authService.currentUser;

  constructor(
    private readonly scheduleApiService: ScheduleApiService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly employeesApiService: EmployeesApiService,
    private readonly availabilityApiService: AvailabilityApiService
  ) {}

  ngOnInit(): void {
    this.loadSchedule();

    if (this.canReplaceScheduleWorkers()) {
      this.employeesApiService.getEmployees().subscribe({
        next: (response) => {
          this.employees = response.employees;
        }
      });
      this.loadReplacementAvailability();
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

  protected canReplaceScheduleWorkers(): boolean {
    return this.permissionService.canReplaceScheduleWorkers(this.currentUser());
  }

  protected canSaveScheduleAssignments(): boolean {
    return this.permissionService.canSaveScheduleAssignments(this.currentUser());
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

  protected get gapRoleGroupCount(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.reduce(
          (shiftTotal, shift) =>
            shiftTotal +
            shift.roleGroups.filter(
              (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
            ).length,
          0
        ),
      0
    );
  }

  protected get gapShiftCount(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.filter((shift) =>
          shift.roleGroups.some(
            (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
          )
        ).length,
      0
    );
  }

  protected get belowStrengthShiftCount(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.filter((shift) =>
          shift.roleGroups.some((roleGroup) =>
            this.isRoleGroupBelowStrength(roleGroup)
          )
        ).length,
      0
    );
  }

  protected get scheduleStatusValue(): string {
    if (!this.board) {
      return 'Not generated';
    }

    if (this.hasUnsavedChanges) {
      return 'Unsaved changes';
    }

    if (this.totalAssignedEmployees === 0) {
      return 'Empty';
    }

    if (this.validationResult && this.validationResult.warnings.length === 0) {
      return 'Validated';
    }

    if (this.validationResult?.warnings.length || this.unfilledSlots > 0 || this.belowStrengthShiftCount > 0) {
      return 'Needs review';
    }

    if (this.board.scheduleId) {
      return 'Saved';
    }

    return 'Draft';
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

    if (this.hasUnsavedChanges) {
      return 'Save changes to persist replacements';
    }

    if (this.totalAssignedEmployees === 0) {
      return 'No assignments in this schedule';
    }

    if (this.validationResult) {
      return `${this.validationResult.warnings.length} validation warnings`;
    }

    const attentionCount = this.getProblemShiftIds('gaps').size;

    if (attentionCount > 0) {
      return `${attentionCount} shifts need attention`;
    }

    return 'All required slots are filled';
  }

  protected get weakestShift(): {
    label: string;
    helper: string;
    gap: number;
  } | null {
    if (!this.board) {
      return null;
    }

    const candidates = this.board.days.flatMap((day) =>
      day.shifts.flatMap((shift) =>
        shift.roleGroups.map((roleGroup) => {
          const assignedStrength = roleGroup.assignedStrengthScore || 0;
          const requiredStrength = roleGroup.requiredStrengthScore || 0;

          return {
            label: `${day.dayName} ${this.formatShiftType(shift)}`,
            helper: `${Number(assignedStrength.toFixed(1))} / ${Number(
              requiredStrength.toFixed(1)
            )} strength`,
            gap: Math.max(0, requiredStrength - assignedStrength),
          };
        })
      )
    );

    return (
      candidates
        .filter((candidate) => candidate.gap > 0)
        .sort((left, right) => right.gap - left.gap)[0] || null
    );
  }

  protected get employeesUnderTarget(): {
    employeeId: number;
    fullName: string;
    assigned: number;
    requested: number;
    target: number;
    gap: number;
  }[] {
    const assignedCounts = this.getAssignedCountsByEmployee();

    return this.employees
      .filter((employee) => employee.isActive !== false)
      .map((employee) => {
        const assigned = assignedCounts.get(employee.id) || 0;
        const requested = this.getRequestedShiftCount(employee.id);
        const target = this.calculateTargetShifts(employee, requested);

        return {
          employeeId: employee.id,
          fullName: employee.fullName,
          assigned,
          requested,
          target,
          gap: Number((assigned - target).toFixed(1)),
        };
      })
      .filter((employee) => employee.requested > 0 && employee.assigned < employee.target - 0.5)
      .sort((left, right) => left.gap - right.gap || left.fullName.localeCompare(right.fullName));
  }

  protected toggleEmployeesUnderTarget(): void {
    this.showEmployeesUnderTarget = !this.showEmployeesUnderTarget;
  }

  protected get publishedStatusLabel(): string {
    if (!this.board?.publishedAt) {
      return 'Not published yet';
    }

    return `Published at ${new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(this.board.publishedAt))}`;
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

  protected setBoardFilter(filter: 'all' | 'gaps' | 'strength'): void {
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

    if (this.boardFilter === 'gaps') {
      return this.getProblemShiftIds('gaps');
    }

    if (this.boardFilter === 'strength') {
      return this.getProblemShiftIds('strength');
    }

    return new Set<number>();
  }

  protected get activeRoleGroupKeys(): Set<string> {
    if (this.boardFilter === 'gaps') {
      return this.getProblemRoleGroupKeys('gaps');
    }

    if (this.boardFilter === 'strength') {
      return this.getProblemRoleGroupKeys('strength');
    }

    return new Set<string>();
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
    this.hasUnsavedChanges = false;
    this.showEmployeesUnderTarget = false;

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
          this.hasUnsavedChanges = false;
          this.showEmployeesUnderTarget = false;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected openReplacement(request: ReplaceAssignmentRequest): void {
    if (!this.canReplaceScheduleWorkers()) {
      return;
    }

    this.pendingReplacement = request;
    this.replacementSearch = '';
  }

  protected closeReplacementDrawer(): void {
    this.pendingReplacement = null;
    this.replacementSearch = '';
  }

  protected getReplacementCandidates(): Employee[] {
    const searchValue = this.replacementSearch.trim().toLowerCase();

    return this.employees
      .filter((employee) =>
        searchValue
          ? employee.fullName.toLowerCase().includes(searchValue)
          : true
      )
      .sort((leftEmployee, rightEmployee) => {
        const leftStatus = this.getReplacementSortRank(leftEmployee);
        const rightStatus = this.getReplacementSortRank(rightEmployee);

        if (leftStatus !== rightStatus) {
          return leftStatus - rightStatus;
        }

        return leftEmployee.fullName.localeCompare(rightEmployee.fullName);
      });
  }

  protected updateReplacementSearch(event: Event): void {
    this.replacementSearch = (event.target as HTMLInputElement).value;
  }

  protected applyReplacement(employeeId: number): void {
    if (!this.board || !this.pendingReplacement) {
      return;
    }

    const replacementEmployee = this.employees.find(
      (employee) => employee.id === Number(employeeId)
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
    this.hasUnsavedChanges = true;
    this.validationResult = null;
    this.closeReplacementDrawer();
  }

  protected getEmployeeInitials(employee: Employee): string {
    return employee.fullName
      .split(' ')
      .map((namePart) => namePart.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  protected formatEmployeeRole(employee: Employee): string {
    return this.formatJobRole(employee.jobRole || 'employee');
  }

  protected getEmployeeShiftRatio(employee: Employee): string {
    return `${this.getAssignedShiftCount(employee.id)}/${this.getRequestedShiftCount(employee.id)}`;
  }

  protected isEmployeeAvailableForPendingShift(employee: Employee): boolean {
    if (!this.pendingReplacement) {
      return false;
    }

    return (
      this.availableShiftIdsByEmployeeId
        .get(employee.id)
        ?.has(this.pendingReplacement.shiftId) || false
    );
  }

  protected isEmployeeScheduledForPendingShift(employee: Employee): boolean {
    if (!this.board || !this.pendingReplacement) {
      return false;
    }

    return this.board.days.some((day) =>
      day.shifts.some(
        (shift) =>
          shift.shiftId === this.pendingReplacement?.shiftId &&
          shift.roleGroups.some((roleGroup) =>
            roleGroup.assignedWorkers.some(
              (worker) => worker.employeeId === employee.id
            )
          )
      )
    );
  }

  private getReplacementSortRank(employee: Employee): number {
    if (employee.isActive === false) {
      return 3;
    }

    if (this.isEmployeeScheduledForPendingShift(employee)) {
      return 2;
    }

    if (this.isEmployeeAvailableForPendingShift(employee)) {
      return 0;
    }

    return 1;
  }

  protected saveChanges(): void {
    if (!this.board?.scheduleId || !this.canSaveScheduleAssignments()) {
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
          this.hasUnsavedChanges = false;
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

  protected publishSchedule(): void {
    if (!this.board?.scheduleId || !this.canManageSchedule()) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.scheduleApiService
      .publishSchedule(this.board.scheduleId)
      .subscribe({
        next: (board) => {
          this.board = board;
          this.successMessage = 'Schedule published.';
          this.hasUnsavedChanges = false;
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

  private getProblemShiftIds(filter: 'gaps' | 'strength'): Set<number> {
    const problemShiftIds = new Set<number>();

    if (!this.board) {
      return problemShiftIds;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        const hasUnfilledSlot = shift.roleGroups.some(
          (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
        );
        const hasStrengthRisk = shift.roleGroups.some((roleGroup) =>
          this.isRoleGroupBelowStrength(roleGroup)
        );

        if (
          (filter === 'gaps' && hasUnfilledSlot) ||
          (filter === 'strength' && hasStrengthRisk)
        ) {
          problemShiftIds.add(shift.shiftId);
        }
      }
    }

    return problemShiftIds;
  }

  private getProblemRoleGroupKeys(filter: 'gaps' | 'strength'): Set<string> {
    const problemRoleGroupKeys = new Set<string>();

    if (!this.board) {
      return problemRoleGroupKeys;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        for (const roleGroup of shift.roleGroups) {
          const hasProblem =
            filter === 'gaps'
              ? (roleGroup.uncoveredSlots || 0) > 0
              : this.isRoleGroupBelowStrength(roleGroup);

          if (hasProblem) {
            problemRoleGroupKeys.add(`${shift.shiftId}:${roleGroup.jobRole}`);
          }
        }
      }
    }

    return problemRoleGroupKeys;
  }

  private isRoleGroupBelowStrength(roleGroup: {
    assignedStrengthScore?: number;
    requiredStrengthScore?: number;
  }): boolean {
    const assignedStrength = roleGroup.assignedStrengthScore || 0;
    const requiredStrength = roleGroup.requiredStrengthScore || 0;

    return requiredStrength > 0 && assignedStrength < requiredStrength;
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

    if (this.canReplaceScheduleWorkers()) {
      this.loadReplacementAvailability();
    }
  }

  private loadReplacementAvailability(): void {
    this.availabilityApiService
      .getAllAvailability(this.selectedWeekStartDate)
      .subscribe({
        next: (availability) => {
          this.availableShiftIdsByEmployeeId = new Map(
            availability.submissions.map((submission) => [
              submission.employeeId,
              new Set(submission.shiftIds)
            ])
          );
        },
        error: () => {
          this.availableShiftIdsByEmployeeId = new Map();
        }
      });
  }

  protected clearSchedule(): void {
    if (!this.board?.scheduleId) {
      return;
    }

    const confirmed = window.confirm('Are you sure you want to delete this schedule?');

    if (!confirmed) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.validationResult = null;

    this.scheduleApiService
      .clearScheduleAssignments(this.board.scheduleId)
      .subscribe({
        next: (board) => {
          this.board = board.days.length ? board : null;
          this.successMessage = 'Schedule cleared.';
          this.hasUnsavedChanges = false;
          this.showEmployeesUnderTarget = false;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private getAssignedShiftCount(employeeId: number): number {
    return this.getAssignedCountsByEmployee().get(employeeId) || 0;
  }

  private getRequestedShiftCount(employeeId: number): number {
    return this.availableShiftIdsByEmployeeId.get(employeeId)?.size || 0;
  }

  private calculateTargetShifts(employee: Employee, requestedShifts: number): number {
    const strengthScore = this.calculateEmployeeStrength(employee);
    const normalizedStrength = strengthScore / 10;

    return Number((requestedShifts * (0.55 + 0.45 * normalizedStrength)).toFixed(1));
  }

  private calculateEmployeeStrength(employee: Employee): number {
    const seniorityScore = Math.min(10, ((employee.seniorityMonths || 0) / 24) * 10);

    return (
      0.35 * (employee.professionalism || 0) +
      0.3 * (employee.responsibility || 0) +
      0.2 * (employee.pressureHandling || 0) +
      0.1 * seniorityScore +
      0.05 * (employee.potential || 0)
    );
  }

  private formatJobRole(jobRole: string): string {
    if (jobRole === 'shift_leader') {
      return 'Shift manager';
    }

    return jobRole.replace('_', ' ');
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
