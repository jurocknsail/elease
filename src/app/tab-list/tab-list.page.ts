import { Component, OnInit } from '@angular/core';
import { LeaseholderService } from '../leaseholder.service';
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
      private leaseholderService : LeaseholderService,
      private storageService: StorageService
  ) { }

  async ngOnInit(){

    //await this.storageService.set("data", this.leaseholderService.getLeaseholders());
    this.leaseholders = await this.storageService.get("data");
    console.log("LeaseHolders from Local Storage : " + JSON.stringify(this.leaseholders));

 }
}
