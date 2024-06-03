import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function phoneNumberValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const validPhoneNumberPattern = /^[0-9]{10}$/;
    const isValid = validPhoneNumberPattern.test(control.value);
    return isValid ? null : { invalidPhoneNumber: { value: control.value } };
  };
}
