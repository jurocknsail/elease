import { FormBuilder, FormControl, FormGroup, ValidatorFn } from '@angular/forms';
import { LandlordProfile } from '../../core/models/landlord-profile';
import { validators } from '../tenants/lease-form';

/*
 * Form logic of the « Profil bailleur » card. Pure: no component, no backend. The profile is printed in
 * every PDF (header, « Établie par la … », issue city, legal text) and signs every e-mail, so an empty
 * name or city would print a broken document: those are required, and every single-line field really is
 * one line (a line break in the name would split the header and the sentence « Établie par la … »).
 */

export const PROFILE_TEXT_MAX = 80;
export const LEGAL_NOTICE_MAX = 600;

export type ProfileForm = FormGroup<{
  name: FormControl<string>;
  addressLine1: FormControl<string>;
  addressLine2: FormControl<string>;
  issueCity: FormControl<string>;
  legalNotice: FormControl<string>;
  emailSignature: FormControl<string>;
}>;

export type ProfileFormValue = ReturnType<ProfileForm['getRawValue']>;

const singleLine: ValidatorFn = (control) =>
  typeof control.value === 'string' && /[\r\n]/.test(control.value) ? { singleLine: true } : null;

const line = (...extra: ValidatorFn[]): ValidatorFn[] => [
  ...extra,
  validators.maxLength(PROFILE_TEXT_MAX),
  singleLine,
];

export function buildProfileForm(fb: FormBuilder, profile: LandlordProfile): ProfileForm {
  const control = (value: string, checks: ValidatorFn[]) => fb.nonNullable.control(value, checks);
  return fb.nonNullable.group({
    name: control(profile.name, line(validators.required)),
    addressLine1: control(profile.addressLines[0] ?? '', line(validators.required)),
    addressLine2: control(profile.addressLines[1] ?? '', line()),
    issueCity: control(profile.issueCity, line(validators.required)),
    legalNotice: control(profile.legalNotice, [validators.maxLength(LEGAL_NOTICE_MAX)]),
    emailSignature: control(profile.emailSignature, line(validators.required)),
  });
}

/**
 * The profile the form describes: every text trimmed, blank address lines dropped, line breaks of the
 * legal notice normalised. `base` supplies the id, and any address line beyond the two of the form
 * (none are created by this app) so that saving never silently drops one.
 */
export function profileFromForm(value: ProfileFormValue, base: LandlordProfile): LandlordProfile {
  const addressLines = [value.addressLine1, value.addressLine2, ...base.addressLines.slice(2)]
    .map((text) => text.trim())
    .filter((text) => text !== '');
  return {
    ...(base.objectId ? { objectId: base.objectId } : {}),
    name: value.name.trim(),
    addressLines,
    issueCity: value.issueCity.trim(),
    legalNotice: value.legalNotice.replace(/\r\n?/g, '\n').trim(),
    emailSignature: value.emailSignature.trim(),
  };
}

export function isProfileChanged(a: LandlordProfile, b: LandlordProfile): boolean {
  return (
    a.name !== b.name ||
    a.issueCity !== b.issueCity ||
    a.legalNotice !== b.legalNotice ||
    a.emailSignature !== b.emailSignature ||
    a.addressLines.length !== b.addressLines.length ||
    a.addressLines.some((text, index) => text !== b.addressLines[index])
  );
}
