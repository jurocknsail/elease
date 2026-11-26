import { FormBuilder } from '@angular/forms';
import { parseFrenchNumber } from '../../core/format/fr';
import { Lease } from '../../core/models/lease';
import {
  buildChargeGroup,
  buildContactForm,
  buildLeaseForm,
  contactFromForm,
  isLeaseIncomplete,
  leaseFromForm,
} from './lease-form';

const fb = new FormBuilder();

/** Fictitious lease, complete. */
function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    objectId: 'l1',
    isPro: false,
    name: 'Studio',
    lot: 4,
    streetNumber: 12,
    streetName: 'rue des Tests',
    optionalAddressInfo: 'Bât. B',
    postalCode: 1000,
    city: 'Ville-Test',
    price: 600,
    charge: 40,
    additionalCharges: [{ title: 'Parking', amount: 35 }],
    lastSendDate: 1700000000000,
    renewalDate: new Date(2027, 2, 1).getTime(),
    ...overrides,
  };
}

/** A new-lease form with the required fields filled in, as a user would. */
function filledForm(values: Record<string, string> = {}) {
  const form = buildLeaseForm(fb);
  form.patchValue({
    name: 'Cave',
    streetNumber: '3',
    streetName: 'rue des Tests',
    postalCode: '13600',
    city: 'Ville-Test',
    price: '50',
    ...values,
  });
  return form;
}

