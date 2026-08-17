(function(){
  var setups = document.querySelectorAll('[data-diagram-setup]');

  function currentFullscreenElement(){
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function enterFullscreen(element){
    if (element.requestFullscreen) return element.requestFullscreen();
    if (element.webkitRequestFullscreen) return element.webkitRequestFullscreen();
    return null;
  }

  function exitFullscreen(){
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    return null;
  }

  function syncButtons(){
    var active = currentFullscreenElement();
    setups.forEach(function(setup){
      var button = setup.querySelector('[data-diagram-fullscreen]');
      var label = setup.querySelector('[data-diagram-fullscreen-label]');
      if (!button || !label) return;
      var isActive = active === setup;
      label.textContent = isActive ? 'Exit full screen' : 'View full screen';
      button.setAttribute('aria-label', isActive ? 'Exit the full-screen diagram view' : 'View the diagram in full screen');
      button.setAttribute('title', isActive ? 'Exit full screen' : 'Full screen');
    });
  }

  setups.forEach(function(setup){
    var button = setup.querySelector('[data-diagram-fullscreen]');
    if (!button) return;
    button.addEventListener('click', function(){
      if (currentFullscreenElement() === setup) {
        exitFullscreen();
      } else {
        var result = enterFullscreen(setup);
        if (result && typeof result.catch === 'function') result.catch(function(){});
      }
    });
  });

  document.addEventListener('fullscreenchange', syncButtons);
  document.addEventListener('webkitfullscreenchange', syncButtons);
  syncButtons();
})();
