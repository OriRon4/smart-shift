import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { WeekSelectorComponent } from '../../../schedule/components/week-selector/week-selector.component';
import { AvailabilityResponse } from '../../models/availability.models';
import { AvailabilityApiService } from '../../services/availability-api.service';

@Component({
  selector: 'app-availability-page',
  standalone: true,
  imports: [
    WeekSelectorComponent
  ],
  templateUrl: './availability-page.component.html',
  styleUrl: './availability-page.component.css'
})
export class AvailabilityPageComponent implements OnInit {
  protected selectedWeekStartDate = '2026-04-19';
  protected availability: AvailabilityResponse | null = null;
  protected selectedShiftIds = new Set<number>();
  protected isLoading = false;
  protected errorMessage = '';
  protected successMessage = '';

  constructor(private readonly availabilityApiService: AvailabilityApiService) {}

  ngOnInit(): void {
    this.loadAvailability();
  }

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

  protected isSelected(shiftId: number): boolean {
    return this.selectedShiftIds.has(shiftId);
  }

  protected toggleShift(shiftId: number): void {
    if (this.selectedShiftIds.has(shiftId)) {
      this.selectedShiftIds.delete(shiftId);
      return;
    }

    this.selectedShiftIds.add(shiftId);
  }

  protected submitAvailability(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.availabilityApiService
      .submitMyAvailability(
        this.selectedWeekStartDate,
        [...this.selectedShiftIds.values()]
      )
      .subscribe({
        next: (availability) => {
          this.applyAvailability(availability);
          this.successMessage = 'Availability submitted.';
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private loadAvailability(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.availabilityApiService
      .getMyAvailability(this.selectedWeekStartDate)
      .subscribe({
        next: (availability) => {
          this.applyAvailability(availability);
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private applyAvailability(availability: AvailabilityResponse): void {
    this.availability = availability;
    this.selectedShiftIds = new Set(availability.selectedShiftIds);
  }

  private changeSelectedWeek(dayOffset: number): void {
    this.selectedWeekStartDate = this.addDays(
      this.selectedWeekStartDate,
      dayOffset
    );
    this.loadAvailability();
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

    return 'Availability action failed. Check that the backend is running and try again.';
  }
}
