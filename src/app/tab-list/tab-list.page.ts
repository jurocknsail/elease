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
    await this.storageService.loadLeaseholders();
    this.leaseholders = this.storageService.getLeaseholders();

    if(this.leaseholders == undefined) {
      this.storageService.getJson().subscribe(data => {
        this.leaseholders = data;
        this.storageService.set("data", this.leaseholders);
        console.log("No local data, assets data loaded and stored : " + JSON.stringify(this.leaseholders));
      });
    } else {
      console.log("Local data loaded : " + JSON.stringify(this.leaseholders));
    }

 }
}
