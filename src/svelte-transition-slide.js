// This code is refered to the following code;
// https://unpkg.com/svelte-transitions@1.2.0/dist/svelte-transitions.js
// https://github.com/sveltejs/svelte-transitions

import { cubicOut } from 'svelte/easing';

export default function slide(node, { duration }) {
  if ( duration === void 0 ) duration = 500;
  let easing = cubicOut;

  let style = getComputedStyle(node);
  let transform = style.transform === 'none' ? '' : style.transform;

  return {
    delay: 0,
    duration: duration,
    easing: easing,
    css: (t) => { return ("transform: " + transform + " translateX(" + ((1 - t) * 100) + "%);");}
  };
}
