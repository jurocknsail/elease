import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabListPage } from './tab-list.page';
import {AuthGuard} from "../auth.guard";

const routes: Routes = [
  {
    path: '',
    component: TabListPage,
    canActivate: [AuthGuard]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TabListPageRoutingModule {}
