import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { LeaseholderDetailsPageRoutingModule } from './leaseholder-details-routing.module';

import {LeaseholderDetailsPage, } from './leaseholder-details.page';
import {MatSelectModule} from '@angular/material/select';
import {MatInputModule} from '@angular/material/input';
import {MatFormFieldModule} from '@angular/material/form-field';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    LeaseholderDetailsPageRoutingModule,
    MatFormFieldModule, MatInputModule, MatSelectModule
  ],
  declarations: [LeaseholderDetailsPage]
})
export class LeaseholderDetailsPageModule {}
