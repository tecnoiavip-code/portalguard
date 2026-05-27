import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'admin' | 'receptionist' | 'security_guard' | 'resident';

const ROLE_TTL_MS = 5 * 60 * 1000;
const rolePriority: AppRole[] = ['admin', 'receptionist', 'security_guard', 'resident'];
const roleCache = new Map<string, { role: AppRole | null; expiresAt: number }>();
const roleInflight = new Map<string, Promise<AppRole | null>>();

const isAppRole = (role: string): role is AppRole =>
  rolePriority.includes(role as AppRole);

export function clearRoleCache(userId?: string) {
  if (userId) {
    roleCache.delete(userId);
    roleInflight.delete(userId);
    return;
  }
  roleCache.clear();
  roleInflight.clear();
}

export async function getUserRole(userId: string, force = false): Promise<AppRole | null> {
  if (!force) {
    const cached = roleCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.role;

    const inflight = roleInflight.get(userId);
    if (inflight) return inflight;
  }

  const request = Promise.resolve(
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
  )
    .then(({ data, error }) => {
      if (error) {
        console.error('Error fetching user role:', error);
        return null;
      }

      const roles = (data || [])
        .map((item) => item.role)
        .filter((role): role is AppRole => typeof role === 'string' && isAppRole(role));
      const role = rolePriority.find((candidate) => roles.includes(candidate)) || null;
      roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_TTL_MS });
      return role;
    })
    .finally(() => {
      roleInflight.delete(userId);
    });

  roleInflight.set(userId, request);
  return request;
}
