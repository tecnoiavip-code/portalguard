import { describe, expect, test } from 'bun:test';
import { buildIdentificationResponse, residentHardwareId, type AccessDecision } from '../supabase/functions/controlid-webhook/identification-response';

const url = new URL('http://localhost/functions/v1/controlid-webhook');
const grant: AccessDecision = { allow: true, reason: 'Morador ativo', source: 'db', resident: 'MARIA SILVA' };
const response = (payload: Record<string, unknown>, decision = grant) =>
  buildIdentificationResponse(payload, url, decision) as Record<string, unknown>;

describe('Control iD centralized authorization', () => {
  test('database grant overrides an unknown local TAG (event 3)', () => {
    expect(response({ event: 3, user_id: 0, card_value: '000123' }).event).toBe(7);
  });
  test('database grant overrides a local denial (event 6)', () => {
    expect(response({ event: 6, user_id: 0 }).event).toBe(7);
  });
  test('authorized response carries the resident name from the database', () => {
    expect(response({ user_name: 'Nome antigo' }).user_name).toBe('MARIA SILVA');
  });
  test('authorized response pulses only the configured relay', () => {
    expect(response({ portal_id: '2' }).actions).toEqual([
      { action: 'sec_box', parameters: 'id=65793, reason=1' },
    ]);
    const internal = buildIdentificationResponse({ portal_id: '2' }, url, grant, 'door') as Record<string, unknown>;
    expect(internal.actions).toEqual([{ action: 'door', parameters: 'door=2' }]);
  });
  test('invalid portal defaults to relay 1', () => {
    const internal = buildIdentificationResponse({ portal_id: 'invalid' }, url, grant, 'door') as Record<string, unknown>;
    expect(internal.actions).toEqual([
      { action: 'door', parameters: 'door=1' },
    ]);
  });
  test('database denial never opens a relay even when the device grants', () => {
    const result = response({ event: 7, user_id: 42 }, { ...grant, allow: false });
    expect(result.event).toBe(6);
    expect(result).not.toHaveProperty('actions');
  });
  test('fallback cannot convert device unknown or denied events into access', () => {
    for (const event of [0, 3, 6]) {
      const result = response({ event, user_id: 42 }, { ...grant, source: 'fallback' });
      expect(result.event).toBe(6);
      expect(result).not.toHaveProperty('actions');
    }
  });
  test('hybrid fallback preserves explicit identified device authorization', () => {
    expect(response({ event: 7, user_id: 42 }, { ...grant, source: 'fallback' }).event).toBe(7);
  });
  test('device authorization without an identity is denied in fallback', () => {
    expect(response({ event: 7, user_id: 0 }, { allow: true, reason: 'Timeout', source: 'fallback' }).event).toBe(6);
  });
  test('official fcgi callbacks wrap the result, base callbacks remain flat', () => {
    expect(buildIdentificationResponse({ event: 3 }, new URL(`${url}/new_user_identified.fcgi`), grant)).toHaveProperty('result.event', 7);
    expect(response({ event: 3 })).not.toHaveProperty('result');
  });
  test('preserves the synced hardware user ID rather than replacing it with a constant', () => {
    expect(response({ user_id: '12345' }).user_id).toBe(12345);
  });
  test('unknown TAG gets the same deterministic resident ID as synchronization', () => {
    expect(residentHardwareId('abc')).toBe(96354);
    expect(response({ user_id: 0 }, { ...grant, resolved_user_id: residentHardwareId('abc') }).user_id).toBe(96354);
  });
});