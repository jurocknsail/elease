import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { LocataireDetailsPageRoutingModule } from './locataire-details-routing.module';

import { LocataireDetailsPage, } from './locataire-details.page';
import {MatSelectModule} from '@angular/material/select';
import {MatInputModule} from '@angular/material/input';
import {MatFormFieldModule} from '@angular/material/form-field';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    LocataireDetailsPageRoutingModule,
    MatFormFieldModule, MatInputModule, MatSelectModule
  ],
  declarations: [LocataireDetailsPage]
})
export class LocataireDetailsPageModule {}
