import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  it('lists a new request at the top once it is sent', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('Acme Portal');

    const [title, reason] = Array.from(element.querySelectorAll('input'));
    title.value = 'Laptop stand';
    title.dispatchEvent(new Event('input'));
    reason.value = 'Posture';
    reason.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();

    const first = element.querySelector('.requests li');
    expect(first?.textContent).toContain('Laptop stand');
    expect(first?.textContent).toContain('Posture');
  });
});
