export type AccessDecision = {
  allow: boolean;
  reason: string;
  source: 'db' | 'fallback';
  resident?: string;
  resolved_user_id?: number;
};

const positiveId = (value: unknown, fallback: number) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : fallback;
};

export const isDeviceAuthorized = (payload: Record<string, unknown>): boolean => {
  const hasIdentity = positiveId(payload.user_id, 0) > 0 ||
    String(payload.user_name || payload.name || '').trim().length > 0;
  return Number(payload.event) === 7 && hasIdentity;
};

export const buildIdentificationResponse = (
  payload: Record<string, unknown>,
  url: URL,
  decision: AccessDecision,
) => {
  // A database grant overrides an unknown local TAG. Contingency never upgrades
  // a device denial into a grant when the database is unavailable.
  const granted = decision.allow &&
    (decision.source === 'db' || isDeviceAuthorized(payload));
  const portalId = positiveId(payload.portal_id, 1);
  const result: Record<string, unknown> = {
    event: granted ? 7 : 6,
    user_id: positiveId(decision.resolved_user_id, positiveId(payload.user_id, 0)),
    user_name: String(decision.resident || payload.user_name || payload.name || '').trim().slice(0, 200),
    user_image: granted && [1, '1', true, 'true'].includes(payload.user_has_image as string | number | boolean),
    portal_id: portalId,
  };
  if (granted) {
    result.actions = [
      { action: 'sec_box', parameters: 'id=65793, reason=1' },
      { action: 'door', parameters: `door=${portalId}` },
    ];
  }
  return url.pathname.toLowerCase().includes('.fcgi') ? { result } : result;
};