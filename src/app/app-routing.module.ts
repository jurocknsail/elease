import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule)
  },
  {
    path: 'leaseholder-details/:leaseholderId',
    loadChildren: () => import('./leaseholder-details/leaseholder-details.module').then(m => m.LeaseholderDetailsPageModule)
  },
  {
    path: 'filebrowser',
    loadChildren: () => import('./filebrowser/filebrowser.module').then( m => m.FilebrowserPageModule)
  },
  {
		path: 'filebrowser/:folder',
		loadChildren: () => import('./filebrowser/filebrowser.module').then((m) => m.FilebrowserPageModule)
	}
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
