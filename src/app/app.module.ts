import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { IonicStorageModule } from '@ionic/storage-angular';
import { PreviewAnyFile } from '@awesome-cordova-plugins/preview-any-file/ngx';
import { EmailComposer } from "@awesome-cordova-plugins/email-composer/ngx";


@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot({mode: 'ios'}), IonicStorageModule.forRoot(), AppRoutingModule, HttpClientModule, BrowserAnimationsModule],
  providers: [{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }, PreviewAnyFile, EmailComposer],
  bootstrap: [AppComponent],
})
export class AppModule {}
