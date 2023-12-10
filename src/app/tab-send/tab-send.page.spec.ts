import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { TabSendPage } from './tab-send.page';

describe('TabSendPage', () => {
  let component: TabSendPage;
  let fixture: ComponentFixture<TabSendPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TabSendPage],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(TabSendPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
