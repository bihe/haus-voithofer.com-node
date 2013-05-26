// This is the main application configuration file.  It is a Grunt
// configuration file, which you can learn more about here:
// https://github.com/cowboy/grunt/blob/master/docs/configuring.md
//
module.exports = function(grunt) {

  grunt.initConfig({

    // The clean task ensures all files are removed from the dist/ directory so
    // that no files linger from previous builds.
    clean: ["dist/"],

    // compile handlebars templates using grunt-contrib-handlebars
		handlebars: {
			compile: {
				options: {
					namespace: 'Handlebars.templates',
					wrapped: true
				},
				files: {
					"dist/debug/templates.js": "app/templates/*.handlebars"
				}
			}
		},

    // The concatenate task is used here to merge the almond require/define
    // shim and the templates into the application code.  It's named
    // dist/debug/require.js, because we want to only load one script file in
    // index.html.
    concat: {
				"dist/debug/require.js": [
				"app/libs/require.js",
				"dist/debug/require.js",
        "dist/debug/templates.js"
      ]
    },

    // This task uses the MinCSS Node.js project to take all your CSS files in
    // order and concatenate them into a single CSS file named index.css.  It
    // also minifies all the CSS as well.  This is named index.css, because we
    // only want to load one stylesheet in index.html.
    cssmin: {
      combine: {
        files: {
          'dist/stylesheets/index.css': [
            'assets/stylesheets/bootstrap.min.css',
            'assets/stylesheets/bootstrap.responsive.min.css',
            'assets/stylesheets/bootstrap.overwrite.css',
            'assets/stylesheets/styles.css'
            ]
        }
      },
      minify: {
        expand: true,
        cwd: 'dist/stylesheets/',
        src: ['index.css'],
        dest: 'dist/stylesheets/',
        ext: '.min.css'
      }

    },

    uglify: {
      options: {
        banner: '',
        mangle: false
      },
      build: {
        src: 'dist/debug/require.js',
        dest: 'dist/release/require.js'
      }
    },

    requirejs: {
			compile: {
				options: {
          name: 'config',
					baseUrl: './app',
					mainConfigFile: 'app/config.js',
					out: "dist/debug/require.js"
				}
			}
		},

    copy: {
      main: {
        files: [
          {expand: true, flatten: true, src: ['dist/debug/require.js'], dest: 'assets/js/', filter: 'isFile'},
          {expand: true, flatten: true, src: ['dist/stylesheets/index.min.css'], dest: 'assets/stylesheets/', filter: 'isFile'}
        ]
      }
    }

  });

	grunt.loadNpmTasks('grunt-contrib-requirejs');
  grunt.loadNpmTasks('grunt-contrib-handlebars');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-cssmin');
  grunt.loadNpmTasks('grunt-contrib-copy');


  // The default task will remove all contents inside the dist/ folder, lint
  // all your code, precompile all the underscore templates into
  // dist/debug/templates.js, compile all the application code into
  // dist/debug/require.js, and then concatenate the require/define shim
  // almond.js and dist/debug/templates.js into the require.js file.
  grunt.registerTask("default", ['clean', 'handlebars', 'requirejs', 'concat']);

  // The debug task is simply an alias to default to remain consistent with
  // debug/release.
  grunt.registerTask("debug", ['default']);

  grunt.registerTask("min", ['uglify']);

  // The release task will run the debug tasks and then minify the
  // dist/debug/require.js file and CSS files.
  grunt.registerTask("release", ['default', 'min', 'cssmin', 'copy']);

};
