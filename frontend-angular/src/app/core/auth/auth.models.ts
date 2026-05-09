export type PermissionRole = 'manager' | 'shift_leader' | 'employee';

export interface AuthUser {
  id: number;
  employeeId: number | null;
  username: string;
  email: string;
  displayName: string;
  permissionRole: PermissionRole;
  jobRole: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
