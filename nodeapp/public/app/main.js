require([
  "app",
// Libs
  "jquery",
  "underscore",
  "utils",
  "Handlebars",
// Modules
  "modules/hvapp",
  "modules/social"
],

function (app, $, _, Utils, Handlebars, hvapp, social) {

  // Treat the jQuery ready function as the entry point to the application.
  // Inside this function, kick-off all initialization, everything up to this
  // point should be definitions.
  $(function () {
    // global jquery settings
    // IE caches a lot so will disable this for jquery
    $.ajaxSetup({ cache: false });

    // setup the main app logic
    // ----------------------------------------
    hvapp.init();

    // init the heise provided social privacy plugin
    social.init();
  });

});