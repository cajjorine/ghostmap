export interface Modal {
  open(): void;
  close(): void;
  body: HTMLElement;
}

/** Wraps a <dialog>: [data-close] button, backdrop click and Escape key close it. */
export function createModal(id: string): Modal {
  const dialog = document.getElementById(id);
  if (!(dialog instanceof HTMLDialogElement)) throw new Error(`#${id} must be a <dialog>`);
  const body = dialog.querySelector<HTMLElement>('.modal-body') ?? dialog;

  dialog.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === dialog || target.closest('[data-close]')) dialog.close();
  });

  return {
    body,
    open: () => {
      if (!dialog.open) dialog.showModal();
    },
    close: () => dialog.close(),
  };
}
