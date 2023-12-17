import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { LocataireDetailsPage } from './locataire-details.page';

describe('LocataireDetailsPage', () => {
  let component: LocataireDetailsPage;
  let fixture: ComponentFixture<LocataireDetailsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LocataireDetailsPage],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(LocataireDetailsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
