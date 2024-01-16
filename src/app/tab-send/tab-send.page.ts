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
  count = 0;
  

  constructor(
    private storageService: StorageService
  ) {
  }

  async ngOnInit() {
    await this.storageService.getData();
    this.leaseholders = this.storageService.getLeaseholders();
  }

  generatePdf() {
    this.leaseholders?.forEach(leaseholder => {
      leaseholder.leases.forEach (lease => {
        //TODO MANAGE SELECTION
        console.log("Lease : " + lease.name)
        this.count = this.count+1;
        const docDefinition: TDocumentDefinitions = {
          content: [
            {
              alignment: 'left',
              text:
                `SCI LA CHARINE
              41 CHEMIN DES BAGNOLS
              13600 LA CIOTAT`
            },
            {
              alignment: 'right',
              text:
                `CABINET AGIMMO
              ESPACE LA CHARINE
              41,CHEMIN DES BAGNOLS
              13600 LA CIOTAT`
            },
            {
              alignment: 'left',
              text:
                `LA CIOTAT,
              Le 25 novembre 2023
              \n
              FACTURE DU LOYER N°`+ this.count +`
              \n
              Établie par la SCI LA CHARINE`
            },
            {
              alignment: 'justify',
              text: [{ text: 'Période du 01/12/2023 au 31/12/2023', bold: true },
                `
              Monsieur,
              Nous vous prions de recevoir ci-dessous le détail de votre facture concernant le local sis : 
              41, chemin des Bagnols, LA CHARINE, 13600 LA CIOTAT.
              \n
              `]
            },
            {
              columns: [
                {
                  text:
                    `Date : 
                  01/12/2023`
                },
                {
                  text:
                    `Libellé
                  Appel de loyer Dec 23
                  T.V.A. 20%.
                  \nTotal TTC ..................................`
                },
                {
                  text: [
                    `Montant
                  1300,00
                  260,00
                  --------------
                  `,
                    { text: '1560,00', bold: true }
                  ]
                }
              ]
            },
            {
              alignment: 'justify',
              text: [
                { text: "\n\nConditions de règlement :", italics: true },
                {
                  text: `\nEn application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte. 
                En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure. 
                SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.
                \n`, italics: true
                },
              ]
            },
            {
              alignment: 'justify',
              text:
                `
              `
            }
          ],
        };
        pdfMake.createPdf(docDefinition).open();

      });
    })
    
  }

  sendEmail() {

  }

}
