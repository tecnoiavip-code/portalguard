import { supabase } from '@/integrations/supabase/client';
import { parsePortalAccess, type PortalAccess } from './portal-access-policy';

export async function resolvePortalAccess(): Promise<PortalAccess> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return 'denied';
  // Application-owned RPC on the configured database; absent RPC fails closed.
  const { data: access, error: accessError } = await (supabase as any).rpc('resolve_portal_access');
  if (accessError) throw new Error('Não foi possível validar sua permissão de acesso. Contate a administração.');
  return parsePortalAccess(access);
}