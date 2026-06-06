import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'admin' | 'receptionist' | 'security_guard' | 'resident';

const ROLE_TTL_MS = 5 * 60 * 1000;
const rolePriority: AppRole[] = ['admin', 'receptionist', 'security_guard', 'resident'];
const roleCache = new Map<string, { role: AppRole | null; expiresAt: number }>();
const roleInflight = new Map<string, Promise<AppRole | null>>();

const isAppRole = (role: string): role is AppRole =>
  rolePriority.includes(role as AppRole);

export const isStaffRole = (role: AppRole | null): role is Exclude<AppRole, 'resident'> =>
  role === 'admin' || role === 'receptionist' || role === 'security_guard';

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

  const fetchRole = async (): Promise<AppRole | null> => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

      if (error) {
        console.error('Error fetching user role:', error);
        return null;
      }

      const roles = (data || [])
        .map((item) => item.role)
        .filter((role): role is AppRole => typeof role === 'string' && isAppRole(role));
    return rolePriority.find((candidate) => roles.includes(candidate)) || null;
  };

  const request = fetchRole()
    .then(async (initialRole) => {
      if (initialRole) {
        roleCache.set(userId, { role: initialRole, expiresAt: Date.now() + ROLE_TTL_MS });
        return initialRole;
      }

      try {
        const { error } = await supabase.functions.invoke('register-resident', {
          body: { action: 'link-existing' },
        });

        if (!error) {
          const linkedRole = await fetchRole();
          roleCache.set(userId, { role: linkedRole, expiresAt: Date.now() + ROLE_TTL_MS });
          return linkedRole;
        }
      } catch (error) {
        console.warn('Resident auto-link skipped:', error);
      }

      roleCache.set(userId, { role: null, expiresAt: Date.now() + ROLE_TTL_MS });
      return null;
    })
    .finally(() => {
      roleInflight.delete(userId);
    });

  roleInflight.set(userId, request);
  return request;
}
