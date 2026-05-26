import type { UserRole } from '../types/auth';

export type WorkspaceRole = Extract<UserRole, 'owner' | 'labeler' | 'reviewer'>;

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  owner: 'Project Owner',
  labeler: 'Labeler',
  reviewer: 'Reviewer',
};

export const workspaceRolePath: Record<WorkspaceRole, string> = {
  owner: '/owner/tasks',
  labeler: '/labeler',
  reviewer: '/reviewer',
};

const rolePriority: WorkspaceRole[] = ['owner', 'labeler', 'reviewer'];

export function isWorkspaceRole(role: UserRole): role is WorkspaceRole {
  return role === 'owner' || role === 'labeler' || role === 'reviewer';
}

export function resolveLandingRole(
  roles: UserRole[],
  selectedRole?: UserRole,
): WorkspaceRole {
  if (selectedRole && isWorkspaceRole(selectedRole) && roles.includes(selectedRole)) {
    return selectedRole;
  }

  return rolePriority.find((role) => roles.includes(role)) ?? 'owner';
}

export function resolveLandingPath(roles: UserRole[], selectedRole?: UserRole) {
  return workspaceRolePath[resolveLandingRole(roles, selectedRole)];
}
