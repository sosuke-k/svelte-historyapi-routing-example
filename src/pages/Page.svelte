<script context="module">
  export function go(pathname) {
    if (location.pathname != pathname) {
      history.pushState(null, null, pathname);
    }
  }
</script>

<script>
  import TopAppBar, {
    Row
  } from '@smui/top-app-bar';
</script>

<TopAppBar variant="static" color="primary">
  <slot name="bar"></slot>
</TopAppBar>
<slot name="content"></slot>
