define([
// Global application context.
  "app",
// Third-party libraries.
  "jquery",
  "utils"
// Modules
  //"modules/searchForm/views"
],

// social privacy logic of the heise module
// ----------------------------------------
function (app, $, u) {
  // the module is called namespace ;)
  var ns = app.module();

  // model definitions
  // ----------------------------------------

  // model
  // ----------------------------------------
  ns.ViewModels.Model = function() {
    var self = {};
    return self;
  };

  // logic
  // ----------------------------------------

  // init the app, mainly event handler
  // this is the only public visible method
  // ----------------------------------------
  ns.init = function() {
    if($('#socialshareprivacy').length > 0){
      $('#socialshareprivacy').socialSharePrivacy({
        services : {
          facebook : {
            'status' : 'on',
            'perma_option': 'off',
            'dummy_img': './assets/images/dummy_facebook_en.png',
            'txt_info': '#{lingua.socialFacebook}',
            'language': 'en_US'
          },
          twitter : {
            'status' : 'on',
            'perma_option': 'off',
            'dummy_img': './assets/images/dummy_twitter.png',
            'txt_info': '#{lingua.socialTwitter}',
            'language': 'en'
          },
          gplus : {
            'status' : 'on',
            'perma_option': 'off',
            'dummy_img': './assets/images/dummy_gplus.png',
            'txt_info': '#{lingua.socialGplus}',
            'language': 'en'
          }
        },
        'cookie_domain': 'www.haus-voithofer.com',
        'css_path': './assets/stylesheets/socialshareprivacy.css'
      });
      $('.settings_info').addClass('hide');
    }
  };


  //Required, return the module for AMD compliance
  return ns;
});