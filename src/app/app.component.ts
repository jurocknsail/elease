import { Component } from '@angular/core';
import { LeaseholderService } from './leaseholder.service';
import { StorageService } from './storage-service.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {
  constructor(private leaseholderService:LeaseholderService, private storageService:StorageService) {
    this.leaseholderService.loadLeaseholders();
  }
}
