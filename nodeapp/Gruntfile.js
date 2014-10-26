'use strict';

module.exports = function (grunt) {
  require('load-grunt-tasks')(grunt);
  require('time-grunt')(grunt);

  grunt.initConfig({
    base: {
      // configurable paths
      app: require('./bower.json').appPath || 'public',
      dist: 'public/dist'
    },
    autoprefixer: {
      options: ['last 1 version'],
      dist: {
        files: [{
          expand: true,
          cwd: '.tmp/styles/',
          src: '{,*/}*.css',
          dest: '.tmp/styles/'
        }]
      }
    },
    clean: {
      dist: {
        files: [{
          dot: true,
          src: [
            '.tmp',
            '<%= base.dist %>/*',
            '!<%= base.dist %>/.git*'
          ]
        }]
      },
      server: '.tmp'
    },
    // not used since Uglify task does concat,
    // but still available if needed
    /*concat: {
      dist: {}
    },*/
    rev: {
      dist: {
        files: {
          src: [
            '<%= base.dist %>/scripts/{,*/}*.js',
            '<%= base.dist %>/styles/{,*/}*.css',
            '<%= base.dist %>/images/{,*/}*.{png,jpg,jpeg,gif,webp,svg}',
            '<%= base.dist %>/fonts/*'
          ]
        }
      }
    },
    useminPrepare: {
      html: 'public/index.html',
      options: {
        dest: '<%= base.dist %>'
      }
    },
    usemin: {
      html: ['<%= base.dist %>/{,*/}*.html'],
      css: ['<%= base.dist %>/styles/{,*/}*.css'],
      options: {
        dirs: ['<%= base.dist %>']
      }
    },
    imagemin: {
      dist: {
        files: [{
          expand: true,
          cwd: 'public/images',
          src: '{,*/}*.{png,jpg,jpeg}',
          dest: '<%= base.dist %>/images'
        }]
      }
    },
    svgmin: {
      dist: {
        files: [{
          expand: true,
          cwd: 'public/images',
          src: '{,*/}*.svg',
          dest: '<%= base.dist %>/images'
        }]
      }
    },
    cssmin: {
      // By default, your `index.html` <!-- Usemin Block --> will take care of
      // minification. This option is pre-configured if you do not wish to use
      // Usemin blocks.
      // dist: {
      //   files: {
      //     '<%= base.dist %>/styles/main.css': [
      //       'bootstrap.css',
      //       'flags-sprite.css',
      //       'datepicker.css',
      //       'font-awesome.min.css',
      //       '.tmp/styles/{,*/}*.css',
      //       'styles/{,*/}*.css'
      //     ]
      //   }
      // }
    },
    htmlmin: {
      dist: {
        options: {
          /*removeCommentsFromCDATA: true,
          // https://github.com/base/grunt-usemin/issues/44
          //collapseWhitespace: true,
          collapseBooleanAttributes: true,
          removeAttributeQuotes: true,
          removeRedundantAttributes: true,
          useShortDoctype: true,
          removeEmptyAttributes: true,
          removeOptionalTags: true*/
        },
        files: [{
          expand: true,
          cwd: 'public',
          src: ['*.html', 'views/*.html'],
          dest: '<%= base.dist %>'
        }]
      }
    },
    // Put files not handled in other tasks here
    copy: {
      dist: {
        files: [{
          expand: true,
          dot: true,
          cwd: 'public',
          dest: '<%= base.dist %>',
          src: [
            '*.{ico,png,txt}',
            '.htaccess',
            'images/{,*/}*.{gif,webp}',
            'fonts/*'
          ]
        }, {
          expand: true,
          cwd: '.tmp/images',
          dest: '<%= base.dist %>/images',
          src: [
            'generated/*'
          ]
        }]
      },
      styles: {
        files: [
          {
            expand: true,
            cwd: 'public/styles',
            dest: '.tmp/styles/',
            src: '{,*/}*.css'
          },
          {
            expand: true,
            cwd: 'public/bower_components/bootstrap/dist/css',
            dest: '.tmp/bower_components/bootstrap/dist/css',
            src: 'bootstrap.css'
          },
          {
            expand: true,
            cwd: 'public/bower_components/font-awesome/css',
            dest: '.tmp/bower_components/font-awesome/css',
            src: 'font-awesome.min.css'
          }
        ]
      },
      fonts: {
        files: [
          {
            expand: true,
            cwd: 'public/bower_components/bootstrap/dist/fonts/',
            dest: '<%= base.dist %>/fonts',
            src: '{,*/}*.*'
          },
          {
            expand: true,
            cwd: 'public/bower_components/font-awesome/fonts/',
            dest: '<%= base.dist %>/fonts',
            src: '{,*/}*.*'
          }
        ]
      },
      images4styles: {
        files: [
          {
            expand: true,
            cwd: 'public/bower_components/famfamfam-flags-sprite/src',
            dest: '<%= base.dist %>/styles',
            src: '{,*/}*.png'
          },
        ]
      }
    },
    concurrent: {
      server: [
        'copy:styles'
      ],
      test: [
        'copy:styles'
      ],
      dist: [
        'copy:styles',
        'svgmin',
        'imagemin',
        'htmlmin',
        'copy:fonts',
        'copy:images4styles'
      ]
    },
    ngAnnotate: {
      dist: {
        files: [{
          expand: true,
          cwd: '.tmp/concat/scripts',
          src: '*.js',
          dest: '.tmp/concat/scripts'
        }]
      }
    },
    uglify: {
      dist: {
        files: {
          '<%= base.dist %>/scripts/scripts.js': [
            '<%= base.dist %>/scripts/scripts.js'
          ]
        }
      }
    }
  });

  grunt.registerTask('build', [
    'clean:dist',
    'useminPrepare',
    'concurrent:dist',
    'autoprefixer',
    'concat',
    'copy:dist',
    'ngAnnotate',
    'cssmin',
    'uglify',
    'rev',
    'usemin'
  ]);

  grunt.registerTask('default', [
    'build'
  ]);
};
