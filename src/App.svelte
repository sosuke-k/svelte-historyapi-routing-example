<script>
  import slide from './svelte-transition-slide.js';

  import HomePage from './pages/HomePage.svelte';
  import OnePage from './pages/OnePage.svelte';
  import TwoPage from './pages/TwoPage.svelte';
  import ThreePage from './pages/ThreePage.svelte';

  let pathname = location.pathname;

  function onPopState(e) {
    pathname = location.pathname;
  }

  let pushState = history.pushState;
  history.pushState = function() {
    pushState.apply(history, arguments);
    pathname = location.pathname;
  };
</script>

<style>
  .container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    margin: 0px;
    padding: 0px;
    overflow: scroll;
  }

  .container::-webkit-scrollbar {
    display: none;
  }
</style>

<svelte:window on:popstate={onPopState} />

<div class="container" style="z-index:0;">
  <HomePage />
</div>

{#if pathname.startsWith("/one")}
  <div class="container" style="z-index:1; background-color: #FEDFE1;" transition:slide>
    <OnePage />
  </div>
{/if}

{#if pathname.startsWith("/one/two")}
  <div class="container" style="z-index:2; background-color: #F8C3CD;" transition:slide>
    <TwoPage />
  </div>
{/if}

{#if pathname.startsWith("/three")}
  <div class="container" style="z-index:1; background-color: #FEDFE1;" transition:slide>
    <ThreePage />
  </div>
{/if}
