import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { FilebrowserPage } from './filebrowser.page';
import {AuthGuard} from "../auth.guard";

const routes: Routes = [
  {
    path: '',
    component: FilebrowserPage,
    canActivate: [AuthGuard]
  },
  {
		path: ':folder',
    component: FilebrowserPage,
    canActivate: [AuthGuard]
	}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FilebrowserPageRoutingModule {}
