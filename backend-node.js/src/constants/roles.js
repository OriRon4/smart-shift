const PERMISSION_ROLES = {
  MANAGER: "manager",
  SHIFT_LEADER: "shift_leader",
  EMPLOYEE: "employee",
};

const JOB_ROLES = {
  WAITER: "waiter",
  BARTENDER: "bartender",
  SHIFT_LEADER: "shift_leader",
  MANAGER: "manager",
};

const SCHEDULE_JOB_ROLES = [
  {
    jobRole: JOB_ROLES.SHIFT_LEADER,
    label: "Shift managers",
    requirementField: "required_shift_leaders",
  },
  {
    jobRole: JOB_ROLES.BARTENDER,
    label: "Bartenders",
    requirementField: "required_bartenders",
  },
  {
    jobRole: JOB_ROLES.WAITER,
    label: "Waiters",
    requirementField: "required_waiters",
  },
];

module.exports = {
  PERMISSION_ROLES,
  JOB_ROLES,
  SCHEDULE_JOB_ROLES,
};
