import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AcmeButton } from './button';
import { AcmeCard } from './card';

@Component({
  imports: [AcmeButton, AcmeCard],
  template: `<acme-card heading="Requests"><acme-button variant="quiet" type="submit">Send</acme-button></acme-card>`,
})
class Host {}

describe('ui-core', () => {
  it('renders a card with its heading, and a button with its variant and type', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.acme-card__title')?.textContent).toBe('Requests');
    const button = element.querySelector('button');
    expect(button?.className).toBe('acme-button acme-button--quiet');
    expect(button?.type).toBe('submit');
    expect(button?.textContent).toBe('Send');
  });
});
