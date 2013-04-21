define([
// Libs
  "jquery",
  "underscore",
  "Handlebars",
  "utils",

// Plugins
  "plugins/bootstrap",
  "plugins/handlebars.template",
  "plugins/jquery.socialshareprivacy.min"
],

function ($, _, Handlebars, Utils, lazyload) {

    return {
    // Create a custom object
    module: function (additionalProps) {
      return _.extend({ ViewModels: {} }, additionalProps);
    },
    app: {}
  };
});
