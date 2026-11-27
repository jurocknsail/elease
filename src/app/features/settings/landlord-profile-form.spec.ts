import { FormBuilder } from '@angular/forms';
import { DEFAULT_LANDLORD_PROFILE, LandlordProfile } from '../../core/models/landlord-profile';
import { buildProfileForm, isProfileChanged, profileFromForm } from './landlord-profile-form';

const fb = new FormBuilder();

const profile = (overrides: Partial<LandlordProfile> = {}): LandlordProfile => ({
  objectId: 'p1',
  name: 'SCI DES TESTS',
  addressLines: ['1 RUE DES TESTS', '13600 VILLE-TEST'],
  issueCity: 'VILLE-TEST',
  legalNotice: 'SCI DES TESTS au capital de 1000 euros.',
  emailSignature: 'Sophie TEST',
  ...overrides,
});

describe('landlord profile form', () => {
  it('is valid for the default profile (the migration values)', () => {
    expect(buildProfileForm(fb, DEFAULT_LANDLORD_PROFILE).valid).toBe(true);
  });

  it.each([
    ['name', { name: '  ' }],
    ['name', { name: 'a'.repeat(81) }],
    ['name', { name: 'SCI\nTEST' }],
    ['issueCity', { issueCity: '' }],
    ['emailSignature', { emailSignature: '' }],
    ['emailSignature', { emailSignature: 'Sophie\nTEST' }],
  ])('refuses an invalid %s', (field, patch) => {
    const form = buildProfileForm(fb, profile());
    form.patchValue(patch);
    expect(form.controls[field as 'name'].invalid).toBe(true);
    expect(form.invalid).toBe(true);
  });

  it('needs the first address line, the second is optional and each is a single line of at most 80', () => {
    const form = buildProfileForm(fb, profile({ addressLines: ['1 RUE', ''] }));
    expect(form.valid).toBe(true);

    form.patchValue({ addressLine1: '' });
    expect(form.controls.addressLine1.invalid).toBe(true);

    form.patchValue({ addressLine1: '1 RUE', addressLine2: 'a\nb' });
    expect(form.controls.addressLine2.invalid).toBe(true);
    form.patchValue({ addressLine2: 'a'.repeat(81) });
    expect(form.controls.addressLine2.invalid).toBe(true);
  });

  it('accepts a multi-line legal notice, or none', () => {
    const form = buildProfileForm(fb, profile());
    form.patchValue({ legalNotice: 'Ligne 1\nLigne 2' });
    expect(form.valid).toBe(true);
    form.patchValue({ legalNotice: '' });
    expect(form.valid).toBe(true);
  });

  it('builds the profile to save from trimmed values, keeping the id and dropping blank address lines', () => {
    const form = buildProfileForm(fb, profile());
    form.setValue({
      name: '  SCI NOUVELLE  ',
      addressLine1: ' 2 RUE B ',
      addressLine2: '   ',
      issueCity: ' PARIS ',
      legalNotice: '  Mention\r\nsuite \n',
      emailSignature: ' Jean TEST ',
    });
    expect(profileFromForm(form.getRawValue(), profile())).toEqual({
      objectId: 'p1',
      name: 'SCI NOUVELLE',
      addressLines: ['2 RUE B'],
      issueCity: 'PARIS',
      legalNotice: 'Mention\nsuite',
      emailSignature: 'Jean TEST',
    });
  });

  it('knows whether the form differs from the saved profile (spaces do not count)', () => {
    const saved = profile();
    const form = buildProfileForm(fb, saved);
    expect(isProfileChanged(profileFromForm(form.getRawValue(), saved), saved)).toBe(false);
    form.patchValue({ name: ' SCI DES TESTS ' });
    expect(isProfileChanged(profileFromForm(form.getRawValue(), saved), saved)).toBe(false);
    form.patchValue({ issueCity: 'AUTRE' });
    expect(isProfileChanged(profileFromForm(form.getRawValue(), saved), saved)).toBe(true);
  });
});
