UPDATE shifts
SET required_bartenders = 2
WHERE id = 14
  AND shift_date = '2026-04-25'
  AND shift_type = 'evening';
