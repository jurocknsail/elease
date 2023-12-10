import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabAddPage } from './tab-add.page';

const routes: Routes = [
  {
    path: '',
    component: TabAddPage,
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class Tab1PageRoutingModule {}
