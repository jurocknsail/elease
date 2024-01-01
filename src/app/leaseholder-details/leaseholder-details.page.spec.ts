import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { LeaseholderDetailsPage } from './leaseholder-details.page';

describe('LeaseholderDetailsPage', () => {
  let component: LeaseholderDetailsPage;
  let fixture: ComponentFixture<LeaseholderDetailsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LeaseholderDetailsPage],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(LeaseholderDetailsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
