// Small enhancements for admin pages. Every page also works without this file.
(() => {
  // Ask before destructive actions.
  document.addEventListener('submit', (event) => {
    const form = event.target;
    const question = form.dataset.confirm;
    if (question && !window.confirm(question)) {
      event.preventDefault();
      return;
    }
    // Instant feedback on click: the button shows it is working, and cannot be pressed twice.
    if (form.hasAttribute('data-no-busy')) return;
    const button = event.submitter;
    if (button) {
      setTimeout(() => {
        button.setAttribute('aria-busy', 'true');
        button.disabled = true;
      }, 0);
    }
    form.dataset.submitting = 'true';
  });

  // Warn before leaving a form with unsaved changes.
  for (const form of document.querySelectorAll('form[data-dirty-check]')) {
    const initial = new URLSearchParams(new FormData(form)).toString();
    window.addEventListener('beforeunload', (event) => {
      if (form.dataset.submitting) return;
      if (new URLSearchParams(new FormData(form)).toString() !== initial) event.preventDefault();
    });
  }

  // Ctrl+S / Cmd+S saves the main form.
  const saveForm = document.querySelector('form[data-hotkey-save]');
  if (saveForm) {
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveForm.requestSubmit();
      }
    });
  }

  // "Select all" in bulk tables.
  for (const toggle of document.querySelectorAll('[data-select-all]')) {
    toggle.addEventListener('change', () => {
      for (const box of toggle.closest('form').querySelectorAll('input[name="ids"]')) box.checked = toggle.checked;
    });
  }

  // Changing a role select submits its form right away.
  for (const form of document.querySelectorAll('form[data-autosubmit]')) {
    form.querySelector('select')?.addEventListener('change', () => form.requestSubmit());
    form.querySelector('button')?.setAttribute('hidden', '');
  }

  // Copy buttons.
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const text = document.querySelector(button.dataset.copy)?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
      } catch {
        window.getSelection().selectAllChildren(document.querySelector(button.dataset.copy));
        button.textContent = 'Selected, press Ctrl+C';
      }
    });
  }

  for (const button of document.querySelectorAll('[data-print]')) button.addEventListener('click', () => window.print());

  // Success notices fade away; errors stay until fixed.
  for (const notice of document.querySelectorAll('[data-autohide]')) {
    setTimeout(() => notice.classList.add('fade'), 3500);
    setTimeout(() => notice.remove(), 4000);
    const url = new URL(window.location.href);
    url.searchParams.delete('notice');
    window.history.replaceState(null, '', url);
  }

  document.querySelector('[data-focus]')?.focus();

  // Photo uploads: shrink each photo in the browser, then send them one at a time.
  // Hosts like Vercel refuse requests over 4.5 MB, and phone photos are often bigger.
  const MAX_SIDE_PX = 2400;
  const SEND_AS_IS_BYTES = 2.5 * 1024 * 1024;

  async function shrink(file) {
    if (file.size <= SEND_AS_IS_BYTES || !window.createImageBitmap) return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // WebP keeps transparency (cut-outs). Browsers that cannot write WebP return PNG instead.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
    const extension = blob.type === 'image/webp' ? 'webp' : 'png';
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.' + extension, { type: blob.type });
  }

  for (const form of document.querySelectorAll('form[data-upload]')) {
    form.addEventListener('submit', async (event) => {
      const input = form.querySelector('input[type="file"]');
      if (!input.files.length || !window.fetch) return; // the browser sends the form normally
      event.preventDefault();
      const status = form.querySelector('[data-upload-status]');
      const button = form.querySelector('button[type="submit"]');
      const files = [...input.files];
      button.disabled = true;
      for (const [index, file] of files.entries()) {
        status.textContent = `Uploading ${index + 1} of ${files.length}…`;
        const data = new FormData();
        data.set('_csrf', form.querySelector('input[name="_csrf"]').value);
        data.set('photos', await shrink(file));
        const response = await fetch(form.action, { method: 'POST', body: data });
        if (!response.ok) {
          status.textContent = response.status === 413
            ? `"${file.name}" is too large, even after resizing.`
            : `"${file.name}" could not be uploaded. Check it is a JPEG, PNG or WebP photo.`;
          button.disabled = false;
          button.removeAttribute('aria-busy');
          return;
        }
      }
      window.location.assign(`${window.location.pathname}?notice=uploaded`);
    });
  }
})();
