/*
 * use node-mailer to send emails
 */

var nodemailer = require("nodemailer");
var config = require('../config/application');

// send email via node-mailer
// --------------------------
exports.sendEmail = function(data, callback) {
  // create reusable transport method (opens pool of SMTP connections)
  var smtpTransport = nodemailer.createTransport("SMTP",{
      service: "Gmail",
      auth: {
          user: config.email.stmpUser,
          pass: config.email.stmpPassword
      }
  });

  // setup e-mail data with unicode symbols
  var mailOptions = {
      from: config.email.sender, // sender address
      replyTo: data.email,
      to: config.email.recipient, // list of receivers
      subject: config.email.subject, // Subject line
      html: data.htmlBody // html body
  };

  // send mail with defined transport object
  smtpTransport.sendMail(mailOptions, callback);
      // if you don't want to use this transport object anymore, uncomment following line
      //smtpTransport.close(); // shut down the connection pool, no more messages
  

};