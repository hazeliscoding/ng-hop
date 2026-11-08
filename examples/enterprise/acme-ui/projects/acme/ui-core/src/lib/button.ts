import { Component, input } from '@angular/core';

/** The house button: `primary` for the one action that matters on a screen, `quiet` for the rest. */
@Component({
  selector: 'acme-button',
  template: `<button [type]="type()" [class]="'acme-button acme-button--' + variant()" [disabled]="disabled()"><ng-content /></button>`,
})
export class AcmeButton {
  readonly variant = input<'primary' | 'quiet'>('primary');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
}
