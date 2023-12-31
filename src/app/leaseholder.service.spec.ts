import { TestBed } from '@angular/core/testing';

import { LeaseholderService } from './leaseholder.service';

describe('LeaseholderService', () => {
  let service: LeaseholderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LeaseholderService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
