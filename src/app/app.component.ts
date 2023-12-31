import { Component } from '@angular/core';
import { LeaseholderService } from './leaseholder.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {
  constructor(private leaseholderService:LeaseholderService) {
    this.leaseholderService.loadLeaseholders();
  }
}
