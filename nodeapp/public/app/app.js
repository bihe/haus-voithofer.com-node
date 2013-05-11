define([
// Libs
  "jquery",
  "underscore",
  "Handlebars",
  "utils",
  "spin",

// Plugins
  "plugins/bootstrap",
  "plugins/handlebars.template",
  "plugins/jquery.socialshareprivacy.min",
  "plugins/jquery.spin"
],

function ($, _, Handlebars, Utils, spin) {

    return {
    // Create a custom object
    module: function (additionalProps) {
      return _.extend({ ViewModels: {} }, additionalProps);
    },
    app: {}
  };
});
