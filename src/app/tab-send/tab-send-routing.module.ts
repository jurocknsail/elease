import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabSendPage } from './tab-send.page';
import {AuthGuard} from "../auth.guard";

const routes: Routes = [
  {
    path: '',
    component: TabSendPage,
    canActivate: [AuthGuard]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TabSendPageRoutingModule {}
