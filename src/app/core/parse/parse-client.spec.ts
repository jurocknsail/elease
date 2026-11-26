import { TestBed } from '@angular/core/testing';
import Parse from 'parse';
import { INVALID_SESSION_TOKEN, NoSessionError, ParseClient } from './parse-client';

/**
 * The real SDK adapter, exercised offline: no request is ever made (nothing is saved or fetched, and
 * `Parse.initialize` is stubbed so no credential is configured).
 */
describe('ParseClient (SDK adapter)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes the SDK lazily, with the environment values, and only once', () => {
    const initialize = vi.spyOn(Parse, 'initialize').mockImplementation(() => undefined);

    const client = TestBed.inject(ParseClient);
    expect(initialize).not.toHaveBeenCalled();

    client.newObject('Lease');
    client.objectRef('Lease', 'a');
    client.query('Lease');

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0].every((argument) => typeof argument === 'string')).toBe(true);
  });

  it('builds an owner-only ACL for the signed-in user, as the legacy app did', () => {
    const user = new Parse.User();
    user.id = 'user-1';
    vi.spyOn(Parse.User, 'current').mockReturnValue(user as never);

    const acl = TestBed.inject(ParseClient).ownerAcl();

    expect(acl.toJSON()).toEqual({ 'user-1': { read: true, write: true } });
  });

  it('refuses to build an ACL without a session, with the invalid-session code', () => {
    vi.spyOn(Parse.User, 'current').mockReturnValue(null as never);
    const client = TestBed.inject(ParseClient);

    expect(() => client.ownerAcl()).toThrow(NoSessionError);
    try {
      client.ownerAcl();
    } catch (error) {
      expect((error as NoSessionError).code).toBe(INVALID_SESSION_TOKEN);
    }
  });
});
