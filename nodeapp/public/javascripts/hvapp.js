(function(app, $, i18n, global) {

  // contact data, check the entries and submit the data
  // ---------------------------------------------------
  function submitContactData(event) {
    
    $('#contactSuccess').addClass('hide');
    $('#contactError').addClass('hide');

    // 1) collect the contact-data
    var contact = {
      name: $('#name').val(),
      email: $('#email').val(),
      message: $('#message').val(),

      captcha_challenge: global.Recaptcha.get_challenge(),
      captcha_response: global.Recaptcha.get_response()

    };

    // 2) it is required that all values are present to submit the data
    if(contact.name && contact.name !== '' 
      && contact.email && contact.email !== ''
      && contact.message && contact.message !== ''
      && contact.captcha_challenge && contact.captcha_challenge !== ''
      && contact.captcha_response && contact.captcha_response !== '') {
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


  // init the app - mainly setup eventhandler
  // ----------------------------------------
  app.init = function() {
    $('#submitContact').on('click', submitContactData);
  };


})(hvapp, jQuery, i18n, window);