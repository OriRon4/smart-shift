# Smart-Shift Database

This folder contains the final MySQL schema and demo seed data for the
Smart-Shift final project.

## Contents

- `schema/schema.sql` - source of truth for the final database structure.
- `seed/seed.sql` - core demo users, employees, shifts, and availability.
- `seed/ml_shift_performance_seed.sql` - synthetic historical data for ML
  training demonstrations.

Fresh database setup uses `schema/schema.sql`, then `seed/seed.sql`, and
optionally `seed/ml_shift_performance_seed.sql`. No migrations are required for
a new installation.

Legacy migrations are archived under `archive/db-mysql/migrations/` for
reference only.

The ML seed data is synthetic demo data, not production restaurant data.
