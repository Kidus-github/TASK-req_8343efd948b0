<script lang="ts">
  import { toasts } from '$lib/stores/toast';
</script>

<div class="toast-host" role="status" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div class="toast {t.kind}">{t.message}</div>
  {/each}
</div>
