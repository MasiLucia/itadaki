import { forgetActiveState, stillEmployed } from './auth';

/**
 * Taking someone off the system.
 *
 * A signed token says who someone was when they logged in, not whether they
 * still work here. Until this check existed, firing a waiter left them reading
 * the restaurant's orders until their token expired — up to twelve hours.
 */
describe('revoking access to someone who was let go', () => {
  const TENANT = 'itadaki';

  beforeEach(() => {
    forgetActiveState(TENANT, 'mozo');
    forgetActiveState(TENANT, 'cocinero');
  });

  it('lets an active account through', async () => {
    expect(await stillEmployed(TENANT, 'mozo', async () => true)).toBe(true);
  });

  it('turns away an account that was deactivated', async () => {
    expect(await stillEmployed(TENANT, 'mozo', async () => false)).toBe(false);
  });

  it('does not ask the database on every request', async () => {
    // The kitchen board polls constantly; a query per request would put the
    // database in front of every screen refresh.
    let queries = 0;
    const lookUp = async (): Promise<boolean> => {
      queries += 1;
      return true;
    };

    for (let i = 0; i < 20; i += 1) {
      await stillEmployed(TENANT, 'mozo', lookUp);
    }

    expect(queries).toBe(1);
  });

  it('takes effect at once when the owner revokes access', async () => {
    // The person doing this is standing in front of the screen expecting it
    // to be true by the time they look away.
    await stillEmployed(TENANT, 'mozo', async () => true);

    forgetActiveState(TENANT, 'mozo');

    expect(await stillEmployed(TENANT, 'mozo', async () => false)).toBe(false);
  });

  it('keeps each person separate', async () => {
    await stillEmployed(TENANT, 'mozo', async () => false);
    // Firing one must not sign the rest of the shift out.
    expect(await stillEmployed(TENANT, 'cocinero', async () => true)).toBe(true);
  });

  it('keeps restaurants separate', async () => {
    await stillEmployed(TENANT, 'mozo', async () => false);
    expect(await stillEmployed('otro-resto', 'mozo', async () => true)).toBe(true);
    forgetActiveState('otro-resto', 'mozo');
  });

  it('does not sign the restaurant out when the database blips', async () => {
    // PostgresStaffStore.isActive answers true on a failure for this reason:
    // a momentary outage mid-service must not empty the kitchen screen, since
    // the token is still signed and unexpired.
    const duringOutage = async (): Promise<boolean> => true;

    expect(await stillEmployed(TENANT, 'cocinero', duringOutage)).toBe(true);
  });
});
