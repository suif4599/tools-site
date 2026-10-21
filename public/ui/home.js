import { createEntrance } from './ak-effects.mjs';

const cards = [...document.querySelectorAll('.card')];

const count = document.querySelector('[data-tools-count]');
if (count) count.textContent = String(cards.length).padStart(2, '0');

const controllers = cards.map((el, i) =>
  createEntrance(el, { direction: 'up', distance: 16, duration: 200, delay: i * 70 }),
);
for (const c of controllers) c.play();
