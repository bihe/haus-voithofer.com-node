define([
// Global application context.
  "app",
// Third-party libraries.
  "jquery",
  "utils",
  "Handlebars"
// Modules
  //"modules/searchForm/views"
],

// main module of the haus-voithofer.com app
// ----------------------------------------
function (app, $, u, Handlebars) {
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

  // contact data, check the entries and submit the data
  // ---------------------------------------------------
  function submitContactData(event) {
    $('#contactSuccess').addClass('hide');
    $('#contactError').addClass('hide');

    // use the global object - should be accessed as module
    // too lazy right now
    var global = window;
    var i18n = global.i18n;

    // 1) collect the contact-data
    var contact = {
      name: $('#name').val(),
      email: $('#email').val(),
      message: $('#message').val(),

      captcha_challenge: global.Recaptcha.get_challenge(),
      captcha_response: global.Recaptcha.get_response()

    };

    // 2) it is required that all values are present to submit the data
    if(contact.name && contact.name !== '' &&
      contact.email && contact.email !== '' &&
      contact.message && contact.message !== '' &&
      contact.captcha_challenge && contact.captcha_challenge !== '' &&
      contact.captcha_response && contact.captcha_response !== '') {

      $.ajax({
        type: 'POST',
        contentType: 'application/json; charset=utf-8',
        dataType: 'json',
        url: '/contact',
        data: JSON.stringify(contact),
        async: true,
        success: function(data) {
          console.log('got data from the backend! ' + data.result);
          if(data.result === true) {
            if(data.emailSent === true) {

              $('#name').val('');
              $('#email').val('');
              $('#message').val('');

              $('#contactSuccess').removeClass('hide');
            } else {
              $('#contactError').removeClass('hide');
            }
          } else {
            alert(i18n.wrongCaptcha);
          }
          global.Recaptcha.reload();
        }
      });
    } else {
      global.Recaptcha.reload();
      alert(i18n.requiredFields);
    }
  }

  // init the app, mainly event handler
  // this is the only public visible method
  // ----------------------------------------
  ns.init = function() {
    $('#submitContact').on('click', submitContactData);
  };

  // ns.init = function() {

  //   ns.model = new ns.ViewModels.Model();
  //   self.i18n = new I18N();
  //   console.log('In init method!');
		// var template = Handlebars.getTemplate('init');
		// var template1 = Handlebars.getTemplate('init');
		// var html = template({ name : 'initialized' });
		// $('#container').html(html);
  // };


  //Required, return the module for AMD compliance
  return ns;
});