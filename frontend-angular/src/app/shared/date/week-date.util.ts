// JavaScript Date.getDay(): Sunday=0, Monday=1, ..., Thursday=4.
export const AVAILABILITY_NEXT_WEEK_CUTOFF_DAY = 4;

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function addDaysToDateKey(dateKey: string, dayOffset: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + dayOffset);

  return formatDateKey(date);
}

export function getCurrentWeekStartDate(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());

  return formatDateKey(date);
}

export function getNextWeekStartDate(): string {
  return addDaysToDateKey(getCurrentWeekStartDate(), 7);
}

export function isPastWeekStartDate(weekStartDate: string): boolean {
  return weekStartDate < getCurrentWeekStartDate();
}

export function isCurrentWeekStartDate(weekStartDate: string): boolean {
  return weekStartDate === getCurrentWeekStartDate();
}

export function isNextWeekStartDate(weekStartDate: string): boolean {
  return weekStartDate === getNextWeekStartDate();
}

export function isAvailabilityNextWeekCutoffClosed(): boolean {
  return new Date().getDay() > AVAILABILITY_NEXT_WEEK_CUTOFF_DAY;
}
