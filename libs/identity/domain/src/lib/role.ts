export const ROLES = ['OWNER', 'MANAGER', 'KITCHEN', 'WAITER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'menu:read',
  'menu:write',
  'orders:read',
  'orders:advance',
  'bills:read',
  'bills:close',
  'metrics:read',
  'staff:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role may do.
 *
 * Kitchen staff move tickets but never touch prices; a waiter closes bills but
 * does not edit the menu. Keeping this as data rather than scattered ifs means
 * a permission question has exactly one answer.
 */
const GRANTS: Record<Role, readonly Permission[]> = {
  OWNER: [
    'menu:read',
    'menu:write',
    'orders:read',
    'orders:advance',
    'bills:read',
    'bills:close',
    'metrics:read',
    'staff:manage',
  ],
  MANAGER: [
    'menu:read',
    'menu:write',
    'orders:read',
    'orders:advance',
    'bills:read',
    'bills:close',
    'metrics:read',
  ],
  KITCHEN: ['menu:read', 'orders:read', 'orders:advance'],
  WAITER: ['menu:read', 'orders:read', 'orders:advance', 'bills:read', 'bills:close'],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export function permissionsOf(role: Role): readonly Permission[] {
  return GRANTS[role];
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
