(function () {
  var printButton = document.getElementById('printDiagram');
  if (printButton) printButton.addEventListener('click', function () { window.print(); });
}());
