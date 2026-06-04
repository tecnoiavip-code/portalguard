import { supabase } from '@/integrations/supabase/client';

type AuditMetadata = Record<string, unknown>;

export async function recordAuditLog(
  action: string,
  entityType: string,
  entityId: string | null | undefined,
  summary: string,
  metadata: AuditMetadata = {},
) {
  try {
    await (supabase as any).rpc('record_audit_log', {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId || null,
      p_summary: summary,
      p_metadata: metadata,
    });
  } catch (error) {
    console.warn('Audit log skipped:', error);
  }
}
