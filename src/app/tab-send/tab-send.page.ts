import { Component, OnInit } from '@angular/core';
import { StorageService } from '../storage-service.service';
import { Leaseholder } from '../leaseholder';
import * as pdfMake from 'pdfmake/build/pdfmake';  
import * as pdfFonts from 'pdfmake/build/vfs_fonts'; 
(<any>pdfMake).vfs = pdfFonts.pdfMake.vfs;
import { TDocumentDefinitions } from 'pdfmake/interfaces';

@Component({
  selector: 'app-tab-send',
  templateUrl: 'tab-send.page.html',
  styleUrls: ['tab-send.page.scss']
})
export class TabSendPage implements OnInit {
  leaseholders: Leaseholder[] | undefined;

  constructor(
    private storageService: StorageService
  ) {
  }

  async ngOnInit() {
    await this.storageService.getData();
    this.leaseholders = this.storageService.getLeaseholders(); 
  }

  generatePdf() {
    const docDefinition: TDocumentDefinitions = {
       content: [
         'First paragraph',
         'Another paragraph, this time a little bit longer to make sure, this line will be divided into at least two lines',
       ],
    };
    pdfMake.createPdf(docDefinition).open();
  }

}
