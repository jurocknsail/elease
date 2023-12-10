import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TabSendPage } from './tab-send.page';
import { TabSendPageRoutingModule } from './tab-send-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    TabSendPageRoutingModule
  ],
  declarations: [TabSendPage]
})
export class TabSendPageModule {}
