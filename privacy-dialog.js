(() => {
  'use strict';
  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open-privacy-dialog]');
    if (opener) {
      const dialog = document.getElementById(opener.getAttribute('data-open-privacy-dialog'));
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      return;
    }
    if (event.target instanceof HTMLDialogElement) {
      const rect = event.target.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) event.target.close();
    }
  });
})();
