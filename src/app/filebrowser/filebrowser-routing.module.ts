import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { FilebrowserPage } from './filebrowser.page';

const routes: Routes = [
  {
    path: '',
    component: FilebrowserPage
  },
  {
		path: ':folder',
    component: FilebrowserPage
	}
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FilebrowserPageRoutingModule {}
