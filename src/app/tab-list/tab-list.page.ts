import { Component, OnInit } from '@angular/core';
import { LeaseholderService } from '../leaseholder.service';
import { Leaseholder } from '../leaseholder';

@Component({
  selector: 'app-tab-list',
  templateUrl: 'tab-list.page.html',
  styleUrls: ['tab-list.page.scss']
})
export class TabListPage implements OnInit {
  
  leaseholders: Leaseholder [] = [];
  constructor(
      private leaseholderService : LeaseholderService 
  ) { }

 ngOnInit(){
     this.leaseholders = this.leaseholderService.getLeaseholders();
 }
}
