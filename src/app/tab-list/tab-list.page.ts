import { Component, OnInit } from '@angular/core';
import { Leaseholder } from '../leaseholder';
import { StorageService } from '../storage-service.service';

@Component({
  selector: 'app-tab-list',
  templateUrl: 'tab-list.page.html',
  styleUrls: ['tab-list.page.scss']
})
export class TabListPage implements OnInit {
  
  leaseholders: Leaseholder [] = [];
  constructor(
      private storageService: StorageService
  ) { }

  async ngOnInit(){

    this.leaseholders = this.storageService.getLeaseholders();

 }
}
