import { describe, expect, it } from 'vitest';
import { shouldStartChromeDragging } from './chromeDragging';

function el(
  tag: string,
  attrs: Record<string, string> = {},
  parent?: HTMLElement,
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  parent?.append(node);
  return node;
}

describe('shouldStartChromeDragging', () => {
  it('starts dragging for empty chrome background inside the header', () => {
    const header = el('header', { class: 'lm-top-chrome' });
    document.body.append(header);

    expect(shouldStartChromeDragging(header, header)).toBe(true);
  });

  it('does not drag when pressing interactive chrome controls', () => {
    const header = el('header', { class: 'lm-top-chrome' });
    const menu = el('div', { 'data-lm-window-interactive': 'true' }, header);
    const trigger = el('div', { role: 'menuitem' }, menu);
    document.body.append(header);

    expect(shouldStartChromeDragging(header, trigger)).toBe(false);
  });

  it('does not drag for portaled menu items (React bubble, DOM outside header)', () => {
    const header = el('header', { class: 'lm-top-chrome' });
    const menuHost = el('div', { 'data-lm-window-interactive': 'true' }, header);
    el('div', { role: 'menuitem' }, menuHost);

    // Radix Portal: content is under body, not under header in the DOM.
    const portal = el('div', { class: 'lm-menu-content', role: 'menu' });
    const radio = el('div', { role: 'menuitemradio' }, portal);
    const label = el('span', { class: 'lm-menu-label' }, radio);
    label.textContent = '暗色';
    document.body.append(header, portal);

    expect(header.contains(label)).toBe(false);
    expect(shouldStartChromeDragging(header, label)).toBe(false);
  });

  it('does not drag for portaled About menu item', () => {
    const header = el('header', { class: 'lm-top-chrome' });
    const portal = el('div', { class: 'lm-menu-content', role: 'menu' });
    const item = el('div', { role: 'menuitem' }, portal);
    item.textContent = '关于 LumaMark';
    document.body.append(header, portal);

    expect(shouldStartChromeDragging(header, item)).toBe(false);
  });
});
