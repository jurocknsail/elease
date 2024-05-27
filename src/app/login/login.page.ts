import { Component } from '@angular/core';
import * as Parse from 'parse';
import {Router} from "@angular/router";

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
})
export class LoginPage {
  username: string = '';
  password: string = '';
  errorMessage: string | null = null;

  constructor(
    private router: Router,
  ) { }

  async onSubmit() {
    try {
      const user = await Parse.User.logIn(this.username, this.password);
      console.log('Logged in user:', user);
      // Redirect to a different page or perform other actions after login
      this.router.navigate(['tabs/tab-list'])
    } catch (error) {
      if (error instanceof Error) {
        this.errorMessage = error.message;
      } else {
        this.errorMessage = 'An unknown error occurred';
      }
    }
  }
}
