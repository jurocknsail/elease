import { Component } from '@angular/core';
import { Leaseholder } from '../leaseholder';
import { StorageService } from '../storage-service.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss']
})
export class TabsPage {
  leaseholders: Leaseholder[] = [];

  constructor(
    private storageService: StorageService
  ) {}

  async ngOnInit() {
    await this.storageService.getData();
    this.leaseholders = this.storageService.getLeaseholders();
  }
}
