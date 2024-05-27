import {Component, OnInit} from '@angular/core';
import {Leaseholder} from '../leaseholder';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import {TDocumentDefinitions} from 'pdfmake/interfaces';
import {DatetimeCustomEvent, isPlatform, Platform} from '@ionic/angular';
import {formatDate} from '@angular/common';
import {Directory, Filesystem, StatOptions} from '@capacitor/filesystem';
import {Lease} from '../lease';
import {Router} from '@angular/router';
import { ParseService } from '../parse-service.service';
import { LeasePdfInfoClass } from '../leasepdfinfo';

(<any>pdfMake).vfs = pdfFonts.pdfMake.vfs;


const USER_DATA_FOLDER = 'elease_pdfs';
const APP_DIRECTORY: Directory = Directory.Documents;

@Component({
  selector: 'app-tab-send',
  templateUrl: 'tab-send.page.html',
  styleUrls: ['tab-send.page.scss']
})
export class TabSendPage implements OnInit {
  now: Date;
  defaultSendDate: Date;
	isBrowser = false;
  public progress = 0;
  leaseholders: Leaseholder[] = [];
  periodMonth! : string;

  constructor(
    public platform: Platform,
    private router: Router,
    public parseService: ParseService,
  ) {
    this.now = new Date();
    this.defaultSendDate = this.computeDefaultSendDate();

    if (!isPlatform('hybrid')) {
			this.isBrowser = true;
      console.log("Browser")
		}
  }

  async ngOnInit() {

    if (!isPlatform('hybrid')) {
			this.isBrowser = true;
		}

    this.leaseholders = this.parseService.getLeaseholders();
    if (this.leaseholders.length == 0) {
      await this.parseService.fetchLeaseholders();
      this.leaseholders = this.parseService.getLeaseholders()
    }

    if (await this.checkFileExists({ path: USER_DATA_FOLDER, directory: APP_DIRECTORY })) {

      await Filesystem.rmdir({
        directory: APP_DIRECTORY,
        path: USER_DATA_FOLDER,
        recursive: true
      });

      await Filesystem.mkdir({
        directory: APP_DIRECTORY,
        path: USER_DATA_FOLDER,
        recursive: true
      });
    }

  }

  computeDefaultSendDate(): Date {
    return new Date(this.now.getFullYear() + "-" + (this.now.getMonth() + 1) + "-25");
  }

  daysInNextMonth (date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate();
  }

  computePeriod(): string {
    let month;
    let year;
    if (this.defaultSendDate.getMonth() < 11) {
      month = this.defaultSendDate.getMonth() + 2;
      year = this.defaultSendDate.getFullYear();
    } else {
      month = 1;
      year = this.defaultSendDate.getFullYear() + 1;
    }
    this.periodMonth = month.toLocaleString('en-US', { minimumIntegerDigits: 2, useGrouping: false }) + "/" + year;
    return this.periodMonth;
  }

  async checkFileExists(statOptions: StatOptions): Promise<boolean> {
    try {
      await Filesystem.stat(statOptions);
      return true;
    } catch (checkDirException) {
      if (checkDirException instanceof Error && (checkDirException.message === 'Entry does not exist.' || checkDirException.message === 'File does not exist')) {
        return false;
      } else {
        console.log("error : " + checkDirException)
        throw checkDirException;
      }
    }
  }

  setDate(event: DatetimeCustomEvent) {
    if (event.detail.value != undefined) {
      let newDateAsString: string = event.detail.value as string;
      this.defaultSendDate = new Date(newDateAsString);
    }
  }

  computeTVA (lease : Lease): number {
    return lease.price * 0.2;
  }
  computeTotalPrice ( lease: Lease): number {
    let noChargesPrice = lease.isPro ? lease.price + this.computeTVA(lease) : lease.price;
    return (lease.charge != null && lease.charge != 0) ? noChargesPrice + lease.charge : noChargesPrice;
  }

