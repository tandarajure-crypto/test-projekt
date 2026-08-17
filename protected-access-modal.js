(function () {
  'use strict';

  var dialog = null;
  var lastTrigger = null;
  var loadingPromise = null;

  function isEnglishPage() {
    var language = (document.documentElement.lang || '').toLowerCase();
    return language.indexOf('en') === 0;
  }

  function templateId() {
    return isEnglishPage()
      ? 'protected-access-dialog-en'
      : 'protected-access-dialog-hr';
  }

  function templateUrl() {
    var currentScript = document.currentScript;
    if (currentScript && currentScript.src) {
      return new URL('protected-access-dialog.html', currentScript.src).href;
    }
    return 'protected-access-dialog.html';
  }

  function restoreFocus() {
    if (lastTrigger && typeof lastTrigger.focus === 'function') {
      lastTrigger.focus();
    }
    lastTrigger = null;
  }

  function disposeDialog() {
    var oldDialog = dialog;
    dialog = null;
    loadingPromise = null;

    if (oldDialog && oldDialog.isConnected) {
      oldDialog.remove();
    }

    restoreFocus();
  }

  function closeDialog() {
    if (!dialog) {
      return;
    }

    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
      return;
    }

    dialog.removeAttribute('open');
    dialog.setAttribute('hidden', '');
    disposeDialog();
  }

  function installDialogEvents() {
    dialog.querySelectorAll('[data-protected-access-close]').forEach(function (button) {
      button.addEventListener('click', closeDialog);
    });

    dialog.addEventListener('close', disposeDialog, { once: true });

    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeDialog();
    });

    dialog.addEventListener('click', function (event) {
      var panel = dialog.querySelector('.protected-access-dialog__panel');
      if (panel && !panel.contains(event.target)) {
        closeDialog();
      }
    });
  }

  function loadDialog() {
    if (dialog) {
      return Promise.resolve(dialog);
    }

    if (loadingPromise) {
      return loadingPromise;
    }

    loadingPromise = fetch(templateUrl(), {
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Dijalog nije moguće učitati.');
        }
        return response.text();
      })
      .then(function (html) {
        var parsedDocument = new DOMParser().parseFromString(html, 'text/html');
        var template = parsedDocument.getElementById(templateId());

        if (!template || !template.content) {
          throw new Error('Predložak dijaloga nije pronađen.');
        }

        var fragment = document.importNode(template.content, true);
        document.body.appendChild(fragment);
        dialog = document.body.querySelector('.protected-access-dialog:last-of-type');

        if (!dialog) {
          throw new Error('Dijalog nije pravilno izrađen.');
        }

        installDialogEvents();
        return dialog;
      })
      .catch(function () {
        loadingPromise = null;
        throw new Error(
          isEnglishPage()
            ? 'Protected family information is available only after approval. Please use the Contact and Collaboration page.'
            : 'Zaštićeni obiteljski podaci dostupni su samo nakon odobrenja. Molimo koristite stranicu Kontakt i suradnja.'
        );
      });

    return loadingPromise;
  }

  function openDialog(trigger) {
    lastTrigger = trigger;

    loadDialog()
      .then(function (loadedDialog) {
        if (typeof loadedDialog.showModal === 'function') {
          if (!loadedDialog.open) {
            loadedDialog.showModal();
          }
        } else {
          loadedDialog.removeAttribute('hidden');
          loadedDialog.setAttribute('open', '');
        }

        var closeButton = loadedDialog.querySelector('[data-protected-access-close]');
        if (closeButton) {
          closeButton.focus();
        }
      })
      .catch(function (error) {
        window.alert(error.message);
      });
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-protected-access]');
    if (!trigger) {
      return;
    }

    event.preventDefault();
    openDialog(trigger);
  });
})();
