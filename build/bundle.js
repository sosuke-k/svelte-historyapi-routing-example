var app = (function () {
  'use strict';

  function noop() { }
  const identity = x => x;
  function assign(tar, src) {
      // @ts-ignore
      for (const k in src)
          tar[k] = src[k];
      return tar;
  }
  function run(fn) {
      return fn();
  }
  function blank_object() {
      return Object.create(null);
  }
  function run_all(fns) {
      fns.forEach(run);
  }
  function is_function(thing) {
      return typeof thing === 'function';
  }
  function safe_not_equal(a, b) {
      return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
  }
  function create_slot(definition, ctx, $$scope, fn) {
      if (definition) {
          const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
          return definition[0](slot_ctx);
      }
  }
  function get_slot_context(definition, ctx, $$scope, fn) {
      return definition[1] && fn
          ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
          : $$scope.ctx;
  }
  function get_slot_changes(definition, $$scope, dirty, fn) {
      if (definition[2] && fn) {
          const lets = definition[2](fn(dirty));
          if (typeof $$scope.dirty === 'object') {
              const merged = [];
              const len = Math.max($$scope.dirty.length, lets.length);
              for (let i = 0; i < len; i += 1) {
                  merged[i] = $$scope.dirty[i] | lets[i];
              }
              return merged;
          }
          return $$scope.dirty | lets;
      }
      return $$scope.dirty;
  }
  function exclude_internal_props(props) {
      const result = {};
      for (const k in props)
          if (k[0] !== '$')
              result[k] = props[k];
      return result;
  }
  function action_destroyer(action_result) {
      return action_result && is_function(action_result.destroy) ? action_result.destroy : noop;
  }

  const is_client = typeof window !== 'undefined';
  let now = is_client
      ? () => window.performance.now()
      : () => Date.now();
  let raf = is_client ? cb => requestAnimationFrame(cb) : noop;

  const tasks = new Set();
  function run_tasks(now) {
      tasks.forEach(task => {
          if (!task.c(now)) {
              tasks.delete(task);
              task.f();
          }
      });
      if (tasks.size !== 0)
          raf(run_tasks);
  }
  /**
   * Creates a new task that runs on each raf frame
   * until it returns a falsy value or is aborted
   */
  function loop(callback) {
      let task;
      if (tasks.size === 0)
          raf(run_tasks);
      return {
          promise: new Promise(fulfill => {
              tasks.add(task = { c: callback, f: fulfill });
          }),
          abort() {
              tasks.delete(task);
          }
      };
  }

  function append(target, node) {
      target.appendChild(node);
  }
  function insert(target, node, anchor) {
      target.insertBefore(node, anchor || null);
  }
  function detach(node) {
      node.parentNode.removeChild(node);
  }
  function destroy_each(iterations, detaching) {
      for (let i = 0; i < iterations.length; i += 1) {
          if (iterations[i])
              iterations[i].d(detaching);
      }
  }
  function element(name) {
      return document.createElement(name);
  }
  function text(data) {
      return document.createTextNode(data);
  }
  function space() {
      return text(' ');
  }
  function empty() {
      return text('');
  }
  function listen(node, event, handler, options) {
      node.addEventListener(event, handler, options);
      return () => node.removeEventListener(event, handler, options);
  }
  function attr(node, attribute, value) {
      if (value == null)
          node.removeAttribute(attribute);
      else if (node.getAttribute(attribute) !== value)
          node.setAttribute(attribute, value);
  }
  function set_attributes(node, attributes) {
      // @ts-ignore
      const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
      for (const key in attributes) {
          if (attributes[key] == null) {
              node.removeAttribute(key);
          }
          else if (key === 'style') {
              node.style.cssText = attributes[key];
          }
          else if (descriptors[key] && descriptors[key].set) {
              node[key] = attributes[key];
          }
          else {
              attr(node, key, attributes[key]);
          }
      }
  }
  function children(element) {
      return Array.from(element.childNodes);
  }
  function set_data(text, data) {
      data = '' + data;
      if (text.data !== data)
          text.data = data;
  }
  function set_style(node, key, value, important) {
      node.style.setProperty(key, value, important ? 'important' : '');
  }
  function custom_event(type, detail) {
      const e = document.createEvent('CustomEvent');
      e.initCustomEvent(type, false, false, detail);
      return e;
  }

  let stylesheet;
  let active = 0;
  let current_rules = {};
  // https://github.com/darkskyapp/string-hash/blob/master/index.js
  function hash(str) {
      let hash = 5381;
      let i = str.length;
      while (i--)
          hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
      return hash >>> 0;
  }
  function create_rule(node, a, b, duration, delay, ease, fn, uid = 0) {
      const step = 16.666 / duration;
      let keyframes = '{\n';
      for (let p = 0; p <= 1; p += step) {
          const t = a + (b - a) * ease(p);
          keyframes += p * 100 + `%{${fn(t, 1 - t)}}\n`;
      }
      const rule = keyframes + `100% {${fn(b, 1 - b)}}\n}`;
      const name = `__svelte_${hash(rule)}_${uid}`;
      if (!current_rules[name]) {
          if (!stylesheet) {
              const style = element('style');
              document.head.appendChild(style);
              stylesheet = style.sheet;
          }
          current_rules[name] = true;
          stylesheet.insertRule(`@keyframes ${name} ${rule}`, stylesheet.cssRules.length);
      }
      const animation = node.style.animation || '';
      node.style.animation = `${animation ? `${animation}, ` : ``}${name} ${duration}ms linear ${delay}ms 1 both`;
      active += 1;
      return name;
  }
  function delete_rule(node, name) {
      node.style.animation = (node.style.animation || '')
          .split(', ')
          .filter(name
          ? anim => anim.indexOf(name) < 0 // remove specific animation
          : anim => anim.indexOf('__svelte') === -1 // remove all Svelte animations
      )
          .join(', ');
      if (name && !--active)
          clear_rules();
  }
  function clear_rules() {
      raf(() => {
          if (active)
              return;
          let i = stylesheet.cssRules.length;
          while (i--)
              stylesheet.deleteRule(i);
          current_rules = {};
      });
  }

  let current_component;
  function set_current_component(component) {
      current_component = component;
  }
  function get_current_component() {
      if (!current_component)
          throw new Error(`Function called outside component initialization`);
      return current_component;
  }
  function onMount(fn) {
      get_current_component().$$.on_mount.push(fn);
  }
  function onDestroy(fn) {
      get_current_component().$$.on_destroy.push(fn);
  }
  function setContext(key, context) {
      get_current_component().$$.context.set(key, context);
  }
  function getContext(key) {
      return get_current_component().$$.context.get(key);
  }
  // TODO figure out if we still want to support
  // shorthand events, or if we want to implement
  // a real bubbling mechanism
  function bubble(component, event) {
      const callbacks = component.$$.callbacks[event.type];
      if (callbacks) {
          callbacks.slice().forEach(fn => fn(event));
      }
  }

  const dirty_components = [];
  const binding_callbacks = [];
  const render_callbacks = [];
  const flush_callbacks = [];
  const resolved_promise = Promise.resolve();
  let update_scheduled = false;
  function schedule_update() {
      if (!update_scheduled) {
          update_scheduled = true;
          resolved_promise.then(flush);
      }
  }
  function add_render_callback(fn) {
      render_callbacks.push(fn);
  }
  let flushing = false;
  const seen_callbacks = new Set();
  function flush() {
      if (flushing)
          return;
      flushing = true;
      do {
          // first, call beforeUpdate functions
          // and update components
          for (let i = 0; i < dirty_components.length; i += 1) {
              const component = dirty_components[i];
              set_current_component(component);
              update(component.$$);
          }
          dirty_components.length = 0;
          while (binding_callbacks.length)
              binding_callbacks.pop()();
          // then, once components are updated, call
          // afterUpdate functions. This may cause
          // subsequent updates...
          for (let i = 0; i < render_callbacks.length; i += 1) {
              const callback = render_callbacks[i];
              if (!seen_callbacks.has(callback)) {
                  // ...so guard against infinite loops
                  seen_callbacks.add(callback);
                  callback();
              }
          }
          render_callbacks.length = 0;
      } while (dirty_components.length);
      while (flush_callbacks.length) {
          flush_callbacks.pop()();
      }
      update_scheduled = false;
      flushing = false;
      seen_callbacks.clear();
  }
  function update($$) {
      if ($$.fragment !== null) {
          $$.update();
          run_all($$.before_update);
          const dirty = $$.dirty;
          $$.dirty = [-1];
          $$.fragment && $$.fragment.p($$.ctx, dirty);
          $$.after_update.forEach(add_render_callback);
      }
  }

  let promise;
  function wait() {
      if (!promise) {
          promise = Promise.resolve();
          promise.then(() => {
              promise = null;
          });
      }
      return promise;
  }
  function dispatch(node, direction, kind) {
      node.dispatchEvent(custom_event(`${direction ? 'intro' : 'outro'}${kind}`));
  }
  const outroing = new Set();
  let outros;
  function group_outros() {
      outros = {
          r: 0,
          c: [],
          p: outros // parent group
      };
  }
  function check_outros() {
      if (!outros.r) {
          run_all(outros.c);
      }
      outros = outros.p;
  }
  function transition_in(block, local) {
      if (block && block.i) {
          outroing.delete(block);
          block.i(local);
      }
  }
  function transition_out(block, local, detach, callback) {
      if (block && block.o) {
          if (outroing.has(block))
              return;
          outroing.add(block);
          outros.c.push(() => {
              outroing.delete(block);
              if (callback) {
                  if (detach)
                      block.d(1);
                  callback();
              }
          });
          block.o(local);
      }
  }
  const null_transition = { duration: 0 };
  function create_bidirectional_transition(node, fn, params, intro) {
      let config = fn(node, params);
      let t = intro ? 0 : 1;
      let running_program = null;
      let pending_program = null;
      let animation_name = null;
      function clear_animation() {
          if (animation_name)
              delete_rule(node, animation_name);
      }
      function init(program, duration) {
          const d = program.b - t;
          duration *= Math.abs(d);
          return {
              a: t,
              b: program.b,
              d,
              duration,
              start: program.start,
              end: program.start + duration,
              group: program.group
          };
      }
      function go(b) {
          const { delay = 0, duration = 300, easing = identity, tick = noop, css } = config || null_transition;
          const program = {
              start: now() + delay,
              b
          };
          if (!b) {
              // @ts-ignore todo: improve typings
              program.group = outros;
              outros.r += 1;
          }
          if (running_program) {
              pending_program = program;
          }
          else {
              // if this is an intro, and there's a delay, we need to do
              // an initial tick and/or apply CSS animation immediately
              if (css) {
                  clear_animation();
                  animation_name = create_rule(node, t, b, duration, delay, easing, css);
              }
              if (b)
                  tick(0, 1);
              running_program = init(program, duration);
              add_render_callback(() => dispatch(node, b, 'start'));
              loop(now => {
                  if (pending_program && now > pending_program.start) {
                      running_program = init(pending_program, duration);
                      pending_program = null;
                      dispatch(node, running_program.b, 'start');
                      if (css) {
                          clear_animation();
                          animation_name = create_rule(node, t, running_program.b, running_program.duration, 0, easing, config.css);
                      }
                  }
                  if (running_program) {
                      if (now >= running_program.end) {
                          tick(t = running_program.b, 1 - t);
                          dispatch(node, running_program.b, 'end');
                          if (!pending_program) {
                              // we're done
                              if (running_program.b) {
                                  // intro — we can tidy up immediately
                                  clear_animation();
                              }
                              else {
                                  // outro — needs to be coordinated
                                  if (!--running_program.group.r)
                                      run_all(running_program.group.c);
                              }
                          }
                          running_program = null;
                      }
                      else if (now >= running_program.start) {
                          const p = now - running_program.start;
                          t = running_program.a + running_program.d * easing(p / running_program.duration);
                          tick(t, 1 - t);
                      }
                  }
                  return !!(running_program || pending_program);
              });
          }
      }
      return {
          run(b) {
              if (is_function(config)) {
                  wait().then(() => {
                      // @ts-ignore
                      config = config();
                      go(b);
                  });
              }
              else {
                  go(b);
              }
          },
          end() {
              clear_animation();
              running_program = pending_program = null;
          }
      };
  }

  function get_spread_update(levels, updates) {
      const update = {};
      const to_null_out = {};
      const accounted_for = { $$scope: 1 };
      let i = levels.length;
      while (i--) {
          const o = levels[i];
          const n = updates[i];
          if (n) {
              for (const key in o) {
                  if (!(key in n))
                      to_null_out[key] = 1;
              }
              for (const key in n) {
                  if (!accounted_for[key]) {
                      update[key] = n[key];
                      accounted_for[key] = 1;
                  }
              }
              levels[i] = n;
          }
          else {
              for (const key in o) {
                  accounted_for[key] = 1;
              }
          }
      }
      for (const key in to_null_out) {
          if (!(key in update))
              update[key] = undefined;
      }
      return update;
  }
  function get_spread_object(spread_props) {
      return typeof spread_props === 'object' && spread_props !== null ? spread_props : {};
  }
  function create_component(block) {
      block && block.c();
  }
  function mount_component(component, target, anchor) {
      const { fragment, on_mount, on_destroy, after_update } = component.$$;
      fragment && fragment.m(target, anchor);
      // onMount happens before the initial afterUpdate
      add_render_callback(() => {
          const new_on_destroy = on_mount.map(run).filter(is_function);
          if (on_destroy) {
              on_destroy.push(...new_on_destroy);
          }
          else {
              // Edge case - component was destroyed immediately,
              // most likely as a result of a binding initialising
              run_all(new_on_destroy);
          }
          component.$$.on_mount = [];
      });
      after_update.forEach(add_render_callback);
  }
  function destroy_component(component, detaching) {
      const $$ = component.$$;
      if ($$.fragment !== null) {
          run_all($$.on_destroy);
          $$.fragment && $$.fragment.d(detaching);
          // TODO null out other refs, including component.$$ (but need to
          // preserve final state?)
          $$.on_destroy = $$.fragment = null;
          $$.ctx = [];
      }
  }
  function make_dirty(component, i) {
      if (component.$$.dirty[0] === -1) {
          dirty_components.push(component);
          schedule_update();
          component.$$.dirty.fill(0);
      }
      component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
  }
  function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
      const parent_component = current_component;
      set_current_component(component);
      const prop_values = options.props || {};
      const $$ = component.$$ = {
          fragment: null,
          ctx: null,
          // state
          props,
          update: noop,
          not_equal,
          bound: blank_object(),
          // lifecycle
          on_mount: [],
          on_destroy: [],
          before_update: [],
          after_update: [],
          context: new Map(parent_component ? parent_component.$$.context : []),
          // everything else
          callbacks: blank_object(),
          dirty
      };
      let ready = false;
      $$.ctx = instance
          ? instance(component, prop_values, (i, ret, ...rest) => {
              const value = rest.length ? rest[0] : ret;
              if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                  if ($$.bound[i])
                      $$.bound[i](value);
                  if (ready)
                      make_dirty(component, i);
              }
              return ret;
          })
          : [];
      $$.update();
      ready = true;
      run_all($$.before_update);
      // `false` as a special case of no DOM component
      $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
      if (options.target) {
          if (options.hydrate) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              $$.fragment && $$.fragment.l(children(options.target));
          }
          else {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              $$.fragment && $$.fragment.c();
          }
          if (options.intro)
              transition_in(component.$$.fragment);
          mount_component(component, options.target, options.anchor);
          flush();
      }
      set_current_component(parent_component);
  }
  class SvelteComponent {
      $destroy() {
          destroy_component(this, 1);
          this.$destroy = noop;
      }
      $on(type, callback) {
          const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
          callbacks.push(callback);
          return () => {
              const index = callbacks.indexOf(callback);
              if (index !== -1)
                  callbacks.splice(index, 1);
          };
      }
      $set() {
          // overridden by instance, if it has props
      }
  }

  function cubicOut(t) {
      const f = t - 1.0;
      return f * f * f + 1.0;
  }

  // This code is refered to the following code;

  function slide(node, { duration }) {
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

  /*! *****************************************************************************
  Copyright (c) Microsoft Corporation. All rights reserved.
  Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  this file except in compliance with the License. You may obtain a copy of the
  License at http://www.apache.org/licenses/LICENSE-2.0

  THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
  WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
  MERCHANTABLITY OR NON-INFRINGEMENT.

  See the Apache Version 2.0 License for specific language governing permissions
  and limitations under the License.
  ***************************************************************************** */
  /* global Reflect, Promise */

  var extendStatics = function(d, b) {
      extendStatics = Object.setPrototypeOf ||
          ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
          function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
      return extendStatics(d, b);
  };

  function __extends(d, b) {
      extendStatics(d, b);
      function __() { this.constructor = d; }
      d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
  }

  var __assign = function() {
      __assign = Object.assign || function __assign(t) {
          for (var s, i = 1, n = arguments.length; i < n; i++) {
              s = arguments[i];
              for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
          }
          return t;
      };
      return __assign.apply(this, arguments);
  };

  function __read(o, n) {
      var m = typeof Symbol === "function" && o[Symbol.iterator];
      if (!m) return o;
      var i = m.call(o), r, ar = [], e;
      try {
          while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
      }
      catch (error) { e = { error: error }; }
      finally {
          try {
              if (r && !r.done && (m = i["return"])) m.call(i);
          }
          finally { if (e) throw e.error; }
      }
      return ar;
  }

  function __spread() {
      for (var ar = [], i = 0; i < arguments.length; i++)
          ar = ar.concat(__read(arguments[i]));
      return ar;
  }

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCFoundation = /** @class */ (function () {
      function MDCFoundation(adapter) {
          if (adapter === void 0) { adapter = {}; }
          this.adapter_ = adapter;
      }
      Object.defineProperty(MDCFoundation, "cssClasses", {
          get: function () {
              // Classes extending MDCFoundation should implement this method to return an object which exports every
              // CSS class the foundation class needs as a property. e.g. {ACTIVE: 'mdc-component--active'}
              return {};
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFoundation, "strings", {
          get: function () {
              // Classes extending MDCFoundation should implement this method to return an object which exports all
              // semantic strings as constants. e.g. {ARIA_ROLE: 'tablist'}
              return {};
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFoundation, "numbers", {
          get: function () {
              // Classes extending MDCFoundation should implement this method to return an object which exports all
              // of its semantic numbers as constants. e.g. {ANIMATION_DELAY_MS: 350}
              return {};
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFoundation, "defaultAdapter", {
          get: function () {
              // Classes extending MDCFoundation may choose to implement this getter in order to provide a convenient
              // way of viewing the necessary methods of an adapter. In the future, this could also be used for adapter
              // validation.
              return {};
          },
          enumerable: true,
          configurable: true
      });
      MDCFoundation.prototype.init = function () {
          // Subclasses should override this method to perform initialization routines (registering events, etc.)
      };
      MDCFoundation.prototype.destroy = function () {
          // Subclasses should override this method to perform de-initialization routines (de-registering events, etc.)
      };
      return MDCFoundation;
  }());

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCComponent = /** @class */ (function () {
      function MDCComponent(root, foundation) {
          var args = [];
          for (var _i = 2; _i < arguments.length; _i++) {
              args[_i - 2] = arguments[_i];
          }
          this.root_ = root;
          this.initialize.apply(this, __spread(args));
          // Note that we initialize foundation here and not within the constructor's default param so that
          // this.root_ is defined and can be used within the foundation class.
          this.foundation_ = foundation === undefined ? this.getDefaultFoundation() : foundation;
          this.foundation_.init();
          this.initialSyncWithDOM();
      }
      MDCComponent.attachTo = function (root) {
          // Subclasses which extend MDCBase should provide an attachTo() method that takes a root element and
          // returns an instantiated component with its root set to that element. Also note that in the cases of
          // subclasses, an explicit foundation class will not have to be passed in; it will simply be initialized
          // from getDefaultFoundation().
          return new MDCComponent(root, new MDCFoundation({}));
      };
      /* istanbul ignore next: method param only exists for typing purposes; it does not need to be unit tested */
      MDCComponent.prototype.initialize = function () {
          var _args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
              _args[_i] = arguments[_i];
          }
          // Subclasses can override this to do any additional setup work that would be considered part of a
          // "constructor". Essentially, it is a hook into the parent constructor before the foundation is
          // initialized. Any additional arguments besides root and foundation will be passed in here.
      };
      MDCComponent.prototype.getDefaultFoundation = function () {
          // Subclasses must override this method to return a properly configured foundation class for the
          // component.
          throw new Error('Subclasses must override getDefaultFoundation to return a properly configured ' +
              'foundation class');
      };
      MDCComponent.prototype.initialSyncWithDOM = function () {
          // Subclasses should override this method if they need to perform work to synchronize with a host DOM
          // object. An example of this would be a form control wrapper that needs to synchronize its internal state
          // to some property or attribute of the host DOM. Please note: this is *not* the place to perform DOM
          // reads/writes that would cause layout / paint, as this is called synchronously from within the constructor.
      };
      MDCComponent.prototype.destroy = function () {
          // Subclasses may implement this method to release any resources / deregister any listeners they have
          // attached. An example of this might be deregistering a resize event from the window object.
          this.foundation_.destroy();
      };
      MDCComponent.prototype.listen = function (evtType, handler, options) {
          this.root_.addEventListener(evtType, handler, options);
      };
      MDCComponent.prototype.unlisten = function (evtType, handler, options) {
          this.root_.removeEventListener(evtType, handler, options);
      };
      /**
       * Fires a cross-browser-compatible custom event from the component root of the given type, with the given data.
       */
      MDCComponent.prototype.emit = function (evtType, evtData, shouldBubble) {
          if (shouldBubble === void 0) { shouldBubble = false; }
          var evt;
          if (typeof CustomEvent === 'function') {
              evt = new CustomEvent(evtType, {
                  bubbles: shouldBubble,
                  detail: evtData,
              });
          }
          else {
              evt = document.createEvent('CustomEvent');
              evt.initCustomEvent(evtType, shouldBubble, false, evtData);
          }
          this.root_.dispatchEvent(evt);
      };
      return MDCComponent;
  }());

  /**
   * @license
   * Copyright 2019 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  /**
   * Stores result from applyPassive to avoid redundant processing to detect
   * passive event listener support.
   */
  var supportsPassive_;
  /**
   * Determine whether the current browser supports passive event listeners, and
   * if so, use them.
   */
  function applyPassive(globalObj, forceRefresh) {
      if (globalObj === void 0) { globalObj = window; }
      if (forceRefresh === void 0) { forceRefresh = false; }
      if (supportsPassive_ === undefined || forceRefresh) {
          var isSupported_1 = false;
          try {
              globalObj.document.addEventListener('test', function () { return undefined; }, {
                  get passive() {
                      isSupported_1 = true;
                      return isSupported_1;
                  },
              });
          }
          catch (e) {
          } // tslint:disable-line:no-empty cannot throw error due to tests. tslint also disables console.log.
          supportsPassive_ = isSupported_1;
      }
      return supportsPassive_ ? { passive: true } : false;
  }

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  function matches(element, selector) {
      var nativeMatches = element.matches
          || element.webkitMatchesSelector
          || element.msMatchesSelector;
      return nativeMatches.call(element, selector);
  }

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var cssClasses = {
      // Ripple is a special case where the "root" component is really a "mixin" of sorts,
      // given that it's an 'upgrade' to an existing component. That being said it is the root
      // CSS class that all other CSS classes derive from.
      BG_FOCUSED: 'mdc-ripple-upgraded--background-focused',
      FG_ACTIVATION: 'mdc-ripple-upgraded--foreground-activation',
      FG_DEACTIVATION: 'mdc-ripple-upgraded--foreground-deactivation',
      ROOT: 'mdc-ripple-upgraded',
      UNBOUNDED: 'mdc-ripple-upgraded--unbounded',
  };
  var strings = {
      VAR_FG_SCALE: '--mdc-ripple-fg-scale',
      VAR_FG_SIZE: '--mdc-ripple-fg-size',
      VAR_FG_TRANSLATE_END: '--mdc-ripple-fg-translate-end',
      VAR_FG_TRANSLATE_START: '--mdc-ripple-fg-translate-start',
      VAR_LEFT: '--mdc-ripple-left',
      VAR_TOP: '--mdc-ripple-top',
  };
  var numbers = {
      DEACTIVATION_TIMEOUT_MS: 225,
      FG_DEACTIVATION_MS: 150,
      INITIAL_ORIGIN_SCALE: 0.6,
      PADDING: 10,
      TAP_DELAY_MS: 300,
  };

  /**
   * Stores result from supportsCssVariables to avoid redundant processing to
   * detect CSS custom variable support.
   */
  var supportsCssVariables_;
  function detectEdgePseudoVarBug(windowObj) {
      // Detect versions of Edge with buggy var() support
      // See: https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/11495448/
      var document = windowObj.document;
      var node = document.createElement('div');
      node.className = 'mdc-ripple-surface--test-edge-var-bug';
      // Append to head instead of body because this script might be invoked in the
      // head, in which case the body doesn't exist yet. The probe works either way.
      document.head.appendChild(node);
      // The bug exists if ::before style ends up propagating to the parent element.
      // Additionally, getComputedStyle returns null in iframes with display: "none" in Firefox,
      // but Firefox is known to support CSS custom properties correctly.
      // See: https://bugzilla.mozilla.org/show_bug.cgi?id=548397
      var computedStyle = windowObj.getComputedStyle(node);
      var hasPseudoVarBug = computedStyle !== null && computedStyle.borderTopStyle === 'solid';
      if (node.parentNode) {
          node.parentNode.removeChild(node);
      }
      return hasPseudoVarBug;
  }
  function supportsCssVariables(windowObj, forceRefresh) {
      if (forceRefresh === void 0) { forceRefresh = false; }
      var CSS = windowObj.CSS;
      var supportsCssVars = supportsCssVariables_;
      if (typeof supportsCssVariables_ === 'boolean' && !forceRefresh) {
          return supportsCssVariables_;
      }
      var supportsFunctionPresent = CSS && typeof CSS.supports === 'function';
      if (!supportsFunctionPresent) {
          return false;
      }
      var explicitlySupportsCssVars = CSS.supports('--css-vars', 'yes');
      // See: https://bugs.webkit.org/show_bug.cgi?id=154669
      // See: README section on Safari
      var weAreFeatureDetectingSafari10plus = (CSS.supports('(--css-vars: yes)') &&
          CSS.supports('color', '#00000000'));
      if (explicitlySupportsCssVars || weAreFeatureDetectingSafari10plus) {
          supportsCssVars = !detectEdgePseudoVarBug(windowObj);
      }
      else {
          supportsCssVars = false;
      }
      if (!forceRefresh) {
          supportsCssVariables_ = supportsCssVars;
      }
      return supportsCssVars;
  }
  function getNormalizedEventCoords(evt, pageOffset, clientRect) {
      if (!evt) {
          return { x: 0, y: 0 };
      }
      var x = pageOffset.x, y = pageOffset.y;
      var documentX = x + clientRect.left;
      var documentY = y + clientRect.top;
      var normalizedX;
      var normalizedY;
      // Determine touch point relative to the ripple container.
      if (evt.type === 'touchstart') {
          var touchEvent = evt;
          normalizedX = touchEvent.changedTouches[0].pageX - documentX;
          normalizedY = touchEvent.changedTouches[0].pageY - documentY;
      }
      else {
          var mouseEvent = evt;
          normalizedX = mouseEvent.pageX - documentX;
          normalizedY = mouseEvent.pageY - documentY;
      }
      return { x: normalizedX, y: normalizedY };
  }

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  // Activation events registered on the root element of each instance for activation
  var ACTIVATION_EVENT_TYPES = [
      'touchstart', 'pointerdown', 'mousedown', 'keydown',
  ];
  // Deactivation events registered on documentElement when a pointer-related down event occurs
  var POINTER_DEACTIVATION_EVENT_TYPES = [
      'touchend', 'pointerup', 'mouseup', 'contextmenu',
  ];
  // simultaneous nested activations
  var activatedTargets = [];
  var MDCRippleFoundation = /** @class */ (function (_super) {
      __extends(MDCRippleFoundation, _super);
      function MDCRippleFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCRippleFoundation.defaultAdapter, adapter)) || this;
          _this.activationAnimationHasEnded_ = false;
          _this.activationTimer_ = 0;
          _this.fgDeactivationRemovalTimer_ = 0;
          _this.fgScale_ = '0';
          _this.frame_ = { width: 0, height: 0 };
          _this.initialSize_ = 0;
          _this.layoutFrame_ = 0;
          _this.maxRadius_ = 0;
          _this.unboundedCoords_ = { left: 0, top: 0 };
          _this.activationState_ = _this.defaultActivationState_();
          _this.activationTimerCallback_ = function () {
              _this.activationAnimationHasEnded_ = true;
              _this.runDeactivationUXLogicIfReady_();
          };
          _this.activateHandler_ = function (e) { return _this.activate_(e); };
          _this.deactivateHandler_ = function () { return _this.deactivate_(); };
          _this.focusHandler_ = function () { return _this.handleFocus(); };
          _this.blurHandler_ = function () { return _this.handleBlur(); };
          _this.resizeHandler_ = function () { return _this.layout(); };
          return _this;
      }
      Object.defineProperty(MDCRippleFoundation, "cssClasses", {
          get: function () {
              return cssClasses;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCRippleFoundation, "strings", {
          get: function () {
              return strings;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCRippleFoundation, "numbers", {
          get: function () {
              return numbers;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCRippleFoundation, "defaultAdapter", {
          get: function () {
              return {
                  addClass: function () { return undefined; },
                  browserSupportsCssVars: function () { return true; },
                  computeBoundingRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                  containsEventTarget: function () { return true; },
                  deregisterDocumentInteractionHandler: function () { return undefined; },
                  deregisterInteractionHandler: function () { return undefined; },
                  deregisterResizeHandler: function () { return undefined; },
                  getWindowPageOffset: function () { return ({ x: 0, y: 0 }); },
                  isSurfaceActive: function () { return true; },
                  isSurfaceDisabled: function () { return true; },
                  isUnbounded: function () { return true; },
                  registerDocumentInteractionHandler: function () { return undefined; },
                  registerInteractionHandler: function () { return undefined; },
                  registerResizeHandler: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  updateCssVariable: function () { return undefined; },
              };
          },
          enumerable: true,
          configurable: true
      });
      MDCRippleFoundation.prototype.init = function () {
          var _this = this;
          var supportsPressRipple = this.supportsPressRipple_();
          this.registerRootHandlers_(supportsPressRipple);
          if (supportsPressRipple) {
              var _a = MDCRippleFoundation.cssClasses, ROOT_1 = _a.ROOT, UNBOUNDED_1 = _a.UNBOUNDED;
              requestAnimationFrame(function () {
                  _this.adapter_.addClass(ROOT_1);
                  if (_this.adapter_.isUnbounded()) {
                      _this.adapter_.addClass(UNBOUNDED_1);
                      // Unbounded ripples need layout logic applied immediately to set coordinates for both shade and ripple
                      _this.layoutInternal_();
                  }
              });
          }
      };
      MDCRippleFoundation.prototype.destroy = function () {
          var _this = this;
          if (this.supportsPressRipple_()) {
              if (this.activationTimer_) {
                  clearTimeout(this.activationTimer_);
                  this.activationTimer_ = 0;
                  this.adapter_.removeClass(MDCRippleFoundation.cssClasses.FG_ACTIVATION);
              }
              if (this.fgDeactivationRemovalTimer_) {
                  clearTimeout(this.fgDeactivationRemovalTimer_);
                  this.fgDeactivationRemovalTimer_ = 0;
                  this.adapter_.removeClass(MDCRippleFoundation.cssClasses.FG_DEACTIVATION);
              }
              var _a = MDCRippleFoundation.cssClasses, ROOT_2 = _a.ROOT, UNBOUNDED_2 = _a.UNBOUNDED;
              requestAnimationFrame(function () {
                  _this.adapter_.removeClass(ROOT_2);
                  _this.adapter_.removeClass(UNBOUNDED_2);
                  _this.removeCssVars_();
              });
          }
          this.deregisterRootHandlers_();
          this.deregisterDeactivationHandlers_();
      };
      /**
       * @param evt Optional event containing position information.
       */
      MDCRippleFoundation.prototype.activate = function (evt) {
          this.activate_(evt);
      };
      MDCRippleFoundation.prototype.deactivate = function () {
          this.deactivate_();
      };
      MDCRippleFoundation.prototype.layout = function () {
          var _this = this;
          if (this.layoutFrame_) {
              cancelAnimationFrame(this.layoutFrame_);
          }
          this.layoutFrame_ = requestAnimationFrame(function () {
              _this.layoutInternal_();
              _this.layoutFrame_ = 0;
          });
      };
      MDCRippleFoundation.prototype.setUnbounded = function (unbounded) {
          var UNBOUNDED = MDCRippleFoundation.cssClasses.UNBOUNDED;
          if (unbounded) {
              this.adapter_.addClass(UNBOUNDED);
          }
          else {
              this.adapter_.removeClass(UNBOUNDED);
          }
      };
      MDCRippleFoundation.prototype.handleFocus = function () {
          var _this = this;
          requestAnimationFrame(function () {
              return _this.adapter_.addClass(MDCRippleFoundation.cssClasses.BG_FOCUSED);
          });
      };
      MDCRippleFoundation.prototype.handleBlur = function () {
          var _this = this;
          requestAnimationFrame(function () {
              return _this.adapter_.removeClass(MDCRippleFoundation.cssClasses.BG_FOCUSED);
          });
      };
      /**
       * We compute this property so that we are not querying information about the client
       * until the point in time where the foundation requests it. This prevents scenarios where
       * client-side feature-detection may happen too early, such as when components are rendered on the server
       * and then initialized at mount time on the client.
       */
      MDCRippleFoundation.prototype.supportsPressRipple_ = function () {
          return this.adapter_.browserSupportsCssVars();
      };
      MDCRippleFoundation.prototype.defaultActivationState_ = function () {
          return {
              activationEvent: undefined,
              hasDeactivationUXRun: false,
              isActivated: false,
              isProgrammatic: false,
              wasActivatedByPointer: false,
              wasElementMadeActive: false,
          };
      };
      /**
       * supportsPressRipple Passed from init to save a redundant function call
       */
      MDCRippleFoundation.prototype.registerRootHandlers_ = function (supportsPressRipple) {
          var _this = this;
          if (supportsPressRipple) {
              ACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                  _this.adapter_.registerInteractionHandler(evtType, _this.activateHandler_);
              });
              if (this.adapter_.isUnbounded()) {
                  this.adapter_.registerResizeHandler(this.resizeHandler_);
              }
          }
          this.adapter_.registerInteractionHandler('focus', this.focusHandler_);
          this.adapter_.registerInteractionHandler('blur', this.blurHandler_);
      };
      MDCRippleFoundation.prototype.registerDeactivationHandlers_ = function (evt) {
          var _this = this;
          if (evt.type === 'keydown') {
              this.adapter_.registerInteractionHandler('keyup', this.deactivateHandler_);
          }
          else {
              POINTER_DEACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                  _this.adapter_.registerDocumentInteractionHandler(evtType, _this.deactivateHandler_);
              });
          }
      };
      MDCRippleFoundation.prototype.deregisterRootHandlers_ = function () {
          var _this = this;
          ACTIVATION_EVENT_TYPES.forEach(function (evtType) {
              _this.adapter_.deregisterInteractionHandler(evtType, _this.activateHandler_);
          });
          this.adapter_.deregisterInteractionHandler('focus', this.focusHandler_);
          this.adapter_.deregisterInteractionHandler('blur', this.blurHandler_);
          if (this.adapter_.isUnbounded()) {
              this.adapter_.deregisterResizeHandler(this.resizeHandler_);
          }
      };
      MDCRippleFoundation.prototype.deregisterDeactivationHandlers_ = function () {
          var _this = this;
          this.adapter_.deregisterInteractionHandler('keyup', this.deactivateHandler_);
          POINTER_DEACTIVATION_EVENT_TYPES.forEach(function (evtType) {
              _this.adapter_.deregisterDocumentInteractionHandler(evtType, _this.deactivateHandler_);
          });
      };
      MDCRippleFoundation.prototype.removeCssVars_ = function () {
          var _this = this;
          var rippleStrings = MDCRippleFoundation.strings;
          var keys = Object.keys(rippleStrings);
          keys.forEach(function (key) {
              if (key.indexOf('VAR_') === 0) {
                  _this.adapter_.updateCssVariable(rippleStrings[key], null);
              }
          });
      };
      MDCRippleFoundation.prototype.activate_ = function (evt) {
          var _this = this;
          if (this.adapter_.isSurfaceDisabled()) {
              return;
          }
          var activationState = this.activationState_;
          if (activationState.isActivated) {
              return;
          }
          // Avoid reacting to follow-on events fired by touch device after an already-processed user interaction
          var previousActivationEvent = this.previousActivationEvent_;
          var isSameInteraction = previousActivationEvent && evt !== undefined && previousActivationEvent.type !== evt.type;
          if (isSameInteraction) {
              return;
          }
          activationState.isActivated = true;
          activationState.isProgrammatic = evt === undefined;
          activationState.activationEvent = evt;
          activationState.wasActivatedByPointer = activationState.isProgrammatic ? false : evt !== undefined && (evt.type === 'mousedown' || evt.type === 'touchstart' || evt.type === 'pointerdown');
          var hasActivatedChild = evt !== undefined && activatedTargets.length > 0 && activatedTargets.some(function (target) { return _this.adapter_.containsEventTarget(target); });
          if (hasActivatedChild) {
              // Immediately reset activation state, while preserving logic that prevents touch follow-on events
              this.resetActivationState_();
              return;
          }
          if (evt !== undefined) {
              activatedTargets.push(evt.target);
              this.registerDeactivationHandlers_(evt);
          }
          activationState.wasElementMadeActive = this.checkElementMadeActive_(evt);
          if (activationState.wasElementMadeActive) {
              this.animateActivation_();
          }
          requestAnimationFrame(function () {
              // Reset array on next frame after the current event has had a chance to bubble to prevent ancestor ripples
              activatedTargets = [];
              if (!activationState.wasElementMadeActive
                  && evt !== undefined
                  && (evt.key === ' ' || evt.keyCode === 32)) {
                  // If space was pressed, try again within an rAF call to detect :active, because different UAs report
                  // active states inconsistently when they're called within event handling code:
                  // - https://bugs.chromium.org/p/chromium/issues/detail?id=635971
                  // - https://bugzilla.mozilla.org/show_bug.cgi?id=1293741
                  // We try first outside rAF to support Edge, which does not exhibit this problem, but will crash if a CSS
                  // variable is set within a rAF callback for a submit button interaction (#2241).
                  activationState.wasElementMadeActive = _this.checkElementMadeActive_(evt);
                  if (activationState.wasElementMadeActive) {
                      _this.animateActivation_();
                  }
              }
              if (!activationState.wasElementMadeActive) {
                  // Reset activation state immediately if element was not made active.
                  _this.activationState_ = _this.defaultActivationState_();
              }
          });
      };
      MDCRippleFoundation.prototype.checkElementMadeActive_ = function (evt) {
          return (evt !== undefined && evt.type === 'keydown') ? this.adapter_.isSurfaceActive() : true;
      };
      MDCRippleFoundation.prototype.animateActivation_ = function () {
          var _this = this;
          var _a = MDCRippleFoundation.strings, VAR_FG_TRANSLATE_START = _a.VAR_FG_TRANSLATE_START, VAR_FG_TRANSLATE_END = _a.VAR_FG_TRANSLATE_END;
          var _b = MDCRippleFoundation.cssClasses, FG_DEACTIVATION = _b.FG_DEACTIVATION, FG_ACTIVATION = _b.FG_ACTIVATION;
          var DEACTIVATION_TIMEOUT_MS = MDCRippleFoundation.numbers.DEACTIVATION_TIMEOUT_MS;
          this.layoutInternal_();
          var translateStart = '';
          var translateEnd = '';
          if (!this.adapter_.isUnbounded()) {
              var _c = this.getFgTranslationCoordinates_(), startPoint = _c.startPoint, endPoint = _c.endPoint;
              translateStart = startPoint.x + "px, " + startPoint.y + "px";
              translateEnd = endPoint.x + "px, " + endPoint.y + "px";
          }
          this.adapter_.updateCssVariable(VAR_FG_TRANSLATE_START, translateStart);
          this.adapter_.updateCssVariable(VAR_FG_TRANSLATE_END, translateEnd);
          // Cancel any ongoing activation/deactivation animations
          clearTimeout(this.activationTimer_);
          clearTimeout(this.fgDeactivationRemovalTimer_);
          this.rmBoundedActivationClasses_();
          this.adapter_.removeClass(FG_DEACTIVATION);
          // Force layout in order to re-trigger the animation.
          this.adapter_.computeBoundingRect();
          this.adapter_.addClass(FG_ACTIVATION);
          this.activationTimer_ = setTimeout(function () { return _this.activationTimerCallback_(); }, DEACTIVATION_TIMEOUT_MS);
      };
      MDCRippleFoundation.prototype.getFgTranslationCoordinates_ = function () {
          var _a = this.activationState_, activationEvent = _a.activationEvent, wasActivatedByPointer = _a.wasActivatedByPointer;
          var startPoint;
          if (wasActivatedByPointer) {
              startPoint = getNormalizedEventCoords(activationEvent, this.adapter_.getWindowPageOffset(), this.adapter_.computeBoundingRect());
          }
          else {
              startPoint = {
                  x: this.frame_.width / 2,
                  y: this.frame_.height / 2,
              };
          }
          // Center the element around the start point.
          startPoint = {
              x: startPoint.x - (this.initialSize_ / 2),
              y: startPoint.y - (this.initialSize_ / 2),
          };
          var endPoint = {
              x: (this.frame_.width / 2) - (this.initialSize_ / 2),
              y: (this.frame_.height / 2) - (this.initialSize_ / 2),
          };
          return { startPoint: startPoint, endPoint: endPoint };
      };
      MDCRippleFoundation.prototype.runDeactivationUXLogicIfReady_ = function () {
          var _this = this;
          // This method is called both when a pointing device is released, and when the activation animation ends.
          // The deactivation animation should only run after both of those occur.
          var FG_DEACTIVATION = MDCRippleFoundation.cssClasses.FG_DEACTIVATION;
          var _a = this.activationState_, hasDeactivationUXRun = _a.hasDeactivationUXRun, isActivated = _a.isActivated;
          var activationHasEnded = hasDeactivationUXRun || !isActivated;
          if (activationHasEnded && this.activationAnimationHasEnded_) {
              this.rmBoundedActivationClasses_();
              this.adapter_.addClass(FG_DEACTIVATION);
              this.fgDeactivationRemovalTimer_ = setTimeout(function () {
                  _this.adapter_.removeClass(FG_DEACTIVATION);
              }, numbers.FG_DEACTIVATION_MS);
          }
      };
      MDCRippleFoundation.prototype.rmBoundedActivationClasses_ = function () {
          var FG_ACTIVATION = MDCRippleFoundation.cssClasses.FG_ACTIVATION;
          this.adapter_.removeClass(FG_ACTIVATION);
          this.activationAnimationHasEnded_ = false;
          this.adapter_.computeBoundingRect();
      };
      MDCRippleFoundation.prototype.resetActivationState_ = function () {
          var _this = this;
          this.previousActivationEvent_ = this.activationState_.activationEvent;
          this.activationState_ = this.defaultActivationState_();
          // Touch devices may fire additional events for the same interaction within a short time.
          // Store the previous event until it's safe to assume that subsequent events are for new interactions.
          setTimeout(function () { return _this.previousActivationEvent_ = undefined; }, MDCRippleFoundation.numbers.TAP_DELAY_MS);
      };
      MDCRippleFoundation.prototype.deactivate_ = function () {
          var _this = this;
          var activationState = this.activationState_;
          // This can happen in scenarios such as when you have a keyup event that blurs the element.
          if (!activationState.isActivated) {
              return;
          }
          var state = __assign({}, activationState);
          if (activationState.isProgrammatic) {
              requestAnimationFrame(function () { return _this.animateDeactivation_(state); });
              this.resetActivationState_();
          }
          else {
              this.deregisterDeactivationHandlers_();
              requestAnimationFrame(function () {
                  _this.activationState_.hasDeactivationUXRun = true;
                  _this.animateDeactivation_(state);
                  _this.resetActivationState_();
              });
          }
      };
      MDCRippleFoundation.prototype.animateDeactivation_ = function (_a) {
          var wasActivatedByPointer = _a.wasActivatedByPointer, wasElementMadeActive = _a.wasElementMadeActive;
          if (wasActivatedByPointer || wasElementMadeActive) {
              this.runDeactivationUXLogicIfReady_();
          }
      };
      MDCRippleFoundation.prototype.layoutInternal_ = function () {
          var _this = this;
          this.frame_ = this.adapter_.computeBoundingRect();
          var maxDim = Math.max(this.frame_.height, this.frame_.width);
          // Surface diameter is treated differently for unbounded vs. bounded ripples.
          // Unbounded ripple diameter is calculated smaller since the surface is expected to already be padded appropriately
          // to extend the hitbox, and the ripple is expected to meet the edges of the padded hitbox (which is typically
          // square). Bounded ripples, on the other hand, are fully expected to expand beyond the surface's longest diameter
          // (calculated based on the diagonal plus a constant padding), and are clipped at the surface's border via
          // `overflow: hidden`.
          var getBoundedRadius = function () {
              var hypotenuse = Math.sqrt(Math.pow(_this.frame_.width, 2) + Math.pow(_this.frame_.height, 2));
              return hypotenuse + MDCRippleFoundation.numbers.PADDING;
          };
          this.maxRadius_ = this.adapter_.isUnbounded() ? maxDim : getBoundedRadius();
          // Ripple is sized as a fraction of the largest dimension of the surface, then scales up using a CSS scale transform
          this.initialSize_ = Math.floor(maxDim * MDCRippleFoundation.numbers.INITIAL_ORIGIN_SCALE);
          this.fgScale_ = "" + this.maxRadius_ / this.initialSize_;
          this.updateLayoutCssVars_();
      };
      MDCRippleFoundation.prototype.updateLayoutCssVars_ = function () {
          var _a = MDCRippleFoundation.strings, VAR_FG_SIZE = _a.VAR_FG_SIZE, VAR_LEFT = _a.VAR_LEFT, VAR_TOP = _a.VAR_TOP, VAR_FG_SCALE = _a.VAR_FG_SCALE;
          this.adapter_.updateCssVariable(VAR_FG_SIZE, this.initialSize_ + "px");
          this.adapter_.updateCssVariable(VAR_FG_SCALE, this.fgScale_);
          if (this.adapter_.isUnbounded()) {
              this.unboundedCoords_ = {
                  left: Math.round((this.frame_.width / 2) - (this.initialSize_ / 2)),
                  top: Math.round((this.frame_.height / 2) - (this.initialSize_ / 2)),
              };
              this.adapter_.updateCssVariable(VAR_LEFT, this.unboundedCoords_.left + "px");
              this.adapter_.updateCssVariable(VAR_TOP, this.unboundedCoords_.top + "px");
          }
      };
      return MDCRippleFoundation;
  }(MDCFoundation));

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCRipple = /** @class */ (function (_super) {
      __extends(MDCRipple, _super);
      function MDCRipple() {
          var _this = _super !== null && _super.apply(this, arguments) || this;
          _this.disabled = false;
          return _this;
      }
      MDCRipple.attachTo = function (root, opts) {
          if (opts === void 0) { opts = { isUnbounded: undefined }; }
          var ripple = new MDCRipple(root);
          // Only override unbounded behavior if option is explicitly specified
          if (opts.isUnbounded !== undefined) {
              ripple.unbounded = opts.isUnbounded;
          }
          return ripple;
      };
      MDCRipple.createAdapter = function (instance) {
          return {
              addClass: function (className) { return instance.root_.classList.add(className); },
              browserSupportsCssVars: function () { return supportsCssVariables(window); },
              computeBoundingRect: function () { return instance.root_.getBoundingClientRect(); },
              containsEventTarget: function (target) { return instance.root_.contains(target); },
              deregisterDocumentInteractionHandler: function (evtType, handler) {
                  return document.documentElement.removeEventListener(evtType, handler, applyPassive());
              },
              deregisterInteractionHandler: function (evtType, handler) {
                  return instance.root_.removeEventListener(evtType, handler, applyPassive());
              },
              deregisterResizeHandler: function (handler) { return window.removeEventListener('resize', handler); },
              getWindowPageOffset: function () { return ({ x: window.pageXOffset, y: window.pageYOffset }); },
              isSurfaceActive: function () { return matches(instance.root_, ':active'); },
              isSurfaceDisabled: function () { return Boolean(instance.disabled); },
              isUnbounded: function () { return Boolean(instance.unbounded); },
              registerDocumentInteractionHandler: function (evtType, handler) {
                  return document.documentElement.addEventListener(evtType, handler, applyPassive());
              },
              registerInteractionHandler: function (evtType, handler) {
                  return instance.root_.addEventListener(evtType, handler, applyPassive());
              },
              registerResizeHandler: function (handler) { return window.addEventListener('resize', handler); },
              removeClass: function (className) { return instance.root_.classList.remove(className); },
              updateCssVariable: function (varName, value) { return instance.root_.style.setProperty(varName, value); },
          };
      };
      Object.defineProperty(MDCRipple.prototype, "unbounded", {
          get: function () {
              return Boolean(this.unbounded_);
          },
          set: function (unbounded) {
              this.unbounded_ = Boolean(unbounded);
              this.setUnbounded_();
          },
          enumerable: true,
          configurable: true
      });
      MDCRipple.prototype.activate = function () {
          this.foundation_.activate();
      };
      MDCRipple.prototype.deactivate = function () {
          this.foundation_.deactivate();
      };
      MDCRipple.prototype.layout = function () {
          this.foundation_.layout();
      };
      MDCRipple.prototype.getDefaultFoundation = function () {
          return new MDCRippleFoundation(MDCRipple.createAdapter(this));
      };
      MDCRipple.prototype.initialSyncWithDOM = function () {
          var root = this.root_;
          this.unbounded = 'mdcRippleIsUnbounded' in root.dataset;
      };
      /**
       * Closure Compiler throws an access control error when directly accessing a
       * protected or private property inside a getter/setter, like unbounded above.
       * By accessing the protected property inside a method, we solve that problem.
       * That's why this function exists.
       */
      MDCRipple.prototype.setUnbounded_ = function () {
          this.foundation_.setUnbounded(Boolean(this.unbounded_));
      };
      return MDCRipple;
  }(MDCComponent));

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var cssClasses$1 = {
      FIXED_CLASS: 'mdc-top-app-bar--fixed',
      FIXED_SCROLLED_CLASS: 'mdc-top-app-bar--fixed-scrolled',
      SHORT_CLASS: 'mdc-top-app-bar--short',
      SHORT_COLLAPSED_CLASS: 'mdc-top-app-bar--short-collapsed',
      SHORT_HAS_ACTION_ITEM_CLASS: 'mdc-top-app-bar--short-has-action-item',
  };
  var numbers$1 = {
      DEBOUNCE_THROTTLE_RESIZE_TIME_MS: 100,
      MAX_TOP_APP_BAR_HEIGHT: 128,
  };
  var strings$1 = {
      ACTION_ITEM_SELECTOR: '.mdc-top-app-bar__action-item',
      NAVIGATION_EVENT: 'MDCTopAppBar:nav',
      NAVIGATION_ICON_SELECTOR: '.mdc-top-app-bar__navigation-icon',
      ROOT_SELECTOR: '.mdc-top-app-bar',
      TITLE_SELECTOR: '.mdc-top-app-bar__title',
  };

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCTopAppBarBaseFoundation = /** @class */ (function (_super) {
      __extends(MDCTopAppBarBaseFoundation, _super);
      /* istanbul ignore next: optional argument is not a branch statement */
      function MDCTopAppBarBaseFoundation(adapter) {
          return _super.call(this, __assign({}, MDCTopAppBarBaseFoundation.defaultAdapter, adapter)) || this;
      }
      Object.defineProperty(MDCTopAppBarBaseFoundation, "strings", {
          get: function () {
              return strings$1;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTopAppBarBaseFoundation, "cssClasses", {
          get: function () {
              return cssClasses$1;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTopAppBarBaseFoundation, "numbers", {
          get: function () {
              return numbers$1;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTopAppBarBaseFoundation, "defaultAdapter", {
          /**
           * See {@link MDCTopAppBarAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  hasClass: function () { return false; },
                  setStyle: function () { return undefined; },
                  getTopAppBarHeight: function () { return 0; },
                  notifyNavigationIconClicked: function () { return undefined; },
                  getViewportScrollY: function () { return 0; },
                  getTotalActionItems: function () { return 0; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      /** Other variants of TopAppBar foundation overrides this method */
      MDCTopAppBarBaseFoundation.prototype.handleTargetScroll = function () { }; // tslint:disable-line:no-empty
      /** Other variants of TopAppBar foundation overrides this method */
      MDCTopAppBarBaseFoundation.prototype.handleWindowResize = function () { }; // tslint:disable-line:no-empty
      MDCTopAppBarBaseFoundation.prototype.handleNavigationClick = function () {
          this.adapter_.notifyNavigationIconClicked();
      };
      return MDCTopAppBarBaseFoundation;
  }(MDCFoundation));

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var INITIAL_VALUE = 0;
  var MDCTopAppBarFoundation = /** @class */ (function (_super) {
      __extends(MDCTopAppBarFoundation, _super);
      /* istanbul ignore next: optional argument is not a branch statement */
      function MDCTopAppBarFoundation(adapter) {
          var _this = _super.call(this, adapter) || this;
          /**
           * Indicates if the top app bar was docked in the previous scroll handler iteration.
           */
          _this.wasDocked_ = true;
          /**
           * Indicates if the top app bar is docked in the fully shown position.
           */
          _this.isDockedShowing_ = true;
          /**
           * Variable for current scroll position of the top app bar
           */
          _this.currentAppBarOffsetTop_ = 0;
          /**
           * Used to prevent the top app bar from being scrolled out of view during resize events
           */
          _this.isCurrentlyBeingResized_ = false;
          /**
           * The timeout that's used to throttle the resize events
           */
          _this.resizeThrottleId_ = INITIAL_VALUE;
          /**
           * The timeout that's used to debounce toggling the isCurrentlyBeingResized_ variable after a resize
           */
          _this.resizeDebounceId_ = INITIAL_VALUE;
          _this.lastScrollPosition_ = _this.adapter_.getViewportScrollY();
          _this.topAppBarHeight_ = _this.adapter_.getTopAppBarHeight();
          return _this;
      }
      MDCTopAppBarFoundation.prototype.destroy = function () {
          _super.prototype.destroy.call(this);
          this.adapter_.setStyle('top', '');
      };
      /**
       * Scroll handler for the default scroll behavior of the top app bar.
       * @override
       */
      MDCTopAppBarFoundation.prototype.handleTargetScroll = function () {
          var currentScrollPosition = Math.max(this.adapter_.getViewportScrollY(), 0);
          var diff = currentScrollPosition - this.lastScrollPosition_;
          this.lastScrollPosition_ = currentScrollPosition;
          // If the window is being resized the lastScrollPosition_ needs to be updated but the
          // current scroll of the top app bar should stay in the same position.
          if (!this.isCurrentlyBeingResized_) {
              this.currentAppBarOffsetTop_ -= diff;
              if (this.currentAppBarOffsetTop_ > 0) {
                  this.currentAppBarOffsetTop_ = 0;
              }
              else if (Math.abs(this.currentAppBarOffsetTop_) > this.topAppBarHeight_) {
                  this.currentAppBarOffsetTop_ = -this.topAppBarHeight_;
              }
              this.moveTopAppBar_();
          }
      };
      /**
       * Top app bar resize handler that throttle/debounce functions that execute updates.
       * @override
       */
      MDCTopAppBarFoundation.prototype.handleWindowResize = function () {
          var _this = this;
          // Throttle resize events 10 p/s
          if (!this.resizeThrottleId_) {
              this.resizeThrottleId_ = setTimeout(function () {
                  _this.resizeThrottleId_ = INITIAL_VALUE;
                  _this.throttledResizeHandler_();
              }, numbers$1.DEBOUNCE_THROTTLE_RESIZE_TIME_MS);
          }
          this.isCurrentlyBeingResized_ = true;
          if (this.resizeDebounceId_) {
              clearTimeout(this.resizeDebounceId_);
          }
          this.resizeDebounceId_ = setTimeout(function () {
              _this.handleTargetScroll();
              _this.isCurrentlyBeingResized_ = false;
              _this.resizeDebounceId_ = INITIAL_VALUE;
          }, numbers$1.DEBOUNCE_THROTTLE_RESIZE_TIME_MS);
      };
      /**
       * Function to determine if the DOM needs to update.
       */
      MDCTopAppBarFoundation.prototype.checkForUpdate_ = function () {
          var offscreenBoundaryTop = -this.topAppBarHeight_;
          var hasAnyPixelsOffscreen = this.currentAppBarOffsetTop_ < 0;
          var hasAnyPixelsOnscreen = this.currentAppBarOffsetTop_ > offscreenBoundaryTop;
          var partiallyShowing = hasAnyPixelsOffscreen && hasAnyPixelsOnscreen;
          // If it's partially showing, it can't be docked.
          if (partiallyShowing) {
              this.wasDocked_ = false;
          }
          else {
              // Not previously docked and not partially showing, it's now docked.
              if (!this.wasDocked_) {
                  this.wasDocked_ = true;
                  return true;
              }
              else if (this.isDockedShowing_ !== hasAnyPixelsOnscreen) {
                  this.isDockedShowing_ = hasAnyPixelsOnscreen;
                  return true;
              }
          }
          return partiallyShowing;
      };
      /**
       * Function to move the top app bar if needed.
       */
      MDCTopAppBarFoundation.prototype.moveTopAppBar_ = function () {
          if (this.checkForUpdate_()) {
              // Once the top app bar is fully hidden we use the max potential top app bar height as our offset
              // so the top app bar doesn't show if the window resizes and the new height > the old height.
              var offset = this.currentAppBarOffsetTop_;
              if (Math.abs(offset) >= this.topAppBarHeight_) {
                  offset = -numbers$1.MAX_TOP_APP_BAR_HEIGHT;
              }
              this.adapter_.setStyle('top', offset + 'px');
          }
      };
      /**
       * Throttled function that updates the top app bar scrolled values if the
       * top app bar height changes.
       */
      MDCTopAppBarFoundation.prototype.throttledResizeHandler_ = function () {
          var currentHeight = this.adapter_.getTopAppBarHeight();
          if (this.topAppBarHeight_ !== currentHeight) {
              this.wasDocked_ = false;
              // Since the top app bar has a different height depending on the screen width, this
              // will ensure that the top app bar remains in the correct location if
              // completely hidden and a resize makes the top app bar a different height.
              this.currentAppBarOffsetTop_ -= this.topAppBarHeight_ - currentHeight;
              this.topAppBarHeight_ = currentHeight;
          }
          this.handleTargetScroll();
      };
      return MDCTopAppBarFoundation;
  }(MDCTopAppBarBaseFoundation));

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCFixedTopAppBarFoundation = /** @class */ (function (_super) {
      __extends(MDCFixedTopAppBarFoundation, _super);
      function MDCFixedTopAppBarFoundation() {
          var _this = _super !== null && _super.apply(this, arguments) || this;
          /**
           * State variable for the previous scroll iteration top app bar state
           */
          _this.wasScrolled_ = false;
          return _this;
      }
      /**
       * Scroll handler for applying/removing the modifier class on the fixed top app bar.
       * @override
       */
      MDCFixedTopAppBarFoundation.prototype.handleTargetScroll = function () {
          var currentScroll = this.adapter_.getViewportScrollY();
          if (currentScroll <= 0) {
              if (this.wasScrolled_) {
                  this.adapter_.removeClass(cssClasses$1.FIXED_SCROLLED_CLASS);
                  this.wasScrolled_ = false;
              }
          }
          else {
              if (!this.wasScrolled_) {
                  this.adapter_.addClass(cssClasses$1.FIXED_SCROLLED_CLASS);
                  this.wasScrolled_ = true;
              }
          }
      };
      return MDCFixedTopAppBarFoundation;
  }(MDCTopAppBarFoundation));

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCShortTopAppBarFoundation = /** @class */ (function (_super) {
      __extends(MDCShortTopAppBarFoundation, _super);
      /* istanbul ignore next: optional argument is not a branch statement */
      function MDCShortTopAppBarFoundation(adapter) {
          var _this = _super.call(this, adapter) || this;
          _this.isCollapsed_ = false;
          _this.isAlwaysCollapsed_ = false;
          return _this;
      }
      Object.defineProperty(MDCShortTopAppBarFoundation.prototype, "isCollapsed", {
          // Public visibility for backward compatibility.
          get: function () {
              return this.isCollapsed_;
          },
          enumerable: true,
          configurable: true
      });
      MDCShortTopAppBarFoundation.prototype.init = function () {
          _super.prototype.init.call(this);
          if (this.adapter_.getTotalActionItems() > 0) {
              this.adapter_.addClass(cssClasses$1.SHORT_HAS_ACTION_ITEM_CLASS);
          }
          // If initialized with SHORT_COLLAPSED_CLASS, the bar should always be collapsed
          this.setAlwaysCollapsed(this.adapter_.hasClass(cssClasses$1.SHORT_COLLAPSED_CLASS));
      };
      /**
       * Set if the short top app bar should always be collapsed.
       *
       * @param value When `true`, bar will always be collapsed. When `false`, bar may collapse or expand based on scroll.
       */
      MDCShortTopAppBarFoundation.prototype.setAlwaysCollapsed = function (value) {
          this.isAlwaysCollapsed_ = !!value;
          if (this.isAlwaysCollapsed_) {
              this.collapse_();
          }
          else {
              // let maybeCollapseBar_ determine if the bar should be collapsed
              this.maybeCollapseBar_();
          }
      };
      MDCShortTopAppBarFoundation.prototype.getAlwaysCollapsed = function () {
          return this.isAlwaysCollapsed_;
      };
      /**
       * Scroll handler for applying/removing the collapsed modifier class on the short top app bar.
       * @override
       */
      MDCShortTopAppBarFoundation.prototype.handleTargetScroll = function () {
          this.maybeCollapseBar_();
      };
      MDCShortTopAppBarFoundation.prototype.maybeCollapseBar_ = function () {
          if (this.isAlwaysCollapsed_) {
              return;
          }
          var currentScroll = this.adapter_.getViewportScrollY();
          if (currentScroll <= 0) {
              if (this.isCollapsed_) {
                  this.uncollapse_();
              }
          }
          else {
              if (!this.isCollapsed_) {
                  this.collapse_();
              }
          }
      };
      MDCShortTopAppBarFoundation.prototype.uncollapse_ = function () {
          this.adapter_.removeClass(cssClasses$1.SHORT_COLLAPSED_CLASS);
          this.isCollapsed_ = false;
      };
      MDCShortTopAppBarFoundation.prototype.collapse_ = function () {
          this.adapter_.addClass(cssClasses$1.SHORT_COLLAPSED_CLASS);
          this.isCollapsed_ = true;
      };
      return MDCShortTopAppBarFoundation;
  }(MDCTopAppBarBaseFoundation));

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCTopAppBar = /** @class */ (function (_super) {
      __extends(MDCTopAppBar, _super);
      function MDCTopAppBar() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCTopAppBar.attachTo = function (root) {
          return new MDCTopAppBar(root);
      };
      MDCTopAppBar.prototype.initialize = function (rippleFactory) {
          if (rippleFactory === void 0) { rippleFactory = function (el) { return MDCRipple.attachTo(el); }; }
          this.navIcon_ = this.root_.querySelector(strings$1.NAVIGATION_ICON_SELECTOR);
          // Get all icons in the toolbar and instantiate the ripples
          var icons = [].slice.call(this.root_.querySelectorAll(strings$1.ACTION_ITEM_SELECTOR));
          if (this.navIcon_) {
              icons.push(this.navIcon_);
          }
          this.iconRipples_ = icons.map(function (icon) {
              var ripple = rippleFactory(icon);
              ripple.unbounded = true;
              return ripple;
          });
          this.scrollTarget_ = window;
      };
      MDCTopAppBar.prototype.initialSyncWithDOM = function () {
          this.handleNavigationClick_ = this.foundation_.handleNavigationClick.bind(this.foundation_);
          this.handleWindowResize_ = this.foundation_.handleWindowResize.bind(this.foundation_);
          this.handleTargetScroll_ = this.foundation_.handleTargetScroll.bind(this.foundation_);
          this.scrollTarget_.addEventListener('scroll', this.handleTargetScroll_);
          if (this.navIcon_) {
              this.navIcon_.addEventListener('click', this.handleNavigationClick_);
          }
          var isFixed = this.root_.classList.contains(cssClasses$1.FIXED_CLASS);
          var isShort = this.root_.classList.contains(cssClasses$1.SHORT_CLASS);
          if (!isShort && !isFixed) {
              window.addEventListener('resize', this.handleWindowResize_);
          }
      };
      MDCTopAppBar.prototype.destroy = function () {
          this.iconRipples_.forEach(function (iconRipple) { return iconRipple.destroy(); });
          this.scrollTarget_.removeEventListener('scroll', this.handleTargetScroll_);
          if (this.navIcon_) {
              this.navIcon_.removeEventListener('click', this.handleNavigationClick_);
          }
          var isFixed = this.root_.classList.contains(cssClasses$1.FIXED_CLASS);
          var isShort = this.root_.classList.contains(cssClasses$1.SHORT_CLASS);
          if (!isShort && !isFixed) {
              window.removeEventListener('resize', this.handleWindowResize_);
          }
          _super.prototype.destroy.call(this);
      };
      MDCTopAppBar.prototype.setScrollTarget = function (target) {
          // Remove scroll handler from the previous scroll target
          this.scrollTarget_.removeEventListener('scroll', this.handleTargetScroll_);
          this.scrollTarget_ = target;
          // Initialize scroll handler on the new scroll target
          this.handleTargetScroll_ =
              this.foundation_.handleTargetScroll.bind(this.foundation_);
          this.scrollTarget_.addEventListener('scroll', this.handleTargetScroll_);
      };
      MDCTopAppBar.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              hasClass: function (className) { return _this.root_.classList.contains(className); },
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              setStyle: function (property, value) { return _this.root_.style.setProperty(property, value); },
              getTopAppBarHeight: function () { return _this.root_.clientHeight; },
              notifyNavigationIconClicked: function () { return _this.emit(strings$1.NAVIGATION_EVENT, {}); },
              getViewportScrollY: function () {
                  var win = _this.scrollTarget_;
                  var el = _this.scrollTarget_;
                  return win.pageYOffset !== undefined ? win.pageYOffset : el.scrollTop;
              },
              getTotalActionItems: function () { return _this.root_.querySelectorAll(strings$1.ACTION_ITEM_SELECTOR).length; },
          };
          // tslint:enable:object-literal-sort-keys
          var foundation;
          if (this.root_.classList.contains(cssClasses$1.SHORT_CLASS)) {
              foundation = new MDCShortTopAppBarFoundation(adapter);
          }
          else if (this.root_.classList.contains(cssClasses$1.FIXED_CLASS)) {
              foundation = new MDCFixedTopAppBarFoundation(adapter);
          }
          else {
              foundation = new MDCTopAppBarFoundation(adapter);
          }
          return foundation;
      };
      return MDCTopAppBar;
  }(MDCComponent));

  function forwardEventsBuilder(component, additionalEvents = []) {
    const events = [
      'focus', 'blur',
      'fullscreenchange', 'fullscreenerror', 'scroll',
      'cut', 'copy', 'paste',
      'keydown', 'keypress', 'keyup',
      'auxclick', 'click', 'contextmenu', 'dblclick', 'mousedown', 'mouseenter', 'mouseleave', 'mousemove', 'mouseover', 'mouseout', 'mouseup', 'pointerlockchange', 'pointerlockerror', 'select', 'wheel',
      'drag', 'dragend', 'dragenter', 'dragstart', 'dragleave', 'dragover', 'drop',
      'touchcancel', 'touchend', 'touchmove', 'touchstart',
      'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave', 'gotpointercapture', 'lostpointercapture',
      ...additionalEvents
    ];

    function forward(e) {
      bubble(component, e);
    }

    return node => {
      const destructors = [];

      for (let i = 0; i < events.length; i++) {
        destructors.push(listen(node, events[i], forward));
      }

      return {
        destroy: () => {
          for (let i = 0; i < destructors.length; i++) {
            destructors[i]();
          }
        }
      }
    };
  }

  function exclude(obj, keys) {
    let names = Object.getOwnPropertyNames(obj);
    const newObj = {};

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const cashIndex = name.indexOf('$');
      if (cashIndex !== -1 && keys.indexOf(name.substring(0, cashIndex + 1)) !== -1) {
        continue;
      }
      if (keys.indexOf(name) !== -1) {
        continue;
      }
      newObj[name] = obj[name];
    }

    return newObj;
  }

  function useActions(node, actions) {
    let objects = [];

    if (actions) {
      for (let i = 0; i < actions.length; i++) {
        const isArray = Array.isArray(actions[i]);
        const action = isArray ? actions[i][0] : actions[i];
        if (isArray && actions[i].length > 1) {
          objects.push(action(node, actions[i][1]));
        } else {
          objects.push(action(node));
        }
      }
    }

    return {
      update(actions) {
        if ((actions && actions.length || 0) != objects.length) {
          throw new Error('You must not change the length of an actions array.');
        }

        if (actions) {
          for (let i = 0; i < actions.length; i++) {
            if (objects[i] && 'update' in objects[i]) {
              const isArray = Array.isArray(actions[i]);
              if (isArray && actions[i].length > 1) {
                objects[i].update(actions[i][1]);
              } else {
                objects[i].update();
              }
            }
          }
        }
      },

      destroy() {
        for (let i = 0; i < objects.length; i++) {
          if (objects[i] && 'destroy' in objects[i]) {
            objects[i].destroy();
          }
        }
      }
    }
  }

  /* node_modules/@smui/top-app-bar/TopAppBar.svelte generated by Svelte v3.18.2 */

  function create_fragment(ctx) {
  	let header;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[12].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[11], null);

  	let header_levels = [
  		{
  			class: "\n    mdc-top-app-bar\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "short"
  			? "mdc-top-app-bar--short"
  			: "") + "\n    " + (/*collapsed*/ ctx[4]
  			? "mdc-top-app-bar--short-collapsed"
  			: "") + "\n    " + (/*variant*/ ctx[2] === "fixed"
  			? "mdc-top-app-bar--fixed"
  			: "") + "\n    " + (/*variant*/ ctx[2] === "static"
  			? "smui-top-app-bar--static"
  			: "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  			? "smui-top-app-bar--color-secondary"
  			: "") + "\n    " + (/*prominent*/ ctx[5] ? "mdc-top-app-bar--prominent" : "") + "\n    " + (/*dense*/ ctx[6] ? "mdc-top-app-bar--dense" : "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[9], ["use", "class", "variant", "color", "collapsed", "prominent", "dense"])
  	];

  	let header_data = {};

  	for (let i = 0; i < header_levels.length; i += 1) {
  		header_data = assign(header_data, header_levels[i]);
  	}

  	return {
  		c() {
  			header = element("header");
  			if (default_slot) default_slot.c();
  			set_attributes(header, header_data);
  		},
  		m(target, anchor) {
  			insert(target, header, anchor);

  			if (default_slot) {
  				default_slot.m(header, null);
  			}

  			/*header_binding*/ ctx[13](header);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, header, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[8].call(null, header))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 2048) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[11], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[11], dirty, null));
  			}

  			set_attributes(header, get_spread_update(header_levels, [
  				dirty & /*className, variant, collapsed, color, prominent, dense*/ 126 && {
  					class: "\n    mdc-top-app-bar\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "short"
  					? "mdc-top-app-bar--short"
  					: "") + "\n    " + (/*collapsed*/ ctx[4]
  					? "mdc-top-app-bar--short-collapsed"
  					: "") + "\n    " + (/*variant*/ ctx[2] === "fixed"
  					? "mdc-top-app-bar--fixed"
  					: "") + "\n    " + (/*variant*/ ctx[2] === "static"
  					? "smui-top-app-bar--static"
  					: "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  					? "smui-top-app-bar--color-secondary"
  					: "") + "\n    " + (/*prominent*/ ctx[5] ? "mdc-top-app-bar--prominent" : "") + "\n    " + (/*dense*/ ctx[6] ? "mdc-top-app-bar--dense" : "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 512 && exclude(/*$$props*/ ctx[9], ["use", "class", "variant", "color", "collapsed", "prominent", "dense"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(header);
  			if (default_slot) default_slot.d(detaching);
  			/*header_binding*/ ctx[13](null);
  			run_all(dispose);
  		}
  	};
  }

  function instance($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["MDCList:action"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { variant = "standard" } = $$props;
  	let { color = "primary" } = $$props;
  	let { collapsed = false } = $$props;
  	let { prominent = false } = $$props;
  	let { dense = false } = $$props;
  	let element;
  	let topAppBar;

  	onMount(() => {
  		topAppBar = new MDCTopAppBar(element);
  	});

  	onDestroy(() => {
  		topAppBar && topAppBar.destroy();
  	});

  	let { $$slots = {}, $$scope } = $$props;

  	function header_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(7, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(9, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("variant" in $$new_props) $$invalidate(2, variant = $$new_props.variant);
  		if ("color" in $$new_props) $$invalidate(3, color = $$new_props.color);
  		if ("collapsed" in $$new_props) $$invalidate(4, collapsed = $$new_props.collapsed);
  		if ("prominent" in $$new_props) $$invalidate(5, prominent = $$new_props.prominent);
  		if ("dense" in $$new_props) $$invalidate(6, dense = $$new_props.dense);
  		if ("$$scope" in $$new_props) $$invalidate(11, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		variant,
  		color,
  		collapsed,
  		prominent,
  		dense,
  		element,
  		forwardEvents,
  		$$props,
  		topAppBar,
  		$$scope,
  		$$slots,
  		header_binding
  	];
  }

  class TopAppBar extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance, create_fragment, safe_not_equal, {
  			use: 0,
  			class: 1,
  			variant: 2,
  			color: 3,
  			collapsed: 4,
  			prominent: 5,
  			dense: 6
  		});
  	}
  }

  /* node_modules/@smui/common/ClassAdder.svelte generated by Svelte v3.18.2 */

  function create_default_slot(ctx) {
  	let current;
  	const default_slot_template = /*$$slots*/ ctx[8].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);

  	return {
  		c() {
  			if (default_slot) default_slot.c();
  		},
  		m(target, anchor) {
  			if (default_slot) {
  				default_slot.m(target, anchor);
  			}

  			current = true;
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 512) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[9], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null));
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (default_slot) default_slot.d(detaching);
  		}
  	};
  }

  function create_fragment$1(ctx) {
  	let switch_instance_anchor;
  	let current;

  	const switch_instance_spread_levels = [
  		{
  			use: [/*forwardEvents*/ ctx[4], .../*use*/ ctx[0]]
  		},
  		{
  			class: "" + (/*smuiClass*/ ctx[3] + " " + /*className*/ ctx[1])
  		},
  		exclude(/*$$props*/ ctx[5], ["use", "class", "component", "forwardEvents"])
  	];

  	var switch_value = /*component*/ ctx[2];

  	function switch_props(ctx) {
  		let switch_instance_props = {
  			$$slots: { default: [create_default_slot] },
  			$$scope: { ctx }
  		};

  		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
  			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
  		}

  		return { props: switch_instance_props };
  	}

  	if (switch_value) {
  		var switch_instance = new switch_value(switch_props(ctx));
  	}

  	return {
  		c() {
  			if (switch_instance) create_component(switch_instance.$$.fragment);
  			switch_instance_anchor = empty();
  		},
  		m(target, anchor) {
  			if (switch_instance) {
  				mount_component(switch_instance, target, anchor);
  			}

  			insert(target, switch_instance_anchor, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const switch_instance_changes = (dirty & /*forwardEvents, use, smuiClass, className, exclude, $$props*/ 59)
  			? get_spread_update(switch_instance_spread_levels, [
  					dirty & /*forwardEvents, use*/ 17 && {
  						use: [/*forwardEvents*/ ctx[4], .../*use*/ ctx[0]]
  					},
  					dirty & /*smuiClass, className*/ 10 && {
  						class: "" + (/*smuiClass*/ ctx[3] + " " + /*className*/ ctx[1])
  					},
  					dirty & /*exclude, $$props*/ 32 && get_spread_object(exclude(/*$$props*/ ctx[5], ["use", "class", "component", "forwardEvents"]))
  				])
  			: {};

  			if (dirty & /*$$scope*/ 512) {
  				switch_instance_changes.$$scope = { dirty, ctx };
  			}

  			if (switch_value !== (switch_value = /*component*/ ctx[2])) {
  				if (switch_instance) {
  					group_outros();
  					const old_component = switch_instance;

  					transition_out(old_component.$$.fragment, 1, 0, () => {
  						destroy_component(old_component, 1);
  					});

  					check_outros();
  				}

  				if (switch_value) {
  					switch_instance = new switch_value(switch_props(ctx));
  					create_component(switch_instance.$$.fragment);
  					transition_in(switch_instance.$$.fragment, 1);
  					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
  				} else {
  					switch_instance = null;
  				}
  			} else if (switch_value) {
  				switch_instance.$set(switch_instance_changes);
  			}
  		},
  		i(local) {
  			if (current) return;
  			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(switch_instance_anchor);
  			if (switch_instance) destroy_component(switch_instance, detaching);
  		}
  	};
  }

  const internals = {
  	component: null,
  	smuiClass: null,
  	contexts: {}
  };

  function instance$1($$self, $$props, $$invalidate) {
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { component = internals.component } = $$props;
  	let { forwardEvents: smuiForwardEvents = [] } = $$props;
  	const smuiClass = internals.class;
  	const contexts = internals.contexts;
  	const forwardEvents = forwardEventsBuilder(current_component, smuiForwardEvents);

  	for (let context in contexts) {
  		if (contexts.hasOwnProperty(context)) {
  			setContext(context, contexts[context]);
  		}
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(5, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("component" in $$new_props) $$invalidate(2, component = $$new_props.component);
  		if ("forwardEvents" in $$new_props) $$invalidate(6, smuiForwardEvents = $$new_props.forwardEvents);
  		if ("$$scope" in $$new_props) $$invalidate(9, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		component,
  		smuiClass,
  		forwardEvents,
  		$$props,
  		smuiForwardEvents,
  		contexts,
  		$$slots,
  		$$scope
  	];
  }

  class ClassAdder extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$1, create_fragment$1, safe_not_equal, {
  			use: 0,
  			class: 1,
  			component: 2,
  			forwardEvents: 6
  		});
  	}
  }

  function classAdderBuilder(props) {
    function Component(...args) {
      Object.assign(internals, props);
      return new ClassAdder(...args);
    }

    Component.prototype = ClassAdder;

    // SSR support
    if (ClassAdder.$$render) {
      Component.$$render = (...args) => Object.assign(internals, props) && ClassAdder.$$render(...args);
    }
    if (ClassAdder.render) {
      Component.render = (...args) => Object.assign(internals, props) && ClassAdder.render(...args);
    }

    return Component;
  }

  /* node_modules/@smui/common/Div.svelte generated by Svelte v3.18.2 */

  function create_fragment$2(ctx) {
  	let div;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let div_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
  	let div_data = {};

  	for (let i = 0; i < div_levels.length; i += 1) {
  		div_data = assign(div_data, div_levels[i]);
  	}

  	return {
  		c() {
  			div = element("div");
  			if (default_slot) default_slot.c();
  			set_attributes(div, div_data);
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);

  			if (default_slot) {
  				default_slot.m(div, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, div, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, div))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(div, get_spread_update(div_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$2($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(2, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("$$scope" in $$new_props) $$invalidate(3, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, forwardEvents, $$props, $$scope, $$slots];
  }

  class Div extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$2, create_fragment$2, safe_not_equal, { use: 0 });
  	}
  }

  var Row = classAdderBuilder({
    class: 'mdc-top-app-bar__row',
    component: Div,
    contexts: {}
  });

  /* node_modules/@smui/top-app-bar/Section.svelte generated by Svelte v3.18.2 */

  function create_fragment$3(ctx) {
  	let section;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[7].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[6], null);

  	let section_levels = [
  		{
  			class: "\n    mdc-top-app-bar__section\n    " + /*className*/ ctx[1] + "\n    " + (/*align*/ ctx[2] === "start"
  			? "mdc-top-app-bar__section--align-start"
  			: "") + "\n    " + (/*align*/ ctx[2] === "end"
  			? "mdc-top-app-bar__section--align-end"
  			: "") + "\n  "
  		},
  		/*toolbar*/ ctx[3] ? { role: "toolbar" } : {},
  		exclude(/*$$props*/ ctx[5], ["use", "class", "align", "toolbar"])
  	];

  	let section_data = {};

  	for (let i = 0; i < section_levels.length; i += 1) {
  		section_data = assign(section_data, section_levels[i]);
  	}

  	return {
  		c() {
  			section = element("section");
  			if (default_slot) default_slot.c();
  			set_attributes(section, section_data);
  		},
  		m(target, anchor) {
  			insert(target, section, anchor);

  			if (default_slot) {
  				default_slot.m(section, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, section, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[4].call(null, section))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 64) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[6], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[6], dirty, null));
  			}

  			set_attributes(section, get_spread_update(section_levels, [
  				dirty & /*className, align*/ 6 && {
  					class: "\n    mdc-top-app-bar__section\n    " + /*className*/ ctx[1] + "\n    " + (/*align*/ ctx[2] === "start"
  					? "mdc-top-app-bar__section--align-start"
  					: "") + "\n    " + (/*align*/ ctx[2] === "end"
  					? "mdc-top-app-bar__section--align-end"
  					: "") + "\n  "
  				},
  				dirty & /*toolbar*/ 8 && (/*toolbar*/ ctx[3] ? { role: "toolbar" } : {}),
  				dirty & /*exclude, $$props*/ 32 && exclude(/*$$props*/ ctx[5], ["use", "class", "align", "toolbar"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(section);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$3($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["MDCList:action"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { align = "start" } = $$props;
  	let { toolbar = false } = $$props;

  	setContext("SMUI:icon-button:context", toolbar
  	? "top-app-bar:action"
  	: "top-app-bar:navigation");

  	setContext("SMUI:button:context", toolbar
  	? "top-app-bar:action"
  	: "top-app-bar:navigation");

  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(5, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("align" in $$new_props) $$invalidate(2, align = $$new_props.align);
  		if ("toolbar" in $$new_props) $$invalidate(3, toolbar = $$new_props.toolbar);
  		if ("$$scope" in $$new_props) $$invalidate(6, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, className, align, toolbar, forwardEvents, $$props, $$scope, $$slots];
  }

  class Section extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$3, create_fragment$3, safe_not_equal, { use: 0, class: 1, align: 2, toolbar: 3 });
  	}
  }

  /* node_modules/@smui/common/Span.svelte generated by Svelte v3.18.2 */

  function create_fragment$4(ctx) {
  	let span;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let span_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
  	let span_data = {};

  	for (let i = 0; i < span_levels.length; i += 1) {
  		span_data = assign(span_data, span_levels[i]);
  	}

  	return {
  		c() {
  			span = element("span");
  			if (default_slot) default_slot.c();
  			set_attributes(span, span_data);
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);

  			if (default_slot) {
  				default_slot.m(span, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, span, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, span))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(span, get_spread_update(span_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$4($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(2, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("$$scope" in $$new_props) $$invalidate(3, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, forwardEvents, $$props, $$scope, $$slots];
  }

  class Span extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$4, create_fragment$4, safe_not_equal, { use: 0 });
  	}
  }

  var Title = classAdderBuilder({
    class: 'mdc-top-app-bar__title',
    component: Span,
    contexts: {}
  });

  /* node_modules/@smui/common/A.svelte generated by Svelte v3.18.2 */

  function create_fragment$5(ctx) {
  	let a;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[5].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[4], null);
  	let a_levels = [{ href: /*href*/ ctx[1] }, exclude(/*$$props*/ ctx[3], ["use", "href"])];
  	let a_data = {};

  	for (let i = 0; i < a_levels.length; i += 1) {
  		a_data = assign(a_data, a_levels[i]);
  	}

  	return {
  		c() {
  			a = element("a");
  			if (default_slot) default_slot.c();
  			set_attributes(a, a_data);
  		},
  		m(target, anchor) {
  			insert(target, a, anchor);

  			if (default_slot) {
  				default_slot.m(a, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, a, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[2].call(null, a))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 16) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[4], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[4], dirty, null));
  			}

  			set_attributes(a, get_spread_update(a_levels, [
  				dirty & /*href*/ 2 && { href: /*href*/ ctx[1] },
  				dirty & /*exclude, $$props*/ 8 && exclude(/*$$props*/ ctx[3], ["use", "href"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(a);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$5($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { href = "javascript:void(0);" } = $$props;
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(3, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("href" in $$new_props) $$invalidate(1, href = $$new_props.href);
  		if ("$$scope" in $$new_props) $$invalidate(4, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, href, forwardEvents, $$props, $$scope, $$slots];
  }

  class A extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$5, create_fragment$5, safe_not_equal, { use: 0, href: 1 });
  	}
  }

  /* node_modules/@smui/common/Button.svelte generated by Svelte v3.18.2 */

  function create_fragment$6(ctx) {
  	let button;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let button_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
  	let button_data = {};

  	for (let i = 0; i < button_levels.length; i += 1) {
  		button_data = assign(button_data, button_levels[i]);
  	}

  	return {
  		c() {
  			button = element("button");
  			if (default_slot) default_slot.c();
  			set_attributes(button, button_data);
  		},
  		m(target, anchor) {
  			insert(target, button, anchor);

  			if (default_slot) {
  				default_slot.m(button, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, button, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, button))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(button, get_spread_update(button_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(button);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$6($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(2, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("$$scope" in $$new_props) $$invalidate(3, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, forwardEvents, $$props, $$scope, $$slots];
  }

  class Button extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$6, create_fragment$6, safe_not_equal, { use: 0 });
  	}
  }

  function Ripple(node, props = {ripple: false, unbounded: false, color: null, classForward: () => {}}) {
    let instance = null;
    let addLayoutListener = getContext('SMUI:addLayoutListener');
    let removeLayoutListener;
    let classList = [];

    function addClass(className) {
      const idx = classList.indexOf(className);
      if (idx === -1) {
        node.classList.add(className);
        classList.push(className);
        if (props.classForward) {
          props.classForward(classList);
          console.log('addClass', className, classList);
        }
      }
    }

    function removeClass(className) {
      const idx = classList.indexOf(className);
      if (idx !== -1) {
        node.classList.remove(className);
        classList.splice(idx, 1);
        if (props.classForward) {
          props.classForward(classList);
          console.log('removeClass', className, classList);
        }
      }
    }

    function handleProps() {
      if (props.ripple && !instance) {
        // Override the Ripple component's adapter, so that we can forward classes
        // to Svelte components that overwrite Ripple's classes.
        const _createAdapter = MDCRipple.createAdapter;
        MDCRipple.createAdapter = function(...args) {
          const adapter = _createAdapter.apply(this, args);
          adapter.addClass = function(className) {
            return addClass(className);
          };
          adapter.removeClass = function(className) {
            return removeClass(className);
          };
          return adapter;
        };
        instance = new MDCRipple(node);
        MDCRipple.createAdapter = _createAdapter;
      } else if (instance && !props.ripple) {
        instance.destroy();
        instance = null;
      }
      if (props.ripple) {
        instance.unbounded = !!props.unbounded;
        switch (props.color) {
          case 'surface':
            addClass('mdc-ripple-surface');
            removeClass('mdc-ripple-surface--primary');
            removeClass('mdc-ripple-surface--accent');
            return;
          case 'primary':
            addClass('mdc-ripple-surface');
            addClass('mdc-ripple-surface--primary');
            removeClass('mdc-ripple-surface--accent');
            return;
          case 'secondary':
            addClass('mdc-ripple-surface');
            removeClass('mdc-ripple-surface--primary');
            addClass('mdc-ripple-surface--accent');
            return;
        }
      }
      removeClass('mdc-ripple-surface');
      removeClass('mdc-ripple-surface--primary');
      removeClass('mdc-ripple-surface--accent');
    }

    handleProps();

    if (addLayoutListener) {
      removeLayoutListener = addLayoutListener(layout);
    }

    function layout() {
      if (instance) {
        instance.layout();
      }
    }

    return {
      update(newProps = {ripple: false, unbounded: false, color: null, classForward: []}) {
        props = newProps;
        handleProps();
      },

      destroy() {
        if (instance) {
          instance.destroy();
          instance = null;
          removeClass('mdc-ripple-surface');
          removeClass('mdc-ripple-surface--primary');
          removeClass('mdc-ripple-surface--accent');
        }

        if (removeLayoutListener) {
          removeLayoutListener();
        }
      }
    }
  }

  /* node_modules/@smui/button/Button.svelte generated by Svelte v3.18.2 */

  function create_default_slot$1(ctx) {
  	let current;
  	const default_slot_template = /*$$slots*/ ctx[17].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[19], null);

  	return {
  		c() {
  			if (default_slot) default_slot.c();
  		},
  		m(target, anchor) {
  			if (default_slot) {
  				default_slot.m(target, anchor);
  			}

  			current = true;
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 524288) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[19], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[19], dirty, null));
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (default_slot) default_slot.d(detaching);
  		}
  	};
  }

  function create_fragment$7(ctx) {
  	let switch_instance_anchor;
  	let current;

  	const switch_instance_spread_levels = [
  		{
  			use: [
  				[
  					Ripple,
  					{
  						ripple: /*ripple*/ ctx[2],
  						unbounded: false,
  						classForward: /*func*/ ctx[18]
  					}
  				],
  				/*forwardEvents*/ ctx[11],
  				.../*use*/ ctx[0]
  			]
  		},
  		{
  			class: "\n    mdc-button\n    " + /*className*/ ctx[1] + "\n    " + /*rippleClasses*/ ctx[7].join(" ") + "\n    " + (/*variant*/ ctx[4] === "raised"
  			? "mdc-button--raised"
  			: "") + "\n    " + (/*variant*/ ctx[4] === "unelevated"
  			? "mdc-button--unelevated"
  			: "") + "\n    " + (/*variant*/ ctx[4] === "outlined"
  			? "mdc-button--outlined"
  			: "") + "\n    " + (/*dense*/ ctx[5] ? "mdc-button--dense" : "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  			? "smui-button--color-secondary"
  			: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  			? "mdc-card__action"
  			: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  			? "mdc-card__action--button"
  			: "") + "\n    " + (/*context*/ ctx[12] === "dialog:action"
  			? "mdc-dialog__button"
  			: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:navigation"
  			? "mdc-top-app-bar__navigation-icon"
  			: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:action"
  			? "mdc-top-app-bar__action-item"
  			: "") + "\n    " + (/*context*/ ctx[12] === "snackbar"
  			? "mdc-snackbar__action"
  			: "") + "\n  "
  		},
  		/*actionProp*/ ctx[9],
  		/*defaultProp*/ ctx[10],
  		exclude(/*$$props*/ ctx[13], [
  			"use",
  			"class",
  			"ripple",
  			"color",
  			"variant",
  			"dense",
  			.../*dialogExcludes*/ ctx[8]
  		])
  	];

  	var switch_value = /*component*/ ctx[6];

  	function switch_props(ctx) {
  		let switch_instance_props = {
  			$$slots: { default: [create_default_slot$1] },
  			$$scope: { ctx }
  		};

  		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
  			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
  		}

  		return { props: switch_instance_props };
  	}

  	if (switch_value) {
  		var switch_instance = new switch_value(switch_props(ctx));
  	}

  	return {
  		c() {
  			if (switch_instance) create_component(switch_instance.$$.fragment);
  			switch_instance_anchor = empty();
  		},
  		m(target, anchor) {
  			if (switch_instance) {
  				mount_component(switch_instance, target, anchor);
  			}

  			insert(target, switch_instance_anchor, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const switch_instance_changes = (dirty & /*Ripple, ripple, rippleClasses, forwardEvents, use, className, variant, dense, color, context, actionProp, defaultProp, exclude, $$props, dialogExcludes*/ 16319)
  			? get_spread_update(switch_instance_spread_levels, [
  					dirty & /*Ripple, ripple, rippleClasses, forwardEvents, use*/ 2181 && {
  						use: [
  							[
  								Ripple,
  								{
  									ripple: /*ripple*/ ctx[2],
  									unbounded: false,
  									classForward: /*func*/ ctx[18]
  								}
  							],
  							/*forwardEvents*/ ctx[11],
  							.../*use*/ ctx[0]
  						]
  					},
  					dirty & /*className, rippleClasses, variant, dense, color, context*/ 4282 && {
  						class: "\n    mdc-button\n    " + /*className*/ ctx[1] + "\n    " + /*rippleClasses*/ ctx[7].join(" ") + "\n    " + (/*variant*/ ctx[4] === "raised"
  						? "mdc-button--raised"
  						: "") + "\n    " + (/*variant*/ ctx[4] === "unelevated"
  						? "mdc-button--unelevated"
  						: "") + "\n    " + (/*variant*/ ctx[4] === "outlined"
  						? "mdc-button--outlined"
  						: "") + "\n    " + (/*dense*/ ctx[5] ? "mdc-button--dense" : "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  						? "smui-button--color-secondary"
  						: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  						? "mdc-card__action"
  						: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  						? "mdc-card__action--button"
  						: "") + "\n    " + (/*context*/ ctx[12] === "dialog:action"
  						? "mdc-dialog__button"
  						: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:navigation"
  						? "mdc-top-app-bar__navigation-icon"
  						: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:action"
  						? "mdc-top-app-bar__action-item"
  						: "") + "\n    " + (/*context*/ ctx[12] === "snackbar"
  						? "mdc-snackbar__action"
  						: "") + "\n  "
  					},
  					dirty & /*actionProp*/ 512 && get_spread_object(/*actionProp*/ ctx[9]),
  					dirty & /*defaultProp*/ 1024 && get_spread_object(/*defaultProp*/ ctx[10]),
  					dirty & /*exclude, $$props, dialogExcludes*/ 8448 && get_spread_object(exclude(/*$$props*/ ctx[13], [
  						"use",
  						"class",
  						"ripple",
  						"color",
  						"variant",
  						"dense",
  						.../*dialogExcludes*/ ctx[8]
  					]))
  				])
  			: {};

  			if (dirty & /*$$scope*/ 524288) {
  				switch_instance_changes.$$scope = { dirty, ctx };
  			}

  			if (switch_value !== (switch_value = /*component*/ ctx[6])) {
  				if (switch_instance) {
  					group_outros();
  					const old_component = switch_instance;

  					transition_out(old_component.$$.fragment, 1, 0, () => {
  						destroy_component(old_component, 1);
  					});

  					check_outros();
  				}

  				if (switch_value) {
  					switch_instance = new switch_value(switch_props(ctx));
  					create_component(switch_instance.$$.fragment);
  					transition_in(switch_instance.$$.fragment, 1);
  					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
  				} else {
  					switch_instance = null;
  				}
  			} else if (switch_value) {
  				switch_instance.$set(switch_instance_changes);
  			}
  		},
  		i(local) {
  			if (current) return;
  			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(switch_instance_anchor);
  			if (switch_instance) destroy_component(switch_instance, detaching);
  		}
  	};
  }

  function instance$7($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { ripple = true } = $$props;
  	let { color = "primary" } = $$props;
  	let { variant = "text" } = $$props;
  	let { dense = false } = $$props;
  	let { href = null } = $$props;
  	let { action = "close" } = $$props;
  	let { default: defaultAction = false } = $$props;
  	let { component = href == null ? Button : A } = $$props;
  	let context = getContext("SMUI:button:context");
  	let rippleClasses = [];
  	setContext("SMUI:label:context", "button");
  	setContext("SMUI:icon:context", "button");
  	let { $$slots = {}, $$scope } = $$props;
  	const func = classes => $$invalidate(7, rippleClasses = classes);

  	$$self.$set = $$new_props => {
  		$$invalidate(13, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("ripple" in $$new_props) $$invalidate(2, ripple = $$new_props.ripple);
  		if ("color" in $$new_props) $$invalidate(3, color = $$new_props.color);
  		if ("variant" in $$new_props) $$invalidate(4, variant = $$new_props.variant);
  		if ("dense" in $$new_props) $$invalidate(5, dense = $$new_props.dense);
  		if ("href" in $$new_props) $$invalidate(14, href = $$new_props.href);
  		if ("action" in $$new_props) $$invalidate(15, action = $$new_props.action);
  		if ("default" in $$new_props) $$invalidate(16, defaultAction = $$new_props.default);
  		if ("component" in $$new_props) $$invalidate(6, component = $$new_props.component);
  		if ("$$scope" in $$new_props) $$invalidate(19, $$scope = $$new_props.$$scope);
  	};

  	let dialogExcludes;
  	let actionProp;
  	let defaultProp;

  	$$self.$$.update = () => {
  		if ($$self.$$.dirty & /*action*/ 32768) {
  			 $$invalidate(9, actionProp = context === "dialog:action" && action !== null
  			? { "data-mdc-dialog-action": action }
  			: {});
  		}

  		if ($$self.$$.dirty & /*defaultAction*/ 65536) {
  			 $$invalidate(10, defaultProp = context === "dialog:action" && defaultAction
  			? { "data-mdc-dialog-button-default": "" }
  			: {});
  		}
  	};

  	 $$invalidate(8, dialogExcludes = context === "dialog:action" ? ["action", "default"] : []);
  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		ripple,
  		color,
  		variant,
  		dense,
  		component,
  		rippleClasses,
  		dialogExcludes,
  		actionProp,
  		defaultProp,
  		forwardEvents,
  		context,
  		$$props,
  		href,
  		action,
  		defaultAction,
  		$$slots,
  		func,
  		$$scope
  	];
  }

  class Button_1 extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$7, create_fragment$7, safe_not_equal, {
  			use: 0,
  			class: 1,
  			ripple: 2,
  			color: 3,
  			variant: 4,
  			dense: 5,
  			href: 14,
  			action: 15,
  			default: 16,
  			component: 6
  		});
  	}
  }

  /* node_modules/@smui/common/Label.svelte generated by Svelte v3.18.2 */

  function create_fragment$8(ctx) {
  	let span;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[6].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[5], null);

  	let span_levels = [
  		{
  			class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[3] === "button"
  			? "mdc-button__label"
  			: "") + "\n    " + (/*context*/ ctx[3] === "fab" ? "mdc-fab__label" : "") + "\n    " + (/*context*/ ctx[3] === "chip" ? "mdc-chip__text" : "") + "\n    " + (/*context*/ ctx[3] === "tab"
  			? "mdc-tab__text-label"
  			: "") + "\n    " + (/*context*/ ctx[3] === "image-list"
  			? "mdc-image-list__label"
  			: "") + "\n    " + (/*context*/ ctx[3] === "snackbar"
  			? "mdc-snackbar__label"
  			: "") + "\n  "
  		},
  		/*context*/ ctx[3] === "snackbar"
  		? { role: "status", "aria-live": "polite" }
  		: {},
  		exclude(/*$$props*/ ctx[4], ["use", "class"])
  	];

  	let span_data = {};

  	for (let i = 0; i < span_levels.length; i += 1) {
  		span_data = assign(span_data, span_levels[i]);
  	}

  	return {
  		c() {
  			span = element("span");
  			if (default_slot) default_slot.c();
  			set_attributes(span, span_data);
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);

  			if (default_slot) {
  				default_slot.m(span, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, span, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[2].call(null, span))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 32) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[5], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[5], dirty, null));
  			}

  			set_attributes(span, get_spread_update(span_levels, [
  				dirty & /*className, context*/ 10 && {
  					class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[3] === "button"
  					? "mdc-button__label"
  					: "") + "\n    " + (/*context*/ ctx[3] === "fab" ? "mdc-fab__label" : "") + "\n    " + (/*context*/ ctx[3] === "chip" ? "mdc-chip__text" : "") + "\n    " + (/*context*/ ctx[3] === "tab"
  					? "mdc-tab__text-label"
  					: "") + "\n    " + (/*context*/ ctx[3] === "image-list"
  					? "mdc-image-list__label"
  					: "") + "\n    " + (/*context*/ ctx[3] === "snackbar"
  					? "mdc-snackbar__label"
  					: "") + "\n  "
  				},
  				dirty & /*context*/ 8 && (/*context*/ ctx[3] === "snackbar"
  				? { role: "status", "aria-live": "polite" }
  				: {}),
  				dirty & /*exclude, $$props*/ 16 && exclude(/*$$props*/ ctx[4], ["use", "class"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$8($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	const context = getContext("SMUI:label:context");
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(4, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("$$scope" in $$new_props) $$invalidate(5, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, className, forwardEvents, context, $$props, $$scope, $$slots];
  }

  class Label extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$8, create_fragment$8, safe_not_equal, { use: 0, class: 1 });
  	}
  }

  /* node_modules/@smui/common/Icon.svelte generated by Svelte v3.18.2 */

  function create_fragment$9(ctx) {
  	let i;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[10].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);

  	let i_levels = [
  		{
  			class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[7] === "button"
  			? "mdc-button__icon"
  			: "") + "\n    " + (/*context*/ ctx[7] === "fab" ? "mdc-fab__icon" : "") + "\n    " + (/*context*/ ctx[7] === "icon-button"
  			? "mdc-icon-button__icon"
  			: "") + "\n    " + (/*context*/ ctx[7] === "icon-button" && /*on*/ ctx[2]
  			? "mdc-icon-button__icon--on"
  			: "") + "\n    " + (/*context*/ ctx[7] === "chip" ? "mdc-chip__icon" : "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leading*/ ctx[3]
  			? "mdc-chip__icon--leading"
  			: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leadingHidden*/ ctx[4]
  			? "mdc-chip__icon--leading-hidden"
  			: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*trailing*/ ctx[5]
  			? "mdc-chip__icon--trailing"
  			: "") + "\n    " + (/*context*/ ctx[7] === "tab" ? "mdc-tab__icon" : "") + "\n  "
  		},
  		{ "aria-hidden": "true" },
  		exclude(/*$$props*/ ctx[8], ["use", "class", "on", "leading", "leadingHidden", "trailing"])
  	];

  	let i_data = {};

  	for (let i = 0; i < i_levels.length; i += 1) {
  		i_data = assign(i_data, i_levels[i]);
  	}

  	return {
  		c() {
  			i = element("i");
  			if (default_slot) default_slot.c();
  			set_attributes(i, i_data);
  		},
  		m(target, anchor) {
  			insert(target, i, anchor);

  			if (default_slot) {
  				default_slot.m(i, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, i, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[6].call(null, i))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 512) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[9], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null));
  			}

  			set_attributes(i, get_spread_update(i_levels, [
  				dirty & /*className, context, on, leading, leadingHidden, trailing*/ 190 && {
  					class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[7] === "button"
  					? "mdc-button__icon"
  					: "") + "\n    " + (/*context*/ ctx[7] === "fab" ? "mdc-fab__icon" : "") + "\n    " + (/*context*/ ctx[7] === "icon-button"
  					? "mdc-icon-button__icon"
  					: "") + "\n    " + (/*context*/ ctx[7] === "icon-button" && /*on*/ ctx[2]
  					? "mdc-icon-button__icon--on"
  					: "") + "\n    " + (/*context*/ ctx[7] === "chip" ? "mdc-chip__icon" : "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leading*/ ctx[3]
  					? "mdc-chip__icon--leading"
  					: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leadingHidden*/ ctx[4]
  					? "mdc-chip__icon--leading-hidden"
  					: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*trailing*/ ctx[5]
  					? "mdc-chip__icon--trailing"
  					: "") + "\n    " + (/*context*/ ctx[7] === "tab" ? "mdc-tab__icon" : "") + "\n  "
  				},
  				{ "aria-hidden": "true" },
  				dirty & /*exclude, $$props*/ 256 && exclude(/*$$props*/ ctx[8], ["use", "class", "on", "leading", "leadingHidden", "trailing"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(i);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$9($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { on = false } = $$props;
  	let { leading = false } = $$props;
  	let { leadingHidden = false } = $$props;
  	let { trailing = false } = $$props;
  	const context = getContext("SMUI:icon:context");
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(8, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("on" in $$new_props) $$invalidate(2, on = $$new_props.on);
  		if ("leading" in $$new_props) $$invalidate(3, leading = $$new_props.leading);
  		if ("leadingHidden" in $$new_props) $$invalidate(4, leadingHidden = $$new_props.leadingHidden);
  		if ("trailing" in $$new_props) $$invalidate(5, trailing = $$new_props.trailing);
  		if ("$$scope" in $$new_props) $$invalidate(9, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		on,
  		leading,
  		leadingHidden,
  		trailing,
  		forwardEvents,
  		context,
  		$$props,
  		$$scope,
  		$$slots
  	];
  }

  class Icon extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$9, create_fragment$9, safe_not_equal, {
  			use: 0,
  			class: 1,
  			on: 2,
  			leading: 3,
  			leadingHidden: 4,
  			trailing: 5
  		});
  	}
  }

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var cssClasses$2 = {
      ICON_BUTTON_ON: 'mdc-icon-button--on',
      ROOT: 'mdc-icon-button',
  };
  var strings$2 = {
      ARIA_PRESSED: 'aria-pressed',
      CHANGE_EVENT: 'MDCIconButtonToggle:change',
  };

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCIconButtonToggleFoundation = /** @class */ (function (_super) {
      __extends(MDCIconButtonToggleFoundation, _super);
      function MDCIconButtonToggleFoundation(adapter) {
          return _super.call(this, __assign({}, MDCIconButtonToggleFoundation.defaultAdapter, adapter)) || this;
      }
      Object.defineProperty(MDCIconButtonToggleFoundation, "cssClasses", {
          get: function () {
              return cssClasses$2;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCIconButtonToggleFoundation, "strings", {
          get: function () {
              return strings$2;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCIconButtonToggleFoundation, "defaultAdapter", {
          get: function () {
              return {
                  addClass: function () { return undefined; },
                  hasClass: function () { return false; },
                  notifyChange: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  setAttr: function () { return undefined; },
              };
          },
          enumerable: true,
          configurable: true
      });
      MDCIconButtonToggleFoundation.prototype.init = function () {
          this.adapter_.setAttr(strings$2.ARIA_PRESSED, "" + this.isOn());
      };
      MDCIconButtonToggleFoundation.prototype.handleClick = function () {
          this.toggle();
          this.adapter_.notifyChange({ isOn: this.isOn() });
      };
      MDCIconButtonToggleFoundation.prototype.isOn = function () {
          return this.adapter_.hasClass(cssClasses$2.ICON_BUTTON_ON);
      };
      MDCIconButtonToggleFoundation.prototype.toggle = function (isOn) {
          if (isOn === void 0) { isOn = !this.isOn(); }
          if (isOn) {
              this.adapter_.addClass(cssClasses$2.ICON_BUTTON_ON);
          }
          else {
              this.adapter_.removeClass(cssClasses$2.ICON_BUTTON_ON);
          }
          this.adapter_.setAttr(strings$2.ARIA_PRESSED, "" + isOn);
      };
      return MDCIconButtonToggleFoundation;
  }(MDCFoundation));

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var strings$3 = MDCIconButtonToggleFoundation.strings;
  var MDCIconButtonToggle = /** @class */ (function (_super) {
      __extends(MDCIconButtonToggle, _super);
      function MDCIconButtonToggle() {
          var _this = _super !== null && _super.apply(this, arguments) || this;
          _this.ripple_ = _this.createRipple_();
          return _this;
      }
      MDCIconButtonToggle.attachTo = function (root) {
          return new MDCIconButtonToggle(root);
      };
      MDCIconButtonToggle.prototype.initialSyncWithDOM = function () {
          var _this = this;
          this.handleClick_ = function () { return _this.foundation_.handleClick(); };
          this.listen('click', this.handleClick_);
      };
      MDCIconButtonToggle.prototype.destroy = function () {
          this.unlisten('click', this.handleClick_);
          this.ripple_.destroy();
          _super.prototype.destroy.call(this);
      };
      MDCIconButtonToggle.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          var adapter = {
              addClass: function (className) { return _this.root_.classList.add(className); },
              hasClass: function (className) { return _this.root_.classList.contains(className); },
              notifyChange: function (evtData) { return _this.emit(strings$3.CHANGE_EVENT, evtData); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              setAttr: function (attrName, attrValue) { return _this.root_.setAttribute(attrName, attrValue); },
          };
          return new MDCIconButtonToggleFoundation(adapter);
      };
      Object.defineProperty(MDCIconButtonToggle.prototype, "ripple", {
          get: function () {
              return this.ripple_;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCIconButtonToggle.prototype, "on", {
          get: function () {
              return this.foundation_.isOn();
          },
          set: function (isOn) {
              this.foundation_.toggle(isOn);
          },
          enumerable: true,
          configurable: true
      });
      MDCIconButtonToggle.prototype.createRipple_ = function () {
          var ripple = new MDCRipple(this.root_);
          ripple.unbounded = true;
          return ripple;
      };
      return MDCIconButtonToggle;
  }(MDCComponent));

  /* node_modules/@smui/icon-button/IconButton.svelte generated by Svelte v3.18.2 */

  function create_else_block(ctx) {
  	let button;
  	let useActions_action;
  	let forwardEvents_action;
  	let Ripple_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[16].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[15], null);

  	let button_levels = [
  		{
  			class: "\n      mdc-icon-button\n      " + /*className*/ ctx[2] + "\n      " + (/*pressed*/ ctx[0] ? "mdc-icon-button--on" : "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  			? "mdc-card__action"
  			: "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  			? "mdc-card__action--icon"
  			: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:navigation"
  			? "mdc-top-app-bar__navigation-icon"
  			: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:action"
  			? "mdc-top-app-bar__action-item"
  			: "") + "\n      " + (/*context*/ ctx[10] === "snackbar"
  			? "mdc-snackbar__dismiss"
  			: "") + "\n    "
  		},
  		{ "aria-hidden": "true" },
  		{ "aria-pressed": /*pressed*/ ctx[0] },
  		/*props*/ ctx[8]
  	];

  	let button_data = {};

  	for (let i = 0; i < button_levels.length; i += 1) {
  		button_data = assign(button_data, button_levels[i]);
  	}

  	return {
  		c() {
  			button = element("button");
  			if (default_slot) default_slot.c();
  			set_attributes(button, button_data);
  		},
  		m(target, anchor) {
  			insert(target, button, anchor);

  			if (default_slot) {
  				default_slot.m(button, null);
  			}

  			/*button_binding*/ ctx[18](button);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, button, /*use*/ ctx[1])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[9].call(null, button)),
  				action_destroyer(Ripple_action = Ripple.call(null, button, {
  					ripple: /*ripple*/ ctx[3] && !/*toggle*/ ctx[5],
  					unbounded: true,
  					color: /*color*/ ctx[4]
  				})),
  				listen(button, "MDCIconButtonToggle:change", /*handleChange*/ ctx[11])
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 32768) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[15], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[15], dirty, null));
  			}

  			set_attributes(button, get_spread_update(button_levels, [
  				dirty & /*className, pressed, context*/ 1029 && {
  					class: "\n      mdc-icon-button\n      " + /*className*/ ctx[2] + "\n      " + (/*pressed*/ ctx[0] ? "mdc-icon-button--on" : "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  					? "mdc-card__action"
  					: "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  					? "mdc-card__action--icon"
  					: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:navigation"
  					? "mdc-top-app-bar__navigation-icon"
  					: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:action"
  					? "mdc-top-app-bar__action-item"
  					: "") + "\n      " + (/*context*/ ctx[10] === "snackbar"
  					? "mdc-snackbar__dismiss"
  					: "") + "\n    "
  				},
  				{ "aria-hidden": "true" },
  				dirty & /*pressed*/ 1 && { "aria-pressed": /*pressed*/ ctx[0] },
  				dirty & /*props*/ 256 && /*props*/ ctx[8]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);

  			if (Ripple_action && is_function(Ripple_action.update) && dirty & /*ripple, toggle, color*/ 56) Ripple_action.update.call(null, {
  				ripple: /*ripple*/ ctx[3] && !/*toggle*/ ctx[5],
  				unbounded: true,
  				color: /*color*/ ctx[4]
  			});
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(button);
  			if (default_slot) default_slot.d(detaching);
  			/*button_binding*/ ctx[18](null);
  			run_all(dispose);
  		}
  	};
  }

  // (1:0) {#if href}
  function create_if_block(ctx) {
  	let a;
  	let useActions_action;
  	let forwardEvents_action;
  	let Ripple_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[16].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[15], null);

  	let a_levels = [
  		{
  			class: "\n      mdc-icon-button\n      " + /*className*/ ctx[2] + "\n      " + (/*pressed*/ ctx[0] ? "mdc-icon-button--on" : "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  			? "mdc-card__action"
  			: "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  			? "mdc-card__action--icon"
  			: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:navigation"
  			? "mdc-top-app-bar__navigation-icon"
  			: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:action"
  			? "mdc-top-app-bar__action-item"
  			: "") + "\n      " + (/*context*/ ctx[10] === "snackbar"
  			? "mdc-snackbar__dismiss"
  			: "") + "\n    "
  		},
  		{ "aria-hidden": "true" },
  		{ "aria-pressed": /*pressed*/ ctx[0] },
  		{ href: /*href*/ ctx[6] },
  		/*props*/ ctx[8]
  	];

  	let a_data = {};

  	for (let i = 0; i < a_levels.length; i += 1) {
  		a_data = assign(a_data, a_levels[i]);
  	}

  	return {
  		c() {
  			a = element("a");
  			if (default_slot) default_slot.c();
  			set_attributes(a, a_data);
  		},
  		m(target, anchor) {
  			insert(target, a, anchor);

  			if (default_slot) {
  				default_slot.m(a, null);
  			}

  			/*a_binding*/ ctx[17](a);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, a, /*use*/ ctx[1])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[9].call(null, a)),
  				action_destroyer(Ripple_action = Ripple.call(null, a, {
  					ripple: /*ripple*/ ctx[3] && !/*toggle*/ ctx[5],
  					unbounded: true,
  					color: /*color*/ ctx[4]
  				})),
  				listen(a, "MDCIconButtonToggle:change", /*handleChange*/ ctx[11])
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 32768) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[15], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[15], dirty, null));
  			}

  			set_attributes(a, get_spread_update(a_levels, [
  				dirty & /*className, pressed, context*/ 1029 && {
  					class: "\n      mdc-icon-button\n      " + /*className*/ ctx[2] + "\n      " + (/*pressed*/ ctx[0] ? "mdc-icon-button--on" : "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  					? "mdc-card__action"
  					: "") + "\n      " + (/*context*/ ctx[10] === "card:action"
  					? "mdc-card__action--icon"
  					: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:navigation"
  					? "mdc-top-app-bar__navigation-icon"
  					: "") + "\n      " + (/*context*/ ctx[10] === "top-app-bar:action"
  					? "mdc-top-app-bar__action-item"
  					: "") + "\n      " + (/*context*/ ctx[10] === "snackbar"
  					? "mdc-snackbar__dismiss"
  					: "") + "\n    "
  				},
  				{ "aria-hidden": "true" },
  				dirty & /*pressed*/ 1 && { "aria-pressed": /*pressed*/ ctx[0] },
  				dirty & /*href*/ 64 && { href: /*href*/ ctx[6] },
  				dirty & /*props*/ 256 && /*props*/ ctx[8]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);

  			if (Ripple_action && is_function(Ripple_action.update) && dirty & /*ripple, toggle, color*/ 56) Ripple_action.update.call(null, {
  				ripple: /*ripple*/ ctx[3] && !/*toggle*/ ctx[5],
  				unbounded: true,
  				color: /*color*/ ctx[4]
  			});
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(a);
  			if (default_slot) default_slot.d(detaching);
  			/*a_binding*/ ctx[17](null);
  			run_all(dispose);
  		}
  	};
  }

  function create_fragment$a(ctx) {
  	let current_block_type_index;
  	let if_block;
  	let if_block_anchor;
  	let current;
  	const if_block_creators = [create_if_block, create_else_block];
  	const if_blocks = [];

  	function select_block_type(ctx, dirty) {
  		if (/*href*/ ctx[6]) return 0;
  		return 1;
  	}

  	current_block_type_index = select_block_type(ctx);
  	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

  	return {
  		c() {
  			if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if_blocks[current_block_type_index].m(target, anchor);
  			insert(target, if_block_anchor, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			let previous_block_index = current_block_type_index;
  			current_block_type_index = select_block_type(ctx);

  			if (current_block_type_index === previous_block_index) {
  				if_blocks[current_block_type_index].p(ctx, dirty);
  			} else {
  				group_outros();

  				transition_out(if_blocks[previous_block_index], 1, 1, () => {
  					if_blocks[previous_block_index] = null;
  				});

  				check_outros();
  				if_block = if_blocks[current_block_type_index];

  				if (!if_block) {
  					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  					if_block.c();
  				}

  				transition_in(if_block, 1);
  				if_block.m(if_block_anchor.parentNode, if_block_anchor);
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if_blocks[current_block_type_index].d(detaching);
  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  function instance$a($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["MDCIconButtonToggle:change"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { ripple = true } = $$props;
  	let { color = null } = $$props;
  	let { toggle = false } = $$props;
  	let { pressed = false } = $$props;
  	let { href = null } = $$props;
  	let element;
  	let toggleButton;
  	let context = getContext("SMUI:icon-button:context");
  	setContext("SMUI:icon:context", "icon-button");
  	let oldToggle = null;

  	onDestroy(() => {
  		toggleButton && toggleButton.destroy();
  	});

  	function handleChange(e) {
  		$$invalidate(0, pressed = e.detail.isOn);
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	function a_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(7, element = $$value);
  		});
  	}

  	function button_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(7, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(14, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(1, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(2, className = $$new_props.class);
  		if ("ripple" in $$new_props) $$invalidate(3, ripple = $$new_props.ripple);
  		if ("color" in $$new_props) $$invalidate(4, color = $$new_props.color);
  		if ("toggle" in $$new_props) $$invalidate(5, toggle = $$new_props.toggle);
  		if ("pressed" in $$new_props) $$invalidate(0, pressed = $$new_props.pressed);
  		if ("href" in $$new_props) $$invalidate(6, href = $$new_props.href);
  		if ("$$scope" in $$new_props) $$invalidate(15, $$scope = $$new_props.$$scope);
  	};

  	let props;

  	$$self.$$.update = () => {
  		 $$invalidate(8, props = exclude($$props, ["use", "class", "ripple", "color", "toggle", "pressed", "href"]));

  		if ($$self.$$.dirty & /*element, toggle, oldToggle, ripple, toggleButton, pressed*/ 12457) {
  			 if (element && toggle !== oldToggle) {
  				if (toggle) {
  					$$invalidate(12, toggleButton = new MDCIconButtonToggle(element));

  					if (!ripple) {
  						toggleButton.ripple.destroy();
  					}

  					$$invalidate(12, toggleButton.on = pressed, toggleButton);
  				} else if (oldToggle) {
  					toggleButton && toggleButton.destroy();
  					$$invalidate(12, toggleButton = null);
  				}

  				$$invalidate(13, oldToggle = toggle);
  			}
  		}

  		if ($$self.$$.dirty & /*toggleButton, pressed*/ 4097) {
  			 if (toggleButton && toggleButton.on !== pressed) {
  				$$invalidate(12, toggleButton.on = pressed, toggleButton);
  			}
  		}
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		pressed,
  		use,
  		className,
  		ripple,
  		color,
  		toggle,
  		href,
  		element,
  		props,
  		forwardEvents,
  		context,
  		handleChange,
  		toggleButton,
  		oldToggle,
  		$$props,
  		$$scope,
  		$$slots,
  		a_binding,
  		button_binding
  	];
  }

  class IconButton extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$a, create_fragment$a, safe_not_equal, {
  			use: 1,
  			class: 2,
  			ripple: 3,
  			color: 4,
  			toggle: 5,
  			pressed: 0,
  			href: 6
  		});
  	}
  }

  /* src/components/LoremIpsum.svelte generated by Svelte v3.18.2 */

  function get_each_context(ctx, list, i) {
  	const child_ctx = ctx.slice();
  	child_ctx[0] = list[i];
  	return child_ctx;
  }

  // (1:0) {#each Array(5) as item}
  function create_each_block(ctx) {
  	let p;

  	return {
  		c() {
  			p = element("p");
  			p.textContent = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";
  		},
  		m(target, anchor) {
  			insert(target, p, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(p);
  		}
  	};
  }

  function create_fragment$b(ctx) {
  	let each_1_anchor;
  	let each_value = Array(5);
  	let each_blocks = [];

  	for (let i = 0; i < each_value.length; i += 1) {
  		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
  	}

  	return {
  		c() {
  			for (let i = 0; i < each_blocks.length; i += 1) {
  				each_blocks[i].c();
  			}

  			each_1_anchor = empty();
  		},
  		m(target, anchor) {
  			for (let i = 0; i < each_blocks.length; i += 1) {
  				each_blocks[i].m(target, anchor);
  			}

  			insert(target, each_1_anchor, anchor);
  		},
  		p: noop,
  		i: noop,
  		o: noop,
  		d(detaching) {
  			destroy_each(each_blocks, detaching);
  			if (detaching) detach(each_1_anchor);
  		}
  	};
  }

  class LoremIpsum extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, null, create_fragment$b, safe_not_equal, {});
  	}
  }

  /* src/pages/Page.svelte generated by Svelte v3.18.2 */
  const get_content_slot_changes = dirty => ({});
  const get_content_slot_context = ctx => ({});
  const get_bar_slot_changes = dirty => ({});
  const get_bar_slot_context = ctx => ({});

  // (15:0) <TopAppBar variant="static" color="primary">
  function create_default_slot$2(ctx) {
  	let current;
  	const bar_slot_template = /*$$slots*/ ctx[0].bar;
  	const bar_slot = create_slot(bar_slot_template, ctx, /*$$scope*/ ctx[1], get_bar_slot_context);

  	return {
  		c() {
  			if (bar_slot) bar_slot.c();
  		},
  		m(target, anchor) {
  			if (bar_slot) {
  				bar_slot.m(target, anchor);
  			}

  			current = true;
  		},
  		p(ctx, dirty) {
  			if (bar_slot && bar_slot.p && dirty & /*$$scope*/ 2) {
  				bar_slot.p(get_slot_context(bar_slot_template, ctx, /*$$scope*/ ctx[1], get_bar_slot_context), get_slot_changes(bar_slot_template, /*$$scope*/ ctx[1], dirty, get_bar_slot_changes));
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(bar_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(bar_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (bar_slot) bar_slot.d(detaching);
  		}
  	};
  }

  function create_fragment$c(ctx) {
  	let t;
  	let current;

  	const topappbar = new TopAppBar({
  			props: {
  				variant: "static",
  				color: "primary",
  				$$slots: { default: [create_default_slot$2] },
  				$$scope: { ctx }
  			}
  		});

  	const content_slot_template = /*$$slots*/ ctx[0].content;
  	const content_slot = create_slot(content_slot_template, ctx, /*$$scope*/ ctx[1], get_content_slot_context);

  	return {
  		c() {
  			create_component(topappbar.$$.fragment);
  			t = space();
  			if (content_slot) content_slot.c();
  		},
  		m(target, anchor) {
  			mount_component(topappbar, target, anchor);
  			insert(target, t, anchor);

  			if (content_slot) {
  				content_slot.m(target, anchor);
  			}

  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const topappbar_changes = {};

  			if (dirty & /*$$scope*/ 2) {
  				topappbar_changes.$$scope = { dirty, ctx };
  			}

  			topappbar.$set(topappbar_changes);

  			if (content_slot && content_slot.p && dirty & /*$$scope*/ 2) {
  				content_slot.p(get_slot_context(content_slot_template, ctx, /*$$scope*/ ctx[1], get_content_slot_context), get_slot_changes(content_slot_template, /*$$scope*/ ctx[1], dirty, get_content_slot_changes));
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(topappbar.$$.fragment, local);
  			transition_in(content_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(topappbar.$$.fragment, local);
  			transition_out(content_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(topappbar, detaching);
  			if (detaching) detach(t);
  			if (content_slot) content_slot.d(detaching);
  		}
  	};
  }

  function go(pathname) {
  	if (location.pathname != pathname) {
  		history.pushState(null, null, pathname);
  	}
  }

  function instance$b($$self, $$props, $$invalidate) {
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$props => {
  		if ("$$scope" in $$props) $$invalidate(1, $$scope = $$props.$$scope);
  	};

  	return [$$slots, $$scope];
  }

  class Page extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$b, create_fragment$c, safe_not_equal, {});
  	}
  }

  /* src/pages/HomePage.svelte generated by Svelte v3.18.2 */

  function create_default_slot_9(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Home");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (30:6) <Section>
  function create_default_slot_8(ctx) {
  	let current;

  	const title = new Title({
  			props: {
  				$$slots: { default: [create_default_slot_9] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(title.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(title, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const title_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				title_changes.$$scope = { dirty, ctx };
  			}

  			title.$set(title_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(title.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(title.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(title, detaching);
  		}
  	};
  }

  // (34:8) <IconButton class="material-icons" on:click={_ => go("/one")}>
  function create_default_slot_7(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("looks_one");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (35:8) <IconButton class="material-icons" on:click={_ => go("/three")}>
  function create_default_slot_6(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("looks_3");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (33:6) <Section align="end" toolbar>
  function create_default_slot_5(ctx) {
  	let t;
  	let current;

  	const iconbutton0 = new IconButton({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_7] },
  				$$scope: { ctx }
  			}
  		});

  	iconbutton0.$on("click", /*click_handler*/ ctx[1]);

  	const iconbutton1 = new IconButton({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_6] },
  				$$scope: { ctx }
  			}
  		});

  	iconbutton1.$on("click", /*click_handler_1*/ ctx[2]);

  	return {
  		c() {
  			create_component(iconbutton0.$$.fragment);
  			t = space();
  			create_component(iconbutton1.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(iconbutton0, target, anchor);
  			insert(target, t, anchor);
  			mount_component(iconbutton1, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const iconbutton0_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				iconbutton0_changes.$$scope = { dirty, ctx };
  			}

  			iconbutton0.$set(iconbutton0_changes);
  			const iconbutton1_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				iconbutton1_changes.$$scope = { dirty, ctx };
  			}

  			iconbutton1.$set(iconbutton1_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(iconbutton0.$$.fragment, local);
  			transition_in(iconbutton1.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(iconbutton0.$$.fragment, local);
  			transition_out(iconbutton1.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(iconbutton0, detaching);
  			if (detaching) detach(t);
  			destroy_component(iconbutton1, detaching);
  		}
  	};
  }

  // (29:4) <Row>
  function create_default_slot_4(ctx) {
  	let t;
  	let current;

  	const section0 = new Section({
  			props: {
  				$$slots: { default: [create_default_slot_8] },
  				$$scope: { ctx }
  			}
  		});

  	const section1 = new Section({
  			props: {
  				align: "end",
  				toolbar: true,
  				$$slots: { default: [create_default_slot_5] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(section0.$$.fragment);
  			t = space();
  			create_component(section1.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(section0, target, anchor);
  			insert(target, t, anchor);
  			mount_component(section1, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const section0_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				section0_changes.$$scope = { dirty, ctx };
  			}

  			section0.$set(section0_changes);
  			const section1_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				section1_changes.$$scope = { dirty, ctx };
  			}

  			section1.$set(section1_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(section0.$$.fragment, local);
  			transition_in(section1.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(section0.$$.fragment, local);
  			transition_out(section1.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(section0, detaching);
  			if (detaching) detach(t);
  			destroy_component(section1, detaching);
  		}
  	};
  }

  // (28:2) <span slot="bar">
  function create_bar_slot(ctx) {
  	let span;
  	let current;

  	const row = new Row({
  			props: {
  				$$slots: { default: [create_default_slot_4] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			span = element("span");
  			create_component(row.$$.fragment);
  			attr(span, "slot", "bar");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  			mount_component(row, span, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const row_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				row_changes.$$scope = { dirty, ctx };
  			}

  			row.$set(row_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(row.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(row.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  			destroy_component(row);
  		}
  	};
  }

  // (42:6) <Icon class="material-icons">
  function create_default_slot_3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("thumb_up");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (43:6) <Label>
  function create_default_slot_2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Click Me");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (41:4) <Button on:click={()=> clicked++}>
  function create_default_slot_1(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_3] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  			t = space();
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			insert(target, t, anchor);
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  			if (detaching) detach(t);
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (48:6) {:else}
  function create_else_block$1(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "You haven't clicked the button.";
  			attr(span, "class", "grayed svelte-v7606t");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		p: noop,
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (46:6) {#if clicked}
  function create_if_block$1(ctx) {
  	let t0;
  	let t1;
  	let t2;
  	let t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "";
  	let t3;
  	let t4;

  	return {
  		c() {
  			t0 = text("You've clicked the button ");
  			t1 = text(/*clicked*/ ctx[0]);
  			t2 = text(" time");
  			t3 = text(t3_value);
  			t4 = text(".");
  		},
  		m(target, anchor) {
  			insert(target, t0, anchor);
  			insert(target, t1, anchor);
  			insert(target, t2, anchor);
  			insert(target, t3, anchor);
  			insert(target, t4, anchor);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*clicked*/ 1) set_data(t1, /*clicked*/ ctx[0]);
  			if (dirty & /*clicked*/ 1 && t3_value !== (t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "")) set_data(t3, t3_value);
  		},
  		d(detaching) {
  			if (detaching) detach(t0);
  			if (detaching) detach(t1);
  			if (detaching) detach(t2);
  			if (detaching) detach(t3);
  			if (detaching) detach(t4);
  		}
  	};
  }

  // (40:2) <div slot="content" style="padding: 30px;">
  function create_content_slot(ctx) {
  	let div;
  	let t0;
  	let p;
  	let t1;
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_1] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*click_handler_2*/ ctx[3]);

  	function select_block_type(ctx, dirty) {
  		if (/*clicked*/ ctx[0]) return create_if_block$1;
  		return create_else_block$1;
  	}

  	let current_block_type = select_block_type(ctx);
  	let if_block = current_block_type(ctx);
  	const loremipsum = new LoremIpsum({});

  	return {
  		c() {
  			div = element("div");
  			create_component(button.$$.fragment);
  			t0 = space();
  			p = element("p");
  			if_block.c();
  			t1 = space();
  			create_component(loremipsum.$$.fragment);
  			attr(p, "class", "mdc-typography--body1");
  			attr(div, "slot", "content");
  			set_style(div, "padding", "30px");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(button, div, null);
  			append(div, t0);
  			append(div, p);
  			if_block.m(p, null);
  			append(div, t1);
  			mount_component(loremipsum, div, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);

  			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
  				if_block.p(ctx, dirty);
  			} else {
  				if_block.d(1);
  				if_block = current_block_type(ctx);

  				if (if_block) {
  					if_block.c();
  					if_block.m(p, null);
  				}
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(button.$$.fragment, local);
  			transition_in(loremipsum.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(button.$$.fragment, local);
  			transition_out(loremipsum.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(button);
  			if_block.d();
  			destroy_component(loremipsum);
  		}
  	};
  }

  // (26:0) <Page>
  function create_default_slot$3(ctx) {
  	let t;

  	return {
  		c() {
  			t = space();
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		p: noop,
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  function create_fragment$d(ctx) {
  	let current;

  	const page = new Page({
  			props: {
  				$$slots: {
  					default: [create_default_slot$3],
  					content: [create_content_slot],
  					bar: [create_bar_slot]
  				},
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(page.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(page, target, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const page_changes = {};

  			if (dirty & /*$$scope, clicked*/ 17) {
  				page_changes.$$scope = { dirty, ctx };
  			}

  			page.$set(page_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(page.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(page.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(page, detaching);
  		}
  	};
  }

  function instance$c($$self, $$props, $$invalidate) {
  	let clicked = 0;
  	const click_handler = _ => go("/one");
  	const click_handler_1 = _ => go("/three");
  	const click_handler_2 = () => $$invalidate(0, clicked++, clicked);
  	return [clicked, click_handler, click_handler_1, click_handler_2];
  }

  class HomePage extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$c, create_fragment$d, safe_not_equal, {});
  	}
  }

  /* src/pages/OnePage.svelte generated by Svelte v3.18.2 */

  function create_default_slot_9$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("arrow_back_ios");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (32:8) <Title>
  function create_default_slot_8$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("One");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (30:6) <Section>
  function create_default_slot_7$1(ctx) {
  	let t;
  	let current;

  	const iconbutton = new IconButton({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_9$1] },
  				$$scope: { ctx }
  			}
  		});

  	iconbutton.$on("click", /*click_handler*/ ctx[1]);

  	const title = new Title({
  			props: {
  				$$slots: { default: [create_default_slot_8$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(iconbutton.$$.fragment);
  			t = space();
  			create_component(title.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(iconbutton, target, anchor);
  			insert(target, t, anchor);
  			mount_component(title, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const iconbutton_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				iconbutton_changes.$$scope = { dirty, ctx };
  			}

  			iconbutton.$set(iconbutton_changes);
  			const title_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				title_changes.$$scope = { dirty, ctx };
  			}

  			title.$set(title_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(iconbutton.$$.fragment, local);
  			transition_in(title.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(iconbutton.$$.fragment, local);
  			transition_out(title.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(iconbutton, detaching);
  			if (detaching) detach(t);
  			destroy_component(title, detaching);
  		}
  	};
  }

  // (35:8) <IconButton class="material-icons" on:click={_ => go("/one/two")}>
  function create_default_slot_6$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("looks_two");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (34:6) <Section align="end" toolbar>
  function create_default_slot_5$1(ctx) {
  	let current;

  	const iconbutton = new IconButton({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_6$1] },
  				$$scope: { ctx }
  			}
  		});

  	iconbutton.$on("click", /*click_handler_1*/ ctx[2]);

  	return {
  		c() {
  			create_component(iconbutton.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(iconbutton, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const iconbutton_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				iconbutton_changes.$$scope = { dirty, ctx };
  			}

  			iconbutton.$set(iconbutton_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(iconbutton.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(iconbutton.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(iconbutton, detaching);
  		}
  	};
  }

  // (29:4) <Row>
  function create_default_slot_4$1(ctx) {
  	let t;
  	let current;

  	const section0 = new Section({
  			props: {
  				$$slots: { default: [create_default_slot_7$1] },
  				$$scope: { ctx }
  			}
  		});

  	const section1 = new Section({
  			props: {
  				align: "end",
  				toolbar: true,
  				$$slots: { default: [create_default_slot_5$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(section0.$$.fragment);
  			t = space();
  			create_component(section1.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(section0, target, anchor);
  			insert(target, t, anchor);
  			mount_component(section1, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const section0_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				section0_changes.$$scope = { dirty, ctx };
  			}

  			section0.$set(section0_changes);
  			const section1_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				section1_changes.$$scope = { dirty, ctx };
  			}

  			section1.$set(section1_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(section0.$$.fragment, local);
  			transition_in(section1.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(section0.$$.fragment, local);
  			transition_out(section1.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(section0, detaching);
  			if (detaching) detach(t);
  			destroy_component(section1, detaching);
  		}
  	};
  }

  // (28:2) <span slot="bar">
  function create_bar_slot$1(ctx) {
  	let span;
  	let current;

  	const row = new Row({
  			props: {
  				$$slots: { default: [create_default_slot_4$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			span = element("span");
  			create_component(row.$$.fragment);
  			attr(span, "slot", "bar");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  			mount_component(row, span, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const row_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				row_changes.$$scope = { dirty, ctx };
  			}

  			row.$set(row_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(row.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(row.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  			destroy_component(row);
  		}
  	};
  }

  // (42:6) <Icon class="material-icons">
  function create_default_slot_3$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("thumb_up");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (43:6) <Label>
  function create_default_slot_2$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Click Me");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (41:4) <Button on:click={()=> clicked++}>
  function create_default_slot_1$1(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_3$1] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_2$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  			t = space();
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			insert(target, t, anchor);
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  			if (detaching) detach(t);
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (48:6) {:else}
  function create_else_block$2(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "You haven't clicked the button.";
  			attr(span, "class", "grayed svelte-v7606t");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		p: noop,
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (46:6) {#if clicked}
  function create_if_block$2(ctx) {
  	let t0;
  	let t1;
  	let t2;
  	let t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "";
  	let t3;
  	let t4;

  	return {
  		c() {
  			t0 = text("You've clicked the button ");
  			t1 = text(/*clicked*/ ctx[0]);
  			t2 = text(" time");
  			t3 = text(t3_value);
  			t4 = text(".");
  		},
  		m(target, anchor) {
  			insert(target, t0, anchor);
  			insert(target, t1, anchor);
  			insert(target, t2, anchor);
  			insert(target, t3, anchor);
  			insert(target, t4, anchor);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*clicked*/ 1) set_data(t1, /*clicked*/ ctx[0]);
  			if (dirty & /*clicked*/ 1 && t3_value !== (t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "")) set_data(t3, t3_value);
  		},
  		d(detaching) {
  			if (detaching) detach(t0);
  			if (detaching) detach(t1);
  			if (detaching) detach(t2);
  			if (detaching) detach(t3);
  			if (detaching) detach(t4);
  		}
  	};
  }

  // (40:2) <div slot="content" style="padding: 30px;">
  function create_content_slot$1(ctx) {
  	let div;
  	let t0;
  	let p;
  	let t1;
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_1$1] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*click_handler_2*/ ctx[3]);

  	function select_block_type(ctx, dirty) {
  		if (/*clicked*/ ctx[0]) return create_if_block$2;
  		return create_else_block$2;
  	}

  	let current_block_type = select_block_type(ctx);
  	let if_block = current_block_type(ctx);
  	const loremipsum = new LoremIpsum({});

  	return {
  		c() {
  			div = element("div");
  			create_component(button.$$.fragment);
  			t0 = space();
  			p = element("p");
  			if_block.c();
  			t1 = space();
  			create_component(loremipsum.$$.fragment);
  			attr(p, "class", "mdc-typography--body1");
  			attr(div, "slot", "content");
  			set_style(div, "padding", "30px");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(button, div, null);
  			append(div, t0);
  			append(div, p);
  			if_block.m(p, null);
  			append(div, t1);
  			mount_component(loremipsum, div, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 16) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);

  			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
  				if_block.p(ctx, dirty);
  			} else {
  				if_block.d(1);
  				if_block = current_block_type(ctx);

  				if (if_block) {
  					if_block.c();
  					if_block.m(p, null);
  				}
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(button.$$.fragment, local);
  			transition_in(loremipsum.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(button.$$.fragment, local);
  			transition_out(loremipsum.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(button);
  			if_block.d();
  			destroy_component(loremipsum);
  		}
  	};
  }

  // (26:0) <Page>
  function create_default_slot$4(ctx) {
  	let t;

  	return {
  		c() {
  			t = space();
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		p: noop,
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  function create_fragment$e(ctx) {
  	let current;

  	const page = new Page({
  			props: {
  				$$slots: {
  					default: [create_default_slot$4],
  					content: [create_content_slot$1],
  					bar: [create_bar_slot$1]
  				},
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(page.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(page, target, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const page_changes = {};

  			if (dirty & /*$$scope, clicked*/ 17) {
  				page_changes.$$scope = { dirty, ctx };
  			}

  			page.$set(page_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(page.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(page.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(page, detaching);
  		}
  	};
  }

  function instance$d($$self, $$props, $$invalidate) {
  	let clicked = 0;
  	const click_handler = _ => go("/");
  	const click_handler_1 = _ => go("/one/two");
  	const click_handler_2 = () => $$invalidate(0, clicked++, clicked);
  	return [clicked, click_handler, click_handler_1, click_handler_2];
  }

  class OnePage extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$d, create_fragment$e, safe_not_equal, {});
  	}
  }

  /* src/pages/TwoPage.svelte generated by Svelte v3.18.2 */

  function create_default_slot_7$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("arrow_back_ios");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (32:8) <Title>
  function create_default_slot_6$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Two");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (30:6) <Section>
  function create_default_slot_5$2(ctx) {
  	let t;
  	let current;

  	const iconbutton = new IconButton({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_7$2] },
  				$$scope: { ctx }
  			}
  		});

  	iconbutton.$on("click", /*click_handler*/ ctx[1]);

  	const title = new Title({
  			props: {
  				$$slots: { default: [create_default_slot_6$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(iconbutton.$$.fragment);
  			t = space();
  			create_component(title.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(iconbutton, target, anchor);
  			insert(target, t, anchor);
  			mount_component(title, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const iconbutton_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				iconbutton_changes.$$scope = { dirty, ctx };
  			}

  			iconbutton.$set(iconbutton_changes);
  			const title_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				title_changes.$$scope = { dirty, ctx };
  			}

  			title.$set(title_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(iconbutton.$$.fragment, local);
  			transition_in(title.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(iconbutton.$$.fragment, local);
  			transition_out(title.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(iconbutton, detaching);
  			if (detaching) detach(t);
  			destroy_component(title, detaching);
  		}
  	};
  }

  // (29:4) <Row>
  function create_default_slot_4$2(ctx) {
  	let current;

  	const section = new Section({
  			props: {
  				$$slots: { default: [create_default_slot_5$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(section.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(section, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const section_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				section_changes.$$scope = { dirty, ctx };
  			}

  			section.$set(section_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(section.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(section.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(section, detaching);
  		}
  	};
  }

  // (28:2) <span slot="bar">
  function create_bar_slot$2(ctx) {
  	let span;
  	let current;

  	const row = new Row({
  			props: {
  				$$slots: { default: [create_default_slot_4$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			span = element("span");
  			create_component(row.$$.fragment);
  			attr(span, "slot", "bar");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  			mount_component(row, span, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const row_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				row_changes.$$scope = { dirty, ctx };
  			}

  			row.$set(row_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(row.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(row.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  			destroy_component(row);
  		}
  	};
  }

  // (39:6) <Icon class="material-icons">
  function create_default_slot_3$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("thumb_up");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (40:6) <Label>
  function create_default_slot_2$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Click Me");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (38:4) <Button on:click={()=> clicked++}>
  function create_default_slot_1$2(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_3$2] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_2$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  			t = space();
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			insert(target, t, anchor);
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  			if (detaching) detach(t);
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (45:6) {:else}
  function create_else_block$3(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "You haven't clicked the button.";
  			attr(span, "class", "grayed svelte-v7606t");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		p: noop,
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (43:6) {#if clicked}
  function create_if_block$3(ctx) {
  	let t0;
  	let t1;
  	let t2;
  	let t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "";
  	let t3;
  	let t4;

  	return {
  		c() {
  			t0 = text("You've clicked the button ");
  			t1 = text(/*clicked*/ ctx[0]);
  			t2 = text(" time");
  			t3 = text(t3_value);
  			t4 = text(".");
  		},
  		m(target, anchor) {
  			insert(target, t0, anchor);
  			insert(target, t1, anchor);
  			insert(target, t2, anchor);
  			insert(target, t3, anchor);
  			insert(target, t4, anchor);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*clicked*/ 1) set_data(t1, /*clicked*/ ctx[0]);
  			if (dirty & /*clicked*/ 1 && t3_value !== (t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "")) set_data(t3, t3_value);
  		},
  		d(detaching) {
  			if (detaching) detach(t0);
  			if (detaching) detach(t1);
  			if (detaching) detach(t2);
  			if (detaching) detach(t3);
  			if (detaching) detach(t4);
  		}
  	};
  }

  // (37:2) <div slot="content" style="padding: 30px;">
  function create_content_slot$2(ctx) {
  	let div;
  	let t0;
  	let p;
  	let t1;
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_1$2] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*click_handler_1*/ ctx[2]);

  	function select_block_type(ctx, dirty) {
  		if (/*clicked*/ ctx[0]) return create_if_block$3;
  		return create_else_block$3;
  	}

  	let current_block_type = select_block_type(ctx);
  	let if_block = current_block_type(ctx);
  	const loremipsum = new LoremIpsum({});

  	return {
  		c() {
  			div = element("div");
  			create_component(button.$$.fragment);
  			t0 = space();
  			p = element("p");
  			if_block.c();
  			t1 = space();
  			create_component(loremipsum.$$.fragment);
  			attr(p, "class", "mdc-typography--body1");
  			attr(div, "slot", "content");
  			set_style(div, "padding", "30px");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(button, div, null);
  			append(div, t0);
  			append(div, p);
  			if_block.m(p, null);
  			append(div, t1);
  			mount_component(loremipsum, div, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);

  			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
  				if_block.p(ctx, dirty);
  			} else {
  				if_block.d(1);
  				if_block = current_block_type(ctx);

  				if (if_block) {
  					if_block.c();
  					if_block.m(p, null);
  				}
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(button.$$.fragment, local);
  			transition_in(loremipsum.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(button.$$.fragment, local);
  			transition_out(loremipsum.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(button);
  			if_block.d();
  			destroy_component(loremipsum);
  		}
  	};
  }

  // (26:0) <Page>
  function create_default_slot$5(ctx) {
  	let t;

  	return {
  		c() {
  			t = space();
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		p: noop,
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  function create_fragment$f(ctx) {
  	let current;

  	const page = new Page({
  			props: {
  				$$slots: {
  					default: [create_default_slot$5],
  					content: [create_content_slot$2],
  					bar: [create_bar_slot$2]
  				},
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(page.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(page, target, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const page_changes = {};

  			if (dirty & /*$$scope, clicked*/ 9) {
  				page_changes.$$scope = { dirty, ctx };
  			}

  			page.$set(page_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(page.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(page.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(page, detaching);
  		}
  	};
  }

  function instance$e($$self, $$props, $$invalidate) {
  	let clicked = 0;
  	const click_handler = _ => go("/one");
  	const click_handler_1 = () => $$invalidate(0, clicked++, clicked);
  	return [clicked, click_handler, click_handler_1];
  }

  class TwoPage extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$e, create_fragment$f, safe_not_equal, {});
  	}
  }

  /* src/pages/ThreePage.svelte generated by Svelte v3.18.2 */

  function create_default_slot_7$3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("arrow_back_ios");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (32:8) <Title>
  function create_default_slot_6$3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Three");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (30:6) <Section>
  function create_default_slot_5$3(ctx) {
  	let t;
  	let current;

  	const iconbutton = new IconButton({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_7$3] },
  				$$scope: { ctx }
  			}
  		});

  	iconbutton.$on("click", /*click_handler*/ ctx[1]);

  	const title = new Title({
  			props: {
  				$$slots: { default: [create_default_slot_6$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(iconbutton.$$.fragment);
  			t = space();
  			create_component(title.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(iconbutton, target, anchor);
  			insert(target, t, anchor);
  			mount_component(title, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const iconbutton_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				iconbutton_changes.$$scope = { dirty, ctx };
  			}

  			iconbutton.$set(iconbutton_changes);
  			const title_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				title_changes.$$scope = { dirty, ctx };
  			}

  			title.$set(title_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(iconbutton.$$.fragment, local);
  			transition_in(title.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(iconbutton.$$.fragment, local);
  			transition_out(title.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(iconbutton, detaching);
  			if (detaching) detach(t);
  			destroy_component(title, detaching);
  		}
  	};
  }

  // (29:4) <Row>
  function create_default_slot_4$3(ctx) {
  	let current;

  	const section = new Section({
  			props: {
  				$$slots: { default: [create_default_slot_5$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(section.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(section, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const section_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				section_changes.$$scope = { dirty, ctx };
  			}

  			section.$set(section_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(section.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(section.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(section, detaching);
  		}
  	};
  }

  // (28:2) <span slot="bar">
  function create_bar_slot$3(ctx) {
  	let span;
  	let current;

  	const row = new Row({
  			props: {
  				$$slots: { default: [create_default_slot_4$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			span = element("span");
  			create_component(row.$$.fragment);
  			attr(span, "slot", "bar");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  			mount_component(row, span, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const row_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				row_changes.$$scope = { dirty, ctx };
  			}

  			row.$set(row_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(row.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(row.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  			destroy_component(row);
  		}
  	};
  }

  // (39:6) <Icon class="material-icons">
  function create_default_slot_3$3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("thumb_up");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (40:6) <Label>
  function create_default_slot_2$3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Click Me");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (38:4) <Button on:click={()=> clicked++}>
  function create_default_slot_1$3(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_3$3] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_2$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  			t = space();
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			insert(target, t, anchor);
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  			if (detaching) detach(t);
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (45:6) {:else}
  function create_else_block$4(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "You haven't clicked the button.";
  			attr(span, "class", "grayed svelte-v7606t");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		p: noop,
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (43:6) {#if clicked}
  function create_if_block$4(ctx) {
  	let t0;
  	let t1;
  	let t2;
  	let t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "";
  	let t3;
  	let t4;

  	return {
  		c() {
  			t0 = text("You've clicked the button ");
  			t1 = text(/*clicked*/ ctx[0]);
  			t2 = text(" time");
  			t3 = text(t3_value);
  			t4 = text(".");
  		},
  		m(target, anchor) {
  			insert(target, t0, anchor);
  			insert(target, t1, anchor);
  			insert(target, t2, anchor);
  			insert(target, t3, anchor);
  			insert(target, t4, anchor);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*clicked*/ 1) set_data(t1, /*clicked*/ ctx[0]);
  			if (dirty & /*clicked*/ 1 && t3_value !== (t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "")) set_data(t3, t3_value);
  		},
  		d(detaching) {
  			if (detaching) detach(t0);
  			if (detaching) detach(t1);
  			if (detaching) detach(t2);
  			if (detaching) detach(t3);
  			if (detaching) detach(t4);
  		}
  	};
  }

  // (37:2) <div slot="content" style="padding: 30px;">
  function create_content_slot$3(ctx) {
  	let div;
  	let t0;
  	let p;
  	let t1;
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_1$3] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*click_handler_1*/ ctx[2]);

  	function select_block_type(ctx, dirty) {
  		if (/*clicked*/ ctx[0]) return create_if_block$4;
  		return create_else_block$4;
  	}

  	let current_block_type = select_block_type(ctx);
  	let if_block = current_block_type(ctx);
  	const loremipsum = new LoremIpsum({});

  	return {
  		c() {
  			div = element("div");
  			create_component(button.$$.fragment);
  			t0 = space();
  			p = element("p");
  			if_block.c();
  			t1 = space();
  			create_component(loremipsum.$$.fragment);
  			attr(p, "class", "mdc-typography--body1");
  			attr(div, "slot", "content");
  			set_style(div, "padding", "30px");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(button, div, null);
  			append(div, t0);
  			append(div, p);
  			if_block.m(p, null);
  			append(div, t1);
  			mount_component(loremipsum, div, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 8) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);

  			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
  				if_block.p(ctx, dirty);
  			} else {
  				if_block.d(1);
  				if_block = current_block_type(ctx);

  				if (if_block) {
  					if_block.c();
  					if_block.m(p, null);
  				}
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(button.$$.fragment, local);
  			transition_in(loremipsum.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(button.$$.fragment, local);
  			transition_out(loremipsum.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(button);
  			if_block.d();
  			destroy_component(loremipsum);
  		}
  	};
  }

  // (26:0) <Page>
  function create_default_slot$6(ctx) {
  	let t;

  	return {
  		c() {
  			t = space();
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		p: noop,
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  function create_fragment$g(ctx) {
  	let current;

  	const page = new Page({
  			props: {
  				$$slots: {
  					default: [create_default_slot$6],
  					content: [create_content_slot$3],
  					bar: [create_bar_slot$3]
  				},
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(page.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(page, target, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const page_changes = {};

  			if (dirty & /*$$scope, clicked*/ 9) {
  				page_changes.$$scope = { dirty, ctx };
  			}

  			page.$set(page_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(page.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(page.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(page, detaching);
  		}
  	};
  }

  function instance$f($$self, $$props, $$invalidate) {
  	let clicked = 0;
  	const click_handler = _ => go("/");
  	const click_handler_1 = () => $$invalidate(0, clicked++, clicked);
  	return [clicked, click_handler, click_handler_1];
  }

  class ThreePage extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$f, create_fragment$g, safe_not_equal, {});
  	}
  }

  /* src/App.svelte generated by Svelte v3.18.2 */

  function create_if_block_2(ctx) {
  	let div;
  	let div_transition;
  	let current;
  	const onepage = new OnePage({});

  	return {
  		c() {
  			div = element("div");
  			create_component(onepage.$$.fragment);
  			attr(div, "class", "container svelte-1w9opi8");
  			set_style(div, "z-index", "1");
  			set_style(div, "background-color", "#FEDFE1");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(onepage, div, null);
  			current = true;
  		},
  		i(local) {
  			if (current) return;
  			transition_in(onepage.$$.fragment, local);

  			add_render_callback(() => {
  				if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, true);
  				div_transition.run(1);
  			});

  			current = true;
  		},
  		o(local) {
  			transition_out(onepage.$$.fragment, local);
  			if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, false);
  			div_transition.run(0);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(onepage);
  			if (detaching && div_transition) div_transition.end();
  		}
  	};
  }

  // (53:0) {#if pathname.startsWith("/one/two")}
  function create_if_block_1(ctx) {
  	let div;
  	let div_transition;
  	let current;
  	const twopage = new TwoPage({});

  	return {
  		c() {
  			div = element("div");
  			create_component(twopage.$$.fragment);
  			attr(div, "class", "container svelte-1w9opi8");
  			set_style(div, "z-index", "2");
  			set_style(div, "background-color", "#F8C3CD");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(twopage, div, null);
  			current = true;
  		},
  		i(local) {
  			if (current) return;
  			transition_in(twopage.$$.fragment, local);

  			add_render_callback(() => {
  				if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, true);
  				div_transition.run(1);
  			});

  			current = true;
  		},
  		o(local) {
  			transition_out(twopage.$$.fragment, local);
  			if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, false);
  			div_transition.run(0);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(twopage);
  			if (detaching && div_transition) div_transition.end();
  		}
  	};
  }

  // (59:0) {#if pathname.startsWith("/three")}
  function create_if_block$5(ctx) {
  	let div;
  	let div_transition;
  	let current;
  	const threepage = new ThreePage({});

  	return {
  		c() {
  			div = element("div");
  			create_component(threepage.$$.fragment);
  			attr(div, "class", "container svelte-1w9opi8");
  			set_style(div, "z-index", "1");
  			set_style(div, "background-color", "#FEDFE1");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(threepage, div, null);
  			current = true;
  		},
  		i(local) {
  			if (current) return;
  			transition_in(threepage.$$.fragment, local);

  			add_render_callback(() => {
  				if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, true);
  				div_transition.run(1);
  			});

  			current = true;
  		},
  		o(local) {
  			transition_out(threepage.$$.fragment, local);
  			if (!div_transition) div_transition = create_bidirectional_transition(div, slide, {}, false);
  			div_transition.run(0);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(threepage);
  			if (detaching && div_transition) div_transition.end();
  		}
  	};
  }

  function create_fragment$h(ctx) {
  	let div;
  	let t0;
  	let show_if_2 = /*pathname*/ ctx[0].startsWith("/one");
  	let t1;
  	let show_if_1 = /*pathname*/ ctx[0].startsWith("/one/two");
  	let t2;
  	let show_if = /*pathname*/ ctx[0].startsWith("/three");
  	let if_block2_anchor;
  	let current;
  	let dispose;
  	const homepage = new HomePage({});
  	let if_block0 = show_if_2 && create_if_block_2();
  	let if_block1 = show_if_1 && create_if_block_1();
  	let if_block2 = show_if && create_if_block$5();

  	return {
  		c() {
  			div = element("div");
  			create_component(homepage.$$.fragment);
  			t0 = space();
  			if (if_block0) if_block0.c();
  			t1 = space();
  			if (if_block1) if_block1.c();
  			t2 = space();
  			if (if_block2) if_block2.c();
  			if_block2_anchor = empty();
  			attr(div, "class", "container svelte-1w9opi8");
  			set_style(div, "z-index", "0");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(homepage, div, null);
  			insert(target, t0, anchor);
  			if (if_block0) if_block0.m(target, anchor);
  			insert(target, t1, anchor);
  			if (if_block1) if_block1.m(target, anchor);
  			insert(target, t2, anchor);
  			if (if_block2) if_block2.m(target, anchor);
  			insert(target, if_block2_anchor, anchor);
  			current = true;
  			dispose = listen(window, "popstate", /*onPopState*/ ctx[1]);
  		},
  		p(ctx, [dirty]) {
  			if (dirty & /*pathname*/ 1) show_if_2 = /*pathname*/ ctx[0].startsWith("/one");

  			if (show_if_2) {
  				if (!if_block0) {
  					if_block0 = create_if_block_2();
  					if_block0.c();
  					transition_in(if_block0, 1);
  					if_block0.m(t1.parentNode, t1);
  				} else {
  					transition_in(if_block0, 1);
  				}
  			} else if (if_block0) {
  				group_outros();

  				transition_out(if_block0, 1, 1, () => {
  					if_block0 = null;
  				});

  				check_outros();
  			}

  			if (dirty & /*pathname*/ 1) show_if_1 = /*pathname*/ ctx[0].startsWith("/one/two");

  			if (show_if_1) {
  				if (!if_block1) {
  					if_block1 = create_if_block_1();
  					if_block1.c();
  					transition_in(if_block1, 1);
  					if_block1.m(t2.parentNode, t2);
  				} else {
  					transition_in(if_block1, 1);
  				}
  			} else if (if_block1) {
  				group_outros();

  				transition_out(if_block1, 1, 1, () => {
  					if_block1 = null;
  				});

  				check_outros();
  			}

  			if (dirty & /*pathname*/ 1) show_if = /*pathname*/ ctx[0].startsWith("/three");

  			if (show_if) {
  				if (!if_block2) {
  					if_block2 = create_if_block$5();
  					if_block2.c();
  					transition_in(if_block2, 1);
  					if_block2.m(if_block2_anchor.parentNode, if_block2_anchor);
  				} else {
  					transition_in(if_block2, 1);
  				}
  			} else if (if_block2) {
  				group_outros();

  				transition_out(if_block2, 1, 1, () => {
  					if_block2 = null;
  				});

  				check_outros();
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(homepage.$$.fragment, local);
  			transition_in(if_block0);
  			transition_in(if_block1);
  			transition_in(if_block2);
  			current = true;
  		},
  		o(local) {
  			transition_out(homepage.$$.fragment, local);
  			transition_out(if_block0);
  			transition_out(if_block1);
  			transition_out(if_block2);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(homepage);
  			if (detaching) detach(t0);
  			if (if_block0) if_block0.d(detaching);
  			if (detaching) detach(t1);
  			if (if_block1) if_block1.d(detaching);
  			if (detaching) detach(t2);
  			if (if_block2) if_block2.d(detaching);
  			if (detaching) detach(if_block2_anchor);
  			dispose();
  		}
  	};
  }

  function instance$g($$self, $$props, $$invalidate) {
  	let pathname = location.pathname;

  	function onPopState(e) {
  		$$invalidate(0, pathname = location.pathname);
  	}

  	let pushState = history.pushState;

  	history.pushState = function () {
  		pushState.apply(history, arguments);
  		$$invalidate(0, pathname = location.pathname);
  	};

  	return [pathname, onPopState];
  }

  class App extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$g, create_fragment$h, safe_not_equal, {});
  	}
  }

  // window.app = new App({
  //   target: document.getElementsByTagName('app')[0]
  // });

  const app = new App({
    target: document.body
  });

  return app;

}());
