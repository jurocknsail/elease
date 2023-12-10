import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { TabAddPage } from './tab-add.page';

describe('Tab1Page', () => {
  let component: TabAddPage;
  let fixture: ComponentFixture<TabAddPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TabAddPage],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(TabAddPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
