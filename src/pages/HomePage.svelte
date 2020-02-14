<script>
  import {
    Row,
    Section,
    Title
  } from '@smui/top-app-bar';
  import Button, {
    Label,
    Icon
  } from '@smui/button';
  import IconButton from '@smui/icon-button';
  import LoremIpsum from '../components/LoremIpsum.svelte';
  import Page, {
    go
  } from './Page.svelte';

  let clicked = 0;
</script>

<style>
  .grayed {
    opacity: .6;
  }
</style>

<Page>

  <span slot="bar">
    <Row>
      <Section>
        <Title>Home</Title>
      </Section>
      <Section align="end" toolbar>
        <IconButton class="material-icons" on:click={_ => go("/one")}>looks_one</IconButton>
        <IconButton class="material-icons" on:click={_ => go("/three")}>looks_3</IconButton>
      </Section>
    </Row>
  </span>

  <div slot="content" style="padding: 30px;">
    <Button on:click={()=> clicked++}>
      <Icon class="material-icons">thumb_up</Icon>
      <Label>Click Me</Label>
    </Button>
    <p class="mdc-typography--body1">
      {#if clicked}
      You've clicked the button {clicked} time{clicked === 1 ? '' : 's'}.
      {:else}
      <span class="grayed">You haven't clicked the button.</span>
      {/if}
    </p>
    <LoremIpsum />
  </div>

</Page>
