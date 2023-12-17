import { Component } from '@angular/core';
import { LocataireService } from './locataire.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {
  constructor(private locataireService:LocataireService) {
    this.locataireService.loadLocataires();
  }
}
