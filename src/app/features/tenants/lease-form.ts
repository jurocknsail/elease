import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { isSingleEmailAddress } from '../../core/email/email-guard';
import {
  formatPostalCode,
  isValidPhone,
  normalizePhone,
  parseFrenchNumber,
  toFieldNumber,
} from '../../core/format/fr';
import { INDEX_TYPES, IndexType, Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';
import { parseDateInput, toDateInputValue } from '../rent-calls/send-state';

/*
 * Form logic of the tenant screens: the forms (every field is text, exactly what the user typed), their
 * validators, and the conversion back to the models. Pure: no component, no backend.
 *
 * What a lease must carry to be billed correctly is enforced here: the PDF prints the postal code and
 * the street number, so both are required (a missing one would print « 00000 VILLE » / « 0 RUE »);
 * every optional value that is left empty becomes `null` / absent, never `''` and never `0`.
 * `lastSendDate`, `lastSentPeriod`, `lastSentPeriodAt` and `revisionReminderSentFor` are bookkeeping of
 * the sends and of the reminders: the form never edits them, `leaseFromForm` only carries them over.
 */

export const CONTACT_NAME_MAX = 80;

/** The index family a lease starts with: ILAT for a professional lease, IRL for housing. */
export function defaultIndexType(isPro: boolean): IndexType {
  return isPro ? 'ILAT' : 'IRL';
}

export type ChargeGroup = FormGroup<{
  title: FormControl<string>;
  amount: FormControl<string>;
}>;

export type LeaseForm = FormGroup<{
  isPro: FormControl<boolean>;
  name: FormControl<string>;
  lot: FormControl<string>;
  streetNumber: FormControl<string>;
  streetName: FormControl<string>;
  optionalAddressInfo: FormControl<string>;
  postalCode: FormControl<string>;
  city: FormControl<string>;
  price: FormControl<string>;
  charge: FormControl<string>;
  additionalCharges: FormArray<ChargeGroup>;
  renewalDate: FormControl<string>;
  indexType: FormControl<IndexType>;
  referenceIndexQuarter: FormControl<string>;
  referenceIndexValue: FormControl<string>;
}>;

export type LeaseFormValue = ReturnType<LeaseForm['getRawValue']>;

export type ContactForm = FormGroup<{
  name: FormControl<string>;
  email: FormControl<string>;
  phone: FormControl<string>;
}>;

export type ContactFormValue = ReturnType<ContactForm['getRawValue']>;

// ---------------------------------------------------------------------------------------------
// Validators (all of them look at the trimmed text; an empty optional field is always valid)

const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === '';

const required: ValidatorFn = (control) => (isBlank(control.value) ? { required: true } : null);

function maxLength(max: number): ValidatorFn {
  return (control) =>
    typeof control.value === 'string' && control.value.trim().length > max
      ? { maxlength: { max } }
      : null;
}

/** Exactly five digits: '01000' yes, '1000' no (the stored number is padded back for display). */
const postalCode: ValidatorFn = (control) =>
  isBlank(control.value) || /^\d{5}$/.test(control.value.trim()) ? null : { postalCode: true };

/** A street number is a whole number from 1: 0 is what a missing number is stored as. */
const streetNumber: ValidatorFn = (control) => {
  if (isBlank(control.value)) {
    return null;
  }
  const text = control.value.trim();
  return /^\d{1,6}$/.test(text) && Number(text) >= 1 ? null : { streetNumber: true };
};

/** Optional whole number (the lot). */
const wholeNumber: ValidatorFn = (control) =>
  isBlank(control.value) || /^\d{1,6}$/.test(control.value.trim()) ? null : { integer: true };

/** An amount in euros typed the French way: a number, not negative, at most two decimals. */
const amount: ValidatorFn = (control) => {
  if (isBlank(control.value)) {
    return null;
  }
  const value = parseFrenchNumber(control.value);
  if (value === null) {
    return { number: true };
  }
  if (value < 0) {
    return { negative: true };
  }
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6 ? null : { decimals: true };
};

/** The value of the reference index: a number above 0. */
const indexValue: ValidatorFn = (control) => {
  if (isBlank(control.value)) {
    return null;
  }
  const value = parseFrenchNumber(control.value);
  if (value === null) {
    return { number: true };
  }
  return value > 0 ? null : { notPositive: true };
};

const QUARTER = /^\d{4}-T[1-4]$/;
const quarter: ValidatorFn = (control) =>
  isBlank(control.value) || QUARTER.test(control.value.trim()) ? null : { quarter: true };

const dateInput: ValidatorFn = (control) =>
  isBlank(control.value) || parseDateInput(control.value) !== null ? null : { date: true };

/** The shape the sender accepts (`a@b` and lists of addresses are refused here too). */
const email: ValidatorFn = (control): ValidationErrors | null =>
  isBlank(control.value) || isSingleEmailAddress(control.value) ? null : { email: true };

const phone: ValidatorFn = (control) =>
  isBlank(control.value) || isValidPhone(control.value) ? null : { phone: true };

/** Exported for the specs and for fields built outside the two forms. */
export const validators = {
  required,
  maxLength,
  postalCode,
  streetNumber,
  wholeNumber,
  amount,
  indexValue,
  quarter,
  dateInput,
  email,
  phone,
};

const MESSAGES: Record<string, string> = {
  required: 'Ce champ est obligatoire.',
  maxlength: `Trop long (${CONTACT_NAME_MAX} caractères au maximum).`,
  postalCode: 'Le code postal comporte exactement 5 chiffres.',
  streetNumber: 'Saisissez le numéro de voie (nombre entier, 1 ou plus).',
  integer: 'Saisissez un nombre entier.',
  number: 'Saisissez un nombre (par exemple 1 234,56).',
  negative: 'Le montant ne peut pas être négatif.',
  decimals: 'Deux décimales au maximum.',
  notPositive: 'La valeur doit être supérieure à 0.',
  quarter: 'Format attendu : 2025-T2 (année, T, trimestre de 1 à 4).',
  date: 'Date invalide.',
  email: 'Saisissez une seule adresse e-mail valide (par exemple nom@exemple.fr).',
  phone: 'Numéro de téléphone invalide (par exemple 06 12 34 56 78 ou +33 6 12 34 56 78).',
};

/** The French message of the first error of a control, or null when it is valid. */
export function errorMessage(control: AbstractControl | null): string | null {
  const errors = control?.errors;
  if (!errors) {
    return null;
  }
  const key = Object.keys(errors)[0];
  return MESSAGES[key] ?? 'Valeur invalide.';
}

// ---------------------------------------------------------------------------------------------
// Lease

function chargeGroup(fb: FormBuilder, title = '', value = ''): ChargeGroup {
  return fb.nonNullable.group({
    title: fb.nonNullable.control(title, [required]),
    amount: fb.nonNullable.control(value, [required, amount]),
  });
}

/** A new, empty « charge additionnelle » row, for the « + Ajouter une charge » button. */
export function buildChargeGroup(fb: FormBuilder): ChargeGroup {
  return chargeGroup(fb);
}

/**
 * The form of a lease, filled from `lease` when given (editing) or empty (adding). A missing postal
 * code or street number (stored as 0) is shown empty so that it has to be entered; lot 0 and a missing
 * lot both show empty. `indexType` starts at the lease's, or at the default of its kind.
 */
export function buildLeaseForm(fb: FormBuilder, lease?: Lease): LeaseForm {
  const text = (value: string, ...checks: ValidatorFn[]) => fb.nonNullable.control(value, checks);
  const isPro = lease?.isPro ?? false;
  const form: LeaseForm = fb.nonNullable.group({
    isPro: fb.nonNullable.control(isPro),
    name: text(lease?.name ?? '', required),
    lot: text(lease?.lot ? String(lease.lot) : '', wholeNumber),
    streetNumber: text(
      lease && lease.streetNumber > 0 ? String(lease.streetNumber) : '',
      required,
      streetNumber,
    ),
    streetName: text(lease?.streetName ?? '', required),
    optionalAddressInfo: text(lease?.optionalAddressInfo ?? ''),
    postalCode: text(
      lease && lease.postalCode > 0 ? formatPostalCode(lease.postalCode) : '',
      required,
      postalCode,
    ),
    city: text(lease?.city ?? '', required),
    price: text(lease ? toFieldNumber(lease.price) : '', required, amount),
    charge: text(lease?.charge != null ? toFieldNumber(lease.charge) : '', amount),
    additionalCharges: fb.array<ChargeGroup>(
      (lease?.additionalCharges ?? []).map((charge) =>
        chargeGroup(fb, charge.title, toFieldNumber(charge.amount)),
      ),
    ),
    renewalDate: text(
      lease?.renewalDate != null ? toDateInputValue(new Date(lease.renewalDate)) : '',
      dateInput,
    ),
    indexType: fb.nonNullable.control<IndexType>(lease?.indexType ?? defaultIndexType(isPro)),
    referenceIndexQuarter: text(lease?.referenceIndexQuarter ?? '', quarter),
    referenceIndexValue: text(
      lease?.referenceIndexValue !== undefined ? toFieldNumber(lease.referenceIndexValue) : '',
      indexValue,
    ),
  });

  // While the lease has no index family of its own, the default follows its kind (Habitation / Pro).
  if (lease?.indexType === undefined) {
    form.controls.isPro.valueChanges.subscribe((pro) => {
      if (!form.controls.indexType.dirty) {
        form.controls.indexType.setValue(defaultIndexType(pro));
      }
    });
  }
  return form;
}

function requiredNumber(text: string, what: string): number {
  const value = parseFrenchNumber(text);
  if (value === null) {
    throw new Error(`Formulaire invalide : ${what}.`);
  }
  return value;
}

/** Empty or 0 means « no lot ». */
function lotFromText(text: string): number | null {
  const value = parseFrenchNumber(text);
  return value === null || value === 0 ? null : value;
}

/**
 * The anniversary date from the date field. Left alone when the field still shows the stored date:
 * a stored timestamp that is not at local midnight is kept exactly, so that an edit of something
 * else never rewrites it.
 */
function renewalFromInput(text: string, stored: number | null): number | null {
  if (isBlank(text)) {
    return null;
  }
  if (stored !== null && toDateInputValue(new Date(stored)) === text.trim()) {
    return stored;
  }
  const date = parseDateInput(text);
  if (!date) {
    throw new Error('Formulaire invalide : date anniversaire.');
  }
  return date.getTime();
}

/**
 * The lease described by a (valid) form value. With `base`, the editable fields are replaced and
 * everything else is kept, the bookkeeping of the sends included. Empty optional fields give `null`
 * (`lot`, `charge`, `renewalDate`) or no field (index quarter and value); never `''`, never `0` unless 0
 * was typed (a charge of 0). A lease without an index, whose index family is still the default of its
 * kind, stays without one: the default is a suggestion, not something the user entered.
 *
 * Throws if a required value cannot be read: the screens only call it on a valid form, and writing a 0
 * instead would bill a wrong amount.
 */
export function leaseFromForm(value: LeaseFormValue, base?: Lease): Lease {
  const lease: Lease = base
    ? { ...base }
    : {
        isPro: false,
        name: '',
        lot: null,
        streetNumber: 0,
        streetName: '',
        optionalAddressInfo: '',
        postalCode: 0,
        city: '',
        price: 0,
        charge: null,
        additionalCharges: [],
        lastSendDate: 0,
        renewalDate: null,
      };

  lease.isPro = value.isPro;
  lease.name = value.name.trim();
  const lot = lotFromText(value.lot);
  // « No lot » is stored as 0 or as nothing: an untouched lot is never rewritten into the other form.
  lease.lot = lot === null && base?.lot === 0 ? 0 : lot;
  lease.streetNumber = requiredNumber(value.streetNumber, 'numéro de voie');
  lease.streetName = value.streetName.trim();
  lease.optionalAddressInfo = value.optionalAddressInfo.trim();
  lease.postalCode = requiredNumber(value.postalCode, 'code postal');
  lease.city = value.city.trim();
  lease.price = requiredNumber(value.price, 'loyer');
  lease.charge = parseFrenchNumber(value.charge);
  lease.additionalCharges = value.additionalCharges.map((row) => ({
    title: row.title.trim(),
    amount: requiredNumber(row.amount, 'charge additionnelle'),
  }));
  lease.renewalDate = renewalFromInput(value.renewalDate, base?.renewalDate ?? null);

  const referenceQuarter = value.referenceIndexQuarter.trim();
  const referenceValue = parseFrenchNumber(value.referenceIndexValue);
  const keepDefaultOut =
    base?.indexType === undefined &&
    referenceQuarter === '' &&
    referenceValue === null &&
    value.indexType === defaultIndexType(value.isPro);
  if (INDEX_TYPES.includes(value.indexType) && !keepDefaultOut) {
    lease.indexType = value.indexType;
  } else {
    delete lease.indexType;
  }
  if (referenceQuarter !== '') {
    lease.referenceIndexQuarter = referenceQuarter;
  } else {
    delete lease.referenceIndexQuarter;
  }
  if (referenceValue !== null) {
    lease.referenceIndexValue = referenceValue;
  } else {
    delete lease.referenceIndexValue;
  }
  return lease;
}

/**
 * Whether the lease lacks what the annual revision needs: the anniversary date or the reference index
 * (family, quarter, value). Shown as « À compléter ».
 */
export function isLeaseIncomplete(lease: Lease): boolean {
  return (
    lease.renewalDate == null ||
    lease.indexType === undefined ||
    !lease.referenceIndexQuarter ||
    lease.referenceIndexValue === undefined
  );
}

// ---------------------------------------------------------------------------------------------
// Contact

/** The contact form of a tenant, filled from `holder` when given. */
export function buildContactForm(
  fb: FormBuilder,
  holder?: Pick<Leaseholder, 'name' | 'email' | 'phone'>,
): ContactForm {
  return fb.nonNullable.group({
    name: fb.nonNullable.control(holder?.name ?? '', [required, maxLength(CONTACT_NAME_MAX)]),
    email: fb.nonNullable.control(holder?.email ?? '', [required, email]),
    phone: fb.nonNullable.control(holder?.phone ?? '', [phone]),
  });
}

/** What is saved: trimmed name and e-mail, the phone number normalised (blank gives ''). */
export function contactFromForm(value: ContactFormValue): {
  name: string;
  email: string;
  phone: string;
} {
  return {
    name: value.name.trim(),
    email: value.email.trim(),
    phone: normalizePhone(value.phone),
  };
}
