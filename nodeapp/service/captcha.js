var Recaptcha = require('recaptcha').Recaptcha;

/* Recaptcha logic, get the fields from the request
 * and check the values with the recaptcha server
 * ================================================ */
exports.checkRecaptche = function(req, options, callback) {
  var data = {
      remoteip:  req.connection.remoteAddress,
      challenge: req.body.recaptcha_challenge_field,
      response:  req.body.recaptcha_response_field
  };
  var recaptcha = new Recaptcha(options.PUBLIC_KEY, options.PRIVATE_KEY, data);

  recaptcha.verify(function(success, error_code) {
      if (success) {
        callback(true);
      }
      else {
        callback(false, error_code);
      }
  });
};