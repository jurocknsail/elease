import { Component, OnInit } from '@angular/core';
import { StorageService } from '../storage-service.service';
import { Leaseholder } from '../leaseholder';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
(<any>pdfMake).vfs = pdfFonts.pdfMake.vfs;
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { DatetimeCustomEvent } from '@ionic/angular';

@Component({
  selector: 'app-tab-send',
  templateUrl: 'tab-send.page.html',
  styleUrls: ['tab-send.page.scss']
})
export class TabSendPage implements OnInit {
  leaseholders: Leaseholder[] | undefined;
  now: Date;
  defaultSendDate: Date;

  constructor(
    private storageService: StorageService
  ) {
    this.now = new Date();
    this.defaultSendDate = new Date(this.now.getFullYear() + "-" + this.now.getMonth() + 1 + "-25");
  }

  async ngOnInit() {
    await this.storageService.getData();
    this.leaseholders = this.storageService.getLeaseholders();
  }

  setDate(event: DatetimeCustomEvent) {
    if (event.detail.value != undefined) {
      let newDateAsString: string = event.detail.value as string;
      this.defaultSendDate = new Date(newDateAsString);
    }
  }

  generatePdf() {
    this.leaseholders?.forEach(leaseholder => {
      leaseholder.leases.forEach(lease => {

        if (lease.isSelected) {

          let priceTVA = lease.price * 0.2;
          let priceTTC = lease.price + priceTVA;

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
                text: lease.name.toUpperCase() + "\n" + lease.address.toUpperCase() + "\n"
              },
              {
                alignment: 'left',
                text:
                  `LA CIOTAT,
                  Le `+ this.defaultSendDate.toLocaleDateString() +
                  `\n
                  FACTURE DU LOYER N°`+ lease.lot + `
                  \n
                  Établie par la SCI LA CHARINE`
              },
              {
                alignment: 'justify',
                text: [{ text: 'Période du 01/' + this.now.getMonth() + 2 + '/' + this.now.getFullYear() + ' au 31/' + this.now.getMonth() + 2 + '/' + this.now.getFullYear(), bold: true },
                `
                  Monsieur,
                  Nous vous prions de recevoir ci-dessous le détail de votre facture concernant le local sis : 
                  `
                + lease.address +
                `
                  \n
                  `]
              },
              {
                columns: [
                  {
                    text:
                      "Date : \n01/" + this.now.getMonth() + 2 + "/" + this.now.getFullYear()
                  },
                  {
                    text:
                      `Libellé
                      Appel de loyer ` + this.now.getMonth() + 2 + "/" + this.now.getFullYear() +
                      `\nT.V.A. 20%.
                      \nTotal TTC ..................................`
                  },
                  {
                    text: [
                      "Montant\n"
                      + lease.price.toFixed(2) + "\n"
                      + priceTVA.toFixed(2) + "\n"
                      + "--------------\n"
                      ,
                      { text: priceTTC.toFixed(2), bold: true }
                    ]
                  }
                ]
              },
              {
                alignment: 'justify',
                text: [
                  { text: "\n\nConditions de règlement :", italics: true },
                  {
                    text:
                      `\nEn application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte. 
                    En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure. 
                    SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.
                    \n`,
                    italics: true
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
        }
      });
    })
  }

  sendEmail() { }

}
