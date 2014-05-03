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

    // test
    $(function () {
      $('#imageBackground').click(function() {
        var current_image = $(this).attr('src');
        var target_image = '';
	      if ( current_image === './assets/images/panorama-winter.jpg') {
          target_image = './assets/images/panorama-winter2.jpg';
        }
        else if ( current_image === './assets/images/panorama-winter2.jpg') {
          target_image = './assets/images/panorama-winter3.jpg';
        }
        else if ( current_image === './assets/images/panorama-winter3.jpg') {
          target_image = './assets/images/panorama-winter.jpg';
        }
          $(this).attr('src', target_image);
      });  
    });

    // init the heise provided social privacy plugin
    social.init();
  });

});