describe('lease form', () => {
  it('is valid without lot, charge, anniversary date and index', () => {
    const form = filledForm();
    expect(form.valid).toBe(true);
    const created = leaseFromForm(form.getRawValue());
    expect(created.lot).toBeNull();
    expect(created.charge).toBeNull();
    expect(created.renewalDate).toBeNull();
    expect(created.optionalAddressInfo).toBe('');
    expect(created.additionalCharges).toEqual([]);
    expect(created.lastSendDate).toBe(0);
    expect(created).not.toHaveProperty('referenceIndexQuarter');
    expect(created).not.toHaveProperty('referenceIndexValue');
  });

  it('requires name, street number, street, postal code, city and rent', () => {
    const form = buildLeaseForm(fb);
    const invalid = Object.entries(form.controls)
      .filter(([, control]) => control.invalid)
      .map(([name]) => name)
      .sort();
    expect(invalid).toEqual(['city', 'name', 'postalCode', 'price', 'streetName', 'streetNumber']);
  });

  it('shows a missing postal code or street number (stored as 0) empty, so that it must be entered', () => {
    const form = buildLeaseForm(fb, lease({ postalCode: 0, streetNumber: 0, lot: 0 }));
    expect(form.controls.postalCode.value).toBe('');
    expect(form.controls.streetNumber.value).toBe('');
    expect(form.controls.lot.value).toBe('');
    expect(form.invalid).toBe(true);
  });

  it('accepts a postal code of exactly five digits only', () => {
    const form = filledForm();
    form.controls.postalCode.setValue('1000');
    expect(form.controls.postalCode.valid).toBe(false);
    form.controls.postalCode.setValue('01000');
    expect(form.controls.postalCode.valid).toBe(true);
    form.controls.postalCode.setValue('1300A');
    expect(form.controls.postalCode.valid).toBe(false);
    // The stored number loses the zero; the form puts it back.
    expect(buildLeaseForm(fb, lease({ postalCode: 1000 })).controls.postalCode.value).toBe('01000');
    form.controls.postalCode.setValue('01000');
    expect(leaseFromForm(form.getRawValue()).postalCode).toBe(1000);
  });

  it('refuses a street number of 0 or that is not a whole number', () => {
    const form = filledForm();
    for (const bad of ['0', '12,5', 'abc', '-3']) {
      form.controls.streetNumber.setValue(bad);
      expect(form.controls.streetNumber.valid).toBe(false);
    }
    form.controls.streetNumber.setValue('12');
    expect(form.controls.streetNumber.valid).toBe(true);
  });

  it('keeps the bookkeeping of the sends of the base lease: the form never edits it', () => {
    const base = lease({
      lastSendDate: 1700000000000,
      lastSentPeriod: '2026-12',
      lastSentPeriodAt: 1700000000000,
      revisionReminderSentFor: '2027-03-01',
    });
    const form = buildLeaseForm(fb, base);
    form.controls.price.setValue('650');
    const saved = leaseFromForm(form.getRawValue(), base);
    expect(saved.price).toBe(650);
    expect(saved.objectId).toBe('l1');
    expect(saved.lastSendDate).toBe(1700000000000);
    expect(saved.lastSentPeriod).toBe('2026-12');
    expect(saved.lastSentPeriodAt).toBe(1700000000000);
    expect(saved.revisionReminderSentFor).toBe('2027-03-01');
  });

  it('leaves an untouched lease exactly as it was (stored anniversary time of day included)', () => {
    const base = lease({
      renewalDate: new Date(2027, 2, 1, 13, 45).getTime(),
      indexType: 'IRL',
      referenceIndexQuarter: '2025-T2',
      referenceIndexValue: 145.47,
    });
    const form = buildLeaseForm(fb, base);
    expect(form.valid).toBe(true);
    expect(leaseFromForm(form.getRawValue(), base)).toEqual(base);
  });

  describe('empty optional fields', () => {
    it('become null, never an empty string and never 0', () => {
      const base = lease();
      const form = buildLeaseForm(fb, base);
      form.patchValue({ lot: '', charge: '', renewalDate: '', optionalAddressInfo: '  ' });
      form.controls.additionalCharges.clear();
      const saved = leaseFromForm(form.getRawValue(), base);
      expect(saved.lot).toBeNull();
      expect(saved.charge).toBeNull();
      expect(saved.renewalDate).toBeNull();
      expect(saved.optionalAddressInfo).toBe('');
      expect(saved.additionalCharges).toEqual([]);
    });

    it('treats lot 0 as no lot, and keeps a charge that was typed as 0', () => {
      const form = filledForm({ lot: '0', charge: '0' });
      const saved = leaseFromForm(form.getRawValue());
      expect(saved.lot).toBeNull();
      expect(saved.charge).toBe(0);
    });

    it('clears the reference index when its fields are emptied', () => {
      const base = lease({
        indexType: 'IRL',
        referenceIndexQuarter: '2025-T2',
        referenceIndexValue: 145.47,
      });
      const form = buildLeaseForm(fb, base);
      form.patchValue({ referenceIndexQuarter: '', referenceIndexValue: '' });
      const saved = leaseFromForm(form.getRawValue(), base);
      expect(saved).not.toHaveProperty('referenceIndexQuarter');
      expect(saved).not.toHaveProperty('referenceIndexValue');
    });
  });

  describe('amounts', () => {
    it('are read from French input: « 1 234,56 » and « 1234.56 » are the same number', () => {
      expect(parseFrenchNumber('1 234,56')).toBe(1234.56);
      expect(parseFrenchNumber('1234.56')).toBe(1234.56);
      const nbsp = String.fromCharCode(0xa0, 0x202f);
      expect(parseFrenchNumber(`1${nbsp[0]}234,56${nbsp[1]}€`)).toBe(1234.56);
      expect(parseFrenchNumber('1.234,56')).toBe(1234.56);
      expect(parseFrenchNumber('1,234.56')).toBe(1234.56);
      expect(parseFrenchNumber('0,5')).toBe(0.5);
      expect(parseFrenchNumber('')).toBeNull();
      expect(parseFrenchNumber('12 abc')).toBeNull();
      expect(parseFrenchNumber('1,2,3')).toBeNull();
      const form = filledForm({ price: '1 234,56', charge: '75.5' });
      const saved = leaseFromForm(form.getRawValue());
      expect(saved.price).toBe(1234.56);
      expect(saved.charge).toBe(75.5);
    });

    it('refuse a negative or malformed rent, charge or extra charge', () => {
      const form = filledForm();
      for (const bad of ['-5', 'abc', '12,345']) {
        form.controls.price.setValue(bad);
        expect(form.controls.price.valid).toBe(false);
        form.controls.charge.setValue(bad);
        expect(form.controls.charge.valid).toBe(false);
      }
      form.controls.price.setValue('0');
      expect(form.controls.price.valid).toBe(true);
    });

    it('require a title and an amount (not negative) for each additional charge', () => {
      const form = filledForm();
      form.controls.additionalCharges.push(buildChargeGroup(fb));
      expect(form.valid).toBe(false);
      const row = form.controls.additionalCharges.at(0);
      row.patchValue({ title: 'Parking' });
      expect(form.valid).toBe(false);
      row.patchValue({ amount: '-3' });
      expect(form.valid).toBe(false);
      row.patchValue({ amount: '35,5' });
      expect(form.valid).toBe(true);
      expect(leaseFromForm(form.getRawValue()).additionalCharges).toEqual([
        { title: 'Parking', amount: 35.5 },
      ]);
    });
  });

  describe('anniversary date', () => {
    it('is optional, and read back as the same local day', () => {
      const form = filledForm({ renewalDate: '2027-03-01' });
      expect(form.valid).toBe(true);
      expect(leaseFromForm(form.getRawValue()).renewalDate).toBe(new Date(2027, 2, 1).getTime());
      form.controls.renewalDate.setValue('2027-02-31');
      expect(form.controls.renewalDate.valid).toBe(false);
    });
  });

  describe('reference index', () => {
    it('defaults to IRL for housing and ILAT for a professional lease', () => {
      expect(buildLeaseForm(fb).controls.indexType.value).toBe('IRL');
      expect(buildLeaseForm(fb, lease({ isPro: true })).controls.indexType.value).toBe('ILAT');
      expect(buildLeaseForm(fb, lease({ indexType: 'ILC' })).controls.indexType.value).toBe('ILC');
    });

    it('follows the kind of lease until the family is chosen, but never overrides a choice', () => {
      const form = buildLeaseForm(fb);
      form.controls.isPro.setValue(true);
      expect(form.controls.indexType.value).toBe('ILAT');
      form.controls.indexType.setValue('ILC');
      form.controls.indexType.markAsDirty();
      form.controls.isPro.setValue(false);
      expect(form.controls.indexType.value).toBe('ILC');
    });

    it('accepts quarters like 2025-T2 only', () => {
      const form = filledForm();
      for (const bad of ['2025-T5', '2025-T0', '25-T2', '2025T2', '2025-t2']) {
        form.controls.referenceIndexQuarter.setValue(bad);
        expect(form.controls.referenceIndexQuarter.valid).toBe(false);
      }
      form.controls.referenceIndexQuarter.setValue('2025-T2');
      expect(form.controls.referenceIndexQuarter.valid).toBe(true);
    });

    it('needs a value above 0', () => {
      const form = filledForm();
      for (const bad of ['0', '-1', 'abc']) {
        form.controls.referenceIndexValue.setValue(bad);
        expect(form.controls.referenceIndexValue.valid).toBe(false);
      }
      form.controls.referenceIndexValue.setValue('145,47');
      expect(form.controls.referenceIndexValue.valid).toBe(true);
    });

    it('does not invent an index for a lease that has none: the default family alone is not saved', () => {
      const base = lease();
      const form = buildLeaseForm(fb, base);
      expect(leaseFromForm(form.getRawValue(), base)).not.toHaveProperty('indexType');
      form.patchValue({ referenceIndexQuarter: '2025-T2', referenceIndexValue: '145,47' });
      const saved = leaseFromForm(form.getRawValue(), base);
      expect(saved.indexType).toBe('IRL');
      expect(saved.referenceIndexQuarter).toBe('2025-T2');
      expect(saved.referenceIndexValue).toBe(145.47);
    });
  });

  it('flags a lease that lacks its anniversary date or its index as incomplete', () => {
    const complete = lease({
      indexType: 'IRL',
      referenceIndexQuarter: '2025-T2',
      referenceIndexValue: 145.47,
    });
    expect(isLeaseIncomplete(complete)).toBe(false);
    expect(isLeaseIncomplete({ ...complete, renewalDate: null })).toBe(true);
    expect(isLeaseIncomplete({ ...complete, indexType: undefined })).toBe(true);
    expect(isLeaseIncomplete({ ...complete, referenceIndexQuarter: undefined })).toBe(true);
    expect(isLeaseIncomplete({ ...complete, referenceIndexValue: undefined })).toBe(true);
  });
});

