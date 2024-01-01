import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { LeaseholderDetailsPage } from './leaseholder-details.page';

const routes: Routes = [
  {
    path: '',
    component: LeaseholderDetailsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LeaseholderDetailsPageRoutingModule {}
