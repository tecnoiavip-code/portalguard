export type PortalAccess = 'staff' | 'resident' | 'denied';

// Only the authenticated database RPC may supply this value.
export function parsePortalAccess(value: unknown): PortalAccess {
  return value === 'staff' || value === 'resident' ? value : 'denied';
}

export function portalDestination(access: PortalAccess, next?: string | null): string {
  if (access === 'denied') return '/auth';
  // Preserve only the public OAuth consent continuation, never a protected next path.
  if (next) {
    const target = new URL(next, 'https://portal.invalid');
    if (target.origin === 'https://portal.invalid' && target.pathname === '/.lovable/oauth/consent') {
      return target.pathname + target.search;
    }
  }
  return access === 'staff' ? '/' : '/morador';
}