describe('contact form', () => {
  const valid = { name: 'Camille Lefèvre', email: 'camille@example.test', phone: '' };

  it('requires a name of at most 80 characters and an e-mail address', () => {
    const form = buildContactForm(fb);
    expect(form.invalid).toBe(true);
    form.setValue(valid);
    expect(form.valid).toBe(true);
    form.controls.name.setValue('x'.repeat(81));
    expect(form.controls.name.valid).toBe(false);
    form.controls.name.setValue('   ');
    expect(form.controls.name.valid).toBe(false);
  });

  it('refuses what the sender refuses: a@b, several addresses, a display name', () => {
    const form = buildContactForm(fb, valid);
    for (const bad of [
      'a@b',
      'a@b.fr, c@d.fr',
      'Camille <a@b.fr>',
      'a@b.fr;c@d.fr',
      'sans-arobase',
    ]) {
      form.controls.email.setValue(bad);
      expect(form.controls.email.valid).toBe(false);
    }
    form.controls.email.setValue('  camille@example.test ');
    expect(form.controls.email.valid).toBe(true);
  });

  it('makes the phone optional and normalises it when saving', () => {
    const form = buildContactForm(fb, valid);
    expect(form.valid).toBe(true);
    form.controls.phone.setValue('+33 6 12 34 56 78');
    expect(form.valid).toBe(true);
    expect(contactFromForm(form.getRawValue())).toEqual({
      name: 'Camille Lefèvre',
      email: 'camille@example.test',
      phone: '0612345678',
    });
    form.controls.phone.setValue('abc');
    expect(form.controls.phone.valid).toBe(false);
    form.patchValue({ phone: '   ', email: ' camille@example.test ' });
    expect(contactFromForm(form.getRawValue())).toEqual({ ...valid, phone: '' });
  });
});
