import { Component, Input } from '@angular/core';

import {
  ScheduleBoardResponse,
  ScheduleShift,
  ScheduleWorker
} from '../../models/schedule.models';

type ShiftStatus = 'optimal' | 'covered' | 'understaffed';

@Component({
  selector: 'app-schedule-grid',
  standalone: true,
  templateUrl: './schedule-grid.component.html',
  styleUrl: './schedule-grid.component.css'
})
export class ScheduleGridComponent {
  @Input({ required: true }) board: ScheduleBoardResponse | null = null;

  getShiftStatus(shift: ScheduleShift): ShiftStatus {
    if (shift.uncoveredSlots > 0) {
      return 'understaffed';
    }

    return shift.meetsStrengthTarget ? 'optimal' : 'covered';
  }

  getShiftStatusLabel(shift: ScheduleShift): string {
    const status = this.getShiftStatus(shift);

    if (status === 'understaffed') {
      return 'Understaffed';
    }

    if (status === 'covered') {
      return 'Covered';
    }

    return 'Optimal';
  }

  formatShiftType(shift: ScheduleShift): string {
    return shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1);
  }

  getWorkerInitials(worker: ScheduleWorker): string {
    return worker.fullName
      .split(' ')
      .map((namePart) => namePart.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
}
