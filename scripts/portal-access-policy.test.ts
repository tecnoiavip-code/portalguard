import { describe, expect, test } from 'bun:test';
import { parsePortalAccess, portalDestination } from '../src/lib/portal-access-policy';

describe('Portal access rules', () => {
  test('server-approved staff reaches portaria', () => {
    expect(portalDestination(parsePortalAccess('staff'))).toBe('/');
  });
  test('resident cannot enter portaria through next', () => {
    expect(portalDestination(parsePortalAccess('resident'), '/')).toBe('/morador');
  });
  test('missing or failed role resolution never grants staff', () => {
    for (const value of [null, undefined, 'admin', {}, 'denied']) {
      expect(portalDestination(parsePortalAccess(value))).toBe('/auth');
    }
  });
  test('only same-origin consent continuation is preserved', () => {
    expect(portalDestination('resident', '/.lovable/oauth/consent?authorization_id=123')).toBe('/.lovable/oauth/consent?authorization_id=123');
    expect(portalDestination('resident', '//external.invalid/')).toBe('/morador');
  });
});