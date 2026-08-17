(function () {
  'use strict';

  document.querySelectorAll('[data-print-page]').forEach(function (button) {
    button.addEventListener('click', function () {
      window.print();
    });
  });
})();
