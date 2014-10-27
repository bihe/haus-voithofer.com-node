/*
 * application configuration file
 */
'use strict';

var config = {};

config.application = {};
config.application.secret = '--SECRET--KEY--';
config.application.basePath = '/';

// define the google maps key
config.maps = {};
config.maps.key = '--GOOGLE-MAPS-KEY--';

// recaptcha section
config.recaptcha = {};
config.recaptcha.public = '--RECAPTCHA--PUBLIC--';
config.recaptcha.private = '--RECAPTCHA--PRIVATE--';

// email configuration
config.email = {};
config.email.recipient = '--EMAIL-RECIPIENT--';
config.email.subject = '--SUBJECT--';
config.email.sender = '--EMAIL-SENDER--';
config.email.stmpServer = 'smtp.googlemail.com';
config.email.stmpUser = '--SMTP-USER--';
config.email.stmpPassword = '--SMTP-PASS--';

module.exports = config;
