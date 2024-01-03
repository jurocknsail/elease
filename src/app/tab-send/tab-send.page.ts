import { Component, OnInit } from '@angular/core';
import { StorageService } from '../storage-service.service';
import { Leaseholder } from '../leaseholder';

@Component({
  selector: 'app-tab-send',
  templateUrl: 'tab-send.page.html',
  styleUrls: ['tab-send.page.scss']
})
export class TabSendPage implements OnInit {
  leaseholders: Leaseholder[] | undefined;

  constructor(
    private storageService: StorageService
  ) {}

  ngOnInit() {

    // Find the product that correspond with the id provided in route.
    this.leaseholders = this.storageService.getLeaseholders();
   
  }
}
