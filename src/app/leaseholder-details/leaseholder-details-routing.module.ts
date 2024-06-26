import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { LeaseholderDetailsPage } from './leaseholder-details.page';
import {AuthGuard} from "../auth.guard";

const routes: Routes = [
  {
    path: '',
    component: LeaseholderDetailsPage,
    canActivate: [AuthGuard]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LeaseholderDetailsPageRoutingModule {}
