import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { LocataireDetailsPage } from './locataire-details.page';

const routes: Routes = [
  {
    path: '',
    component: LocataireDetailsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LocataireDetailsPageRoutingModule {}
