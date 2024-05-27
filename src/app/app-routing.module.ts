import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import {AuthGuard} from "./auth.guard";

const routes: Routes = [

  {
    path: '',
    redirectTo: 'tabs', pathMatch: 'full'
  },
  {
    path: 'login',
    loadChildren: () => import('./login/login.module').then( m => m.LoginPageModule)
  },
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule), canActivate: [AuthGuard]
  },
  {
    path: 'leaseholder-details/:leaseholderId',
    loadChildren: () => import('./leaseholder-details/leaseholder-details.module').then(m => m.LeaseholderDetailsPageModule), canActivate: [AuthGuard]
  },
  {
    path: 'filebrowser',
    loadChildren: () => import('./filebrowser/filebrowser.module').then( m => m.FilebrowserPageModule), canActivate: [AuthGuard]
  },
  {
		path: 'filebrowser/:folder',
		loadChildren: () => import('./filebrowser/filebrowser.module').then((m) => m.FilebrowserPageModule), canActivate: [AuthGuard]
	}
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
