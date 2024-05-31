import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { AlertController, isPlatform, LoadingController, Platform, ToastController } from '@ionic/angular';
import { PreviewAnyFile } from '@awesome-cordova-plugins/preview-any-file/ngx';
import { ParseService } from "../parse-service.service";

const APP_DIRECTORY = Directory.Documents;

type File = {
  name: string;
  isFile: boolean;
};

@Component({
  selector: 'app-filebrowser',
  templateUrl: './filebrowser.page.html',
  styleUrls: ['./filebrowser.page.scss'],
})
export class FilebrowserPage implements OnInit {

  folderContent: any[] = [];
  currentFolder = '';
  copyFile = null;
  @ViewChild('filepicker') uploader!: ElementRef;
  isGreyedOut: boolean = false;


  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private previewAnyFile: PreviewAnyFile,
    public platform: Platform,
    public parseService: ParseService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController
  ) {
  }

  ngOnInit() {
    this.currentFolder = this.route.snapshot.paramMap.get('folder') || '';
    this.loadDocuments();
    console.log("Platform type : " + this.platform.platforms())
  }

  toggleGreyOut() {
    this.isGreyedOut = !this.isGreyedOut;
  }

  async loadDocuments() {
    const folderContent = await Filesystem.readdir({
      directory: APP_DIRECTORY,
      path: this.currentFolder
    });

    // The directory array is just strings
    // We add the information isFile to make life easier
    this.folderContent = folderContent.files.map((file) => {
      return {
        name: file.name,
        isFile: file.type === 'file'
      };
    });
  }

  async itemClicked(entry: File) {

    // Open the file or folder
    if (entry.isFile) {
      this.openFile(entry);
    } else {
      let pathToOpen =
        this.currentFolder != '' ? this.currentFolder + '/' + entry.name : entry.name;
      let folder = encodeURIComponent(pathToOpen);
      this.router.navigateByUrl(`/filebrowser/${folder}`);
    }

  }

  async openFile(entry: File) {
    if (isPlatform('hybrid')) {
      console.log("cordova")
      // Get the URI and use our Cordova plugin for preview
      const file_uri = await Filesystem.getUri({
        directory: APP_DIRECTORY,
        path: this.currentFolder + '/' + entry.name
      });
      this.previewAnyFile.preview(file_uri.uri)
        .then((res: any) => console.log(res))
        .catch((error: any) => console.error(error));
    } else {

      // Browser fallback to download the file
      const file = await Filesystem.readFile({
        directory: APP_DIRECTORY,
        path: this.currentFolder + '/' + entry.name
      });
      const blob = this.b64toBlob(file.data, 'application/pdf');
      window.open(URL.createObjectURL(blob), "_blank");

    }
  }

  b64toBlob = (b64Data: any, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);

      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
  };


  async presentSendAlert() {
    const alert = await this.alertController.create({
      header: "Confirmation d'envoi",
      message: "Es-tu sûr(e) de vouloir envoyer les appels de loyers ?",
      buttons: this.alertSendButtons,
    });
    await alert.present();
  }

  public alertSendButtons = [
    {
      text: 'Annuler',
      role: 'cancel'
    },
    {
      text: 'OK',
      role: 'confirm',
      handler: () => {
        console.log('Alert confirmed');
        this.sendEmail();
      },
    },
  ];

  sendEmailButton() {
    this.presentSendAlert();
  }

  async sendEmail() {

    this.toggleGreyOut();

    if (this.parseService.getLeaseholdersPDFs().size == 0) {
      const toast = this.toastController.create({
        message: "Une erreur est survenue, recommence !",
        duration: 3000,
        position: "middle",
        color: 'danger',
        icon: "warning"
      });
      toast.then((t) => {
        t.onDidDismiss().then(() => {
          this.router.navigate(['/']);
        });
        t.present();
        this.toggleGreyOut();
      })
      return;
    }

    let promises: Promise<string[]>[] = []

    // Show loading overlay
    const loading = await this.loadingController.create({
      message: 'Envoie des emails ...'
    });
    await loading.present();

    this.parseService.getLeaseholdersPDFs().forEach((pdfDataList, recipientEmail) => {
      const myPromise: Promise<string[]> = new Promise((resolve) => {
        this.parseService.sendEmail(recipientEmail, pdfDataList).subscribe({
          next: (res) => {
            console.log('Email(s) sent successfully from ' + recipientEmail);

            let leaseObjectIds: string[] = []
            pdfDataList.forEach((data) => {
              if (data.leaseObjectId) {
                leaseObjectIds.push(data.leaseObjectId);
              }
            });
            resolve(leaseObjectIds);
          },
          error: (err) => {
            console.error('Error sending email(s) from ' + recipientEmail, err.message);

            // Show success message
            const toast = this.toastController.create({
              message: "Erreur lors de l'envoi pour " + recipientEmail,
              duration: 3000,
              position: "middle",
              color: 'danger',
              icon: "warning"
            });
            toast.then((t) => {
              t.onDidDismiss().then(() => {
                this.router.navigate(['/']);
                this.toggleGreyOut();
              });
              t.present();
            })

          }
        });
      });
      promises.push(myPromise);
    });

    Promise.all(promises).then((results) => {
      console.log("All emails sent.");

      // Update sendDate of each sent leases
      // Flatten the array of arrays into a single array of strings
      const allStrings: string[] = results.reduce((acc, val) => acc.concat(val), []);
      console.log('All leaseId sent :', allStrings);

      loading.dismiss();

      // Show success message
      const toast = this.toastController.create({
        message: 'Tous les emails ont été envoyés ! Tu les as aussi reçus en copie 😊',
        duration: 2000,
        position: "middle",
        color: 'primary',
        icon: "send"
      });

      toast.then((t) => {
        t.onDidDismiss().then(() => {
          this.router.navigate(['/']);
          this.toggleGreyOut();
        });
        t.present();
      })

    }).catch((err) => {
      console.log("ERROR Updating leases lastSendDate");
    });

  }

}
