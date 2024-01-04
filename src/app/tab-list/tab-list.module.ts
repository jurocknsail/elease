import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TabListPage } from './tab-list.page';

import { TabListPageRoutingModule } from './tab-list-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TabListPageRoutingModule,
  ],
  declarations: [TabListPage]
})
export class TabListPageModule {}
