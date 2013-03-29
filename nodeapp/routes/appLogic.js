/*
 * central place for application logic
 * more or less the service layer of the application
 */

var Recaptcha = require('recaptcha').Recaptcha;
var config = require('../config/application');
var mail = require('./mail');
var strftime = require('strftime');

// validate the recaptcha challenge, send the contact data by email
// ----------------------------------------------------------------
exports.contact = function(req, res){
  
  console.log('got contact data ...');

  var contactData = req.body;

  console.log('data: ' + contactData.name + '/' + contactData.email);

  var data = {
        remoteip:  req.connection.remoteAddress,
        challenge: contactData.captcha_challenge,
        response:  contactData.captcha_response
  };

  console.log('recaptcha: ' + config.recaptcha.public);

  var recaptcha = new Recaptcha(config.recaptcha.public, config.recaptcha.private, data);
  var operationResult = {
    result: false,
    emailSent: false,
    message: ''
  };
  recaptcha.verify(function(success, error_code) {
      if (success) {
        console.log('result from recaptcha: ' + success);
        
        operationResult.result = true;

        // use the contact data to send an email
        var htmlMessage = "<strong>Name:</strong> " + contactData.name + 
        "<br/><strong>Email:</strong> " + contactData.email + 
        "<br/><strong>Gesendet:</strong> " + strftime('%F %T', new Date()) + 
        "<br/><br/><br/>" + contactData.message;
        
        contactData.htmlBody = htmlMessage;
        mail.sendEmail(contactData, function(error, response) {
          if(error) {
              console.log(error);
              operationResult.emailSent = false;
              res.json(operationResult);
          } else {
              console.log("Message sent: " + response.message);
              operationResult.emailSent = true;
              res.json(operationResult);
          }
        });
        
      }
      else {

        console.log('recaptcha error message: ' + error_code);
         
        operationResult.result = false;
        res.json(operationResult);
      }
  });
  
};