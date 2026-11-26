import { Injectable, inject } from '@angular/core';
import { DEFAULT_LANDLORD_PROFILE, LandlordProfile } from '../models/landlord-profile';
import { landlordProfileFromParse, landlordProfileToParseFields } from './mapping';
import { NoSessionError, ParseClient, RemoteObject } from './parse-client';
import { withTimeout } from './with-timeout';

const PROFILE_CLASS = 'LandlordProfile';

/**
 * The landlord profile of the signed-in user (class `LandlordProfile`: `name`, `addressLines`,
 * `issueCity`, `legalNotice`, `emailSignature`, and a `user` pointer to `_User`), readable and
 * writable by its owner only. Parse errors propagate unchanged.
 */
@Injectable({ providedIn: 'root' })
export class LandlordProfileRepository {
  private readonly client = inject(ParseClient);
  private pendingGet: Promise<LandlordProfile> | null = null;

  /**
   * The user's profile. A user without one gets it created from `DEFAULT_LANDLORD_PROFILE` (the values
   * that were hard-coded in the legacy app), so PDFs and e-mails stay identical. Simultaneous calls
   * share one request, so a profile is never created twice by two screens opening together.
   */
  get(): Promise<LandlordProfile> {
    this.pendingGet ??= this.loadOrCreate().finally(() => {
      this.pendingGet = null;
    });
    return this.pendingGet;
  }

  async save(profile: LandlordProfile): Promise<void> {
    const existing = profile.objectId
      ? await withTimeout(this.client.fetchById(PROFILE_CLASS, profile.objectId))
      : await this.findOwn();
    if (!existing) {
      await this.create(profile);
      return;
    }
    this.fill(existing, profile);
    await withTimeout(existing.save());
  }

  private async loadOrCreate(): Promise<LandlordProfile> {
    const existing = await this.findOwn();
    const object = existing ?? (await this.create(DEFAULT_LANDLORD_PROFILE));
    return landlordProfileFromParse(object.toJSON());
  }

  private findOwn(): Promise<RemoteObject | undefined> {
    const user = this.requireUser();
    return withTimeout(
      this.client.query(PROFILE_CLASS).equalTo('user', user).ascending('createdAt').first(),
    );
  }

  private create(profile: LandlordProfile): Promise<RemoteObject> {
    const user = this.requireUser();
    const object = this.client.newObject(PROFILE_CLASS);
    this.fill(object, profile);
    object.set('user', user);
    object.setACL(this.client.ownerAcl());
    return withTimeout(object.save());
  }

  private fill(object: RemoteObject, profile: LandlordProfile): void {
    for (const [key, value] of Object.entries(landlordProfileToParseFields(profile))) {
      object.set(key, value);
    }
  }

  private requireUser(): RemoteObject {
    const user = this.client.currentUser();
    if (!user) {
      throw new NoSessionError();
    }
    return user;
  }
}
