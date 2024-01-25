import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { FilebrowserPageRoutingModule } from './filebrowser-routing.module';

import { FilebrowserPage } from './filebrowser.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    FilebrowserPageRoutingModule
  ],
  declarations: [FilebrowserPage]
})
export class FilebrowserPageModule {}