  async generatePdf() {

    await Filesystem.rmdir({
      directory: APP_DIRECTORY,
      path: USER_DATA_FOLDER,
      recursive: true
    });
    await Filesystem.mkdir({
      directory: APP_DIRECTORY,
      path: USER_DATA_FOLDER,
      recursive: true
    });
    this.parseService.getLeaseholdersPDFs().clear();

    let promises: Promise<void>[] = []

    let totalLeases = 0;
    this.parseService.getLeaseholders().forEach(leaseholder => {
      leaseholder.leases.forEach(lease => {
        totalLeases = totalLeases + 1;
      });
    });
    let currentLeaseNb = 1;

    this.parseService.getLeaseholders().forEach(leaseholder => {
      leaseholder.leases.forEach(lease => {

        if (lease.isSelected) {

          const docDefinition: TDocumentDefinitions = {
            info: {
              title: formatDate(this.now, 'dd_MM_yyyy', "en-GB") + "_" + leaseholder.name + "_" + lease.name,
              author: 'SCI LA CHARINE',
              subject: 'Appel de Loyer',
              keywords: 'LOYER ' + lease.name,
            },
            styles: {
              red: {
                bold: true,
                color: '#ff5500'
              }
            },
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
                text: leaseholder.name.toUpperCase() + "\n" + lease.streetNumber + " " + lease.streetName.toUpperCase() + "\n"
                      + ((lease.optionalAddressInfo != null && lease.optionalAddressInfo != "") ? lease.optionalAddressInfo.toUpperCase() + "\n" : "")
                      + lease.postalCode + " " + lease.city.toUpperCase()
              },
              {
                alignment: 'left',
                text: [
                  "LA CIOTAT \n Le " + formatDate(this.defaultSendDate, 'dd/MM/yyyy', "en-GB"),
                  { text: "\n\nFACTURE DU LOYER pour " + ((lease.lot != null && lease.lot != 0) ? "le lot n° " + lease.lot : lease.name) , bold: true},
                  `

                  Établie par la SCI LA CHARINE`
                ]
              },
              {
                alignment: 'justify',
                text: [{ text: 'Période du 01/' + this.computePeriod() + ' au ' + this.daysInNextMonth(this.defaultSendDate) + '/' + this.computePeriod(), bold: true },
                { text:
                `

                  Madame, Monsieur,
                  Nous vous prions de recevoir ci-dessous le détail de votre facture concernant le local sis :
                  `
                },
                { text: lease.name + ", "
                + lease.streetNumber + " "
                + lease.streetName + ", "
                + ((lease.optionalAddressInfo != null && lease.optionalAddressInfo != "") ? lease.optionalAddressInfo + ", " : "")
                + lease.postalCode + " "
                + lease.city.toUpperCase()
                , italics: true },
                  `
                  \n
                  `]
              },
              {
                columns: [
                  { text: "Date \n01/" + this.computePeriod() , bold: true},
                  {
                    text: [
                      { text: "Libellé\n" , bold: true},
                      "Loyer HT" +
                      (lease.isPro ? "\nT.V.A. 20%" : "\n" ),
                      { text: (lease.charge != null && lease.charge != 0) ? "\nAvance sur charges" : "\n", style: [ 'black' ] },
                      { text: "\nTotal TTC", bold: true },
                    ]
                  },
                  {
                    alignment: 'right',
                    text: [
                      { text: "Montant\n" , bold: true},
                      lease.price.toFixed(2) + "\n"
                      + (lease.isPro ? this.computeTVA(lease).toFixed(2)  + "\n" : "\n" ),
                      { text: (lease.charge != null && lease.charge != 0) ? lease.charge.toFixed(2)  + "\n" : "\n", style: [ 'black' ] },
                      { text: this.computeTotalPrice(lease).toFixed(2) + "€", bold: true }
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
          const pdf = pdfMake.createPdf(docDefinition);

          // Open PDF in tab when using web browser
          //pdf.getBlob(blob => {
          //  window.open(URL.createObjectURL(blob), "_blank");
          //});

          // Save PDF to Disc DB
          const myPromise: Promise<void> = new Promise((resolve) => {
            pdf.getBase64(data => {
              this.writePDF(data, leaseholder, lease).then(() => {
                this.progress = currentLeaseNb / totalLeases;
                currentLeaseNb = currentLeaseNb +1;

                // Add pdf to map of leaseholder email/pdfInfo
                let pdfInfo = new LeasePdfInfoClass (this.generatePdfName(leaseholder, lease, this.periodMonth), this.periodMonth, data);
                this.parseService.addLeaseholderPDF(leaseholder.email, pdfInfo);

                resolve();
              });
            });
          });
          promises.push(myPromise);
        }
      });
    });

    Promise.all(promises).then(() => {
      this.router.navigate(['/filebrowser/' + USER_DATA_FOLDER]);
      this.progress = 0;
    });

  }

  private generatePdfName(leaseholder: Leaseholder, lease: Lease, periodMonth: string): string {
    return leaseholder.name.replace(" ", "_").trim().toLowerCase() + "-" + lease.name.replace(" ", "_").trim().toLowerCase() + "-" + periodMonth.replace("/", "_")+".pdf"
  }

  async writePDF(data: string, leaseholder: Leaseholder, lease: Lease) {
    let filePath = USER_DATA_FOLDER + "/" + this.generatePdfName(leaseholder, lease, this.periodMonth);
    if (! await this.checkFileExists({ path: filePath, directory: Directory.Documents })) {
      await Filesystem.writeFile({
        path: filePath,
        data: data,
        directory: Directory.Documents,
        recursive: true
      });
    } else {
      await Filesystem.deleteFile({
        path: filePath,
        directory: Directory.Documents
      });
      await Filesystem.writeFile({
        path: filePath,
        data: data,
        directory: Directory.Documents,
        recursive: true
      });
    }
  }

}
