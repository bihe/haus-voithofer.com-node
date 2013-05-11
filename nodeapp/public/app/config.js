// Set the require.js configuration for your application.
require.config({
  // Initialize the application with the main application file
  deps: ["main"],

  paths: {
    // JavaScript folders
    libs: "./libs",
    plugins: "./plugins",

    // Libraries
    jquery: "./libs/jquery.min",
    underscore: "./libs/underscore-min",
		Handlebars: "./libs/handlebars-1.0.rc.1.min",
    utils: "./libs/utils",
    lazyload: "./libs/lazyload.min",
    spin: "./libs/spin.min"
  },

  shim: {

    Handlebars: {
      exports: "Handlebars"
    },

    underscore:{
      exports: '_'
    },

    // my own util methods
    utils: {
      exports: "Utils",
      deps: ["jquery"]
    },

    HandlebarsTemplates: {
      exports: "HandlebarsTemplates",
      deps: ["Handlebars"]
    },

    lazyload: {
      exports: "lazyload"
    },

    spin: {
      exports: "spin"
    },

    // bootstrap plugin
    "plugins/bootstrap": {
      deps: ["jquery"]
    },

    // Handlebars plugin
    "plugins/handlebars.template": {
      deps: ["Handlebars"]
    },

    // heise social privacy
    "plugins/jquery.socialshareprivacy.min": {
      deps: ["jquery"]
    },

    // spin.js jquery plugin
    "plugins/jquery.spin":{
      deps: ["jquery"]
    }
  }
});
