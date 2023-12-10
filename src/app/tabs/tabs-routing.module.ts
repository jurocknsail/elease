import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'tab-add',
        loadChildren: () => import('../tab-add/tab-add.module').then(m => m.Tab1PageModule)
      },
      {
        path: 'tab-list',
        loadChildren: () => import('../tab-list/tab-list.module').then(m => m.Tab2PageModule)
      },
      {
        path: 'tab-send',
        loadChildren: () => import('../tab-send/tab-send.module').then(m => m.Tab3PageModule)
      },
      {
        path: '',
        redirectTo: '/tabs/tab-list',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '',
    redirectTo: '/tabs/tab-list',
    pathMatch: 'full'
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
})
export class TabsPageRoutingModule {}
