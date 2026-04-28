import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { ScheduleGridComponent } from '../../components/schedule-grid/schedule-grid.component';
import { WeekSelectorComponent } from '../../components/week-selector/week-selector.component';
import { ScheduleBoardResponse } from '../../models/schedule.models';
import { ScheduleApiService } from '../../services/schedule-api.service';

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
export class ScheduleBoardComponent {
  protected selectedWeekStartDate = '2026-04-19';
  protected board: ScheduleBoardResponse | null = null;
  protected isLoading = false;
  protected errorMessage = '';

  constructor(private readonly scheduleApiService: ScheduleApiService) {}

  protected get weekRangeLabel(): string {
    return `${this.formatDisplayDate(this.selectedWeekStartDate)} - ${this.formatDisplayDate(
      this.addDays(this.selectedWeekStartDate, 6)
    )}`;
  }

  protected previousWeek(): void {
    this.changeSelectedWeek(-7);
  }

  protected nextWeek(): void {
    this.changeSelectedWeek(7);
  }

  protected generateSchedule(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.scheduleApiService
      .generateSchedule(this.selectedWeekStartDate)
      .subscribe({
        next: (board) => {
          this.board = board;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private changeSelectedWeek(dayOffset: number): void {
    this.selectedWeekStartDate = this.addDays(
      this.selectedWeekStartDate,
      dayOffset
    );
    this.board = null;
    this.errorMessage = '';
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

    return 'Could not generate the schedule. Check that the backend is running and try again.';
  }
}
