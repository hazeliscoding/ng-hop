import { Component, input } from '@angular/core';

/** A titled panel that holds one task on a screen. */
@Component({
  selector: 'acme-card',
  template: `<section class="acme-card"><h2 class="acme-card__title">{{ heading() }}</h2><ng-content /></section>`,
})
export class AcmeCard {
  readonly heading = input.required<string>();
}
