import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable } from 'rxjs';
import * as Parse from 'parse';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(private router: Router) {}

  canActivate(): boolean | Observable<boolean> | Promise<boolean> {
    const currentUser = Parse.User.current();
    if (currentUser) {
      return true;
    } else {
      this.router.navigate(['/login']);
      return false;
    }
  }
}
