<script lang="ts">
  import { activeModal } from '$lib/stores/modal';

  let promptValue = '';
  let promptError = '';
  let selectValue = '';

  // Reset local form state whenever a new modal is surfaced.
  $: if ($activeModal?.kind === 'prompt') {
    const init = $activeModal.opts.initialValue ?? '';
    if (promptValue !== init && promptValue === '') promptValue = init;
  }
  $: if ($activeModal?.kind === 'select') {
    const first = $activeModal.opts.options[0]?.value ?? '';
    if (!selectValue) selectValue = first;
  }

  function closeConfirm(value: boolean): void {
    if ($activeModal?.kind !== 'confirm') return;
    const r = $activeModal.resolve;
    activeModal.set(null);
    r(value);
  }

  function closePrompt(value: string | null): void {
    if ($activeModal?.kind !== 'prompt') return;
    const r = $activeModal.resolve;
    activeModal.set(null);
    promptValue = '';
    promptError = '';
    r(value);
  }

  function submitPrompt(): void {
    if ($activeModal?.kind !== 'prompt') return;
    const v = promptValue.trim();
    const validator = $activeModal.opts.validate;
    if (validator) {
      const err = validator(v);
      if (err) {
        promptError = err;
        return;
      }
    }
    closePrompt(v);
  }

  function closeSelect(value: string | null): void {
    if ($activeModal?.kind !== 'select') return;
    const r = $activeModal.resolve;
    activeModal.set(null);
    selectValue = '';
    r(value);
  }

  function onBackdropKey(e: KeyboardEvent, close: () => void): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      close();
    }
  }
</script>

{#if $activeModal?.kind === 'confirm'}
  {@const opts = $activeModal.opts}
  <div
    class="modal-backdrop"
    style="z-index: 300;"
    role="button"
    tabindex="-1"
    aria-label="Close dialog"
    on:click|self={() => closeConfirm(false)}
    on:keydown|self={(e) => onBackdropKey(e, () => closeConfirm(false))}
  >
    <div class="modal" role="dialog" aria-modal="true">
      <h3>{opts.title}</h3>
      <p class="muted">{opts.message}</p>
      <div class="row" style="justify-content: flex-end; margin-top: 1rem;">
        <button on:click={() => closeConfirm(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
        <button
          class={opts.destructive ? 'danger' : 'primary'}
          on:click={() => closeConfirm(true)}
        >
          {opts.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if $activeModal?.kind === 'prompt'}
  {@const opts = $activeModal.opts}
  <div
    class="modal-backdrop"
    style="z-index: 300;"
    role="button"
    tabindex="-1"
    aria-label="Close dialog"
    on:click|self={() => closePrompt(null)}
    on:keydown|self={(e) => onBackdropKey(e, () => closePrompt(null))}
  >
    <div class="modal" role="dialog" aria-modal="true">
      <h3>{opts.title}</h3>
      {#if opts.message}
        <p class="muted">{opts.message}</p>
      {/if}
      {#if opts.inputType === 'password'}
        <input
          type="password"
          bind:value={promptValue}
          placeholder={opts.placeholder ?? ''}
          on:keydown={(e) => {
            if (e.key === 'Enter') submitPrompt();
            if (e.key === 'Escape') closePrompt(null);
          }}
          style="width: 100%; margin-top: 0.5rem;"
        />
      {:else}
        <input
          type="text"
          bind:value={promptValue}
          placeholder={opts.placeholder ?? ''}
          on:keydown={(e) => {
            if (e.key === 'Enter') submitPrompt();
            if (e.key === 'Escape') closePrompt(null);
          }}
          style="width: 100%; margin-top: 0.5rem;"
        />
      {/if}
      {#if promptError}
        <small style="color: var(--danger);">{promptError}</small>
      {/if}
      <div class="row" style="justify-content: flex-end; margin-top: 1rem;">
        <button on:click={() => closePrompt(null)}>{opts.cancelLabel ?? 'Cancel'}</button>
        <button class="primary" on:click={submitPrompt}>{opts.confirmLabel ?? 'OK'}</button>
      </div>
    </div>
  </div>
{/if}

{#if $activeModal?.kind === 'select'}
  {@const opts = $activeModal.opts}
  <div
    class="modal-backdrop"
    style="z-index: 300;"
    role="button"
    tabindex="-1"
    aria-label="Close dialog"
    on:click|self={() => closeSelect(null)}
    on:keydown|self={(e) => onBackdropKey(e, () => closeSelect(null))}
  >
    <div class="modal" role="dialog" aria-modal="true">
      <h3>{opts.title}</h3>
      {#if opts.message}
        <p class="muted">{opts.message}</p>
      {/if}
      <select bind:value={selectValue} style="width: 100%; margin-top: 0.5rem;">
        {#each opts.options as o (o.value)}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
      <div class="row" style="justify-content: flex-end; margin-top: 1rem;">
        <button on:click={() => closeSelect(null)}>{opts.cancelLabel ?? 'Cancel'}</button>
        <button
          class="primary"
          on:click={() => closeSelect(selectValue)}
          disabled={!selectValue}
        >
          {opts.confirmLabel ?? 'OK'}
        </button>
      </div>
    </div>
  </div>
{/if}
