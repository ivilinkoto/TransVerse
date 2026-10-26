/**
 * Staff roles. Order matters: each role includes the permissions of the ones below.
 *   founder  — Основател / Главен администратор (cannot be demoted by anyone else)
 *   admin    — Администратор
 *   support  — Техническа поддръжка
 *   player   — Играч
 */
export const ROLES = ['player', 'support', 'admin', 'founder'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  player: 'Играч',
  support: 'Техническа поддръжка',
  admin: 'Администратор',
  founder: 'Основател / Главен администратор',
};

const rank = (role: string) => Math.max(0, ROLES.indexOf(role as Role));

export const isStaff = (role: string) => rank(role) >= rank('support');
export const isAdmin = (role: string) => rank(role) >= rank('admin');
/**
 * Staff test the features of updates that are not out yet, except while they
 * look at the game as a player (1.1.2, Настройки → Виж като играч).
 */
export const testsUnreleased = (u: { role: string; asPlayer?: boolean; uiPrefs?: { asPlayer?: boolean } | null }) => isStaff(u.role) && !u.asPlayer && !u.uiPrefs?.asPlayer;
export const isFounder = (role: string) => role === 'founder';

/**
 * Who may set whose role:
 *  - the founder can grant/revoke admin and support (but there is only one founder role holder chain: founder cannot be changed here);
 *  - an admin can grant/revoke support only, and cannot touch admins or the founder;
 *  - nobody can change their own role.
 */
export function canChangeRole(actorRole: string, actorId: string, targetRole: string, targetId: string, newRole: string): boolean {
  if (actorId === targetId) return false;
  if (!ROLES.includes(newRole as Role) || newRole === 'founder') return false;
  if (targetRole === 'founder') return false;
  if (isFounder(actorRole)) return true;
  if (actorRole === 'admin') return rank(targetRole) < rank('admin') && rank(newRole) < rank('admin');
  return false;
}

/** Banning: admins can ban players and support staff; only the founder can ban admins; nobody bans the founder. */
export function canBan(actorRole: string, actorId: string, targetRole: string, targetId: string): boolean {
  if (actorId === targetId || targetRole === 'founder') return false;
  if (isFounder(actorRole)) return true;
  return actorRole === 'admin' && rank(targetRole) < rank('admin');
}
