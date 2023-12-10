import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { LocataireDetailsPageRoutingModule } from './locataire-details-routing.module';

import { LocataireDetailsPage } from './locataire-details.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    LocataireDetailsPageRoutingModule
  ],
  declarations: [LocataireDetailsPage]
})
export class LocataireDetailsPageModule {}
