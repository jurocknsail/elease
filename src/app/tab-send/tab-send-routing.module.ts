import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabSendPage } from './tab-send.page';

const routes: Routes = [
  {
    path: '',
    component: TabSendPage,
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TabSendPageRoutingModule {}
