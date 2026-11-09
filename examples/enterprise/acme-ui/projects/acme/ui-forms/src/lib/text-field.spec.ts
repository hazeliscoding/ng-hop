import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { AcmeTextField } from './text-field';

@Component({
  imports: [AcmeTextField, ReactiveFormsModule],
  template: `<acme-text-field label="Title" [formControl]="title" />`,
})
class Host {
  readonly title = new FormControl('Laptop');
}

describe('AcmeTextField', () => {
  it('shows the form value, writes typing back, and clears it', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector('input')!;
    expect(element.querySelector('.acme-field__label')?.textContent).toBe('Title');
    expect(input.value).toBe('Laptop');

    input.value = 'Monitor';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.title.value).toBe('Monitor');

    element.querySelector('button')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.title.value).toBe('');
    expect(element.querySelector('button')).toBeNull();
  });
});
