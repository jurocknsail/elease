import {Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {AlertController, isPlatform, Platform} from '@ionic/angular';
import {PreviewAnyFile} from '@awesome-cordova-plugins/preview-any-file/ngx';
import {ParseService} from "../parse-service.service";

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


  constructor(
    private route: ActivatedRoute,
    private alertCtrl: AlertController,
    private router: Router,
    private previewAnyFile: PreviewAnyFile,
    public platform: Platform,
    public parseService: ParseService,
  ) {
  }

  ngOnInit() {
    this.currentFolder = this.route.snapshot.paramMap.get('folder') || '';
    this.loadDocuments();
    console.log("Platform type : " + this.platform.platforms())
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

    return new Blob(byteArrays, {type: contentType});
  };


  sendEmail() {
    this.parseService.getLeaseholdersPDFs().forEach( (pdfDataList, email) => {
      pdfDataList.forEach((pdfInfo) => {
        this.parseService.sendEmail(email, pdfInfo).subscribe({
          next: (res) => {
            console.log('Email sent successfully !');
          },
          error: (err) => {
            console.error('Error sending email : ', err.message);
          }
        });
      })
    });
  }

}
