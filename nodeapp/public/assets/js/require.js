/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.0.1 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
/*jslint regexp: true, nomen: true */
/*global window, navigator, document, importScripts, jQuery, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    'use strict';

    var version = '2.0.1',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        ostring = Object.prototype.toString,
        ap = Array.prototype,
        aps = ap.slice,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && navigator && document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false,
        req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return obj.hasOwnProperty(prop);
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     * This is not robust in IE for transferring methods that match
     * Object.prototype names, but the uses of mixin here seem unlikely to
     * trigger a problem related to that.
     */
    function mixin(target, source, force) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    target[prop] = value;
                }
            });
        }
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    function makeContextModuleFunc(func, relMap, enableBuildCallback) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0), lastArg;
            if (enableBuildCallback &&
                isFunction((lastArg = args[args.length - 1]))) {
                lastArg.__requireJsBuild = true;
            }
            args.push(relMap);
            return func.apply(null, args);
        };
    }

    function addRequireMethods(req, context, relMap) {
        each([
            ['toUrl'],
            ['undef'],
            ['defined', 'requireDefined'],
            ['specified', 'requireSpecified']
        ], function (item) {
            req[item[0]] = makeContextModuleFunc(context[item[1] || item[0]], relMap);
        });
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var config = {
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {}
            },
            registry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlMap = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1,
            //Used to track the order in which modules
            //should be executed, by the order they
            //load. Important for consistent cycle resolution
            //behavior.
            waitAry = [],
            inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i+= 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var baseParts = baseName && baseName.split('/'),
                map = config.map,
                starMap = map && map['*'],
                pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap;

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (config.pkgs[baseName]) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        baseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = baseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = config.pkgs[(pkgName = name[0])];
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && (baseParts || starMap) && map) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = map[baseParts.slice(0, j).join('/')];

                            //baseName segment has  config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = mapValue[nameSegment];
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    break;
                                }
                            }
                        }
                    }

                    if (!foundMap && starMap && starMap[nameSegment]) {
                        foundMap = starMap[nameSegment];
                    }

                    if (foundMap) {
                        nameParts.splice(0, i, foundMap);
                        name = nameParts.join('/');
                        break;
                    }
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                        scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = config.paths[id];
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                removeScript(id);
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.undef(id);
                context.require([id]);
                return true;
            }
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var index = name ? name.indexOf('!') : -1,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '',
                url, pluginModule, suffix;

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            if (index !== -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = defined[prefix];
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    url = urlMap[normalizedName];
                    if (!url) {
                        //Calculate url for the module, if it has a name.
                        //Use name here since nameToUrl also calls normalize,
                        //and for relative names that are outside the baseUrl
                        //this causes havoc. Was thinking of just removing
                        //parentModuleMap to avoid extra normalization, but
                        //normalize() still does a dot removal because of
                        //issue #142, so just pass in name here and redo
                        //the normalization. Paths outside baseUrl are just
                        //messy to support.
                        url = context.nameToUrl(name, null, parentModuleMap);

                        //Store the URL mapping for later.
                        urlMap[normalizedName] = url;
                    }
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                    prefix + '!' + normalizedName :
                    normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = registry[id];

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = registry[id];

            if (hasProp(defined, id) &&
                (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                getModule(depMap).on(name, fn);
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = registry[id];
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        /**
         * Helper function that creates a require function object to give to
         * modules that ask for it as a dependency. It needs to be specific
         * per module because of the implication of path mappings that may
         * need to be relative to the module name.
         */
        function makeRequire(mod, enableBuildCallback, altRequire) {
            var relMap = mod && mod.map,
                modRequire = makeContextModuleFunc(altRequire || context.require,
                                                   relMap,
                                                   enableBuildCallback);

            addRequireMethods(modRequire, context, relMap);
            modRequire.isBrowser = isBrowser;

            return modRequire;
        }

        handlers = {
            'require': function (mod) {
                return makeRequire(mod);
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    return (mod.exports = defined[mod.map.id] = {});
                }
            },
            'module': function (mod) {
                return (mod.module = {
                    id: mod.map.id,
                    uri: mod.map.url,
                    config: function () {
                        return (config.config && config.config[mod.map.id]) || {};
                    },
                    exports: defined[mod.map.id]
                });
            }
        };

        function removeWaiting(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];

            each(waitAry, function (mod, i) {
                if (mod.map.id === id) {
                    waitAry.splice(i, 1);
                    if (!mod.defined) {
                        context.waitCount -= 1;
                    }
                    return true;
                }
            });
        }

        function findCycle(mod, traced) {
            var id = mod.map.id,
                depArray = mod.depMaps,
                foundModule;

            //Do not bother with unitialized modules or not yet enabled
            //modules.
            if (!mod.inited) {
                return;
            }

            //Found the cycle.
            if (traced[id]) {
                return mod;
            }

            traced[id] = true;

            //Trace through the dependencies.
            each(depArray, function (depMap) {
                var depId = depMap.id,
                    depMod = registry[depId];

                if (!depMod) {
                    return;
                }

                if (!depMod.inited || !depMod.enabled) {
                    //Dependency is not inited, so this cannot
                    //be used to determine a cycle.
                    foundModule = null;
                    delete traced[id];
                    return true;
                }

                return (foundModule = findCycle(depMod, traced));
            });

            return foundModule;
        }

        function forceExec(mod, traced, uninited) {
            var id = mod.map.id,
                depArray = mod.depMaps;

            if (!mod.inited || !mod.map.isDefine) {
                return;
            }

            if (traced[id]) {
                return defined[id];
            }

            traced[id] = mod;

            each(depArray, function(depMap) {
                var depId = depMap.id,
                    depMod = registry[depId],
                    value;

                if (handlers[depId]) {
                    return;
                }

                if (depMod) {
                    if (!depMod.inited || !depMod.enabled) {
                        //Dependency is not inited,
                        //so this module cannot be
                        //given a forced value yet.
                        uninited[id] = true;
                        return;
                    }

                    //Get the value for the current dependency
                    value = forceExec(depMod, traced, uninited);

                    //Even with forcing it may not be done,
                    //in particular if the module is waiting
                    //on a plugin resource.
                    if (!uninited[depId]) {
                        mod.defineDepById(depId, value);
                    }
                }
            });

            mod.check(true);

            return defined[id];
        }

        function modCheck(mod) {
            mod.check();
        }

        function checkLoaded() {
            var waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                stillLoading = false,
                needCycleCheck = true,
                map, modId, err, usingPathFallback;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(registry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {

                each(waitAry, function (mod) {
                    if (mod.defined) {
                        return;
                    }

                    var cycleMod = findCycle(mod, {}),
                        traced = {};

                    if (cycleMod) {
                        forceExec(cycleMod, traced, {});

                        //traced modules may have been
                        //removed from the registry, but
                        //their listeners still need to
                        //be called.
                        eachProp(traced, modCheck);
                    }
                });

                //Now that dependencies have
                //been satisfied, trigger the
                //completion check that then
                //notifies listeners.
                eachProp(registry, modCheck);
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = undefEvents[map.id] || {};
            this.map = map;
            this.shim = config.shim[map.id];
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function(depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                each(depMaps, bind(this, function (depMap, i) {
                    if (typeof depMap === 'string') {
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               true);
                        this.depMaps.push(depMap);
                    }

                    var handler = handlers[depMap.id];

                    if (handler) {
                        this.depExports[i] = handler(this);
                        return;
                    }

                    this.depCount += 1;

                    on(depMap, 'defined', bind(this, function (depExports) {
                        this.defineDep(i, depExports);
                        this.check();
                    }));

                    if (errback) {
                        on(depMap, 'error', errback);
                    }
                }));

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDepById: function (id, depExports) {
                var i;

                //Find the index for this dependency.
                each(this.depMaps, function (map, index) {
                    if (map.id === id) {
                        i = index;
                        return true;
                    }
                });

                return this.defineDep(i, depExports);
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (map.prefix) {
                    this.callPlugin();
                } else if (this.shim) {
                    makeRequire(this, true)(this.shim.deps || [], bind(this, function () {
                        this.load();
                    }));
                } else {
                    //Regular dependency.
                    this.load();
                }
            },

            load: function() {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks is the module is ready to define itself, and if so,
             * define it. If the silent argument is true, then it will just
             * define, but not notify listeners, and not ask for a context-wide
             * check of all loaded modules. That is useful for cycle breaking.
             */
            check: function (silent) {
                if (!this.enabled) {
                    return;
                }

                var id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory,
                    err, cjsModule;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error.
                            if (this.events.error) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                    cjsModule.exports !== undefined &&
                                    //Make sure it is not already the exports value
                                    cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = [this.map.id];
                                err.requireType = 'define';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        delete registry[id];

                        this.defined = true;
                        context.waitCount -= 1;
                        if (context.waitCount === 0) {
                            //Clear the wait array used for cycles.
                            waitAry = [];
                        }
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (!silent) {
                        if (this.defined && !this.defineEmitted) {
                            this.defineEmitted = true;
                            this.emit('defined', this.exports);
                            this.defineEmitComplete = true;
                        }
                    }
                }
            },

            callPlugin: function() {
                var map = this.map,
                    id = map.id,
                    pluginMap = makeModuleMap(map.prefix, null, false, true);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        load, normalizedMap, normalizedMod;

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        normalizedMap = makeModuleMap(map.prefix + '!' + name);
                        on(normalizedMap,
                           'defined', bind(this, function (value) {
                            this.init([], function () { return value; }, null, {
                                enabled: true,
                                ignore: true
                            });
                        }));
                        normalizedMod = registry[normalizedMap.id];
                        if (normalizedMod) {
                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                removeWaiting(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = function (moduleName, text) {
                        /*jslint evil: true */
                        var hasInteractive = useInteractive;

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        req.exec(text);

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Support anonymous modules.
                        context.completeLoad(moduleName);
                    };

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, makeRequire(map.parentMap, true, function (deps, cb) {
                        return context.require(deps, cb);
                    }), load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                this.enabled = true;

                if (!this.waitPushed) {
                    waitAry.push(this);
                    context.waitCount += 1;
                    this.waitPushed = true;
                }

                //Enable each dependency
                each(this.depMaps, bind(this, function (map) {
                    var id = map.id,
                        mod = registry[id];
                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!handlers[id] && mod && !mod.enabled) {
                        context.enable(map, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = registry[pluginMap.id];
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.check();
            },

            on: function(name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry/waitAry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        return (context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlMap: urlMap,
            urlFetched: urlFetched,
            waitCount: 0,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var paths = config.paths,
                    pkgs = config.pkgs,
                    shim = config.shim,
                    map = config.map || {};

                //Mix in the config values, favoring the new values over
                //existing ones in context.config.
                mixin(config, cfg, true);

                //Merge paths.
                mixin(paths, cfg.paths, true);
                config.paths = paths;

                //Merge map
                if (cfg.map) {
                    mixin(map, cfg.map, true);
                    config.map = map;
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if (value.exports && !value.exports.__buildReady) {
                            value.exports = context.makeShimExports(value.exports);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (exports) {
                var func;
                if (typeof exports === 'string') {
                    func = function () {
                        return getGlobal(exports);
                    };
                    //Save the exports for use in nodefine checking.
                    func.exports = exports;
                    return func;
                } else {
                    return function () {
                        return exports.apply(global, arguments);
                    };
                }
            },

            requireDefined: function (id, relMap) {
                return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
            },

            requireSpecified: function (id, relMap) {
                id = makeModuleMap(id, relMap, false, true).id;
                return hasProp(defined, id) || hasProp(registry, id);
            },

            require: function (deps, callback, errback, relMap) {
                var moduleName, id, map, requireMod, args;
                if (typeof deps === 'string') {
                    if (isFunction(callback)) {
                        //Invalid call
                        return onError(makeError('requireargs', 'Invalid require call'), errback);
                    }

                    //Synchronous access to one module. If require.get is
                    //available (as in the Node adapter), prefer that.
                    //In this case deps is the moduleName and callback is
                    //the relMap
                    if (req.get) {
                        return req.get(context, deps, callback);
                    }

                    //Just return the module wanted. In this scenario, the
                    //second arg (if passed) is just the relMap.
                    moduleName = deps;
                    relMap = callback;

                    //Normalize module name, if it contains . or ..
                    map = makeModuleMap(moduleName, relMap, false, true);
                    id = map.id;

                    if (!hasProp(defined, id)) {
                        return onError(makeError('notloaded', 'Module name "' +
                                    id +
                                    '" has not been loaded yet for context: ' +
                                    contextName));
                    }
                    return defined[id];
                }

                //Callback require. Normalize args. if callback or errback is
                //not a function, it means it is a relMap. Test errback first.
                if (errback && !isFunction(errback)) {
                    relMap = errback;
                    errback = undefined;
                }
                if (callback && !isFunction(callback)) {
                    relMap = callback;
                    callback = undefined;
                }

                //Any defined modules in the global queue, intake them now.
                takeGlobalQueue();

                //Make sure any remaining defQueue items get properly processed.
                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                    } else {
                        //args are id, deps, factory. Should be normalized by the
                        //define() function.
                        callGetModule(args);
                    }
                }

                //Mark all the dependencies as needing to be loaded.
                requireMod = getModule(makeModuleMap(null, relMap));

                requireMod.init(deps, callback, errback, {
                    enabled: true
                });

                checkLoaded();

                return context.require;
            },

            undef: function (id) {
                var map = makeModuleMap(id, null, true),
                    mod = registry[id];

                delete defined[id];
                delete urlMap[id];
                delete urlFetched[map.url];
                delete undefEvents[id];

                if (mod) {
                    //Hold on to listeners in case the
                    //module will be attempted to be reloaded
                    //using a different config.
                    if (mod.events.defined) {
                        undefEvents[id] = mod.events;
                    }

                    removeWaiting(id);
                }
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. parent module is passed in for context,
             * used by the optimizer.
             */
            enable: function (depMap, parent) {
                var mod = registry[depMap.id];
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var shim = config.shim[moduleName] || {},
                shExports = shim.exports && shim.exports.exports,
                found, args, mod;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = registry[moduleName];

                if (!found &&
                    !defined[moduleName] &&
                    mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exports]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name + .extension into an URL path.
             * *Requires* the use of a module name. It does not support using
             * plain URLs like nameToUrl.
             */
            toUrl: function (moduleNamePlusExt, relModuleMap) {
                var index = moduleNamePlusExt.lastIndexOf('.'),
                    ext = null;

                if (index !== -1) {
                    ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                    moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                }

                return context.nameToUrl(moduleNamePlusExt, ext, relModuleMap);
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             */
            nameToUrl: function (moduleName, ext, relModuleMap) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //Normalize module name if have a base relative module name to work from.
                moduleName = normalize(moduleName, relModuleMap && relModuleMap.id, true);

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = pkgs[parentModule];
                        parentPath = paths[parentModule];
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/') + (ext || '.js');
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callack function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                    (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error', evt, [data.id]));
                }
            }
        });
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var contextName = defContextName,
            context, config;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = contexts[contextName];
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require, using
    //default context if no context specified.
    addRequireMethods(req, contexts[defContextName]);

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = function (err) {
        throw err;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = config.xhtml ?
                   document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                   document.createElement('script');
            node.type = config.scriptType || 'text/javascript';
            node.charset = 'utf-8';

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                //Check if node.attachEvent is artificially added by custom script or
                //natively supported by browser
                //read https://github.com/jrburke/requirejs/issues/187
                //if we can NOT find [native code] then it must NOT natively supported.
                //in IE8, node.attachEvent does not have toString()
                //Note the test for "[native code" with no closing brace, see:
                //https://github.com/jrburke/requirejs/issues/273
                !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEvenListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            //In a web worker, use importScripts. This is not a very
            //efficient use of importScripts, importScripts will block until
            //its script is downloaded and evaluated. However, if web workers
            //are in play, the expectation that a build has been done so that
            //only one script needs to be loaded anyway. This may need to be
            //reevaluated if other use cases become common.
            importScripts(url);

            //Account for anonymous modules
            context.completeLoad(moduleName);
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = dataMain.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    //Set final config.
                    cfg.baseUrl = subPath;
                    //Strip off any trailing .js since dataMain is now
                    //like a module name.
                    dataMain = mainScript.replace(jsSuffixRegExp, '');
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(dataMain) : [dataMain];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous functions
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = [];
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps.length && isFunction(callback)) {
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

/*! jQuery v1.8.3 jquery.com | jquery.org/license */

// Underscore.js 1.3.3
// (c) 2009-2012 Jeremy Ashkenas, DocumentCloud Inc.
// Underscore is freely distributable under the MIT license.
// Portions of Underscore are inspired or borrowed from Prototype,
// Oliver Steele's Functional, and John Resig's Micro-Templating.
// For all details and documentation:
// http://documentcloud.github.com/underscore

/* ===================================================
 * bootstrap-transition.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#transitions
 * ===================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================== */

/* ==========================================================
 * bootstrap-alert.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#alerts
 * ==========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================== */

/* ============================================================
 * bootstrap-button.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#buttons
 * ============================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ============================================================ */

/* ==========================================================
 * bootstrap-carousel.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#carousel
 * ==========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================== */

/* =============================================================
 * bootstrap-collapse.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#collapse
 * =============================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ============================================================ */

/* ============================================================
 * bootstrap-dropdown.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#dropdowns
 * ============================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ============================================================ */

/* =========================================================
 * bootstrap-modal.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#modals
 * =========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================= */

/* ===========================================================
 * bootstrap-tooltip.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#tooltips
 * Inspired by the original jQuery.tipsy by Jason Frame
 * ===========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================== */

/* ===========================================================
 * bootstrap-popover.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#popovers
 * ===========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =========================================================== */

/* =============================================================
 * bootstrap-scrollspy.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#scrollspy
 * =============================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ============================================================== */

/* ========================================================
 * bootstrap-tab.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#tabs
 * ========================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================== */

/* =============================================================
 * bootstrap-typeahead.js v2.2.2
 * http://twitter.github.com/bootstrap/javascript.html#typeahead
 * =============================================================
 * Copyright 2012 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ============================================================ */

/*
 * jquery.socialshareprivacy.js | 2 Klicks fuer mehr Datenschutz
 *
 * http://www.heise.de/extras/socialshareprivacy/
 * http://www.heise.de/ct/artikel/2-Klicks-fuer-mehr-Datenschutz-1333879.html
 *
 * Copyright (c) 2011 Hilko Holweg, Sebastian Hilbig, Nicolas Heiringhoff, Juergen Schmidt,
 * Heise Zeitschriften Verlag GmbH & Co. KG, http://www.heise.de
 *
 * is released under the MIT License http://www.opensource.org/licenses/mit-license.php
 *
 * Spread the word, link to us if you can.
 */

(function(e,t){function n(e){var t=dt[e]={};return Y.each(e.split(tt),function(e,n){t[n]=!0}),t}function r(e,n,r){if(r===t&&e.nodeType===1){var i="data-"+n.replace(mt,"-$1").toLowerCase();r=e.getAttribute(i);if(typeof r=="string"){try{r=r==="true"?!0:r==="false"?!1:r==="null"?null:+r+""===r?+r:vt.test(r)?Y.parseJSON(r):r}catch(s){}Y.data(e,n,r)}else r=t}return r}function i(e){var t;for(t in e){if(t==="data"&&Y.isEmptyObject(e[t]))continue;if(t!=="toJSON")return!1}return!0}function s(){return!1}function o(){return!0}function u(e){return!e||!e.parentNode||e.parentNode.nodeType===11}function a(e,t){do e=e[t];while(e&&e.nodeType!==1);return e}function f(e,t,n){t=t||0;if(Y.isFunction(t))return Y.grep(e,function(e,r){var i=!!t.call(e,r,e);return i===n});if(t.nodeType)return Y.grep(e,function(e,r){return e===t===n});if(typeof t=="string"){var r=Y.grep(e,function(e){return e.nodeType===1});if(Bt.test(t))return Y.filter(t,r,!n);t=Y.filter(t,r)}return Y.grep(e,function(e,r){return Y.inArray(e,t)>=0===n})}function l(e){var t=It.split("|"),n=e.createDocumentFragment();if(n.createElement)while(t.length)n.createElement(t.pop());return n}function c(e,t){return e.getElementsByTagName(t)[0]||e.appendChild(e.ownerDocument.createElement(t))}function h(e,t){if(t.nodeType!==1||!Y.hasData(e))return;var n,r,i,s=Y._data(e),o=Y._data(t,s),u=s.events;if(u){delete o.handle,o.events={};for(n in u)for(r=0,i=u[n].length;r<i;r++)Y.event.add(t,n,u[n][r])}o.data&&(o.data=Y.extend({},o.data))}function p(e,t){var n;if(t.nodeType!==1)return;t.clearAttributes&&t.clearAttributes(),t.mergeAttributes&&t.mergeAttributes(e),n=t.nodeName.toLowerCase(),n==="object"?(t.parentNode&&(t.outerHTML=e.outerHTML),Y.support.html5Clone&&e.innerHTML&&!Y.trim(t.innerHTML)&&(t.innerHTML=e.innerHTML)):n==="input"&&Kt.test(e.type)?(t.defaultChecked=t.checked=e.checked,t.value!==e.value&&(t.value=e.value)):n==="option"?t.selected=e.defaultSelected:n==="input"||n==="textarea"?t.defaultValue=e.defaultValue:n==="script"&&t.text!==e.text&&(t.text=e.text),t.removeAttribute(Y.expando)}function d(e){return typeof e.getElementsByTagName!="undefined"?e.getElementsByTagName("*"):typeof e.querySelectorAll!="undefined"?e.querySelectorAll("*"):[]}function v(e){Kt.test(e.type)&&(e.defaultChecked=e.checked)}function m(e,t){if(t in e)return t;var n=t.charAt(0).toUpperCase()+t.slice(1),r=t,i=yn.length;while(i--){t=yn[i]+n;if(t in e)return t}return r}function g(e,t){return e=t||e,Y.css(e,"display")==="none"||!Y.contains(e.ownerDocument,e)}function y(e,t){var n,r,i=[],s=0,o=e.length;for(;s<o;s++){n=e[s];if(!n.style)continue;i[s]=Y._data(n,"olddisplay"),t?(!i[s]&&n.style.display==="none"&&(n.style.display=""),n.style.display===""&&g(n)&&(i[s]=Y._data(n,"olddisplay",S(n.nodeName)))):(r=nn(n,"display"),!i[s]&&r!=="none"&&Y._data(n,"olddisplay",r))}for(s=0;s<o;s++){n=e[s];if(!n.style)continue;if(!t||n.style.display==="none"||n.style.display==="")n.style.display=t?i[s]||"":"none"}return e}function b(e,t,n){var r=cn.exec(t);return r?Math.max(0,r[1]-(n||0))+(r[2]||"px"):t}function w(e,t,n,r){var i=n===(r?"border":"content")?4:t==="width"?1:0,s=0;for(;i<4;i+=2)n==="margin"&&(s+=Y.css(e,n+gn[i],!0)),r?(n==="content"&&(s-=parseFloat(nn(e,"padding"+gn[i]))||0),n!=="margin"&&(s-=parseFloat(nn(e,"border"+gn[i]+"Width"))||0)):(s+=parseFloat(nn(e,"padding"+gn[i]))||0,n!=="padding"&&(s+=parseFloat(nn(e,"border"+gn[i]+"Width"))||0));return s}function E(e,t,n){var r=t==="width"?e.offsetWidth:e.offsetHeight,i=!0,s=Y.support.boxSizing&&Y.css(e,"boxSizing")==="border-box";if(r<=0||r==null){r=nn(e,t);if(r<0||r==null)r=e.style[t];if(hn.test(r))return r;i=s&&(Y.support.boxSizingReliable||r===e.style[t]),r=parseFloat(r)||0}return r+w(e,t,n||(s?"border":"content"),i)+"px"}function S(e){if(dn[e])return dn[e];var t=Y("<"+e+">").appendTo(R.body),n=t.css("display");t.remove();if(n==="none"||n===""){rn=R.body.appendChild(rn||Y.extend(R.createElement("iframe"),{frameBorder:0,width:0,height:0}));if(!sn||!rn.createElement)sn=(rn.contentWindow||rn.contentDocument).document,sn.write("<!doctype html><html><body>"),sn.close();t=sn.body.appendChild(sn.createElement(e)),n=nn(t,"display"),R.body.removeChild(rn)}return dn[e]=n,n}function x(e,t,n,r){var i;if(Y.isArray(t))Y.each(t,function(t,i){n||En.test(e)?r(e,i):x(e+"["+(typeof i=="object"?t:"")+"]",i,n,r)});else if(!n&&Y.type(t)==="object")for(i in t)x(e+"["+i+"]",t[i],n,r);else r(e,t)}function T(e){return function(t,n){typeof t!="string"&&(n=t,t="*");var r,i,s,o=t.toLowerCase().split(tt),u=0,a=o.length;if(Y.isFunction(n))for(;u<a;u++)r=o[u],s=/^\+/.test(r),s&&(r=r.substr(1)||"*"),i=e[r]=e[r]||[],i[s?"unshift":"push"](n)}}function N(e,n,r,i,s,o){s=s||n.dataTypes[0],o=o||{},o[s]=!0;var u,a=e[s],f=0,l=a?a.length:0,c=e===jn;for(;f<l&&(c||!u);f++)u=a[f](n,r,i),typeof u=="string"&&(!c||o[u]?u=t:(n.dataTypes.unshift(u),u=N(e,n,r,i,u,o)));return(c||!u)&&!o["*"]&&(u=N(e,n,r,i,"*",o)),u}function C(e,n){var r,i,s=Y.ajaxSettings.flatOptions||{};for(r in n)n[r]!==t&&((s[r]?e:i||(i={}))[r]=n[r]);i&&Y.extend(!0,e,i)}function k(e,n,r){var i,s,o,u,a=e.contents,f=e.dataTypes,l=e.responseFields;for(s in l)s in r&&(n[l[s]]=r[s]);while(f[0]==="*")f.shift(),i===t&&(i=e.mimeType||n.getResponseHeader("content-type"));if(i)for(s in a)if(a[s]&&a[s].test(i)){f.unshift(s);break}if(f[0]in r)o=f[0];else{for(s in r){if(!f[0]||e.converters[s+" "+f[0]]){o=s;break}u||(u=s)}o=o||u}if(o)return o!==f[0]&&f.unshift(o),r[o]}function L(e,t){var n,r,i,s,o=e.dataTypes.slice(),u=o[0],a={},f=0;e.dataFilter&&(t=e.dataFilter(t,e.dataType));if(o[1])for(n in e.converters)a[n.toLowerCase()]=e.converters[n];for(;i=o[++f];)if(i!=="*"){if(u!=="*"&&u!==i){n=a[u+" "+i]||a["* "+i];if(!n)for(r in a){s=r.split(" ");if(s[1]===i){n=a[u+" "+s[0]]||a["* "+s[0]];if(n){n===!0?n=a[r]:a[r]!==!0&&(i=s[0],o.splice(f--,0,i));break}}}if(n!==!0)if(n&&e["throws"])t=n(t);else try{t=n(t)}catch(l){return{state:"parsererror",error:n?l:"No conversion from "+u+" to "+i}}}u=i}return{state:"success",data:t}}function A(){try{return new e.XMLHttpRequest}catch(t){}}function O(){try{return new e.ActiveXObject("Microsoft.XMLHTTP")}catch(t){}}function M(){return setTimeout(function(){Jn=t},0),Jn=Y.now()}function _(e,t){Y.each(t,function(t,n){var r=(er[t]||[]).concat(er["*"]),i=0,s=r.length;for(;i<s;i++)if(r[i].call(e,t,n))return})}function D(e,t,n){var r,i=0,s=0,o=Zn.length,u=Y.Deferred().always(function(){delete a.elem}),a=function(){var t=Jn||M(),n=Math.max(0,f.startTime+f.duration-t),r=n/f.duration||0,i=1-r,s=0,o=f.tweens.length;for(;s<o;s++)f.tweens[s].run(i);return u.notifyWith(e,[f,i,n]),i<1&&o?n:(u.resolveWith(e,[f]),!1)},f=u.promise({elem:e,props:Y.extend({},t),opts:Y.extend(!0,{specialEasing:{}},n),originalProperties:t,originalOptions:n,startTime:Jn||M(),duration:n.duration,tweens:[],createTween:function(t,n,r){var i=Y.Tween(e,f.opts,t,n,f.opts.specialEasing[t]||f.opts.easing);return f.tweens.push(i),i},stop:function(t){var n=0,r=t?f.tweens.length:0;for(;n<r;n++)f.tweens[n].run(1);return t?u.resolveWith(e,[f,t]):u.rejectWith(e,[f,t]),this}}),l=f.props;P(l,f.opts.specialEasing);for(;i<o;i++){r=Zn[i].call(f,e,l,f.opts);if(r)return r}return _(f,l),Y.isFunction(f.opts.start)&&f.opts.start.call(e,f),Y.fx.timer(Y.extend(a,{anim:f,queue:f.opts.queue,elem:e})),f.progress(f.opts.progress).done(f.opts.done,f.opts.complete).fail(f.opts.fail).always(f.opts.always)}function P(e,t){var n,r,i,s,o;for(n in e){r=Y.camelCase(n),i=t[r],s=e[n],Y.isArray(s)&&(i=s[1],s=e[n]=s[0]),n!==r&&(e[r]=s,delete e[n]),o=Y.cssHooks[r];if(o&&"expand"in o){s=o.expand(s),delete e[r];for(n in s)n in e||(e[n]=s[n],t[n]=i)}else t[r]=i}}function H(e,t,n){var r,i,s,o,u,a,f,l,c,h=this,p=e.style,d={},v=[],m=e.nodeType&&g(e);n.queue||(l=Y._queueHooks(e,"fx"),l.unqueued==null&&(l.unqueued=0,c=l.empty.fire,l.empty.fire=function(){l.unqueued||c()}),l.unqueued++,h.always(function(){h.always(function(){l.unqueued--,Y.queue(e,"fx").length||l.empty.fire()})})),e.nodeType===1&&("height"in t||"width"in t)&&(n.overflow=[p.overflow,p.overflowX,p.overflowY],Y.css(e,"display")==="inline"&&Y.css(e,"float")==="none"&&(!Y.support.inlineBlockNeedsLayout||S(e.nodeName)==="inline"?p.display="inline-block":p.zoom=1)),n.overflow&&(p.overflow="hidden",Y.support.shrinkWrapBlocks||h.done(function(){p.overflow=n.overflow[0],p.overflowX=n.overflow[1],p.overflowY=n.overflow[2]}));for(r in t){s=t[r];if(Qn.exec(s)){delete t[r],a=a||s==="toggle";if(s===(m?"hide":"show"))continue;v.push(r)}}o=v.length;if(o){u=Y._data(e,"fxshow")||Y._data(e,"fxshow",{}),"hidden"in u&&(m=u.hidden),a&&(u.hidden=!m),m?Y(e).show():h.done(function(){Y(e).hide()}),h.done(function(){var t;Y.removeData(e,"fxshow",!0);for(t in d)Y.style(e,t,d[t])});for(r=0;r<o;r++)i=v[r],f=h.createTween(i,m?u[i]:0),d[i]=u[i]||Y.style(e,i),i in u||(u[i]=f.start,m&&(f.end=f.start,f.start=i==="width"||i==="height"?1:0))}}function B(e,t,n,r,i){return new B.prototype.init(e,t,n,r,i)}function j(e,t){var n,r={height:e},i=0;t=t?1:0;for(;i<4;i+=2-t)n=gn[i],r["margin"+n]=r["padding"+n]=e;return t&&(r.opacity=r.width=e),r}function F(e){return Y.isWindow(e)?e:e.nodeType===9?e.defaultView||e.parentWindow:!1}var I,q,R=e.document,U=e.location,z=e.navigator,W=e.jQuery,X=e.$,V=Array.prototype.push,$=Array.prototype.slice,J=Array.prototype.indexOf,K=Object.prototype.toString,Q=Object.prototype.hasOwnProperty,G=String.prototype.trim,Y=function(e,t){return new Y.fn.init(e,t,I)},Z=/[\-+]?(?:\d*\.|)\d+(?:[eE][\-+]?\d+|)/.source,et=/\S/,tt=/\s+/,nt=/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,rt=/^(?:[^#<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,it=/^<(\w+)\s*\/?>(?:<\/\1>|)$/,st=/^[\],:{}\s]*$/,ot=/(?:^|:|,)(?:\s*\[)+/g,ut=/\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,at=/"[^"\\\r\n]*"|true|false|null|-?(?:\d\d*\.|)\d+(?:[eE][\-+]?\d+|)/g,ft=/^-ms-/,lt=/-([\da-z])/gi,ct=function(e,t){return(t+"").toUpperCase()},ht=function(){R.addEventListener?(R.removeEventListener("DOMContentLoaded",ht,!1),Y.ready()):R.readyState==="complete"&&(R.detachEvent("onreadystatechange",ht),Y.ready())},pt={};Y.fn=Y.prototype={constructor:Y,init:function(e,n,r){var i,s,o,u;if(!e)return this;if(e.nodeType)return this.context=this[0]=e,this.length=1,this;if(typeof e=="string"){e.charAt(0)==="<"&&e.charAt(e.length-1)===">"&&e.length>=3?i=[null,e,null]:i=rt.exec(e);if(i&&(i[1]||!n)){if(i[1])return n=n instanceof Y?n[0]:n,u=n&&n.nodeType?n.ownerDocument||n:R,e=Y.parseHTML(i[1],u,!0),it.test(i[1])&&Y.isPlainObject(n)&&this.attr.call(e,n,!0),Y.merge(this,e);s=R.getElementById(i[2]);if(s&&s.parentNode){if(s.id!==i[2])return r.find(e);this.length=1,this[0]=s}return this.context=R,this.selector=e,this}return!n||n.jquery?(n||r).find(e):this.constructor(n).find(e)}return Y.isFunction(e)?r.ready(e):(e.selector!==t&&(this.selector=e.selector,this.context=e.context),Y.makeArray(e,this))},selector:"",jquery:"1.8.3",length:0,size:function(){return this.length},toArray:function(){return $.call(this)},get:function(e){return e==null?this.toArray():e<0?this[this.length+e]:this[e]},pushStack:function(e,t,n){var r=Y.merge(this.constructor(),e);return r.prevObject=this,r.context=this.context,t==="find"?r.selector=this.selector+(this.selector?" ":"")+n:t&&(r.selector=this.selector+"."+t+"("+n+")"),r},each:function(e,t){return Y.each(this,e,t)},ready:function(e){return Y.ready.promise().done(e),this},eq:function(e){return e=+e,e===-1?this.slice(e):this.slice(e,e+1)},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},slice:function(){return this.pushStack($.apply(this,arguments),"slice",$.call(arguments).join(","))},map:function(e){return this.pushStack(Y.map(this,function(t,n){return e.call(t,n,t)}))},end:function(){return this.prevObject||this.constructor(null)},push:V,sort:[].sort,splice:[].splice},Y.fn.init.prototype=Y.fn,Y.extend=Y.fn.extend=function(){var e,n,r,i,s,o,u=arguments[0]||{},a=1,f=arguments.length,l=!1;typeof u=="boolean"&&(l=u,u=arguments[1]||{},a=2),typeof u!="object"&&!Y.isFunction(u)&&(u={}),f===a&&(u=this,--a);for(;a<f;a++)if((e=arguments[a])!=null)for(n in e){r=u[n],i=e[n];if(u===i)continue;l&&i&&(Y.isPlainObject(i)||(s=Y.isArray(i)))?(s?(s=!1,o=r&&Y.isArray(r)?r:[]):o=r&&Y.isPlainObject(r)?r:{},u[n]=Y.extend(l,o,i)):i!==t&&(u[n]=i)}return u},Y.extend({noConflict:function(t){return e.$===Y&&(e.$=X),t&&e.jQuery===Y&&(e.jQuery=W),Y},isReady:!1,readyWait:1,holdReady:function(e){e?Y.readyWait++:Y.ready(!0)},ready:function(e){if(e===!0?--Y.readyWait:Y.isReady)return;if(!R.body)return setTimeout(Y.ready,1);Y.isReady=!0;if(e!==!0&&--Y.readyWait>0)return;q.resolveWith(R,[Y]),Y.fn.trigger&&Y(R).trigger("ready").off("ready")},isFunction:function(e){return Y.type(e)==="function"},isArray:Array.isArray||function(e){return Y.type(e)==="array"},isWindow:function(e){return e!=null&&e==e.window},isNumeric:function(e){return!isNaN(parseFloat(e))&&isFinite(e)},type:function(e){return e==null?String(e):pt[K.call(e)]||"object"},isPlainObject:function(e){if(!e||Y.type(e)!=="object"||e.nodeType||Y.isWindow(e))return!1;try{if(e.constructor&&!Q.call(e,"constructor")&&!Q.call(e.constructor.prototype,"isPrototypeOf"))return!1}catch(n){return!1}var r;for(r in e);return r===t||Q.call(e,r)},isEmptyObject:function(e){var t;for(t in e)return!1;return!0},error:function(e){throw new Error(e)},parseHTML:function(e,t,n){var r;return!e||typeof e!="string"?null:(typeof t=="boolean"&&(n=t,t=0),t=t||R,(r=it.exec(e))?[t.createElement(r[1])]:(r=Y.buildFragment([e],t,n?null:[]),Y.merge([],(r.cacheable?Y.clone(r.fragment):r.fragment).childNodes)))},parseJSON:function(t){if(!t||typeof t!="string")return null;t=Y.trim(t);if(e.JSON&&e.JSON.parse)return e.JSON.parse(t);if(st.test(t.replace(ut,"@").replace(at,"]").replace(ot,"")))return(new Function("return "+t))();Y.error("Invalid JSON: "+t)},parseXML:function(n){var r,i;if(!n||typeof n!="string")return null;try{e.DOMParser?(i=new DOMParser,r=i.parseFromString(n,"text/xml")):(r=new ActiveXObject("Microsoft.XMLDOM"),r.async="false",r.loadXML(n))}catch(s){r=t}return(!r||!r.documentElement||r.getElementsByTagName("parsererror").length)&&Y.error("Invalid XML: "+n),r},noop:function(){},globalEval:function(t){t&&et.test(t)&&(e.execScript||function(t){e.eval.call(e,t)})(t)},camelCase:function(e){return e.replace(ft,"ms-").replace(lt,ct)},nodeName:function(e,t){return e.nodeName&&e.nodeName.toLowerCase()===t.toLowerCase()},each:function(e,n,r){var i,s=0,o=e.length,u=o===t||Y.isFunction(e);if(r){if(u){for(i in e)if(n.apply(e[i],r)===!1)break}else for(;s<o;)if(n.apply(e[s++],r)===!1)break}else if(u){for(i in e)if(n.call(e[i],i,e[i])===!1)break}else for(;s<o;)if(n.call(e[s],s,e[s++])===!1)break;return e},trim:G&&!G.call("﻿ ")?function(e){return e==null?"":G.call(e)}:function(e){return e==null?"":(e+"").replace(nt,"")},makeArray:function(e,t){var n,r=t||[];return e!=null&&(n=Y.type(e),e.length==null||n==="string"||n==="function"||n==="regexp"||Y.isWindow(e)?V.call(r,e):Y.merge(r,e)),r},inArray:function(e,t,n){var r;if(t){if(J)return J.call(t,e,n);r=t.length,n=n?n<0?Math.max(0,r+n):n:0;for(;n<r;n++)if(n in t&&t[n]===e)return n}return-1},merge:function(e,n){var r=n.length,i=e.length,s=0;if(typeof r=="number")for(;s<r;s++)e[i++]=n[s];else while(n[s]!==t)e[i++]=n[s++];return e.length=i,e},grep:function(e,t,n){var r,i=[],s=0,o=e.length;n=!!n;for(;s<o;s++)r=!!t(e[s],s),n!==r&&i.push(e[s]);return i},map:function(e,n,r){var i,s,o=[],u=0,a=e.length,f=e instanceof Y||a!==t&&typeof a=="number"&&(a>0&&e[0]&&e[a-1]||a===0||Y.isArray(e));if(f)for(;u<a;u++)i=n(e[u],u,r),i!=null&&(o[o.length]=i);else for(s in e)i=n(e[s],s,r),i!=null&&(o[o.length]=i);return o.concat.apply([],o)},guid:1,proxy:function(e,n){var r,i,s;return typeof n=="string"&&(r=e[n],n=e,e=r),Y.isFunction(e)?(i=$.call(arguments,2),s=function(){return e.apply(n,i.concat($.call(arguments)))},s.guid=e.guid=e.guid||Y.guid++,s):t},access:function(e,n,r,i,s,o,u){var a,f=r==null,l=0,c=e.length;if(r&&typeof r=="object"){for(l in r)Y.access(e,n,l,r[l],1,o,i);s=1}else if(i!==t){a=u===t&&Y.isFunction(i),f&&(a?(a=n,n=function(e,t,n){return a.call(Y(e),n)}):(n.call(e,i),n=null));if(n)for(;l<c;l++)n(e[l],r,a?i.call(e[l],l,n(e[l],r)):i,u);s=1}return s?e:f?n.call(e):c?n(e[0],r):o},now:function(){return(new Date).getTime()}}),Y.ready.promise=function(t){if(!q){q=Y.Deferred();if(R.readyState==="complete")setTimeout(Y.ready,1);else if(R.addEventListener)R.addEventListener("DOMContentLoaded",ht,!1),e.addEventListener("load",Y.ready,!1);else{R.attachEvent("onreadystatechange",ht),e.attachEvent("onload",Y.ready);var n=!1;try{n=e.frameElement==null&&R.documentElement}catch(r){}n&&n.doScroll&&function i(){if(!Y.isReady){try{n.doScroll("left")}catch(e){return setTimeout(i,50)}Y.ready()}}()}}return q.promise(t)},Y.each("Boolean Number String Function Array Date RegExp Object".split(" "),function(e,t){pt["[object "+t+"]"]=t.toLowerCase()}),I=Y(R);var dt={};Y.Callbacks=function(e){e=typeof e=="string"?dt[e]||n(e):Y.extend({},e);var r,i,s,o,u,a,f=[],l=!e.once&&[],c=function(t){r=e.memory&&t,i=!0,a=o||0,o=0,u=f.length,s=!0;for(;f&&a<u;a++)if(f[a].apply(t[0],t[1])===!1&&e.stopOnFalse){r=!1;break}s=!1,f&&(l?l.length&&c(l.shift()):r?f=[]:h.disable())},h={add:function(){if(f){var t=f.length;(function n(t){Y.each(t,function(t,r){var i=Y.type(r);i==="function"?(!e.unique||!h.has(r))&&f.push(r):r&&r.length&&i!=="string"&&n(r)})})(arguments),s?u=f.length:r&&(o=t,c(r))}return this},remove:function(){return f&&Y.each(arguments,function(e,t){var n;while((n=Y.inArray(t,f,n))>-1)f.splice(n,1),s&&(n<=u&&u--,n<=a&&a--)}),this},has:function(e){return Y.inArray(e,f)>-1},empty:function(){return f=[],this},disable:function(){return f=l=r=t,this},disabled:function(){return!f},lock:function(){return l=t,r||h.disable(),this},locked:function(){return!l},fireWith:function(e,t){return t=t||[],t=[e,t.slice?t.slice():t],f&&(!i||l)&&(s?l.push(t):c(t)),this},fire:function(){return h.fireWith(this,arguments),this},fired:function(){return!!i}};return h},Y.extend({Deferred:function(e){var t=[["resolve","done",Y.Callbacks("once memory"),"resolved"],["reject","fail",Y.Callbacks("once memory"),"rejected"],["notify","progress",Y.Callbacks("memory")]],n="pending",r={state:function(){return n},always:function(){return i.done(arguments).fail(arguments),this},then:function(){var e=arguments;return Y.Deferred(function(n){Y.each(t,function(t,r){var s=r[0],o=e[t];i[r[1]](Y.isFunction(o)?function(){var e=o.apply(this,arguments);e&&Y.isFunction(e.promise)?e.promise().done(n.resolve).fail(n.reject).progress(n.notify):n[s+"With"](this===i?n:this,[e])}:n[s])}),e=null}).promise()},promise:function(e){return e!=null?Y.extend(e,r):r}},i={};return r.pipe=r.then,Y.each(t,function(e,s){var o=s[2],u=s[3];r[s[1]]=o.add,u&&o.add(function(){n=u},t[e^1][2].disable,t[2][2].lock),i[s[0]]=o.fire,i[s[0]+"With"]=o.fireWith}),r.promise(i),e&&e.call(i,i),i},when:function(e){var t=0,n=$.call(arguments),r=n.length,i=r!==1||e&&Y.isFunction(e.promise)?r:0,s=i===1?e:Y.Deferred(),o=function(e,t,n){return function(r){t[e]=this,n[e]=arguments.length>1?$.call(arguments):r,n===u?s.notifyWith(t,n):--i||s.resolveWith(t,n)}},u,a,f;if(r>1){u=new Array(r),a=new Array(r),f=new Array(r);for(;t<r;t++)n[t]&&Y.isFunction(n[t].promise)?n[t].promise().done(o(t,f,n)).fail(s.reject).progress(o(t,a,u)):--i}return i||s.resolveWith(f,n),s.promise()}}),Y.support=function(){var t,n,r,i,s,o,u,a,f,l,c,h=R.createElement("div");h.setAttribute("className","t"),h.innerHTML="  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>",n=h.getElementsByTagName("*"),r=h.getElementsByTagName("a")[0];if(!n||!r||!n.length)return{};i=R.createElement("select"),s=i.appendChild(R.createElement("option")),o=h.getElementsByTagName("input")[0],r.style.cssText="top:1px;float:left;opacity:.5",t={leadingWhitespace:h.firstChild.nodeType===3,tbody:!h.getElementsByTagName("tbody").length,htmlSerialize:!!h.getElementsByTagName("link").length,style:/top/.test(r.getAttribute("style")),hrefNormalized:r.getAttribute("href")==="/a",opacity:/^0.5/.test(r.style.opacity),cssFloat:!!r.style.cssFloat,checkOn:o.value==="on",optSelected:s.selected,getSetAttribute:h.className!=="t",enctype:!!R.createElement("form").enctype,html5Clone:R.createElement("nav").cloneNode(!0).outerHTML!=="<:nav></:nav>",boxModel:R.compatMode==="CSS1Compat",submitBubbles:!0,changeBubbles:!0,focusinBubbles:!1,deleteExpando:!0,noCloneEvent:!0,inlineBlockNeedsLayout:!1,shrinkWrapBlocks:!1,reliableMarginRight:!0,boxSizingReliable:!0,pixelPosition:!1},o.checked=!0,t.noCloneChecked=o.cloneNode(!0).checked,i.disabled=!0,t.optDisabled=!s.disabled;try{delete h.test}catch(p){t.deleteExpando=!1}!h.addEventListener&&h.attachEvent&&h.fireEvent&&(h.attachEvent("onclick",c=function(){t.noCloneEvent=!1}),h.cloneNode(!0).fireEvent("onclick"),h.detachEvent("onclick",c)),o=R.createElement("input"),o.value="t",o.setAttribute("type","radio"),t.radioValue=o.value==="t",o.setAttribute("checked","checked"),o.setAttribute("name","t"),h.appendChild(o),u=R.createDocumentFragment(),u.appendChild(h.lastChild),t.checkClone=u.cloneNode(!0).cloneNode(!0).lastChild.checked,t.appendChecked=o.checked,u.removeChild(o),u.appendChild(h);if(h.attachEvent)for(f in{submit:!0,change:!0,focusin:!0})a="on"+f,l=a in h,l||(h.setAttribute(a,"return;"),l=typeof h[a]=="function"),t[f+"Bubbles"]=l;return Y(function(){var n,r,i,s,o="padding:0;margin:0;border:0;display:block;overflow:hidden;",u=R.getElementsByTagName("body")[0];if(!u)return;n=R.createElement("div"),n.style.cssText="visibility:hidden;border:0;width:0;height:0;position:static;top:0;margin-top:1px",u.insertBefore(n,u.firstChild),r=R.createElement("div"),n.appendChild(r),r.innerHTML="<table><tr><td></td><td>t</td></tr></table>",i=r.getElementsByTagName("td"),i[0].style.cssText="padding:0;margin:0;border:0;display:none",l=i[0].offsetHeight===0,i[0].style.display="",i[1].style.display="none",t.reliableHiddenOffsets=l&&i[0].offsetHeight===0,r.innerHTML="",r.style.cssText="box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;",t.boxSizing=r.offsetWidth===4,t.doesNotIncludeMarginInBodyOffset=u.offsetTop!==1,e.getComputedStyle&&(t.pixelPosition=(e.getComputedStyle(r,null)||{}).top!=="1%",t.boxSizingReliable=(e.getComputedStyle(r,null)||{width:"4px"}).width==="4px",s=R.createElement("div"),s.style.cssText=r.style.cssText=o,s.style.marginRight=s.style.width="0",r.style.width="1px",r.appendChild(s),t.reliableMarginRight=!parseFloat((e.getComputedStyle(s,null)||{}).marginRight)),typeof r.style.zoom!="undefined"&&(r.innerHTML="",r.style.cssText=o+"width:1px;padding:1px;display:inline;zoom:1",t.inlineBlockNeedsLayout=r.offsetWidth===3,r.style.display="block",r.style.overflow="visible",r.innerHTML="<div></div>",r.firstChild.style.width="5px",t.shrinkWrapBlocks=r.offsetWidth!==3,n.style.zoom=1),u.removeChild(n),n=r=i=s=null}),u.removeChild(h),n=r=i=s=o=u=h=null,t}();var vt=/(?:\{[\s\S]*\}|\[[\s\S]*\])$/,mt=/([A-Z])/g;Y.extend({cache:{},deletedIds:[],uuid:0,expando:"jQuery"+(Y.fn.jquery+Math.random()).replace(/\D/g,""),noData:{embed:!0,object:"clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",applet:!0},hasData:function(e){return e=e.nodeType?Y.cache[e[Y.expando]]:e[Y.expando],!!e&&!i(e)},data:function(e,n,r,i){if(!Y.acceptData(e))return;var s,o,u=Y.expando,a=typeof n=="string",f=e.nodeType,l=f?Y.cache:e,c=f?e[u]:e[u]&&u;if((!c||!l[c]||!i&&!l[c].data)&&a&&r===t)return;c||(f?e[u]=c=Y.deletedIds.pop()||Y.guid++:c=u),l[c]||(l[c]={},f||(l[c].toJSON=Y.noop));if(typeof n=="object"||typeof n=="function")i?l[c]=Y.extend(l[c],n):l[c].data=Y.extend(l[c].data,n);return s=l[c],i||(s.data||(s.data={}),s=s.data),r!==t&&(s[Y.camelCase(n)]=r),a?(o=s[n],o==null&&(o=s[Y.camelCase(n)])):o=s,o},removeData:function(e,t,n){if(!Y.acceptData(e))return;var r,s,o,u=e.nodeType,a=u?Y.cache:e,f=u?e[Y.expando]:Y.expando;if(!a[f])return;if(t){r=n?a[f]:a[f].data;if(r){Y.isArray(t)||(t in r?t=[t]:(t=Y.camelCase(t),t in r?t=[t]:t=t.split(" ")));for(s=0,o=t.length;s<o;s++)delete r[t[s]];if(!(n?i:Y.isEmptyObject)(r))return}}if(!n){delete a[f].data;if(!i(a[f]))return}u?Y.cleanData([e],!0):Y.support.deleteExpando||a!=a.window?delete a[f]:a[f]=null},_data:function(e,t,n){return Y.data(e,t,n,!0)},acceptData:function(e){var t=e.nodeName&&Y.noData[e.nodeName.toLowerCase()];return!t||t!==!0&&e.getAttribute("classid")===t}}),Y.fn.extend({data:function(e,n){var i,s,o,u,a,f=this[0],l=0,c=null;if(e===t){if(this.length){c=Y.data(f);if(f.nodeType===1&&!Y._data(f,"parsedAttrs")){o=f.attributes;for(a=o.length;l<a;l++)u=o[l].name,u.indexOf("data-")||(u=Y.camelCase(u.substring(5)),r(f,u,c[u]));Y._data(f,"parsedAttrs",!0)}}return c}return typeof e=="object"?this.each(function(){Y.data(this,e)}):(i=e.split(".",2),i[1]=i[1]?"."+i[1]:"",s=i[1]+"!",Y.access(this,function(n){if(n===t)return c=this.triggerHandler("getData"+s,[i[0]]),c===t&&f&&(c=Y.data(f,e),c=r(f,e,c)),c===t&&i[1]?this.data(i[0]):c;i[1]=n,this.each(function(){var t=Y(this);t.triggerHandler("setData"+s,i),Y.data(this,e,n),t.triggerHandler("changeData"+s,i)})},null,n,arguments.length>1,null,!1))},removeData:function(e){return this.each(function(){Y.removeData(this,e)})}}),Y.extend({queue:function(e,t,n){var r;if(e)return t=(t||"fx")+"queue",r=Y._data(e,t),n&&(!r||Y.isArray(n)?r=Y._data(e,t,Y.makeArray(n)):r.push(n)),r||[]},dequeue:function(e,t){t=t||"fx";var n=Y.queue(e,t),r=n.length,i=n.shift(),s=Y._queueHooks(e,t),o=function(){Y.dequeue(e,t)};i==="inprogress"&&(i=n.shift(),r--),i&&(t==="fx"&&n.unshift("inprogress"),delete s.stop,i.call(e,o,s)),!r&&s&&s.empty.fire()},_queueHooks:function(e,t){var n=t+"queueHooks";return Y._data(e,n)||Y._data(e,n,{empty:Y.Callbacks("once memory").add(function(){Y.removeData(e,t+"queue",!0),Y.removeData(e,n,!0)})})}}),Y.fn.extend({queue:function(e,n){var r=2;return typeof e!="string"&&(n=e,e="fx",r--),arguments.length<r?Y.queue(this[0],e):n===t?this:this.each(function(){var t=Y.queue(this,e,n);Y._queueHooks(this,e),e==="fx"&&t[0]!=="inprogress"&&Y.dequeue(this,e)})},dequeue:function(e){return this.each(function(){Y.dequeue(this,e)})},delay:function(e,t){return e=Y.fx?Y.fx.speeds[e]||e:e,t=t||"fx",this.queue(t,function(t,n){var r=setTimeout(t,e);n.stop=function(){clearTimeout(r)}})},clearQueue:function(e){return this.queue(e||"fx",[])},promise:function(e,n){var r,i=1,s=Y.Deferred(),o=this,u=this.length,a=function(){--i||s.resolveWith(o,[o])};typeof e!="string"&&(n=e,e=t),e=e||"fx";while(u--)r=Y._data(o[u],e+"queueHooks"),r&&r.empty&&(i++,r.empty.add(a));return a(),s.promise(n)}});var gt,yt,bt,wt=/[\t\r\n]/g,Et=/\r/g,St=/^(?:button|input)$/i,xt=/^(?:button|input|object|select|textarea)$/i,Tt=/^a(?:rea|)$/i,Nt=/^(?:autofocus|autoplay|async|checked|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped|selected)$/i,Ct=Y.support.getSetAttribute;Y.fn.extend({attr:function(e,t){return Y.access(this,Y.attr,e,t,arguments.length>1)},removeAttr:function(e){return this.each(function(){Y.removeAttr(this,e)})},prop:function(e,t){return Y.access(this,Y.prop,e,t,arguments.length>1)},removeProp:function(e){return e=Y.propFix[e]||e,this.each(function(){try{this[e]=t,delete this[e]}catch(n){}})},addClass:function(e){var t,n,r,i,s,o,u;if(Y.isFunction(e))return this.each(function(t){Y(this).addClass(e.call(this,t,this.className))});if(e&&typeof e=="string"){t=e.split(tt);for(n=0,r=this.length;n<r;n++){i=this[n];if(i.nodeType===1)if(!i.className&&t.length===1)i.className=e;else{s=" "+i.className+" ";for(o=0,u=t.length;o<u;o++)s.indexOf(" "+t[o]+" ")<0&&(s+=t[o]+" ");i.className=Y.trim(s)}}}return this},removeClass:function(e){var n,r,i,s,o,u,a;if(Y.isFunction(e))return this.each(function(t){Y(this).removeClass(e.call(this,t,this.className))});if(e&&typeof e=="string"||e===t){n=(e||"").split(tt);for(u=0,a=this.length;u<a;u++){i=this[u];if(i.nodeType===1&&i.className){r=(" "+i.className+" ").replace(wt," ");for(s=0,o=n.length;s<o;s++)while(r.indexOf(" "+n[s]+" ")>=0)r=r.replace(" "+n[s]+" "," ");i.className=e?Y.trim(r):""}}}return this},toggleClass:function(e,t){var n=typeof e,r=typeof t=="boolean";return Y.isFunction(e)?this.each(function(n){Y(this).toggleClass(e.call(this,n,this.className,t),t)}):this.each(function(){if(n==="string"){var i,s=0,o=Y(this),u=t,a=e.split(tt);while(i=a[s++])u=r?u:!o.hasClass(i),o[u?"addClass":"removeClass"](i)}else if(n==="undefined"||n==="boolean")this.className&&Y._data(this,"__className__",this.className),this.className=this.className||e===!1?"":Y._data(this,"__className__")||""})},hasClass:function(e){var t=" "+e+" ",n=0,r=this.length;for(;n<r;n++)if(this[n].nodeType===1&&(" "+this[n].className+" ").replace(wt," ").indexOf(t)>=0)return!0;return!1},val:function(e){var n,r,i,s=this[0];if(!arguments.length){if(s)return n=Y.valHooks[s.type]||Y.valHooks[s.nodeName.toLowerCase()],n&&"get"in n&&(r=n.get(s,"value"))!==t?r:(r=s.value,typeof r=="string"?r.replace(Et,""):r==null?"":r);return}return i=Y.isFunction(e),this.each(function(r){var s,o=Y(this);if(this.nodeType!==1)return;i?s=e.call(this,r,o.val()):s=e,s==null?s="":typeof s=="number"?s+="":Y.isArray(s)&&(s=Y.map(s,function(e){return e==null?"":e+""})),n=Y.valHooks[this.type]||Y.valHooks[this.nodeName.toLowerCase()];if(!n||!("set"in n)||n.set(this,s,"value")===t)this.value=s})}}),Y.extend({valHooks:{option:{get:function(e){var t=e.attributes.value;return!t||t.specified?e.value:e.text}},select:{get:function(e){var t,n,r=e.options,i=e.selectedIndex,s=e.type==="select-one"||i<0,o=s?null:[],u=s?i+1:r.length,a=i<0?u:s?i:0;for(;a<u;a++){n=r[a];if((n.selected||a===i)&&(Y.support.optDisabled?!n.disabled:n.getAttribute("disabled")===null)&&(!n.parentNode.disabled||!Y.nodeName(n.parentNode,"optgroup"))){t=Y(n).val();if(s)return t;o.push(t)}}return o},set:function(e,t){var n=Y.makeArray(t);return Y(e).find("option").each(function(){this.selected=Y.inArray(Y(this).val(),n)>=0}),n.length||(e.selectedIndex=-1),n}}},attrFn:{},attr:function(e,n,r,i){var s,o,u,a=e.nodeType;if(!e||a===3||a===8||a===2)return;if(i&&Y.isFunction(Y.fn[n]))return Y(e)[n](r);if(typeof e.getAttribute=="undefined")return Y.prop(e,n,r);u=a!==1||!Y.isXMLDoc(e),u&&(n=n.toLowerCase(),o=Y.attrHooks[n]||(Nt.test(n)?yt:gt));if(r!==t){if(r===null){Y.removeAttr(e,n);return}return o&&"set"in o&&u&&(s=o.set(e,r,n))!==t?s:(e.setAttribute(n,r+""),r)}return o&&"get"in o&&u&&(s=o.get(e,n))!==null?s:(s=e.getAttribute(n),s===null?t:s)},removeAttr:function(e,t){var n,r,i,s,o=0;if(t&&e.nodeType===1){r=t.split(tt);for(;o<r.length;o++)i=r[o],i&&(n=Y.propFix[i]||i,s=Nt.test(i),s||Y.attr(e,i,""),e.removeAttribute(Ct?i:n),s&&n in e&&(e[n]=!1))}},attrHooks:{type:{set:function(e,t){if(St.test(e.nodeName)&&e.parentNode)Y.error("type property can't be changed");else if(!Y.support.radioValue&&t==="radio"&&Y.nodeName(e,"input")){var n=e.value;return e.setAttribute("type",t),n&&(e.value=n),t}}},value:{get:function(e,t){return gt&&Y.nodeName(e,"button")?gt.get(e,t):t in e?e.value:null},set:function(e,t,n){if(gt&&Y.nodeName(e,"button"))return gt.set(e,t,n);e.value=t}}},propFix:{tabindex:"tabIndex",readonly:"readOnly","for":"htmlFor","class":"className",maxlength:"maxLength",cellspacing:"cellSpacing",cellpadding:"cellPadding",rowspan:"rowSpan",colspan:"colSpan",usemap:"useMap",frameborder:"frameBorder",contenteditable:"contentEditable"},prop:function(e,n,r){var i,s,o,u=e.nodeType;if(!e||u===3||u===8||u===2)return;return o=u!==1||!Y.isXMLDoc(e),o&&(n=Y.propFix[n]||n,s=Y.propHooks[n]),r!==t?s&&"set"in s&&(i=s.set(e,r,n))!==t?i:e[n]=r:s&&"get"in s&&(i=s.get(e,n))!==null?i:e[n]},propHooks:{tabIndex:{get:function(e){var n=e.getAttributeNode("tabindex");return n&&n.specified?parseInt(n.value,10):xt.test(e.nodeName)||Tt.test(e.nodeName)&&e.href?0:t}}}}),yt={get:function(e,n){var r,i=Y.prop(e,n);return i===!0||typeof i!="boolean"&&(r=e.getAttributeNode(n))&&r.nodeValue!==!1?n.toLowerCase():t},set:function(e,t,n){var r;return t===!1?Y.removeAttr(e,n):(r=Y.propFix[n]||n,r in e&&(e[r]=!0),e.setAttribute(n,n.toLowerCase())),n}},Ct||(bt={name:!0,id:!0,coords:!0},gt=Y.valHooks.button={get:function(e,n){var r;return r=e.getAttributeNode(n),r&&(bt[n]?r.value!=="":r.specified)?r.value:t},set:function(e,t,n){var r=e.getAttributeNode(n);return r||(r=R.createAttribute(n),e.setAttributeNode(r)),r.value=t+""}},Y.each(["width","height"],function(e,t){Y.attrHooks[t]=Y.extend(Y.attrHooks[t],{set:function(e,n){if(n==="")return e.setAttribute(t,"auto"),n}})}),Y.attrHooks.contenteditable={get:gt.get,set:function(e,t,n){t===""&&(t="false"),gt.set(e,t,n)}}),Y.support.hrefNormalized||Y.each(["href","src","width","height"],function(e,n){Y.attrHooks[n]=Y.extend(Y.attrHooks[n],{get:function(e){var r=e.getAttribute(n,2);return r===null?t:r}})}),Y.support.style||(Y.attrHooks.style={get:function(e){return e.style.cssText.toLowerCase()||t},set:function(e,t){return e.style.cssText=t+""}}),Y.support.optSelected||(Y.propHooks.selected=Y.extend(Y.propHooks.selected,{get:function(e){var t=e.parentNode;return t&&(t.selectedIndex,t.parentNode&&t.parentNode.selectedIndex),null}})),Y.support.enctype||(Y.propFix.enctype="encoding"),Y.support.checkOn||Y.each(["radio","checkbox"],function(){Y.valHooks[this]={get:function(e){return e.getAttribute("value")===null?"on":e.value}}}),Y.each(["radio","checkbox"],function(){Y.valHooks[this]=Y.extend(Y.valHooks[this],{set:function(e,t){if(Y.isArray(t))return e.checked=Y.inArray(Y(e).val(),t)>=0}})});var kt=/^(?:textarea|input|select)$/i,Lt=/^([^\.]*|)(?:\.(.+)|)$/,At=/(?:^|\s)hover(\.\S+|)\b/,Ot=/^key/,Mt=/^(?:mouse|contextmenu)|click/,_t=/^(?:focusinfocus|focusoutblur)$/,Dt=function(e){return Y.event.special.hover?e:e.replace(At,"mouseenter$1 mouseleave$1")};Y.event={add:function(e,n,r,i,s){var o,u,a,f,l,c,h,p,d,v,m;if(e.nodeType===3||e.nodeType===8||!n||!r||!(o=Y._data(e)))return;r.handler&&(d=r,r=d.handler,s=d.selector),r.guid||(r.guid=Y.guid++),a=o.events,a||(o.events=a={}),u=o.handle,u||(o.handle=u=function(e){return typeof Y=="undefined"||!!e&&Y.event.triggered===e.type?t:Y.event.dispatch.apply(u.elem,arguments)},u.elem=e),n=Y.trim(Dt(n)).split(" ");for(f=0;f<n.length;f++){l=Lt.exec(n[f])||[],c=l[1],h=(l[2]||"").split(".").sort(),m=Y.event.special[c]||{},c=(s?m.delegateType:m.bindType)||c,m=Y.event.special[c]||{},p=Y.extend({type:c,origType:l[1],data:i,handler:r,guid:r.guid,selector:s,needsContext:s&&Y.expr.match.needsContext.test(s),namespace:h.join(".")},d),v=a[c];if(!v){v=a[c]=[],v.delegateCount=0;if(!m.setup||m.setup.call(e,i,h,u)===!1)e.addEventListener?e.addEventListener(c,u,!1):e.attachEvent&&e.attachEvent("on"+c,u)}m.add&&(m.add.call(e,p),p.handler.guid||(p.handler.guid=r.guid)),s?v.splice(v.delegateCount++,0,p):v.push(p),Y.event.global[c]=!0}e=null},global:{},remove:function(e,t,n,r,i){var s,o,u,a,f,l,c,h,p,d,v,m=Y.hasData(e)&&Y._data(e);if(!m||!(h=m.events))return;t=Y.trim(Dt(t||"")).split(" ");for(s=0;s<t.length;s++){o=Lt.exec(t[s])||[],u=a=o[1],f=o[2];if(!u){for(u in h)Y.event.remove(e,u+t[s],n,r,!0);continue}p=Y.event.special[u]||{},u=(r?p.delegateType:p.bindType)||u,d=h[u]||[],l=d.length,f=f?new RegExp("(^|\\.)"+f.split(".").sort().join("\\.(?:.*\\.|)")+"(\\.|$)"):null;for(c=0;c<d.length;c++)v=d[c],(i||a===v.origType)&&(!n||n.guid===v.guid)&&(!f||f.test(v.namespace))&&(!r||r===v.selector||r==="**"&&v.selector)&&(d.splice(c--,1),v.selector&&d.delegateCount--,p.remove&&p.remove.call(e,v));d.length===0&&l!==d.length&&((!p.teardown||p.teardown.call(e,f,m.handle)===!1)&&Y.removeEvent(e,u,m.handle),delete h[u])}Y.isEmptyObject(h)&&(delete m.handle,Y.removeData(e,"events",!0))},customEvent:{getData:!0,setData:!0,changeData:!0},trigger:function(n,r,i,s){if(!i||i.nodeType!==3&&i.nodeType!==8){var o,u,a,f,l,c,h,p,d,v,m=n.type||n,g=[];if(_t.test(m+Y.event.triggered))return;m.indexOf("!")>=0&&(m=m.slice(0,-1),u=!0),m.indexOf(".")>=0&&(g=m.split("."),m=g.shift(),g.sort());if((!i||Y.event.customEvent[m])&&!Y.event.global[m])return;n=typeof n=="object"?n[Y.expando]?n:new Y.Event(m,n):new Y.Event(m),n.type=m,n.isTrigger=!0,n.exclusive=u,n.namespace=g.join("."),n.namespace_re=n.namespace?new RegExp("(^|\\.)"+g.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,c=m.indexOf(":")<0?"on"+m:"";if(!i){o=Y.cache;for(a in o)o[a].events&&o[a].events[m]&&Y.event.trigger(n,r,o[a].handle.elem,!0);return}n.result=t,n.target||(n.target=i),r=r!=null?Y.makeArray(r):[],r.unshift(n),h=Y.event.special[m]||{};if(h.trigger&&h.trigger.apply(i,r)===!1)return;d=[[i,h.bindType||m]];if(!s&&!h.noBubble&&!Y.isWindow(i)){v=h.delegateType||m,f=_t.test(v+m)?i:i.parentNode;for(l=i;f;f=f.parentNode)d.push([f,v]),l=f;l===(i.ownerDocument||R)&&d.push([l.defaultView||l.parentWindow||e,v])}for(a=0;a<d.length&&!n.isPropagationStopped();a++)f=d[a][0],n.type=d[a][1],p=(Y._data(f,"events")||{})[n.type]&&Y._data(f,"handle"),p&&p.apply(f,r),p=c&&f[c],p&&Y.acceptData(f)&&p.apply&&p.apply(f,r)===!1&&n.preventDefault();return n.type=m,!s&&!n.isDefaultPrevented()&&(!h._default||h._default.apply(i.ownerDocument,r)===!1)&&(m!=="click"||!Y.nodeName(i,"a"))&&Y.acceptData(i)&&c&&i[m]&&(m!=="focus"&&m!=="blur"||n.target.offsetWidth!==0)&&!Y.isWindow(i)&&(l=i[c],l&&(i[c]=null),Y.event.triggered=m,i[m](),Y.event.triggered=t,l&&(i[c]=l)),n.result}return},dispatch:function(n){n=Y.event.fix(n||e.event);var r,i,s,o,u,a,f,l,c,h,p=(Y._data(this,"events")||{})[n.type]||[],d=p.delegateCount,v=$.call(arguments),m=!n.exclusive&&!n.namespace,g=Y.event.special[n.type]||{},y=[];v[0]=n,n.delegateTarget=this;if(g.preDispatch&&g.preDispatch.call(this,n)===!1)return;if(d&&(!n.button||n.type!=="click"))for(s=n.target;s!=this;s=s.parentNode||this)if(s.disabled!==!0||n.type!=="click"){u={},f=[];for(r=0;r<d;r++)l=p[r],c=l.selector,u[c]===t&&(u[c]=l.needsContext?Y(c,this).index(s)>=0:Y.find(c,this,null,[s]).length),u[c]&&f.push(l);f.length&&y.push({elem:s,matches:f})}p.length>d&&y.push({elem:this,matches:p.slice(d)});for(r=0;r<y.length&&!n.isPropagationStopped();r++){a=y[r],n.currentTarget=a.elem;for(i=0;i<a.matches.length&&!n.isImmediatePropagationStopped();i++){l=a.matches[i];if(m||!n.namespace&&!l.namespace||n.namespace_re&&n.namespace_re.test(l.namespace))n.data=l.data,n.handleObj=l,o=((Y.event.special[l.origType]||{}).handle||l.handler).apply(a.elem,v),o!==t&&(n.result=o,o===!1&&(n.preventDefault(),n.stopPropagation()))}}return g.postDispatch&&g.postDispatch.call(this,n),n.result},props:"attrChange attrName relatedNode srcElement altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(e,t){return e.which==null&&(e.which=t.charCode!=null?t.charCode:t.keyCode),e}},mouseHooks:{props:"button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(e,n){var r,i,s,o=n.button,u=n.fromElement;return e.pageX==null&&n.clientX!=null&&(r=e.target.ownerDocument||R,i=r.documentElement,s=r.body,e.pageX=n.clientX+(i&&i.scrollLeft||s&&s.scrollLeft||0)-(i&&i.clientLeft||s&&s.clientLeft||0),e.pageY=n.clientY+(i&&i.scrollTop||s&&s.scrollTop||0)-(i&&i.clientTop||s&&s.clientTop||0)),!e.relatedTarget&&u&&(e.relatedTarget=u===e.target?n.toElement:u),!e.which&&o!==t&&(e.which=o&1?1:o&2?3:o&4?2:0),e}},fix:function(e){if(e[Y.expando])return e;var t,n,r=e,i=Y.event.fixHooks[e.type]||{},s=i.props?this.props.concat(i.props):this.props;e=Y.Event(r);for(t=s.length;t;)n=s[--t],e[n]=r[n];return e.target||(e.target=r.srcElement||R),e.target.nodeType===3&&(e.target=e.target.parentNode),e.metaKey=!!e.metaKey,i.filter?i.filter(e,r):e},special:{load:{noBubble:!0},focus:{delegateType:"focusin"},blur:{delegateType:"focusout"},beforeunload:{setup:function(e,t,n){Y.isWindow(this)&&(this.onbeforeunload=n)},teardown:function(e,t){this.onbeforeunload===t&&(this.onbeforeunload=null)}}},simulate:function(e,t,n,r){var i=Y.extend(new Y.Event,n,{type:e,isSimulated:!0,originalEvent:{}});r?Y.event.trigger(i,null,t):Y.event.dispatch.call(t,i),i.isDefaultPrevented()&&n.preventDefault()}},Y.event.handle=Y.event.dispatch,Y.removeEvent=R.removeEventListener?function(e,t,n){e.removeEventListener&&e.removeEventListener(t,n,!1)}:function(e,t,n){var r="on"+t;e.detachEvent&&(typeof e[r]=="undefined"&&(e[r]=null),e.detachEvent(r,n))},Y.Event=function(e,t){if(!(this instanceof Y.Event))return new Y.Event(e,t);e&&e.type?(this.originalEvent=e,this.type=e.type,this.isDefaultPrevented=e.defaultPrevented||e.returnValue===!1||e.getPreventDefault&&e.getPreventDefault()?o:s):this.type=e,t&&Y.extend(this,t),this.timeStamp=e&&e.timeStamp||Y.now(),this[Y.expando]=!0},Y.Event.prototype={preventDefault:function(){this.isDefaultPrevented=o;var e=this.originalEvent;if(!e)return;e.preventDefault?e.preventDefault():e.returnValue=!1},stopPropagation:function(){this.isPropagationStopped=o;var e=this.originalEvent;if(!e)return;e.stopPropagation&&e.stopPropagation(),e.cancelBubble=!0},stopImmediatePropagation:function(){this.isImmediatePropagationStopped=o,this.stopPropagation()},isDefaultPrevented:s,isPropagationStopped:s,isImmediatePropagationStopped:s},Y.each({mouseenter:"mouseover",mouseleave:"mouseout"},function(e,t){Y.event.special[e]={delegateType:t,bindType:t,handle:function(e){var n,r=this,i=e.relatedTarget,s=e.handleObj,o=s.selector;if(!i||i!==r&&!Y.contains(r,i))e.type=s.origType,n=s.handler.apply(this,arguments),e.type=t;return n}}}),Y.support.submitBubbles||(Y.event.special.submit={setup:function(){if(Y.nodeName(this,"form"))return!1;Y.event.add(this,"click._submit keypress._submit",function(e){var n=e.target,r=Y.nodeName(n,"input")||Y.nodeName(n,"button")?n.form:t;r&&!Y._data(r,"_submit_attached")&&(Y.event.add(r,"submit._submit",function(e){e._submit_bubble=!0}),Y._data(r,"_submit_attached",!0))})},postDispatch:function(e){e._submit_bubble&&(delete e._submit_bubble,this.parentNode&&!e.isTrigger&&Y.event.simulate("submit",this.parentNode,e,!0))},teardown:function(){if(Y.nodeName(this,"form"))return!1;Y.event.remove(this,"._submit")}}),Y.support.changeBubbles||(Y.event.special.change={setup:function(){if(kt.test(this.nodeName)){if(this.type==="checkbox"||this.type==="radio")Y.event.add(this,"propertychange._change",function(e){e.originalEvent.propertyName==="checked"&&(this._just_changed=!0)}),Y.event.add(this,"click._change",function(e){this._just_changed&&!e.isTrigger&&(this._just_changed=!1),Y.event.simulate("change",this,e,!0)});return!1}Y.event.add(this,"beforeactivate._change",function(e){var t=e.target;kt.test(t.nodeName)&&!Y._data(t,"_change_attached")&&(Y.event.add(t,"change._change",function(e){this.parentNode&&!e.isSimulated&&!e.isTrigger&&Y.event.simulate("change",this.parentNode,e,!0)}),Y._data(t,"_change_attached",!0))})},handle:function(e){var t=e.target;if(this!==t||e.isSimulated||e.isTrigger||t.type!=="radio"&&t.type!=="checkbox")return e.handleObj.handler.apply(this,arguments)},teardown:function(){return Y.event.remove(this,"._change"),!kt.test(this.nodeName)}}),Y.support.focusinBubbles||Y.each({focus:"focusin",blur:"focusout"},function(e,t){var n=0,r=function(e){Y.event.simulate(t,e.target,Y.event.fix(e),!0)};Y.event.special[t]={setup:function(){n++===0&&R.addEventListener(e,r,!0)},teardown:function(){--n===0&&R.removeEventListener(e,r,!0)}}}),Y.fn.extend({on:function(e,n,r,i,o){var u,a;if(typeof e=="object"){typeof n!="string"&&(r=r||n,n=t);for(a in e)this.on(a,n,r,e[a],o);return this}r==null&&i==null?(i=n,r=n=t):i==null&&(typeof n=="string"?(i=r,r=t):(i=r,r=n,n=t));if(i===!1)i=s;else if(!i)return this;return o===1&&(u=i,i=function(e){return Y().off(e),u.apply(this,arguments)},i.guid=u.guid||(u.guid=Y.guid++)),this.each(function(){Y.event.add(this,e,i,r,n)})},one:function(e,t,n,r){return this.on(e,t,n,r,1)},off:function(e,n,r){var i,o;if(e&&e.preventDefault&&e.handleObj)return i=e.handleObj,Y(e.delegateTarget).off(i.namespace?i.origType+"."+i.namespace:i.origType,i.selector,i.handler),this;if(typeof e=="object"){for(o in e)this.off(o,n,e[o]);return this}if(n===!1||typeof n=="function")r=n,n=t;return r===!1&&(r=s),this.each(function(){Y.event.remove(this,e,r,n)})},bind:function(e,t,n){return this.on(e,null,t,n)},unbind:function(e,t){return this.off(e,null,t)},live:function(e,t,n){return Y(this.context).on(e,this.selector,t,n),this},die:function(e,t){return Y(this.context).off(e,this.selector||"**",t),this},delegate:function(e,t,n,r){return this.on(t,e,n,r)},undelegate:function(e,t,n){return arguments.length===1?this.off(e,"**"):this.off(t,e||"**",n)},trigger:function(e,t){return this.each(function(){Y.event.trigger(e,t,this)})},triggerHandler:function(e,t){if(this[0])return Y.event.trigger(e,t,this[0],!0)},toggle:function(e){var t=arguments,n=e.guid||Y.guid++,r=0,i=function(n){var i=(Y._data(this,"lastToggle"+e.guid)||0)%r;return Y._data(this,"lastToggle"+e.guid,i+1),n.preventDefault(),t[i].apply(this,arguments)||!1};i.guid=n;while(r<t.length)t[r++].guid=n;return this.click(i)},hover:function(e,t){return this.mouseenter(e).mouseleave(t||e)}}),Y.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(e,t){Y.fn[t]=function(e,n){return n==null&&(n=e,e=null),arguments.length>0?this.on(t,null,e,n):this.trigger(t)},Ot.test(t)&&(Y.event.fixHooks[t]=Y.event.keyHooks),Mt.test(t)&&(Y.event.fixHooks[t]=Y.event.mouseHooks)}),function(e,t){function n(e,t,n,r){n=n||[],t=t||M;var i,s,o,u,a=t.nodeType;if(!e||typeof e!="string")return n;if(a!==1&&a!==9)return[];o=E(t);if(!o&&!r)if(i=nt.exec(e))if(u=i[1]){if(a===9){s=t.getElementById(u);if(!s||!s.parentNode)return n;if(s.id===u)return n.push(s),n}else if(t.ownerDocument&&(s=t.ownerDocument.getElementById(u))&&S(t,s)&&s.id===u)return n.push(s),n}else{if(i[2])return B.apply(n,j.call(t.getElementsByTagName(e),0)),n;if((u=i[3])&&dt&&t.getElementsByClassName)return B.apply(n,j.call(t.getElementsByClassName(u),0)),n}return v(e.replace(G,"$1"),t,n,r,o)}function r(e){return function(t){var n=t.nodeName.toLowerCase();return n==="input"&&t.type===e}}function i(e){return function(t){var n=t.nodeName.toLowerCase();return(n==="input"||n==="button")&&t.type===e}}function s(e){return I(function(t){return t=+t,I(function(n,r){var i,s=e([],n.length,t),o=s.length;while(o--)n[i=s[o]]&&(n[i]=!(r[i]=n[i]))})})}function o(e,t,n){if(e===t)return n;var r=e.nextSibling;while(r){if(r===t)return-1;r=r.nextSibling}return 1}function u(e,t){var r,i,s,o,u,a,f,l=U[A][e+" "];if(l)return t?0:l.slice(0);u=e,a=[],f=b.preFilter;while(u){if(!r||(i=Z.exec(u)))i&&(u=u.slice(i[0].length)||u),a.push(s=[]);r=!1;if(i=et.exec(u))s.push(r=new O(i.shift())),u=u.slice(r.length),r.type=i[0].replace(G," ");for(o in b.filter)(i=ft[o].exec(u))&&(!f[o]||(i=f[o](i)))&&(s.push(r=new O(i.shift())),u=u.slice(r.length),r.type=o,r.matches=i);if(!r)break}return t?u.length:u?n.error(e):U(e,a).slice(0)}function a(e,t,n){var r=t.dir,i=n&&t.dir==="parentNode",s=P++;return t.first?function(t,n,s){while(t=t[r])if(i||t.nodeType===1)return e(t,n,s)}:function(t,n,o){if(!o){var u,a=D+" "+s+" ",f=a+g;while(t=t[r])if(i||t.nodeType===1){if((u=t[A])===f)return t.sizset;if(typeof u=="string"&&u.indexOf(a)===0){if(t.sizset)return t}else{t[A]=f;if(e(t,n,o))return t.sizset=!0,t;t.sizset=!1}}}else while(t=t[r])if(i||t.nodeType===1)if(e(t,n,o))return t}}function f(e){return e.length>1?function(t,n,r){var i=e.length;while(i--)if(!e[i](t,n,r))return!1;return!0}:e[0]}function l(e,t,n,r,i){var s,o=[],u=0,a=e.length,f=t!=null;for(;u<a;u++)if(s=e[u])if(!n||n(s,r,i))o.push(s),f&&t.push(u);return o}function c(e,t,n,r,i,s){return r&&!r[A]&&(r=c(r)),i&&!i[A]&&(i=c(i,s)),I(function(s,o,u,a){var f,c,h,p=[],v=[],m=o.length,g=s||d(t||"*",u.nodeType?[u]:u,[]),y=e&&(s||!t)?l(g,p,e,u,a):g,b=n?i||(s?e:m||r)?[]:o:y;n&&n(y,b,u,a);if(r){f=l(b,v),r(f,[],u,a),c=f.length;while(c--)if(h=f[c])b[v[c]]=!(y[v[c]]=h)}if(s){if(i||e){if(i){f=[],c=b.length;while(c--)(h=b[c])&&f.push(y[c]=h);i(null,b=[],f,a)}c=b.length;while(c--)(h=b[c])&&(f=i?F.call(s,h):p[c])>-1&&(s[f]=!(o[f]=h))}}else b=l(b===o?b.splice(m,b.length):b),i?i(null,o,b,a):B.apply(o,b)})}function h(e){var t,n,r,i=e.length,s=b.relative[e[0].type],o=s||b.relative[" "],u=s?1:0,l=a(function(e){return e===t},o,!0),p=a(function(e){return F.call(t,e)>-1},o,!0),d=[function(e,n,r){return!s&&(r||n!==C)||((t=n).nodeType?l(e,n,r):p(e,n,r))}];for(;u<i;u++)if(n=b.relative[e[u].type])d=[a(f(d),n)];else{n=b.filter[e[u].type].apply(null,e[u].matches);if(n[A]){r=++u;for(;r<i;r++)if(b.relative[e[r].type])break;return c(u>1&&f(d),u>1&&e.slice(0,u-1).join("").replace(G,"$1"),n,u<r&&h(e.slice(u,r)),r<i&&h(e=e.slice(r)),r<i&&e.join(""))}d.push(n)}return f(d)}function p(e,t){var r=t.length>0,i=e.length>0,s=function(o,u,a,f,c){var h,p,d,v=[],m=0,y="0",w=o&&[],E=c!=null,S=C,x=o||i&&b.find.TAG("*",c&&u.parentNode||u),T=D+=S==null?1:Math.E;E&&(C=u!==M&&u,g=s.el);for(;(h=x[y])!=null;y++){if(i&&h){for(p=0;d=e[p];p++)if(d(h,u,a)){f.push(h);break}E&&(D=T,g=++s.el)}r&&((h=!d&&h)&&m--,o&&w.push(h))}m+=y;if(r&&y!==m){for(p=0;d=t[p];p++)d(w,v,u,a);if(o){if(m>0)while(y--)!w[y]&&!v[y]&&(v[y]=H.call(f));v=l(v)}B.apply(f,v),E&&!o&&v.length>0&&m+t.length>1&&n.uniqueSort(f)}return E&&(D=T,C=S),w};return s.el=0,r?I(s):s}function d(e,t,r){var i=0,s=t.length;for(;i<s;i++)n(e,t[i],r);return r}function v(e,t,n,r,i){var s,o,a,f,l,c=u(e),h=c.length;if(!r&&c.length===1){o=c[0]=c[0].slice(0);if(o.length>2&&(a=o[0]).type==="ID"&&t.nodeType===9&&!i&&b.relative[o[1].type]){t=b.find.ID(a.matches[0].replace(at,""),t,i)[0];if(!t)return n;e=e.slice(o.shift().length)}for(s=ft.POS.test(e)?-1:o.length-1;s>=0;s--){a=o[s];if(b.relative[f=a.type])break;if(l=b.find[f])if(r=l(a.matches[0].replace(at,""),it.test(o[0].type)&&t.parentNode||t,i)){o.splice(s,1),e=r.length&&o.join("");if(!e)return B.apply(n,j.call(r,0)),n;break}}}return x(e,c)(r,t,i,n,it.test(e)),n}function m(){}var g,y,b,w,E,S,x,T,N,C,k=!0,L="undefined",A=("sizcache"+Math.random()).replace(".",""),O=String,M=e.document,_=M.documentElement,D=0,P=0,H=[].pop,B=[].push,j=[].slice,F=[].indexOf||function(e){var t=0,n=this.length;for(;t<n;t++)if(this[t]===e)return t;return-1},I=function(e,t){return e[A]=t==null||t,e},q=function(){var e={},t=[];return I(function(n,r){return t.push(n)>b.cacheLength&&delete e[t.shift()],e[n+" "]=r},e)},R=q(),U=q(),z=q(),W="[\\x20\\t\\r\\n\\f]",X="(?:\\\\.|[-\\w]|[^\\x00-\\xa0])+",V=X.replace("w","w#"),$="([*^$|!~]?=)",J="\\["+W+"*("+X+")"+W+"*(?:"+$+W+"*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|("+V+")|)|)"+W+"*\\]",K=":("+X+")(?:\\((?:(['\"])((?:\\\\.|[^\\\\])*?)\\2|([^()[\\]]*|(?:(?:"+J+")|[^:]|\\\\.)*|.*))\\)|)",Q=":(even|odd|eq|gt|lt|nth|first|last)(?:\\("+W+"*((?:-\\d)?\\d*)"+W+"*\\)|)(?=[^-]|$)",G=new RegExp("^"+W+"+|((?:^|[^\\\\])(?:\\\\.)*)"+W+"+$","g"),Z=new RegExp("^"+W+"*,"+W+"*"),et=new RegExp("^"+W+"*([\\x20\\t\\r\\n\\f>+~])"+W+"*"),tt=new RegExp(K),nt=/^(?:#([\w\-]+)|(\w+)|\.([\w\-]+))$/,rt=/^:not/,it=/[\x20\t\r\n\f]*[+~]/,st=/:not\($/,ot=/h\d/i,ut=/input|select|textarea|button/i,at=/\\(?!\\)/g,ft={ID:new RegExp("^#("+X+")"),CLASS:new RegExp("^\\.("+X+")"),NAME:new RegExp("^\\[name=['\"]?("+X+")['\"]?\\]"),TAG:new RegExp("^("+X.replace("w","w*")+")"),ATTR:new RegExp("^"+J),PSEUDO:new RegExp("^"+K),POS:new RegExp(Q,"i"),CHILD:new RegExp("^:(only|nth|first|last)-child(?:\\("+W+"*(even|odd|(([+-]|)(\\d*)n|)"+W+"*(?:([+-]|)"+W+"*(\\d+)|))"+W+"*\\)|)","i"),needsContext:new RegExp("^"+W+"*[>+~]|"+Q,"i")},lt=function(e){var t=M.createElement("div");try{return e(t)}catch(n){return!1}finally{t=null}},ct=lt(function(e){return e.appendChild(M.createComment("")),!e.getElementsByTagName("*").length}),ht=lt(function(e){return e.innerHTML="<a href='#'></a>",e.firstChild&&typeof e.firstChild.getAttribute!==L&&e.firstChild.getAttribute("href")==="#"}),pt=lt(function(e){e.innerHTML="<select></select>";var t=typeof e.lastChild.getAttribute("multiple");return t!=="boolean"&&t!=="string"}),dt=lt(function(e){return e.innerHTML="<div class='hidden e'></div><div class='hidden'></div>",!e.getElementsByClassName||!e.getElementsByClassName("e").length?!1:(e.lastChild.className="e",e.getElementsByClassName("e").length===2)}),vt=lt(function(e){e.id=A+0,e.innerHTML="<a name='"+A+"'></a><div name='"+A+"'></div>",_.insertBefore(e,_.firstChild);var t=M.getElementsByName&&M.getElementsByName(A).length===2+M.getElementsByName(A+0).length;return y=!M.getElementById(A),_.removeChild(e),t});try{j.call(_.childNodes,0)[0].nodeType}catch(mt){j=function(e){var t,n=[];for(;t=this[e];e++)n.push(t);return n}}n.matches=function(e,t){return n(e,null,null,t)},n.matchesSelector=function(e,t){return n(t,null,null,[e]).length>0},w=n.getText=function(e){var t,n="",r=0,i=e.nodeType;if(i){if(i===1||i===9||i===11){if(typeof e.textContent=="string")return e.textContent;for(e=e.firstChild;e;e=e.nextSibling)n+=w(e)}else if(i===3||i===4)return e.nodeValue}else for(;t=e[r];r++)n+=w(t);return n},E=n.isXML=function(e){var t=e&&(e.ownerDocument||e).documentElement;return t?t.nodeName!=="HTML":!1},S=n.contains=_.contains?function(e,t){var n=e.nodeType===9?e.documentElement:e,r=t&&t.parentNode;return e===r||!!(r&&r.nodeType===1&&n.contains&&n.contains(r))}:_.compareDocumentPosition?function(e,t){return t&&!!(e.compareDocumentPosition(t)&16)}:function(e,t){while(t=t.parentNode)if(t===e)return!0;return!1},n.attr=function(e,t){var n,r=E(e);return r||(t=t.toLowerCase()),(n=b.attrHandle[t])?n(e):r||pt?e.getAttribute(t):(n=e.getAttributeNode(t),n?typeof e[t]=="boolean"?e[t]?t:null:n.specified?n.value:null:null)},b=n.selectors={cacheLength:50,createPseudo:I,match:ft,attrHandle:ht?{}:{href:function(e){return e.getAttribute("href",2)},type:function(e){return e.getAttribute("type")}},find:{ID:y?function(e,t,n){if(typeof t.getElementById!==L&&!n){var r=t.getElementById(e);return r&&r.parentNode?[r]:[]}}:function(e,n,r){if(typeof n.getElementById!==L&&!r){var i=n.getElementById(e);return i?i.id===e||typeof i.getAttributeNode!==L&&i.getAttributeNode("id").value===e?[i]:t:[]}},TAG:ct?function(e,t){if(typeof t.getElementsByTagName!==L)return t.getElementsByTagName(e)}:function(e,t){var n=t.getElementsByTagName(e);if(e==="*"){var r,i=[],s=0;for(;r=n[s];s++)r.nodeType===1&&i.push(r);return i}return n},NAME:vt&&function(e,t){if(typeof t.getElementsByName!==L)return t.getElementsByName(name)},CLASS:dt&&function(e,t,n){if(typeof t.getElementsByClassName!==L&&!n)return t.getElementsByClassName(e)}},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(e){return e[1]=e[1].replace(at,""),e[3]=(e[4]||e[5]||"").replace(at,""),e[2]==="~="&&(e[3]=" "+e[3]+" "),e.slice(0,4)},CHILD:function(e){return e[1]=e[1].toLowerCase(),e[1]==="nth"?(e[2]||n.error(e[0]),e[3]=+(e[3]?e[4]+(e[5]||1):2*(e[2]==="even"||e[2]==="odd")),e[4]=+(e[6]+e[7]||e[2]==="odd")):e[2]&&n.error(e[0]),e},PSEUDO:function(e){var t,n;if(ft.CHILD.test(e[0]))return null;if(e[3])e[2]=e[3];else if(t=e[4])tt.test(t)&&(n=u(t,!0))&&(n=t.indexOf(")",t.length-n)-t.length)&&(t=t.slice(0,n),e[0]=e[0].slice(0,n)),e[2]=t;return e.slice(0,3)}},filter:{ID:y?function(e){return e=e.replace(at,""),function(t){return t.getAttribute("id")===e}}:function(e){return e=e.replace(at,""),function(t){var n=typeof t.getAttributeNode!==L&&t.getAttributeNode("id");return n&&n.value===e}},TAG:function(e){return e==="*"?function(){return!0}:(e=e.replace(at,"").toLowerCase(),function(t){return t.nodeName&&t.nodeName.toLowerCase()===e})},CLASS:function(e){var t=R[A][e+" "];return t||(t=new RegExp("(^|"+W+")"+e+"("+W+"|$)"))&&R(e,function(e){return t.test(e.className||typeof e.getAttribute!==L&&e.getAttribute("class")||"")})},ATTR:function(e,t,r){return function(i,s){var o=n.attr(i,e);return o==null?t==="!=":t?(o+="",t==="="?o===r:t==="!="?o!==r:t==="^="?r&&o.indexOf(r)===0:t==="*="?r&&o.indexOf(r)>-1:t==="$="?r&&o.substr(o.length-r.length)===r:t==="~="?(" "+o+" ").indexOf(r)>-1:t==="|="?o===r||o.substr(0,r.length+1)===r+"-":!1):!0}},CHILD:function(e,t,n,r){return e==="nth"?function(e){var t,i,s=e.parentNode;if(n===1&&r===0)return!0;if(s){i=0;for(t=s.firstChild;t;t=t.nextSibling)if(t.nodeType===1){i++;if(e===t)break}}return i-=r,i===n||i%n===0&&i/n>=0}:function(t){var n=t;switch(e){case"only":case"first":while(n=n.previousSibling)if(n.nodeType===1)return!1;if(e==="first")return!0;n=t;case"last":while(n=n.nextSibling)if(n.nodeType===1)return!1;return!0}}},PSEUDO:function(e,t){var r,i=b.pseudos[e]||b.setFilters[e.toLowerCase()]||n.error("unsupported pseudo: "+e);return i[A]?i(t):i.length>1?(r=[e,e,"",t],b.setFilters.hasOwnProperty(e.toLowerCase())?I(function(e,n){var r,s=i(e,t),o=s.length;while(o--)r=F.call(e,s[o]),e[r]=!(n[r]=s[o])}):function(e){return i(e,0,r)}):i}},pseudos:{not:I(function(e){var t=[],n=[],r=x(e.replace(G,"$1"));return r[A]?I(function(e,t,n,i){var s,o=r(e,null,i,[]),u=e.length;while(u--)if(s=o[u])e[u]=!(t[u]=s)}):function(e,i,s){return t[0]=e,r(t,null,s,n),!n.pop()}}),has:I(function(e){return function(t){return n(e,t).length>0}}),contains:I(function(e){return function(t){return(t.textContent||t.innerText||w(t)).indexOf(e)>-1}}),enabled:function(e){return e.disabled===!1},disabled:function(e){return e.disabled===!0},checked:function(e){var t=e.nodeName.toLowerCase();return t==="input"&&!!e.checked||t==="option"&&!!e.selected},selected:function(e){return e.parentNode&&e.parentNode.selectedIndex,e.selected===!0},parent:function(e){return!b.pseudos.empty(e)},empty:function(e){var t;e=e.firstChild;while(e){if(e.nodeName>"@"||(t=e.nodeType)===3||t===4)return!1;e=e.nextSibling}return!0},header:function(e){return ot.test(e.nodeName)},text:function(e){var t,n;return e.nodeName.toLowerCase()==="input"&&(t=e.type)==="text"&&((n=e.getAttribute("type"))==null||n.toLowerCase()===t)},radio:r("radio"),checkbox:r("checkbox"),file:r("file"),password:r("password"),image:r("image"),submit:i("submit"),reset:i("reset"),button:function(e){var t=e.nodeName.toLowerCase();return t==="input"&&e.type==="button"||t==="button"},input:function(e){return ut.test(e.nodeName)},focus:function(e){var t=e.ownerDocument;return e===t.activeElement&&(!t.hasFocus||t.hasFocus())&&!!(e.type||e.href||~e.tabIndex)},active:function(e){return e===e.ownerDocument.activeElement},first:s(function(){return[0]}),last:s(function(e,t){return[t-1]}),eq:s(function(e,t,n){return[n<0?n+t:n]}),even:s(function(e,t){for(var n=0;n<t;n+=2)e.push(n);return e}),odd:s(function(e,t){for(var n=1;n<t;n+=2)e.push(n);return e}),lt:s(function(e,t,n){for(var r=n<0?n+t:n;--r>=0;)e.push(r);return e}),gt:s(function(e,t,n){for(var r=n<0?n+t:n;++r<t;)e.push(r);return e})}},T=_.compareDocumentPosition?function(e,t){return e===t?(N=!0,0):(!e.compareDocumentPosition||!t.compareDocumentPosition?e.compareDocumentPosition:e.compareDocumentPosition(t)&4)?-1:1}:function(e,t){if(e===t)return N=!0,0;if(e.sourceIndex&&t.sourceIndex)return e.sourceIndex-t.sourceIndex;var n,r,i=[],s=[],u=e.parentNode,a=t.parentNode,f=u;if(u===a)return o(e,t);if(!u)return-1;if(!a)return 1;while(f)i.unshift(f),f=f.parentNode;f=a;while(f)s.unshift(f),f=f.parentNode;n=i.length,r=s.length;for(var l=0;l<n&&l<r;l++)if(i[l]!==s[l])return o(i[l],s[l]);return l===n?o(e,s[l],-1):o(i[l],t,1)},[0,0].sort(T),k=!N,n.uniqueSort=function(e){var t,n=[],r=1,i=0;N=k,e.sort(T);if(N){for(;t=e[r];r++)t===e[r-1]&&(i=n.push(r));while(i--)e.splice(n[i],1)}return e},n.error=function(e){throw new Error("Syntax error, unrecognized expression: "+e)},x=n.compile=function(e,t){var n,r=[],i=[],s=z[A][e+" "];if(!s){t||(t=u(e)),n=t.length;while(n--)s=h(t[n]),s[A]?r.push(s):i.push(s);s=z(e,p(i,r))}return s},M.querySelectorAll&&function(){var e,t=v,r=/'|\\/g,i=/\=[\x20\t\r\n\f]*([^'"\]]*)[\x20\t\r\n\f]*\]/g,s=[":focus"],o=[":active"],a=_.matchesSelector||_.mozMatchesSelector||_.webkitMatchesSelector||_.oMatchesSelector||_.msMatchesSelector;lt(function(e){e.innerHTML="<select><option selected=''></option></select>",e.querySelectorAll("[selected]").length||s.push("\\["+W+"*(?:checked|disabled|ismap|multiple|readonly|selected|value)"),e.querySelectorAll(":checked").length||s.push(":checked")}),lt(function(e){e.innerHTML="<p test=''></p>",e.querySelectorAll("[test^='']").length&&s.push("[*^$]="+W+"*(?:\"\"|'')"),e.innerHTML="<input type='hidden'/>",e.querySelectorAll(":enabled").length||s.push(":enabled",":disabled")}),s=new RegExp(s.join("|")),v=function(e,n,i,o,a){if(!o&&!a&&!s.test(e)){var f,l,c=!0,h=A,p=n,d=n.nodeType===9&&e;if(n.nodeType===1&&n.nodeName.toLowerCase()!=="object"){f=u(e),(c=n.getAttribute("id"))?h=c.replace(r,"\\$&"):n.setAttribute("id",h),h="[id='"+h+"'] ",l=f.length;while(l--)f[l]=h+f[l].join("");p=it.test(e)&&n.parentNode||n,d=f.join(",")}if(d)try{return B.apply(i,j.call(p.querySelectorAll(d),0)),i}catch(v){}finally{c||n.removeAttribute("id")}}return t(e,n,i,o,a)},a&&(lt(function(t){e=a.call(t,"div");try{a.call(t,"[test!='']:sizzle"),o.push("!=",K)}catch(n){}}),o=new RegExp(o.join("|")),n.matchesSelector=function(t,r){r=r.replace(i,"='$1']");if(!E(t)&&!o.test(r)&&!s.test(r))try{var u=a.call(t,r);if(u||e||t.document&&t.document.nodeType!==11)return u}catch(f){}return n(r,null,null,[t]).length>0})}(),b.pseudos.nth=b.pseudos.eq,b.filters=m.prototype=b.pseudos,b.setFilters=new m,n.attr=Y.attr,Y.find=n,Y.expr=n.selectors,Y.expr[":"]=Y.expr.pseudos,Y.unique=n.uniqueSort,Y.text=n.getText,Y.isXMLDoc=n.isXML,Y.contains=n.contains}(e);var Pt=/Until$/,Ht=/^(?:parents|prev(?:Until|All))/,Bt=/^.[^:#\[\.,]*$/,jt=Y.expr.match.needsContext,Ft={children:!0,contents:!0,next:!0,prev:!0};Y.fn.extend({find:function(e){var t,n,r,i,s,o,u=this;if(typeof e!="string")return Y(e).filter(function(){for(t=0,n=u.length;t<n;t++)if(Y.contains(u[t],this))return!0});o=this.pushStack("","find",e);for(t=0,n=this.length;t<n;t++){r=o.length,Y.find(e,this[t],o);if(t>0)for(i=r;i<o.length;i++)for(s=0;s<r;s++)if(o[s]===o[i]){o.splice(i--,1);break}}return o},has:function(e){var t,n=Y(e,this),r=n.length;return this.filter(function(){for(t=0;t<r;t++)if(Y.contains(this,n[t]))return!0})},not:function(e){return this.pushStack(f(this,e,!1),"not",e)},filter:function(e){return this.pushStack(f(this,e,!0),"filter",e)},is:function(e){return!!e&&(typeof e=="string"?jt.test(e)?Y(e,this.context).index(this[0])>=0:Y.filter(e,this).length>0:this.filter(e).length>0)},closest:function(e,t){var n,r=0,i=this.length,s=[],o=jt.test(e)||typeof e!="string"?Y(e,t||this.context):0;for(;r<i;r++){n=this[r];while(n&&n.ownerDocument&&n!==t&&n.nodeType!==11){if(o?o.index(n)>-1:Y.find.matchesSelector(n,e)){s.push(n);break}n=n.parentNode}}return s=s.length>1?Y.unique(s):s,this.pushStack(s,"closest",e)},index:function(e){return e?typeof e=="string"?Y.inArray(this[0],Y(e)):Y.inArray(e.jquery?e[0]:e,this):this[0]&&this[0].parentNode?this.prevAll().length:-1},add:function(e,t){var n=typeof e=="string"?Y(e,t):Y.makeArray(e&&e.nodeType?[e]:e),r=Y.merge(this.get(),n);return this.pushStack(u(n[0])||u(r[0])?r:Y.unique(r))},addBack:function(e){return this.add(e==null?this.prevObject:this.prevObject.filter(e))}}),Y.fn.andSelf=Y.fn.addBack,Y.each({parent:function(e){var t=e.parentNode;return t&&t.nodeType!==11?t:null},parents:function(e){return Y.dir(e,"parentNode")},parentsUntil:function(e,t,n){return Y.dir(e,"parentNode",n)},next:function(e){return a(e,"nextSibling")},prev:function(e){return a(e,"previousSibling")},nextAll:function(e){return Y.dir(e,"nextSibling")},prevAll:function(e){return Y.dir(e,"previousSibling")},nextUntil:function(e,t,n){return Y.dir(e,"nextSibling",n)},prevUntil:function(e,t,n){return Y.dir(e,"previousSibling",n)},siblings:function(e){return Y.sibling((e.parentNode||{}).firstChild,e)},children:function(e){return Y.sibling(e.firstChild)},contents:function(e){return Y.nodeName(e,"iframe")?e.contentDocument||e.contentWindow.document:Y.merge([],e.childNodes)}},function(e,t){Y.fn[e]=function(n,r){var i=Y.map(this,t,n);return Pt.test(e)||(r=n),r&&typeof r=="string"&&(i=Y.filter(r,i)),i=this.length>1&&!Ft[e]?Y.unique(i):i,this.length>1&&Ht.test(e)&&(i=i.reverse()),this.pushStack(i,e,$.call(arguments).join(","))}}),Y.extend({filter:function(e,t,n){return n&&(e=":not("+e+")"),t.length===1?Y.find.matchesSelector(t[0],e)?[t[0]]:[]:Y.find.matches(e,t)},dir:function(e,n,r){var i=[],s=e[n];while(s&&s.nodeType!==9&&(r===t||s.nodeType!==1||!Y(s).is(r)))s.nodeType===1&&i.push(s),s=s[n];return i},sibling:function(e,t){var n=[];for(;e;e=e.nextSibling)e.nodeType===1&&e!==t&&n.push(e);return n}});var It="abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",qt=/ jQuery\d+="(?:null|\d+)"/g,Rt=/^\s+/,Ut=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,zt=/<([\w:]+)/,Wt=/<tbody/i,Xt=/<|&#?\w+;/,Vt=/<(?:script|style|link)/i,$t=/<(?:script|object|embed|option|style)/i,Jt=new RegExp("<(?:"+It+")[\\s/>]","i"),Kt=/^(?:checkbox|radio)$/,Qt=/checked\s*(?:[^=]|=\s*.checked.)/i,Gt=/\/(java|ecma)script/i,Yt=/^\s*<!(?:\[CDATA\[|\-\-)|[\]\-]{2}>\s*$/g,Zt={option:[1,"<select multiple='multiple'>","</select>"],legend:[1,"<fieldset>","</fieldset>"],thead:[1,"<table>","</table>"],tr:[2,"<table><tbody>","</tbody></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],col:[2,"<table><tbody></tbody><colgroup>","</colgroup></table>"],area:[1,"<map>","</map>"],_default:[0,"",""]},en=l(R),tn=en.appendChild(R.createElement("div"));Zt.optgroup=Zt.option,Zt.tbody=Zt.tfoot=Zt.colgroup=Zt.caption=Zt.thead,Zt.th=Zt.td,Y.support.htmlSerialize||(Zt._default=[1,"X<div>","</div>"]),Y.fn.extend({text:function(e){return Y.access(this,function(e){return e===t?Y.text(this):this.empty().append((this[0]&&this[0].ownerDocument||R).createTextNode(e))},null,e,arguments.length)},wrapAll:function(e){if(Y.isFunction(e))return this.each(function(t){Y(this).wrapAll(e.call(this,t))});if(this[0]){var t=Y(e,this[0].ownerDocument).eq(0).clone(!0);this[0].parentNode&&t.insertBefore(this[0]),t.map(function(){var e=this;while(e.firstChild&&e.firstChild.nodeType===1)e=e.firstChild;return e}).append(this)}return this},wrapInner:function(e){return Y.isFunction(e)?this.each(function(t){Y(this).wrapInner(e.call(this,t))}):this.each(function(){var t=Y(this),n=t.contents();n.length?n.wrapAll(e):t.append(e)})},wrap:function(e){var t=Y.isFunction(e);return this.each(function(n){Y(this).wrapAll(t?e.call(this,n):e)})},unwrap:function(){return this.parent().each(function(){Y.nodeName(this,"body")||Y(this).replaceWith(this.childNodes)}).end()},append:function(){return this.domManip(arguments,!0,function(e){(this.nodeType===1||this.nodeType===11)&&this.appendChild(e)})},prepend:function(){return this.domManip(arguments,!0,function(e){(this.nodeType===1||this.nodeType===11)&&this.insertBefore(e,this.firstChild)})},before:function(){if(!u(this[0]))return this.domManip(arguments,!1,function(e){this.parentNode.insertBefore(e,this)});if(arguments.length){var e=Y.clean(arguments);return this.pushStack(Y.merge(e,this),"before",this.selector)}},after:function(){if(!u(this[0]))return this.domManip(arguments,!1,function(e){this.parentNode.insertBefore(e,this.nextSibling)});if(arguments.length){var e=Y.clean(arguments);return this.pushStack(Y.merge(this,e),"after",this.selector)}},remove:function(e,t){var n,r=0;for(;(n=this[r])!=null;r++)if(!e||Y.filter(e,[n]).length)!t&&n.nodeType===1&&(Y.cleanData(n.getElementsByTagName("*")),Y.cleanData([n])),n.parentNode&&n.parentNode.removeChild(n);return this},empty:function(){var e,t=0;for(;(e=this[t])!=null;t++){e.nodeType===1&&Y.cleanData(e.getElementsByTagName("*"));while(e.firstChild)e.removeChild(e.firstChild)}return this},clone:function(e,t){return e=e==null?!1:e,t=t==null?e:t,this.map(function(){return Y.clone(this,e,t)})},html:function(e){return Y.access(this,function(e){var n=this[0]||{},r=0,i=this.length;if(e===t)return n.nodeType===1?n.innerHTML.replace(qt,""):t;if(typeof e=="string"&&!Vt.test(e)&&(Y.support.htmlSerialize||!Jt.test(e))&&(Y.support.leadingWhitespace||!Rt.test(e))&&!Zt[(zt.exec(e)||["",""])[1].toLowerCase()]){e=e.replace(Ut,"<$1></$2>");try{for(;r<i;r++)n=this[r]||{},n.nodeType===1&&(Y.cleanData(n.getElementsByTagName("*")),n.innerHTML=e);n=0}catch(s){}}n&&this.empty().append(e)},null,e,arguments.length)},replaceWith:function(e){return u(this[0])?this.length?this.pushStack(Y(Y.isFunction(e)?e():e),"replaceWith",e):this:Y.isFunction(e)?this.each(function(t){var n=Y(this),r=n.html();n.replaceWith(e.call(this,t,r))}):(typeof e!="string"&&(e=Y(e).detach()),this.each(function(){var t=this.nextSibling,n=this.parentNode;Y(this).remove(),t?Y(t).before(e):Y(n).append(e)}))},detach:function(e){return this.remove(e,!0)},domManip:function(e,n,r){e=[].concat.apply([],e);var i,s,o,u,a=0,f=e[0],l=[],h=this.length;if(!Y.support.checkClone&&h>1&&typeof f=="string"&&Qt.test(f))return this.each(function(){Y(this).domManip(e,n,r)});if(Y.isFunction(f))return this.each(function(i){var s=Y(this);e[0]=f.call(this,i,n?s.html():t),s.domManip(e,n,r)});if(this[0]){i=Y.buildFragment(e,this,l),o=i.fragment,s=o.firstChild,o.childNodes.length===1&&(o=s);if(s){n=n&&Y.nodeName(s,"tr");for(u=i.cacheable||h-1;a<h;a++)r.call(n&&Y.nodeName(this[a],"table")?c(this[a],"tbody"):this[a],a===u?o:Y.clone(o,!0,!0))}o=s=null,l.length&&Y.each(l,function(e,t){t.src?Y.ajax?Y.ajax({url:t.src,type:"GET",dataType:"script",async:!1,global:!1,"throws":!0}):Y.error("no ajax"):Y.globalEval((t.text||t.textContent||t.innerHTML||"").replace(Yt,"")),t.parentNode&&t.parentNode.removeChild(t)})}return this}}),Y.buildFragment=function(e,n,r){var i,s,o,u=e[0];return n=n||R,n=!n.nodeType&&n[0]||n,n=n.ownerDocument||n,e.length===1&&typeof u=="string"&&u.length<512&&n===R&&u.charAt(0)==="<"&&!$t.test(u)&&(Y.support.checkClone||!Qt.test(u))&&(Y.support.html5Clone||!Jt.test(u))&&(s=!0,i=Y.fragments[u],o=i!==t),i||(i=n.createDocumentFragment(),Y.clean(e,n,i,r),s&&(Y.fragments[u]=o&&i)),{fragment:i,cacheable:s}},Y.fragments={},Y.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(e,t){Y.fn[e]=function(n){var r,i=0,s=[],o=Y(n),u=o.length,a=this.length===1&&this[0].parentNode;if((a==null||a&&a.nodeType===11&&a.childNodes.length===1)&&u===1)return o[t](this[0]),this;for(;i<u;i++)r=(i>0?this.clone(!0):this).get(),Y(o[i])[t](r),s=s.concat(r);return this.pushStack(s,e,o.selector)}}),Y.extend({clone:function(e,t,n){var r,i,s,o;Y.support.html5Clone||Y.isXMLDoc(e)||!Jt.test("<"+e.nodeName+">")?o=e.cloneNode(!0):(tn.innerHTML=e.outerHTML,tn.removeChild(o=tn.firstChild));if((!Y.support.noCloneEvent||!Y.support.noCloneChecked)&&(e.nodeType===1||e.nodeType===11)&&!Y.isXMLDoc(e)){p(e,o),r=d(e),i=d(o);for(s=0;r[s];++s)i[s]&&p(r[s],i[s])}if(t){h(e,o);if(n){r=d(e),i=d(o);for(s=0;r[s];++s)h(r[s],i[s])}}return r=i=null,o},clean:function(e,t,n,r){var i,s,o,u,a,f,c,h,p,d,m,g,y=t===R&&en,b=[];if(!t||typeof t.createDocumentFragment=="undefined")t=R;for(i=0;(o=e[i])!=null;i++){typeof o=="number"&&(o+="");if(!o)continue;if(typeof o=="string")if(!Xt.test(o))o=t.createTextNode(o);else{y=y||l(t),c=t.createElement("div"),y.appendChild(c),o=o.replace(Ut,"<$1></$2>"),u=(zt.exec(o)||["",""])[1].toLowerCase(),a=Zt[u]||Zt._default,f=a[0],c.innerHTML=a[1]+o+a[2];while(f--)c=c.lastChild;if(!Y.support.tbody){h=Wt.test(o),p=u==="table"&&!h?c.firstChild&&c.firstChild.childNodes:a[1]==="<table>"&&!h?c.childNodes:[];for(s=p.length-1;s>=0;--s)Y.nodeName(p[s],"tbody")&&!p[s].childNodes.length&&p[s].parentNode.removeChild(p[s])}!Y.support.leadingWhitespace&&Rt.test(o)&&c.insertBefore(t.createTextNode(Rt.exec(o)[0]),c.firstChild),o=c.childNodes,c.parentNode.removeChild(c)}o.nodeType?b.push(o):Y.merge(b,o)}c&&(o=c=y=null);if(!Y.support.appendChecked)for(i=0;(o=b[i])!=null;i++)Y.nodeName(o,"input")?v(o):typeof o.getElementsByTagName!="undefined"&&Y.grep(o.getElementsByTagName("input"),v);if(n){m=function(e){if(!e.type||Gt.test(e.type))return r?r.push(e.parentNode?e.parentNode.removeChild(e):e):n.appendChild(e)};for(i=0;(o=b[i])!=null;i++)if(!Y.nodeName(o,"script")||!m(o))n.appendChild(o),typeof o.getElementsByTagName!="undefined"&&(g=Y.grep(Y.merge([],o.getElementsByTagName("script")),m),b.splice.apply(b,[i+1,0].concat(g)),i+=g.length)}return b},cleanData:function(e,t){var n,r,i,s,o=0,u=Y.expando,a=Y.cache,f=Y.support.deleteExpando,l=Y.event.special;for(;(i=e[o])!=null;o++)if(t||Y.acceptData(i)){r=i[u],n=r&&a[r];if(n){if(n.events)for(s in n.events)l[s]?Y.event.remove(i,s):Y.removeEvent(i,s,n.handle);a[r]&&(delete a[r],f?delete i[u]:i.removeAttribute?i.removeAttribute(u):i[u]=null,Y.deletedIds.push(r))}}}}),function(){var e,t;Y.uaMatch=function(e){e=e.toLowerCase();var t=/(chrome)[ \/]([\w.]+)/.exec(e)||/(webkit)[ \/]([\w.]+)/.exec(e)||/(opera)(?:.*version|)[ \/]([\w.]+)/.exec(e)||/(msie) ([\w.]+)/.exec(e)||e.indexOf("compatible")<0&&/(mozilla)(?:.*? rv:([\w.]+)|)/.exec(e)||[];return{browser:t[1]||"",version:t[2]||"0"}},e=Y.uaMatch(z.userAgent),t={},e.browser&&(t[e.browser]=!0,t.version=e.version),t.chrome?t.webkit=!0:t.webkit&&(t.safari=!0),Y.browser=t,Y.sub=function(){function e(t,n){return new e.fn.init(t,n)}Y.extend(!0,e,this),e.superclass=this,e.fn=e.prototype=this(),e.fn.constructor=e,e.sub=this.sub,e.fn.init=function(n,r){return r&&r instanceof Y&&!(r instanceof e)&&(r=e(r)),Y.fn.init.call(this,n,r,t)},e.fn.init.prototype=e.fn;var t=e(R);return e}}();var nn,rn,sn,on=/alpha\([^)]*\)/i,un=/opacity=([^)]*)/,an=/^(top|right|bottom|left)$/,fn=/^(none|table(?!-c[ea]).+)/,ln=/^margin/,cn=new RegExp("^("+Z+")(.*)$","i"),hn=new RegExp("^("+Z+")(?!px)[a-z%]+$","i"),pn=new RegExp("^([-+])=("+Z+")","i"),dn={BODY:"block"},vn={position:"absolute",visibility:"hidden",display:"block"},mn={letterSpacing:0,fontWeight:400},gn=["Top","Right","Bottom","Left"],yn=["Webkit","O","Moz","ms"],bn=Y.fn.toggle;Y.fn.extend({css:function(e,n){return Y.access(this,function(e,n,r){return r!==t?Y.style(e,n,r):Y.css(e,n)},e,n,arguments.length>1)},show:function(){return y(this,!0)},hide:function(){return y(this)},toggle:function(e,t){var n=typeof e=="boolean";return Y.isFunction(e)&&Y.isFunction(t)?bn.apply(this,arguments):this.each(function(){(n?e:g(this))?Y(this).show():Y(this).hide()})}}),Y.extend({cssHooks:{opacity:{get:function(e,t){if(t){var n=nn(e,"opacity");return n===""?"1":n}}}},cssNumber:{fillOpacity:!0,fontWeight:!0,lineHeight:!0,opacity:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":Y.support.cssFloat?"cssFloat":"styleFloat"},style:function(e,n,r,i){if(!e||e.nodeType===3||e.nodeType===8||!e.style)return;var s,o,u,a=Y.camelCase(n),f=e.style;n=Y.cssProps[a]||(Y.cssProps[a]=m(f,a)),u=Y.cssHooks[n]||Y.cssHooks[a];if(r===t)return u&&"get"in u&&(s=u.get(e,!1,i))!==t?s:f[n];o=typeof r,o==="string"&&(s=pn.exec(r))&&(r=(s[1]+1)*s[2]+parseFloat(Y.css(e,n)),o="number");if(r==null||o==="number"&&isNaN(r))return;o==="number"&&!Y.cssNumber[a]&&(r+="px");if(!u||!("set"in u)||(r=u.set(e,r,i))!==t)try{f[n]=r}catch(l){}},css:function(e,n,r,i){var s,o,u,a=Y.camelCase(n);return n=Y.cssProps[a]||(Y.cssProps[a]=m(e.style,a)),u=Y.cssHooks[n]||Y.cssHooks[a],u&&"get"in u&&(s=u.get(e,!0,i)),s===t&&(s=nn(e,n)),s==="normal"&&n in mn&&(s=mn[n]),r||i!==t?(o=parseFloat(s),r||Y.isNumeric(o)?o||0:s):s},swap:function(e,t,n){var r,i,s={};for(i in t)s[i]=e.style[i],e.style[i]=t[i];r=n.call(e);for(i in t)e.style[i]=s[i];return r}}),e.getComputedStyle?nn=function(t,n){var r,i,s,o,u=e.getComputedStyle(t,null),a=t.style;return u&&(r=u.getPropertyValue(n)||u[n],r===""&&!Y.contains(t.ownerDocument,t)&&(r=Y.style(t,n)),hn.test(r)&&ln.test(n)&&(i=a.width,s=a.minWidth,o=a.maxWidth,a.minWidth=a.maxWidth=a.width=r,r=u.width,a.width=i,a.minWidth=s,a.maxWidth=o)),r}:R.documentElement.currentStyle&&(nn=function(e,t){var n,r,i=e.currentStyle&&e.currentStyle[t],s=e.style;return i==null&&s&&s[t]&&(i=s[t]),hn.test(i)&&!an.test(t)&&(n=s.left,r=e.runtimeStyle&&e.runtimeStyle.left,r&&(e.runtimeStyle.left=e.currentStyle.left),s.left=t==="fontSize"?"1em":i,i=s.pixelLeft+"px",s.left=n,r&&(e.runtimeStyle.left=r)),i===""?"auto":i}),Y.each(["height","width"],function(e,t){Y.cssHooks[t]={get:function(e,n,r){if(n)return e.offsetWidth===0&&fn.test(nn(e,"display"))?Y.swap(e,vn,function(){return E(e,t,r)}):E(e,t,r)},set:function(e,n,r){return b(e,n,r?w(e,t,r,Y.support.boxSizing&&Y.css(e,"boxSizing")==="border-box"):0)}}}),Y.support.opacity||(Y.cssHooks.opacity={get:function(e,t){return un.test((t&&e.currentStyle?e.currentStyle.filter:e.style.filter)||"")?.01*parseFloat(RegExp.$1)+"":t?"1":""},set:function(e,t){var n=e.style,r=e.currentStyle,i=Y.isNumeric(t)?"alpha(opacity="+t*100+")":"",s=r&&r.filter||n.filter||"";n.zoom=1;if(t>=1&&Y.trim(s.replace(on,""))===""&&n.removeAttribute){n.removeAttribute("filter");if(r&&!r.filter)return}n.filter=on.test(s)?s.replace(on,i):s+" "+i}}),Y(function(){Y.support.reliableMarginRight||(Y.cssHooks.marginRight={get:function(e,t){return Y.swap(e,{display:"inline-block"},function(){if(t)return nn(e,"marginRight")})}}),!Y.support.pixelPosition&&Y.fn.position&&Y.each(["top","left"],function(e,t){Y.cssHooks[t]={get:function(e,n){if(n){var r=nn(e,t);return hn.test(r)?Y(e).position()[t]+"px":r}}}})}),Y.expr&&Y.expr.filters&&(Y.expr.filters.hidden=function(e){return e.offsetWidth===0&&e.offsetHeight===0||!Y.support.reliableHiddenOffsets&&(e.style&&e.style.display||nn(e,"display"))==="none"},Y.expr.filters.visible=function(e){return!Y.expr.filters.hidden(e)}),Y.each({margin:"",padding:"",border:"Width"},function(e,t){Y.cssHooks[e+t]={expand:function(n){var r,i=typeof n=="string"?n.split(" "):[n],s={};for(r=0;r<4;r++)s[e+gn[r]+t]=i[r]||i[r-2]||i[0];return s}},ln.test(e)||(Y.cssHooks[e+t].set=b)});var wn=/%20/g,En=/\[\]$/,Sn=/\r?\n/g,xn=/^(?:color|date|datetime|datetime-local|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,Tn=/^(?:select|textarea)/i;Y.fn.extend({serialize:function(){return Y.param(this.serializeArray())},serializeArray:function(){return this.map(function(){return this.elements?Y.makeArray(this.elements):this}).filter(function(){return this.name&&!this.disabled&&(this.checked||Tn.test(this.nodeName)||xn.test(this.type))}).map(function(e,t){var n=Y(this).val();return n==null?null:Y.isArray(n)?Y.map(n,function(e,n){return{name:t.name,value:e.replace(Sn,"\r\n")}}):{name:t.name,value:n.replace(Sn,"\r\n")}}).get()}}),Y.param=function(e,n){var r,i=[],s=function(e,t){t=Y.isFunction(t)?t():t==null?"":t,i[i.length]=encodeURIComponent(e)+"="+encodeURIComponent(t)};n===t&&(n=Y.ajaxSettings&&Y.ajaxSettings.traditional);if(Y.isArray(e)||e.jquery&&!Y.isPlainObject(e))Y.each(e,function(){s(this.name,this.value)});else for(r in e)x(r,e[r],n,s);return i.join("&").replace(wn,"+")};var Nn,Cn,kn=/#.*$/,Ln=/^(.*?):[ \t]*([^\r\n]*)\r?$/mg,An=/^(?:about|app|app\-storage|.+\-extension|file|res|widget):$/,On=/^(?:GET|HEAD)$/,Mn=/^\/\//,_n=/\?/,Dn=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,Pn=/([?&])_=[^&]*/,Hn=/^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,Bn=Y.fn.load,jn={},Fn={},In=["*/"]+["*"];try{Cn=U.href}catch(qn){Cn=R.createElement("a"),Cn.href="",Cn=Cn.href}Nn=Hn.exec(Cn.toLowerCase())||[],Y.fn.load=function(e,n,r){if(typeof e!="string"&&Bn)return Bn.apply(this,arguments);if(!this.length)return this;var i,s,o,u=this,a=e.indexOf(" ");return a>=0&&(i=e.slice(a,e.length),e=e.slice(0,a)),Y.isFunction(n)?(r=n,n=t):n&&typeof n=="object"&&(s="POST"),Y.ajax({url:e,type:s,dataType:"html",data:n,complete:function(e,t){r&&u.each(r,o||[e.responseText,t,e])}}).done(function(e){o=arguments,u.html(i?Y("<div>").append(e.replace(Dn,"")).find(i):e)}),this},Y.each("ajaxStart ajaxStop ajaxComplete ajaxError ajaxSuccess ajaxSend".split(" "),function(e,t){Y.fn[t]=function(e){return this.on(t,e)}}),Y.each(["get","post"],function(e,n){Y[n]=function(e,r,i,s){return Y.isFunction(r)&&(s=s||i,i=r,r=t),Y.ajax({type:n,url:e,data:r,success:i,dataType:s})}}),Y.extend({getScript:function(e,n){return Y.get(e,t,n,"script")},getJSON:function(e,t,n){return Y.get(e,t,n,"json")},ajaxSetup:function(e,t){return t?C(e,Y.ajaxSettings):(t=e,e=Y.ajaxSettings),C(e,t),e},ajaxSettings:{url:Cn,isLocal:An.test(Nn[1]),global:!0,type:"GET",contentType:"application/x-www-form-urlencoded; charset=UTF-8",processData:!0,async:!0,accepts:{xml:"application/xml, text/xml",html:"text/html",text:"text/plain",json:"application/json, text/javascript","*":In},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":e.String,"text html":!0,"text json":Y.parseJSON,"text xml":Y.parseXML},flatOptions:{context:!0,url:!0}},ajaxPrefilter:T(jn),ajaxTransport:T(Fn),ajax:function(e,n){function r(e,n,r,o){var f,c,y,b,E,x=n;if(w===2)return;w=2,a&&clearTimeout(a),u=t,s=o||"",S.readyState=e>0?4:0,r&&(b=k(h,S,r));if(e>=200&&e<300||e===304)h.ifModified&&(E=S.getResponseHeader("Last-Modified"),E&&(Y.lastModified[i]=E),E=S.getResponseHeader("Etag"),E&&(Y.etag[i]=E)),e===304?(x="notmodified",f=!0):(f=L(h,b),x=f.state,c=f.data,y=f.error,f=!y);else{y=x;if(!x||e)x="error",e<0&&(e=0)}S.status=e,S.statusText=(n||x)+"",f?v.resolveWith(p,[c,x,S]):v.rejectWith(p,[S,x,y]),S.statusCode(g),g=t,l&&d.trigger("ajax"+(f?"Success":"Error"),[S,h,f?c:y]),m.fireWith(p,[S,x]),l&&(d.trigger("ajaxComplete",[S,h]),--Y.active||Y.event.trigger("ajaxStop"))}typeof e=="object"&&(n=e,e=t),n=n||{};var i,s,o,u,a,f,l,c,h=Y.ajaxSetup({},n),p=h.context||h,d=p!==h&&(p.nodeType||p instanceof Y)?Y(p):Y.event,v=Y.Deferred(),m=Y.Callbacks("once memory"),g=h.statusCode||{},y={},b={},w=0,E="canceled",S={readyState:0,setRequestHeader:function(e,t){if(!w){var n=e.toLowerCase();e=b[n]=b[n]||e,y[e]=t}return this},getAllResponseHeaders:function(){return w===2?s:null},getResponseHeader:function(e){var n;if(w===2){if(!o){o={};while(n=Ln.exec(s))o[n[1].toLowerCase()]=n[2]}n=o[e.toLowerCase()]}return n===t?null:n},overrideMimeType:function(e){return w||(h.mimeType=e),this},abort:function(e){return e=e||E,u&&u.abort(e),r(0,e),this}};v.promise(S),S.success=S.done,S.error=S.fail,S.complete=m.add,S.statusCode=function(e){if(e){var t;if(w<2)for(t in e)g[t]=[g[t],e[t]];else t=e[S.status],S.always(t)}return this},h.url=((e||h.url)+"").replace(kn,"").replace(Mn,Nn[1]+"//"),h.dataTypes=Y.trim(h.dataType||"*").toLowerCase().split(tt),h.crossDomain==null&&(f=Hn.exec(h.url.toLowerCase()),h.crossDomain=!(!f||f[1]===Nn[1]&&f[2]===Nn[2]&&(f[3]||(f[1]==="http:"?80:443))==(Nn[3]||(Nn[1]==="http:"?80:443)))),h.data&&h.processData&&typeof h.data!="string"&&(h.data=Y.param(h.data,h.traditional)),N(jn,h,n,S);if(w===2)return S;l=h.global,h.type=h.type.toUpperCase(),h.hasContent=!On.test(h.type),l&&Y.active++===0&&Y.event.trigger("ajaxStart");if(!h.hasContent){h.data&&(h.url+=(_n.test(h.url)?"&":"?")+h.data,delete h.data),i=h.url;if(h.cache===!1){var x=Y.now(),T=h.url.replace(Pn,"$1_="+x);h.url=T+(T===h.url?(_n.test(h.url)?"&":"?")+"_="+x:"")}}(h.data&&h.hasContent&&h.contentType!==!1||n.contentType)&&S.setRequestHeader("Content-Type",h.contentType),h.ifModified&&(i=i||h.url,Y.lastModified[i]&&S.setRequestHeader("If-Modified-Since",Y.lastModified[i]),Y.etag[i]&&S.setRequestHeader("If-None-Match",Y.etag[i])),S.setRequestHeader("Accept",h.dataTypes[0]&&h.accepts[h.dataTypes[0]]?h.accepts[h.dataTypes[0]]+(h.dataTypes[0]!=="*"?", "+In+"; q=0.01":""):h.accepts["*"]);for(c in h.headers)S.setRequestHeader(c,h.headers[c]);if(!h.beforeSend||h.beforeSend.call(p,S,h)!==!1&&w!==2){E="abort";for(c in{success:1,error:1,complete:1})S[c](h[c]);u=N(Fn,h,n,S);if(!u)r(-1,"No Transport");else{S.readyState=1,l&&d.trigger("ajaxSend",[S,h]),h.async&&h.timeout>0&&(a=setTimeout(function(){S.abort("timeout")},h.timeout));try{w=1,u.send(y,r)}catch(C){if(!(w<2))throw C;r(-1,C)}}return S}return S.abort()},active:0,lastModified:{},etag:{}});var Rn=[],Un=/\?/,zn=/(=)\?(?=&|$)|\?\?/,Wn=Y.now();Y.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var e=Rn.pop()||Y.expando+"_"+Wn++;return this[e]=!0,e}}),Y.ajaxPrefilter("json jsonp",function(n,r,i){var s,o,u,a=n.data,f=n.url,l=n.jsonp!==!1,c=l&&zn.test(f),h=l&&!c&&typeof a=="string"&&!(n.contentType||"").indexOf("application/x-www-form-urlencoded")&&zn.test(a);if(n.dataTypes[0]==="jsonp"||c||h)return s=n.jsonpCallback=Y.isFunction(n.jsonpCallback)?n.jsonpCallback():n.jsonpCallback,o=e[s],c?n.url=f.replace(zn,"$1"+s):h?n.data=a.replace(zn,"$1"+s):l&&(n.url+=(Un.test(f)?"&":"?")+n.jsonp+"="+s),n.converters["script json"]=function(){return u||Y.error(s+" was not called"),u[0]},n.dataTypes[0]="json",e[s]=function(){u=arguments},i.always(function(){e[s]=o,n[s]&&(n.jsonpCallback=r.jsonpCallback,Rn.push(s)),u&&Y.isFunction(o)&&o(u[0]),u=o=t}),"script"}),Y.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/javascript|ecmascript/},converters:{"text script":function(e){return Y.globalEval(e),e}}}),Y.ajaxPrefilter("script",function(e){e.cache===t&&(e.cache=!1),e.crossDomain&&(e.type="GET",e.global=!1)}),Y.ajaxTransport("script",function(e){if(e.crossDomain){var n,r=R.head||R.getElementsByTagName("head")[0]||R.documentElement;return{send:function(i,s){n=R.createElement("script"),n.async="async",e.scriptCharset&&(n.charset=e.scriptCharset),n.src=e.url,n.onload=n.onreadystatechange=function(e,i){if(i||!n.readyState||/loaded|complete/.test(n.readyState))n.onload=n.onreadystatechange=null,r&&n.parentNode&&r.removeChild(n),n=t,i||s(200,"success")},r.insertBefore(n,r.firstChild)},abort:function(){n&&n.onload(0,1)}}}});var Xn,Vn=e.ActiveXObject?function(){for(var e in Xn)Xn[e](0,1)}:!1,$n=0;Y.ajaxSettings.xhr=e.ActiveXObject?function(){return!this.isLocal&&A()||O()}:A,function(e){Y.extend(Y.support,{ajax:!!e,cors:!!e&&"withCredentials"in e})}(Y.ajaxSettings.xhr()),Y.support.ajax&&Y.ajaxTransport(function(n){if(!n.crossDomain||Y.support.cors){var r;return{send:function(i,s){var o,u,a=n.xhr();n.username?a.open(n.type,n.url,n.async,n.username,n.password):a.open(n.type,n.url,n.async);if(n.xhrFields)for(u in n.xhrFields)a[u]=n.xhrFields[u];n.mimeType&&a.overrideMimeType&&a.overrideMimeType(n.mimeType),!n.crossDomain&&!i["X-Requested-With"]&&(i["X-Requested-With"]="XMLHttpRequest");try{for(u in i)a.setRequestHeader(u,i[u])}catch(f){}a.send(n.hasContent&&n.data||null),r=function(e,i){var u,f,l,c,h;try{if(r&&(i||a.readyState===4)){r=t,o&&(a.onreadystatechange=Y.noop,Vn&&delete Xn[o]);if(i)a.readyState!==4&&a.abort();else{u=a.status,l=a.getAllResponseHeaders(),c={},h=a.responseXML,h&&h.documentElement&&(c.xml=h);try{c.text=a.responseText}catch(p){}try{f=a.statusText}catch(p){f=""}!u&&n.isLocal&&!n.crossDomain?u=c.text?200:404:u===1223&&(u=204)}}}catch(d){i||s(-1,d)}c&&s(u,f,c,l)},n.async?a.readyState===4?setTimeout(r,0):(o=++$n,Vn&&(Xn||(Xn={},Y(e).unload(Vn)),Xn[o]=r),a.onreadystatechange=r):r()},abort:function(){r&&r(0,1)}}}});var Jn,Kn,Qn=/^(?:toggle|show|hide)$/,Gn=new RegExp("^(?:([-+])=|)("+Z+")([a-z%]*)$","i"),Yn=/queueHooks$/,Zn=[H],er={"*":[function(e,t){var n,r,i=this.createTween(e,t),s=Gn.exec(t),o=i.cur(),u=+o||0,a=1,f=20;if(s){n=+s[2],r=s[3]||(Y.cssNumber[e]?"":"px");if(r!=="px"&&u){u=Y.css(i.elem,e,!0)||n||1;do a=a||".5",u/=a,Y.style(i.elem,e,u+r);while(a!==(a=i.cur()/o)&&a!==1&&--f)}i.unit=r,i.start=u,i.end=s[1]?u+(s[1]+1)*n:n}return i}]};Y.Animation=Y.extend(D,{tweener:function(e,t){Y.isFunction(e)?(t=e,e=["*"]):e=e.split(" ");var n,r=0,i=e.length;for(;r<i;r++)n=e[r],er[n]=er[n]||[],er[n].unshift(t)},prefilter:function(e,t){t?Zn.unshift(e):Zn.push(e)}}),Y.Tween=B,B.prototype={constructor:B,init:function(e,t,n,r,i,s){this.elem=e,this.prop=n,this.easing=i||"swing",this.options=t,this.start=this.now=this.cur(),this.end=r,this.unit=s||(Y.cssNumber[n]?"":"px")},cur:function(){var e=B.propHooks[this.prop];return e&&e.get?e.get(this):B.propHooks._default.get(this)},run:function(e){var t,n=B.propHooks[this.prop];return this.options.duration?this.pos=t=Y.easing[this.easing](e,this.options.duration*e,0,1,this.options.duration):this.pos=t=e,this.now=(this.end-this.start)*t+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),n&&n.set?n.set(this):B.propHooks._default.set(this),this}},B.prototype.init.prototype=B.prototype,B.propHooks={_default:{get:function(e){var t;return e.elem[e.prop]==null||!!e.elem.style&&e.elem.style[e.prop]!=null?(t=Y.css(e.elem,e.prop,!1,""),!t||t==="auto"?0:t):e.elem[e.prop]},set:function(e){Y.fx.step[e.prop]?Y.fx.step[e.prop](e):e.elem.style&&(e.elem.style[Y.cssProps[e.prop]]!=null||Y.cssHooks[e.prop])?Y.style(e.elem,e.prop,e.now+e.unit):e.elem[e.prop]=e.now}}},B.propHooks.scrollTop=B.propHooks.scrollLeft={set:function(e){e.elem.nodeType&&e.elem.parentNode&&(e.elem[e.prop]=e.now)}},Y.each(["toggle","show","hide"],function(e,t){var n=Y.fn[t];Y.fn[t]=function(r,i,s){return r==null||typeof r=="boolean"||!e&&Y.isFunction(r)&&Y.isFunction(i)?n.apply(this,arguments):this.animate(j(t,!0),r,i,s)}}),Y.fn.extend({fadeTo:function(e,t,n,r){return this.filter(g).css("opacity",0).show().end().animate({opacity:t},e,n,r)},animate:function(e,t,n,r){var i=Y.isEmptyObject(e),s=Y.speed(t,n,r),o=function(){var t=D(this,Y.extend({},e),s);i&&t.stop(!0)};return i||s.queue===!1?this.each(o):this.queue(s.queue,o)},stop:function(e,n,r){var i=function(e){var t=e.stop;delete e.stop,t(r)};return typeof e!="string"&&(r=n,n=e,e=t),n&&e!==!1&&this.queue(e||"fx",[]),this.each(function(){var t=!0,n=e!=null&&e+"queueHooks",s=Y.timers,o=Y._data(this);if(n)o[n]&&o[n].stop&&i(o[n]);else for(n in o)o[n]&&o[n].stop&&Yn.test(n)&&i(o[n]);for(n=s.length;n--;)s[n].elem===this&&(e==null||s[n].queue===e)&&(s[n].anim.stop(r),t=!1,s.splice(n,1));(t||!r)&&Y.dequeue(this,e)})}}),Y.each({slideDown:j("show"),slideUp:j("hide"),slideToggle:j("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(e,t){Y.fn[e]=function(e,n,r){return this.animate(t,e,n,r)}}),Y.speed=function(e,t,n){var r=e&&typeof e=="object"?Y.extend({},e):{complete:n||!n&&t||Y.isFunction(e)&&e,duration:e,easing:n&&t||t&&!Y.isFunction(t)&&t};r.duration=Y.fx.off?0:typeof r.duration=="number"?r.duration:r.duration in Y.fx.speeds?Y.fx.speeds[r.duration]:Y.fx.speeds._default;if(r.queue==null||r.queue===!0)r.queue="fx";return r.old=r.complete,r.complete=function(){Y.isFunction(r.old)&&r.old.call(this),r.queue&&Y.dequeue(this,r.queue)},r},Y.easing={linear:function(e){return e},swing:function(e){return.5-Math.cos(e*Math.PI)/2}},Y.timers=[],Y.fx=B.prototype.init,Y.fx.tick=function(){var e,n=Y.timers,r=0;Jn=Y.now();for(;r<n.length;r++)e=n[r],!e()&&n[r]===e&&n.splice(r--,1);n.length||Y.fx.stop(),Jn=t},Y.fx.timer=function(e){e()&&Y.timers.push(e)&&!Kn&&(Kn=setInterval(Y.fx.tick,Y.fx.interval))},Y.fx.interval=13,Y.fx.stop=function(){clearInterval(Kn),Kn=null},Y.fx.speeds={slow:600,fast:200,_default:400},Y.fx.step={},Y.expr&&Y.expr.filters&&(Y.expr.filters.animated=function(e){return Y.grep(Y.timers,function(t){return e===t.elem}).length});var tr=/^(?:body|html)$/i;Y.fn.offset=function(e){if(arguments.length)return e===t?this:this.each(function(t){Y.offset.setOffset(this,e,t)});var n,r,i,s,o,u,a,f={top:0,left:0},l=this[0],c=l&&l.ownerDocument;if(!c)return;return(r=c.body)===l?Y.offset.bodyOffset(l):(n=c.documentElement,Y.contains(n,l)?(typeof l.getBoundingClientRect!="undefined"&&(f=l.getBoundingClientRect()),i=F(c),s=n.clientTop||r.clientTop||0,o=n.clientLeft||r.clientLeft||0,u=i.pageYOffset||n.scrollTop,a=i.pageXOffset||n.scrollLeft,{top:f.top+u-s,left:f.left+a-o}):f)},Y.offset={bodyOffset:function(e){var t=e.offsetTop,n=e.offsetLeft;return Y.support.doesNotIncludeMarginInBodyOffset&&(t+=parseFloat(Y.css(e,"marginTop"))||0,n+=parseFloat(Y.css(e,"marginLeft"))||0),{top:t,left:n}},setOffset:function(e,t,n){var r=Y.css(e,"position");r==="static"&&(e.style.position="relative");var i=Y(e),s=i.offset(),o=Y.css(e,"top"),u=Y.css(e,"left"),a=(r==="absolute"||r==="fixed")&&Y.inArray("auto",[o,u])>-1,f={},l={},c,h;a?(l=i.position(),c=l.top,h=l.left):(c=parseFloat(o)||0,h=parseFloat(u)||0),Y.isFunction(t)&&(t=t.call(e,n,s)),t.top!=null&&(f.top=t.top-s.top+c),t.left!=null&&(f.left=t.left-s.left+h),"using"in t?t.using.call(e,f):i.css(f)}},Y.fn.extend({position:function(){if(!this[0])return;var e=this[0],t=this.offsetParent(),n=this.offset(),r=tr.test(t[0].nodeName)?{top:0,left:0}:t.offset();return n.top-=parseFloat(Y.css(e,"marginTop"))||0,n.left-=parseFloat(Y.css(e,"marginLeft"))||0,r.top+=parseFloat(Y.css(t[0],"borderTopWidth"))||0,r.left+=parseFloat(Y.css(t[0],"borderLeftWidth"))||0,{top:n.top-r.top,left:n.left-r.left}},offsetParent:function(){return this.map(function(){var e=this.offsetParent||R.body;while(e&&!tr.test(e.nodeName)&&Y.css(e,"position")==="static")e=e.offsetParent;return e||R.body})}}),Y.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(e,n){var r=/Y/.test(n);Y.fn[e]=function(i){return Y.access(this,function(e,i,s){var o=F(e);if(s===t)return o?n in o?o[n]:o.document.documentElement[i]:e[i];o?o.scrollTo(r?Y(o).scrollLeft():s,r?s:Y(o).scrollTop()):e[i]=s},e,i,arguments.length,null)}}),Y.each({Height:"height",Width:"width"},function(e,n){Y.each({padding:"inner"+e,content:n,"":"outer"+e},function(r,i){Y.fn[i]=function(i,s){var o=arguments.length&&(r||typeof i!="boolean"),u=r||(i===!0||s===!0?"margin":"border");return Y.access(this,function(n,r,i){var s;return Y.isWindow(n)?n.document.documentElement["client"+e]:n.nodeType===9?(s=n.documentElement,Math.max(n.body["scroll"+e],s["scroll"+e],n.body["offset"+e],s["offset"+e],s["client"+e])):i===t?Y.css(n,r,i,u):Y.style(n,r,i,u)},n,o?i:t,o,null)}})}),e.jQuery=e.$=Y,typeof define=="function"&&define.amd&&define.amd.jQuery&&define("jquery",[],function(){return Y})})(window),function(){function e(t,n,r){if(t===n)return 0!==t||1/t==1/n;if(null==t||null==n)return t===n;t._chain&&(t=t._wrapped),n._chain&&(n=n._wrapped);if(t.isEqual&&E.isFunction(t.isEqual))return t.isEqual(n);if(n.isEqual&&E.isFunction(n.isEqual))return n.isEqual(t);var i=a.call(t);if(i!=a.call(n))return!1;switch(i){case"[object String]":return t==""+n;case"[object Number]":return t!=+t?n!=+n:0==t?1/t==1/n:t==+n;case"[object Date]":case"[object Boolean]":return+t==+n;case"[object RegExp]":return t.source==n.source&&t.global==n.global&&t.multiline==n.multiline&&t.ignoreCase==n.ignoreCase}if("object"!=typeof t||"object"!=typeof n)return!1;for(var s=r.length;s--;)if(r[s]==t)return!0;r.push(t);var s=0,o=!0;if("[object Array]"==i){if(s=t.length,o=s==n.length)for(;s--&&(o=s in t==s in n&&e(t[s],n[s],r)););}else{if("constructor"in t!="constructor"in n||t.constructor!=n.constructor)return!1;for(var u in t)if(E.has(t,u)&&(s++,!(o=E.has(n,u)&&e(t[u],n[u],r))))break;if(o){for(u in n)if(E.has(n,u)&&!(s--))break;o=!s}}return r.pop(),o}var t=this,n=t._,r={},i=Array.prototype,s=Object.prototype,o=i.slice,u=i.unshift,a=s.toString,f=s.hasOwnProperty,l=i.forEach,c=i.map,h=i.reduce,p=i.reduceRight,d=i.filter,v=i.every,m=i.some,g=i.indexOf,y=i.lastIndexOf,s=Array.isArray,b=Object.keys,w=Function.prototype.bind,E=function(e){return new _(e)};"undefined"!=typeof exports?("undefined"!=typeof module&&module.exports&&(exports=module.exports=E),exports._=E):t._=E,E.VERSION="1.3.3";var S=E.each=E.forEach=function(e,t,n){if(e!=null)if(l&&e.forEach===l)e.forEach(t,n);else if(e.length===+e.length){for(var i=0,s=e.length;i<s;i++)if(i in e&&t.call(n,e[i],i,e)===r)break}else for(i in e)if(E.has(e,i)&&t.call(n,e[i],i,e)===r)break};E.map=E.collect=function(e,t,n){var r=[];return e==null?r:c&&e.map===c?e.map(t,n):(S(e,function(e,i,s){r[r.length]=t.call(n,e,i,s)}),e.length===+e.length&&(r.length=e.length),r)},E.reduce=E.foldl=E.inject=function(e,t,n,r){var i=arguments.length>2;e==null&&(e=[]);if(h&&e.reduce===h)return r&&(t=E.bind(t,r)),i?e.reduce(t,n):e.reduce(t);S(e,function(e,s,o){i?n=t.call(r,n,e,s,o):(n=e,i=!0)});if(!i)throw new TypeError("Reduce of empty array with no initial value");return n},E.reduceRight=E.foldr=function(e,t,n,r){var i=arguments.length>2;e==null&&(e=[]);if(p&&e.reduceRight===p)return r&&(t=E.bind(t,r)),i?e.reduceRight(t,n):e.reduceRight(t);var s=E.toArray(e).reverse();return r&&!i&&(t=E.bind(t,r)),i?E.reduce(s,t,n,r):E.reduce(s,t)},E.find=E.detect=function(e,t,n){var r;return x(e,function(e,i,s){if(t.call(n,e,i,s))return r=e,!0}),r},E.filter=E.select=function(e,t,n){var r=[];return e==null?r:d&&e.filter===d?e.filter(t,n):(S(e,function(e,i,s){t.call(n,e,i,s)&&(r[r.length]=e)}),r)},E.reject=function(e,t,n){var r=[];return e==null?r:(S(e,function(e,i,s){t.call(n,e,i,s)||(r[r.length]=e)}),r)},E.every=E.all=function(e,t,n){var i=!0;return e==null?i:v&&e.every===v?e.every(t,n):(S(e,function(e,s,o){if(!(i=i&&t.call(n,e,s,o)))return r}),!!i)};var x=E.some=E.any=function(e,t,n){t||(t=E.identity);var i=!1;return e==null?i:m&&e.some===m?e.some(t,n):(S(e,function(e,s,o){if(i||(i=t.call(n,e,s,o)))return r}),!!i)};E.include=E.contains=function(e,t){var n=!1;return e==null?n:g&&e.indexOf===g?e.indexOf(t)!=-1:n=x(e,function(e){return e===t})},E.invoke=function(e,t){var n=o.call(arguments,2);return E.map(e,function(e){return(E.isFunction(t)?t||e:e[t]).apply(e,n)})},E.pluck=function(e,t){return E.map(e,function(e){return e[t]})},E.max=function(e,t,n){if(!t&&E.isArray(e)&&e[0]===+e[0])return Math.max.apply(Math,e);if(!t&&E.isEmpty(e))return-Infinity;var r={computed:-Infinity};return S(e,function(e,i,s){i=t?t.call(n,e,i,s):e,i>=r.computed&&(r={value:e,computed:i})}),r.value},E.min=function(e,t,n){if(!t&&E.isArray(e)&&e[0]===+e[0])return Math.min.apply(Math,e);if(!t&&E.isEmpty(e))return Infinity;var r={computed:Infinity};return S(e,function(e,i,s){i=t?t.call(n,e,i,s):e,i<r.computed&&(r={value:e,computed:i})}),r.value},E.shuffle=function(e){var t=[],n;return S(e,function(e,r){n=Math.floor(Math.random()*(r+1)),t[r]=t[n],t[n]=e}),t},E.sortBy=function(e,t,n){var r=E.isFunction(t)?t:function(e){return e[t]};return E.pluck(E.map(e,function(e,t,i){return{value:e,criteria:r.call(n,e,t,i)}}).sort(function(e,t){var n=e.criteria,r=t.criteria;return n===void 0?1:r===void 0?-1:n<r?-1:n>r?1:0}),"value")},E.groupBy=function(e,t){var n={},r=E.isFunction(t)?t:function(e){return e[t]};return S(e,function(e,t){var i=r(e,t);(n[i]||(n[i]=[])).push(e)}),n},E.sortedIndex=function(e,t,n){n||(n=E.identity);for(var r=0,i=e.length;r<i;){var s=r+i>>1;n(e[s])<n(t)?r=s+1:i=s}return r},E.toArray=function(e){return e?E.isArray(e)||E.isArguments(e)?o.call(e):e.toArray&&E.isFunction(e.toArray)?e.toArray():E.values(e):[]},E.size=function(e){return E.isArray(e)?e.length:E.keys(e).length},E.first=E.head=E.take=function(e,t,n){return t!=null&&!n?o.call(e,0,t):e[0]},E.initial=function(e,t,n){return o.call(e,0,e.length-(t==null||n?1:t))},E.last=function(e,t,n){return t!=null&&!n?o.call(e,Math.max(e.length-t,0)):e[e.length-1]},E.rest=E.tail=function(e,t,n){return o.call(e,t==null||n?1:t)},E.compact=function(e){return E.filter(e,function(e){return!!e})},E.flatten=function(e,t){return E.reduce(e,function(e,n){return E.isArray(n)?e.concat(t?n:E.flatten(n)):(e[e.length]=n,e)},[])},E.without=function(e){return E.difference(e,o.call(arguments,1))},E.uniq=E.unique=function(e,t,n){var n=n?E.map(e,n):e,r=[];return e.length<3&&(t=!0),E.reduce(n,function(n,i,s){if(t?E.last(n)!==i||!n.length:!E.include(n,i))n.push(i),r.push(e[s]);return n},[]),r},E.union=function(){return E.uniq(E.flatten(arguments,!0))},E.intersection=E.intersect=function(e){var t=o.call(arguments,1);return E.filter(E.uniq(e),function(e){return E.every(t,function(t){return E.indexOf(t,e)>=0})})},E.difference=function(e){var t=E.flatten(o.call(arguments,1),!0);return E.filter(e,function(e){return!E.include(t,e)})},E.zip=function(){for(var e=o.call(arguments),t=E.max(E.pluck(e,"length")),n=Array(t),r=0;r<t;r++)n[r]=E.pluck(e,""+r);return n},E.indexOf=function(e,t,n){if(e==null)return-1;var r;if(n)return n=E.sortedIndex(e,t),e[n]===t?n:-1;if(g&&e.indexOf===g)return e.indexOf(t);n=0;for(r=e.length;n<r;n++)if(n in e&&e[n]===t)return n;return-1},E.lastIndexOf=function(e,t){if(e==null)return-1;if(y&&e.lastIndexOf===y)return e.lastIndexOf(t);for(var n=e.length;n--;)if(n in e&&e[n]===t)return n;return-1},E.range=function(e,t,n){arguments.length<=1&&(t=e||0,e=0);for(var n=arguments[2]||1,r=Math.max(Math.ceil((t-e)/n),0),i=0,s=Array(r);i<r;)s[i++]=e,e+=n;return s};var T=function(){};E.bind=function(e,t){var n,r;if(e.bind===w&&w)return w.apply(e,o.call(arguments,1));if(!E.isFunction(e))throw new TypeError;return r=o.call(arguments,2),n=function(){if(this instanceof n){T.prototype=e.prototype;var i=new T,s=e.apply(i,r.concat(o.call(arguments)));return Object(s)===s?s:i}return e.apply(t,r.concat(o.call(arguments)))}},E.bindAll=function(e){var t=o.call(arguments,1);return t.length==0&&(t=E.functions(e)),S(t,function(t){e[t]=E.bind(e[t],e)}),e},E.memoize=function(e,t){var n={};return t||(t=E.identity),function(){var r=t.apply(this,arguments);return E.has(n,r)?n[r]:n[r]=e.apply(this,arguments)}},E.delay=function(e,t){var n=o.call(arguments,2);return setTimeout(function(){return e.apply(null,n)},t)},E.defer=function(e){return E.delay.apply(E,[e,1].concat(o.call(arguments,1)))},E.throttle=function(e,t){var n,r,i,s,o,u,a=E.debounce(function(){o=s=!1},t);return function(){return n=this,r=arguments,i||(i=setTimeout(function(){i=null,o&&e.apply(n,r),a()},t)),s?o=!0:u=e.apply(n,r),a(),s=!0,u}},E.debounce=function(e,t,n){var r;return function(){var i=this,s=arguments;n&&!r&&e.apply(i,s),clearTimeout(r),r=setTimeout(function(){r=null,n||e.apply(i,s)},t)}},E.once=function(e){var t=!1,n;return function(){return t?n:(t=!0,n=e.apply(this,arguments))}},E.wrap=function(e,t){return function(){var n=[e].concat(o.call(arguments,0));return t.apply(this,n)}},E.compose=function(){var e=arguments;return function(){for(var t=arguments,n=e.length-1;n>=0;n--)t=[e[n].apply(this,t)];return t[0]}},E.after=function(e,t){return e<=0?t():function(){if(--e<1)return t.apply(this,arguments)}},E.keys=b||function(e){if(e!==Object(e))throw new TypeError("Invalid object");var t=[],n;for(n in e)E.has(e,n)&&(t[t.length]=n);return t},E.values=function(e){return E.map(e,E.identity)},E.functions=E.methods=function(e){var t=[],n;for(n in e)E.isFunction(e[n])&&t.push(n);return t.sort()},E.extend=function(e){return S(o.call(arguments,1),function(t){for(var n in t)e[n]=t[n]}),e},E.pick=function(e){var t={};return S(E.flatten(o.call(arguments,1)),function(n){n in e&&(t[n]=e[n])}),t},E.defaults=function(e){return S(o.call(arguments,1),function(t){for(var n in t)e[n]==null&&(e[n]=t[n])}),e},E.clone=function(e){return E.isObject(e)?E.isArray(e)?e.slice():E.extend({},e):e},E.tap=function(e,t){return t(e),e},E.isEqual=function(t,n){return e(t,n,[])},E.isEmpty=function(e){if(e==null)return!0;if(E.isArray(e)||E.isString(e))return e.length===0;for(var t in e)if(E.has(e,t))return!1;return!0},E.isElement=function(e){return!!e&&e.nodeType==1},E.isArray=s||function(e){return a.call(e)=="[object Array]"},E.isObject=function(e){return e===Object(e)},E.isArguments=function(e){return a.call(e)=="[object Arguments]"},E.isArguments(arguments)||(E.isArguments=function(e){return!!e&&!!E.has(e,"callee")}),E.isFunction=function(e){return a.call(e)=="[object Function]"},E.isString=function(e){return a.call(e)=="[object String]"},E.isNumber=function(e){return a.call(e)=="[object Number]"},E.isFinite=function(e){return E.isNumber(e)&&isFinite(e)},E.isNaN=function(e){return e!==e},E.isBoolean=function(e){return e===!0||e===!1||a.call(e)=="[object Boolean]"},E.isDate=function(e){return a.call(e)=="[object Date]"},E.isRegExp=function(e){return a.call(e)=="[object RegExp]"},E.isNull=function(e){return e===null},E.isUndefined=function(e){return e===void 0},E.has=function(e,t){return f.call(e,t)},E.noConflict=function(){return t._=n,this},E.identity=function(e){return e},E.times=function(e,t,n){for(var r=0;r<e;r++)t.call(n,r)},E.escape=function(e){return(""+e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;").replace(/\//g,"&#x2F;")},E.result=function(e,t){if(e==null)return null;var n=e[t];return E.isFunction(n)?n.call(e):n},E.mixin=function(e){S(E.functions(e),function(t){P(t,E[t]=e[t])})};var N=0;E.uniqueId=function(e){var t=N++;return e?e+t:t},E.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var C=/.^/,k={"\\":"\\","'":"'",r:"\r",n:"\n",t:"	",u2028:"\u2028",u2029:"\u2029"},L;for(L in k)k[k[L]]=L;var A=/\\|'|\r|\n|\t|\u2028|\u2029/g,O=/\\(\\|'|r|n|t|u2028|u2029)/g,M=function(e){return e.replace(O,function(e,t){return k[t]})};E.template=function(e,t,n){n=E.defaults(n||{},E.templateSettings),e="__p+='"+e.replace(A,function(e){return"\\"+k[e]}).replace(n.escape||C,function(e,t){return"'+\n_.escape("+M(t)+")+\n'"}).replace(n.interpolate||C,function(e,t){return"'+\n("+M(t)+")+\n'"}).replace(n.evaluate||C,function(e,t){return"';\n"+M(t)+"\n;__p+='"})+"';\n",n.variable||(e="with(obj||{}){\n"+e+"}\n");var e="var __p='';var print=function(){__p+=Array.prototype.join.call(arguments, '')};\n"+e+"return __p;\n",r=new Function(n.variable||"obj","_",e);return t?r(t,E):(t=function(e){return r.call(this,e,E)},t.source="function("+(n.variable||"obj")+"){\n"+e+"}",t)},E.chain=function(e){return E(e).chain()};var _=function(e){this._wrapped=e};E.prototype=_.prototype;var D=function(e,t){return t?E(e).chain():e},P=function(e,t){_.prototype[e]=function(){var e=o.call(arguments);return u.call(e,this._wrapped),D(t.apply(E,e),this._chain)}};E.mixin(E),S("pop,push,reverse,shift,sort,splice,unshift".split(","),function(e){var t=i[e];_.prototype[e]=function(){var n=this._wrapped;t.apply(n,arguments);var r=n.length;return(e=="shift"||e=="splice")&&r===0&&delete n[0],D(n,this._chain)}}),S(["concat","join","slice"],function(e){var t=i[e];_.prototype[e]=function(){return D(t.apply(this._wrapped,arguments),this._chain)}}),_.prototype.chain=function(){return this._chain=!0,this},_.prototype.value=function(){return this._wrapped}}.call(this),define("underscore",function(e){return function(){var t,n;return t||e._}}(this)),this.Handlebars={},function(e){e.VERSION="1.0.rc.1",e.helpers={},e.partials={},e.registerHelper=function(e,t,n){n&&(t.not=n),this.helpers[e]=t},e.registerPartial=function(e,t){this.partials[e]=t},e.registerHelper("helperMissing",function(e){if(arguments.length===2)return undefined;throw new Error("Could not find property '"+e+"'")});var t=Object.prototype.toString,n="[object Function]";e.registerHelper("blockHelperMissing",function(r,i){var s=i.inverse||function(){},o=i.fn,u="",a=t.call(r);return a===n&&(r=r.call(this)),r===!0?o(this):r===!1||r==null?s(this):a==="[object Array]"?r.length>0?e.helpers.each(r,i):s(this):o(r)}),e.K=function(){},e.createFrame=Object.create||function(t){e.K.prototype=t;var n=new e.K;return e.K.prototype=null,n},e.registerHelper("each",function(t,n){var r=n.fn,i=n.inverse,s=0,o="",u;n.data&&(u=e.createFrame(n.data));if(t&&typeof t=="object")if(t instanceof Array)for(var a=t.length;s<a;s++)u&&(u.index=s),o+=r(t[s],{data:u});else for(var f in t)t.hasOwnProperty(f)&&(u&&(u.key=f),o+=r(t[f],{data:u}),s++);return s===0&&(o=i(this)),o}),e.registerHelper("if",function(r,i){var s=t.call(r);return s===n&&(r=r.call(this)),!r||e.Utils.isEmpty(r)?i.inverse(this):i.fn(this)}),e.registerHelper("unless",function(t,n){var r=n.fn,i=n.inverse;return n.fn=i,n.inverse=r,e.helpers["if"].call(this,t,n)}),e.registerHelper("with",function(e,t){return t.fn(e)}),e.registerHelper("log",function(t){e.log(t)})}(this.Handlebars);var handlebars=function(){function e(){this.yy={}}var t={trace:function(){},yy:{},symbols_:{error:2,root:3,program:4,EOF:5,statements:6,simpleInverse:7,statement:8,openInverse:9,closeBlock:10,openBlock:11,mustache:12,partial:13,CONTENT:14,COMMENT:15,OPEN_BLOCK:16,inMustache:17,CLOSE:18,OPEN_INVERSE:19,OPEN_ENDBLOCK:20,path:21,OPEN:22,OPEN_UNESCAPED:23,OPEN_PARTIAL:24,params:25,hash:26,DATA:27,param:28,STRING:29,INTEGER:30,BOOLEAN:31,hashSegments:32,hashSegment:33,ID:34,EQUALS:35,pathSegments:36,SEP:37,$accept:0,$end:1},terminals_:{2:"error",5:"EOF",14:"CONTENT",15:"COMMENT",16:"OPEN_BLOCK",18:"CLOSE",19:"OPEN_INVERSE",20:"OPEN_ENDBLOCK",22:"OPEN",23:"OPEN_UNESCAPED",24:"OPEN_PARTIAL",27:"DATA",29:"STRING",30:"INTEGER",31:"BOOLEAN",34:"ID",35:"EQUALS",37:"SEP"},productions_:[0,[3,2],[4,3],[4,1],[4,0],[6,1],[6,2],[8,3],[8,3],[8,1],[8,1],[8,1],[8,1],[11,3],[9,3],[10,3],[12,3],[12,3],[13,3],[13,4],[7,2],[17,3],[17,2],[17,2],[17,1],[17,1],[25,2],[25,1],[28,1],[28,1],[28,1],[28,1],[28,1],[26,1],[32,2],[32,1],[33,3],[33,3],[33,3],[33,3],[33,3],[21,1],[36,3],[36,1]],performAction:function(e,t,n,r,i,s,o){var u=s.length-1;switch(i){case 1:return s[u-1];case 2:this.$=new r.ProgramNode(s[u-2],s[u]);break;case 3:this.$=new r.ProgramNode(s[u]);break;case 4:this.$=new r.ProgramNode([]);break;case 5:this.$=[s[u]];break;case 6:s[u-1].push(s[u]),this.$=s[u-1];break;case 7:this.$=new r.BlockNode(s[u-2],s[u-1].inverse,s[u-1],s[u]);break;case 8:this.$=new r.BlockNode(s[u-2],s[u-1],s[u-1].inverse,s[u]);break;case 9:this.$=s[u];break;case 10:this.$=s[u];break;case 11:this.$=new r.ContentNode(s[u]);break;case 12:this.$=new r.CommentNode(s[u]);break;case 13:this.$=new r.MustacheNode(s[u-1][0],s[u-1][1]);break;case 14:this.$=new r.MustacheNode(s[u-1][0],s[u-1][1]);break;case 15:this.$=s[u-1];break;case 16:this.$=new r.MustacheNode(s[u-1][0],s[u-1][1]);break;case 17:this.$=new r.MustacheNode(s[u-1][0],s[u-1][1],!0);break;case 18:this.$=new r.PartialNode(s[u-1]);break;case 19:this.$=new r.PartialNode(s[u-2],s[u-1]);break;case 20:break;case 21:this.$=[[s[u-2]].concat(s[u-1]),s[u]];break;case 22:this.$=[[s[u-1]].concat(s[u]),null];break;case 23:this.$=[[s[u-1]],s[u]];break;case 24:this.$=[[s[u]],null];break;case 25:this.$=[[new r.DataNode(s[u])],null];break;case 26:s[u-1].push(s[u]),this.$=s[u-1];break;case 27:this.$=[s[u]];break;case 28:this.$=s[u];break;case 29:this.$=new r.StringNode(s[u]);break;case 30:this.$=new r.IntegerNode(s[u]);break;case 31:this.$=new r.BooleanNode(s[u]);break;case 32:this.$=new r.DataNode(s[u]);break;case 33:this.$=new r.HashNode(s[u]);break;case 34:s[u-1].push(s[u]),this.$=s[u-1];break;case 35:this.$=[s[u]];break;case 36:this.$=[s[u-2],s[u]];break;case 37:this.$=[s[u-2],new r.StringNode(s[u])];break;case 38:this.$=[s[u-2],new r.IntegerNode(s[u])];break;case 39:this.$=[s[u-2],new r.BooleanNode(s[u])];break;case 40:this.$=[s[u-2],new r.DataNode(s[u])];break;case 41:this.$=new r.IdNode(s[u]);break;case 42:s[u-2].push(s[u]),this.$=s[u-2];break;case 43:this.$=[s[u]]}},table:[{3:1,4:2,5:[2,4],6:3,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],22:[1,13],23:[1,14],24:[1,15]},{1:[3]},{5:[1,16]},{5:[2,3],7:17,8:18,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,19],20:[2,3],22:[1,13],23:[1,14],24:[1,15]},{5:[2,5],14:[2,5],15:[2,5],16:[2,5],19:[2,5],20:[2,5],22:[2,5],23:[2,5],24:[2,5]},{4:20,6:3,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,4],22:[1,13],23:[1,14],24:[1,15]},{4:21,6:3,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,4],22:[1,13],23:[1,14],24:[1,15]},{5:[2,9],14:[2,9],15:[2,9],16:[2,9],19:[2,9],20:[2,9],22:[2,9],23:[2,9],24:[2,9]},{5:[2,10],14:[2,10],15:[2,10],16:[2,10],19:[2,10],20:[2,10],22:[2,10],23:[2,10],24:[2,10]},{5:[2,11],14:[2,11],15:[2,11],16:[2,11],19:[2,11],20:[2,11],22:[2,11],23:[2,11],24:[2,11]},{5:[2,12],14:[2,12],15:[2,12],16:[2,12],19:[2,12],20:[2,12],22:[2,12],23:[2,12],24:[2,12]},{17:22,21:23,27:[1,24],34:[1,26],36:25},{17:27,21:23,27:[1,24],34:[1,26],36:25},{17:28,21:23,27:[1,24],34:[1,26],36:25},{17:29,21:23,27:[1,24],34:[1,26],36:25},{21:30,34:[1,26],36:25},{1:[2,1]},{6:31,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],22:[1,13],23:[1,14],24:[1,15]},{5:[2,6],14:[2,6],15:[2,6],16:[2,6],19:[2,6],20:[2,6],22:[2,6],23:[2,6],24:[2,6]},{17:22,18:[1,32],21:23,27:[1,24],34:[1,26],36:25},{10:33,20:[1,34]},{10:35,20:[1,34]},{18:[1,36]},{18:[2,24],21:41,25:37,26:38,27:[1,45],28:39,29:[1,42],30:[1,43],31:[1,44],32:40,33:46,34:[1,47],36:25},{18:[2,25]},{18:[2,41],27:[2,41],29:[2,41],30:[2,41],31:[2,41],34:[2,41],37:[1,48]},{18:[2,43],27:[2,43],29:[2,43],30:[2,43],31:[2,43],34:[2,43],37:[2,43]},{18:[1,49]},{18:[1,50]},{18:[1,51]},{18:[1,52],21:53,34:[1,26],36:25},{5:[2,2],8:18,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,2],22:[1,13],23:[1,14],24:[1,15]},{14:[2,20],15:[2,20],16:[2,20],19:[2,20],22:[2,20],23:[2,20],24:[2,20]},{5:[2,7],14:[2,7],15:[2,7],16:[2,7],19:[2,7],20:[2,7],22:[2,7],23:[2,7],24:[2,7]},{21:54,34:[1,26],36:25},{5:[2,8],14:[2,8],15:[2,8],16:[2,8],19:[2,8],20:[2,8],22:[2,8],23:[2,8],24:[2,8]},{14:[2,14],15:[2,14],16:[2,14],19:[2,14],20:[2,14],22:[2,14],23:[2,14],24:[2,14]},{18:[2,22],21:41,26:55,27:[1,45],28:56,29:[1,42],30:[1,43],31:[1,44],32:40,33:46,34:[1,47],36:25},{18:[2,23]},{18:[2,27],27:[2,27],29:[2,27],30:[2,27],31:[2,27],34:[2,27]},{18:[2,33],33:57,34:[1,58]},{18:[2,28],27:[2,28],29:[2,28],30:[2,28],31:[2,28],34:[2,28]},{18:[2,29],27:[2,29],29:[2,29],30:[2,29],31:[2,29],34:[2,29]},{18:[2,30],27:[2,30],29:[2,30],30:[2,30],31:[2,30],34:[2,30]},{18:[2,31],27:[2,31],29:[2,31],30:[2,31],31:[2,31],34:[2,31]},{18:[2,32],27:[2,32],29:[2,32],30:[2,32],31:[2,32],34:[2,32]},{18:[2,35],34:[2,35]},{18:[2,43],27:[2,43],29:[2,43],30:[2,43],31:[2,43],34:[2,43],35:[1,59],37:[2,43]},{34:[1,60]},{14:[2,13],15:[2,13],16:[2,13],19:[2,13],20:[2,13],22:[2,13],23:[2,13],24:[2,13]},{5:[2,16],14:[2,16],15:[2,16],16:[2,16],19:[2,16],20:[2,16],22:[2,16],23:[2,16],24:[2,16]},{5:[2,17],14:[2,17],15:[2,17],16:[2,17],19:[2,17],20:[2,17],22:[2,17],23:[2,17],24:[2,17]},{5:[2,18],14:[2,18],15:[2,18],16:[2,18],19:[2,18],20:[2,18],22:[2,18],23:[2,18],24:[2,18]},{18:[1,61]},{18:[1,62]},{18:[2,21]},{18:[2,26],27:[2,26],29:[2,26],30:[2,26],31:[2,26],34:[2,26]},{18:[2,34],34:[2,34]},{35:[1,59]},{21:63,27:[1,67],29:[1,64],30:[1,65],31:[1,66],34:[1,26],36:25},{18:[2,42],27:[2,42],29:[2,42],30:[2,42],31:[2,42],34:[2,42],37:[2,42]},{5:[2,19],14:[2,19],15:[2,19],16:[2,19],19:[2,19],20:[2,19],22:[2,19],23:[2,19],24:[2,19]},{5:[2,15],14:[2,15],15:[2,15],16:[2,15],19:[2,15],20:[2,15],22:[2,15],23:[2,15],24:[2,15]},{18:[2,36],34:[2,36]},{18:[2,37],34:[2,37]},{18:[2,38],34:[2,38]},{18:[2,39],34:[2,39]},{18:[2,40],34:[2,40]}],defaultActions:{16:[2,1],24:[2,25],38:[2,23],55:[2,21]},parseError:function(e,t){throw new Error(e)},parse:function(e){function t(e){i.length=i.length-2*e,s.length=s.length-e,o.length=o.length-e}function n(){var e;return e=r.lexer.lex()||1,typeof e!="number"&&(e=r.symbols_[e]||e),e}var r=this,i=[0],s=[null],o=[],u=this.table,a="",f=0,l=0,c=0,h=2,p=1;this.lexer.setInput(e),this.lexer.yy=this.yy,this.yy.lexer=this.lexer,this.yy.parser=this,typeof this.lexer.yylloc=="undefined"&&(this.lexer.yylloc={});var d=this.lexer.yylloc;o.push(d);var v=this.lexer.options&&this.lexer.options.ranges;typeof this.yy.parseError=="function"&&(this.parseError=this.yy.parseError);var m,g,y,b,w,E,S={},x,T,N,C;for(;;){y=i[i.length-1];if(this.defaultActions[y])b=this.defaultActions[y];else{if(m===null||typeof m=="undefined")m=n();b=u[y]&&u[y][m]}if(typeof b=="undefined"||!b.length||!b[0]){var k="";if(!c){C=[];for(x in u[y])this.terminals_[x]&&x>2&&C.push("'"+this.terminals_[x]+"'");this.lexer.showPosition?k="Parse error on line "+(f+1)+":\n"+this.lexer.showPosition()+"\nExpecting "+C.join(", ")+", got '"+(this.terminals_[m]||m)+"'":k="Parse error on line "+(f+1)+": Unexpected "+(m==1?"end of input":"'"+(this.terminals_[m]||m)+"'"),this.parseError(k,{text:this.lexer.match,token:this.terminals_[m]||m,line:this.lexer.yylineno,loc:d,expected:C})}}if(b[0]instanceof Array&&b.length>1)throw new Error("Parse Error: multiple actions possible at state: "+y+", token: "+m);switch(b[0]){case 1:i.push(m),s.push(this.lexer.yytext),o.push(this.lexer.yylloc),i.push(b[1]),m=null,g?(m=g,g=null):(l=this.lexer.yyleng,a=this.lexer.yytext,f=this.lexer.yylineno,d=this.lexer.yylloc,c>0&&c--);break;case 2:T=this.productions_[b[1]][1],S.$=s[s.length-T],S._$={first_line:o[o.length-(T||1)].first_line,last_line:o[o.length-1].last_line,first_column:o[o.length-(T||1)].first_column,last_column:o[o.length-1].last_column},v&&(S._$.range=[o[o.length-(T||1)].range[0],o[o.length-1].range[1]]),E=this.performAction.call(S,a,l,f,this.yy,b[1],s,o);if(typeof E!="undefined")return E;T&&(i=i.slice(0,-1*T*2),s=s.slice(0,-1*T),o=o.slice(0,-1*T)),i.push(this.productions_[b[1]][0]),s.push(S.$),o.push(S._$),N=u[i[i.length-2]][i[i.length-1]],i.push(N);break;case 3:return!0}}return!0}},n=function(){var e={EOF:1,parseError:function(e,t){if(!this.yy.parser)throw new Error(e);this.yy.parser.parseError(e,t)},setInput:function(e){return this._input=e,this._more=this._less=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},input:function(){var e=this._input[0];this.yytext+=e,this.yyleng++,this.offset++,this.match+=e,this.matched+=e;var t=e.match(/(?:\r\n?|\n).*/g);return t?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),e},unput:function(e){var t=e.length,n=e.split(/(?:\r\n?|\n)/g);this._input=e+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-t-1),this.offset-=t;var r=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),n.length-1&&(this.yylineno-=n.length-1);var i=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:n?(n.length===r.length?this.yylloc.first_column:0)+r[r.length-n.length].length-n[0].length:this.yylloc.first_column-t},this.options.ranges&&(this.yylloc.range=[i[0],i[0]+this.yyleng-t]),this},more:function(){return this._more=!0,this},less:function(e){this.unput(this.match.slice(e))},pastInput:function(){var e=this.matched.substr(0,this.matched.length-this.match.length);return(e.length>20?"...":"")+e.substr(-20).replace(/\n/g,"")},upcomingInput:function(){var e=this.match;return e.length<20&&(e+=this._input.substr(0,20-e.length)),(e.substr(0,20)+(e.length>20?"...":"")).replace(/\n/g,"")},showPosition:function(){var e=this.pastInput(),t=(new Array(e.length+1)).join("-");return e+this.upcomingInput()+"\n"+t+"^"},next:function(){if(this.done)return this.EOF;this._input||(this.done=!0);var e,t,n,r,i,s;this._more||(this.yytext="",this.match="");var o=this._currentRules();for(var u=0;u<o.length;u++){n=this._input.match(this.rules[o[u]]);if(n&&(!t||n[0].length>t[0].length)){t=n,r=u;if(!this.options.flex)break}}if(t){s=t[0].match(/(?:\r\n?|\n).*/g),s&&(this.yylineno+=s.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:s?s[s.length-1].length-s[s.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+t[0].length},this.yytext+=t[0],this.match+=t[0],this.matches=t,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._input=this._input.slice(t[0].length),this.matched+=t[0],e=this.performAction.call(this,this.yy,this,o[r],this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1);if(e)return e;return}return this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+". Unrecognized text.\n"+this.showPosition(),{text:"",token:null,line:this.yylineno})},lex:function(){var e=this.next();return typeof e!="undefined"?e:this.lex()},begin:function(e){this.conditionStack.push(e)},popState:function(){return this.conditionStack.pop()},_currentRules:function(){return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules},topState:function(){return this.conditionStack[this.conditionStack.length-2]},pushState:function(e){this.begin(e)}};return e.options={},e.performAction=function(e,t,n,r){var i=r;switch(n){case 0:t.yytext.slice(-1)!=="\\"&&this.begin("mu"),t.yytext.slice(-1)==="\\"&&(t.yytext=t.yytext.substr(0,t.yyleng-1),this.begin("emu"));if(t.yytext)return 14;break;case 1:return 14;case 2:return t.yytext.slice(-1)!=="\\"&&this.popState(),t.yytext.slice(-1)==="\\"&&(t.yytext=t.yytext.substr(0,t.yyleng-1)),14;case 3:return t.yytext=t.yytext.substr(0,t.yyleng-4),this.popState(),15;case 4:return 24;case 5:return 16;case 6:return 20;case 7:return 19;case 8:return 19;case 9:return 23;case 10:return 23;case 11:this.popState(),this.begin("com");break;case 12:return t.yytext=t.yytext.substr(3,t.yyleng-5),this.popState(),15;case 13:return 22;case 14:return 35;case 15:return 34;case 16:return 34;case 17:return 37;case 18:break;case 19:return this.popState(),18;case 20:return this.popState(),18;case 21:return t.yytext=t.yytext.substr(1,t.yyleng-2).replace(/\\"/g,'"'),29;case 22:return t.yytext=t.yytext.substr(1,t.yyleng-2).replace(/\\'/g,"'"),29;case 23:return t.yytext=t.yytext.substr(1),27;case 24:return 31;case 25:return 31;case 26:return 30;case 27:return 34;case 28:return t.yytext=t.yytext.substr(1,t.yyleng-2),34;case 29:return"INVALID";case 30:return 5}},e.rules=[/^(?:[^\x00]*?(?=(\{\{)))/,/^(?:[^\x00]+)/,/^(?:[^\x00]{2,}?(?=(\{\{|$)))/,/^(?:[\s\S]*?--\}\})/,/^(?:\{\{>)/,/^(?:\{\{#)/,/^(?:\{\{\/)/,/^(?:\{\{\^)/,/^(?:\{\{\s*else\b)/,/^(?:\{\{\{)/,/^(?:\{\{&)/,/^(?:\{\{!--)/,/^(?:\{\{![\s\S]*?\}\})/,/^(?:\{\{)/,/^(?:=)/,/^(?:\.(?=[} ]))/,/^(?:\.\.)/,/^(?:[\/.])/,/^(?:\s+)/,/^(?:\}\}\})/,/^(?:\}\})/,/^(?:"(\\["]|[^"])*")/,/^(?:'(\\[']|[^'])*')/,/^(?:@[a-zA-Z]+)/,/^(?:true(?=[}\s]))/,/^(?:false(?=[}\s]))/,/^(?:[0-9]+(?=[}\s]))/,/^(?:[a-zA-Z0-9_$-]+(?=[=}\s\/.]))/,/^(?:\[[^\]]*\])/,/^(?:.)/,/^(?:$)/],e.conditions={mu:{rules:[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],inclusive:!1},emu:{rules:[2],inclusive:!1},com:{rules:[3],inclusive:!1},INITIAL:{rules:[0,1,30],inclusive:!0}},e}();return t.lexer=n,e.prototype=t,t.Parser=e,new e}();typeof require!="undefined"&&typeof exports!="undefined"&&(exports.parser=handlebars,exports.Parser=handlebars.Parser,exports.parse=function(){return handlebars.parse.apply(handlebars,arguments)},exports.main=function(e){if(!e[1])throw new Error("Usage: "+e[0]+" FILE");var t,n;return typeof process!="undefined"?t=require("fs").readFileSync(require("path").resolve(e[1]),"utf8"):t=require("file").path(require("file").cwd()).join(e[1]).read({charset:"utf-8"}),exports.parser.parse(t)},typeof module!="undefined"&&require.main===module&&exports.main(typeof process!="undefined"?process.argv.slice(1):require("system").args)),Handlebars.Parser=handlebars,Handlebars.parse=function(e){return Handlebars.Parser.yy=Handlebars.AST,Handlebars.Parser.parse(e)},Handlebars.print=function(e){return(new Handlebars.PrintVisitor).accept(e)},Handlebars.logger={DEBUG:0,INFO:1,WARN:2,ERROR:3,level:3,log:function(e,t){}},Handlebars.log=function(e,t){Handlebars.logger.log(e,t)},function(){Handlebars.AST={},Handlebars.AST.ProgramNode=function(e,t){this.type="program",this.statements=e,t&&(this.inverse=new Handlebars.AST.ProgramNode(t))},Handlebars.AST.MustacheNode=function(e,t,n){this.type="mustache",this.escaped=!n,this.hash=t;var r=this.id=e[0],i=this.params=e.slice(1),s=this.eligibleHelper=r.isSimple;this.isHelper=s&&(i.length||t)},Handlebars.AST.PartialNode=function(e,t){this.type="partial",this.id=e,this.context=t};var e=function(e,t){if(e.original!==t.original)throw new Handlebars.Exception(e.original+" doesn't match "+t.original)};Handlebars.AST.BlockNode=function(t,n,r,i){e(t.id,i),this.type="block",this.mustache=t,this.program=n,this.inverse=r,this.inverse&&!this.program&&(this.isInverse=!0)},Handlebars.AST.ContentNode=function(e){this.type="content",this.string=e},Handlebars.AST.HashNode=function(e){this.type="hash",this.pairs=e},Handlebars.AST.IdNode=function(e){this.type="ID",this.original=e.join(".");var t=[],n=0;for(var r=0,i=e.length;r<i;r++){var s=e[r];s===".."?n++:s==="."||s==="this"?this.isScoped=!0:t.push(s)}this.parts=t,this.string=t.join("."),this.depth=n,this.isSimple=e.length===1&&!this.isScoped&&n===0},Handlebars.AST.DataNode=function(e){this.type="DATA",this.id=e},Handlebars.AST.StringNode=function(e){this.type="STRING",this.string=e},Handlebars.AST.IntegerNode=function(e){this.type="INTEGER",this.integer=e},Handlebars.AST.BooleanNode=function(e){this.type="BOOLEAN",this.bool=e},Handlebars.AST.CommentNode=function(e){this.type="comment",this.comment=e}}();var errorProps=["description","fileName","lineNumber","message","name","number","stack"];Handlebars.Exception=function(e){var t=Error.prototype.constructor.apply(this,arguments);for(var n=0;n<errorProps.length;n++)this[errorProps[n]]=t[errorProps[n]]},Handlebars.Exception.prototype=new Error,Handlebars.SafeString=function(e){this.string=e},Handlebars.SafeString.prototype.toString=function(){return this.string.toString()},function(){var e={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","`":"&#x60;"},t=/[&<>"'`]/g,n=/[&<>"'`]/,r=function(t){return e[t]||"&amp;"};Handlebars.Utils={escapeExpression:function(e){return e instanceof Handlebars.SafeString?e.toString():e==null||e===!1?"":n.test(e)?e.replace(t,r):e},isEmpty:function(e){return typeof e=="undefined"?!0:e===null?!0:e===!1?!0:Object.prototype.toString.call(e)==="[object Array]"&&e.length===0?!0:!1}}}(),Handlebars.Compiler=function(){},Handlebars.JavaScriptCompiler=function(){},function(e,t){e.prototype={compiler:e,disassemble:function(){var e=this.opcodes,t,n=[],r,i;for(var s=0,o=e.length;s<o;s++){t=e[s];if(t.opcode==="DECLARE")n.push("DECLARE "+t.name+"="+t.value);else{r=[];for(var u=0;u<t.args.length;u++)i=t.args[u],typeof i=="string"&&(i='"'+i.replace("\n","\\n")+'"'),r.push(i);n.push(t.opcode+" "+r.join(" "))}}return n.join("\n")},guid:0,compile:function(e,t){this.children=[],this.depths={list:[]},this.options=t;var n=this.options.knownHelpers;this.options.knownHelpers={helperMissing:!0,blockHelperMissing:!0,each:!0,"if":!0,unless:!0,"with":!0,log:!0};if(n)for(var r in n)this.options.knownHelpers[r]=n[r];return this.program(e)},accept:function(e){return this[e.type](e)},program:function(e){var t=e.statements,n;this.opcodes=[];for(var r=0,i=t.length;r<i;r++)n=t[r],this[n.type](n);return this.isSimple=i===1,this.depths.list=this.depths.list.sort(function(e,t){return e-t}),this},compileProgram:function(e){var t=(new this.compiler).compile(e,this.options),n=this.guid++,r;this.usePartial=this.usePartial||t.usePartial,this.children[n]=t;for(var i=0,s=t.depths.list.length;i<s;i++){r=t.depths.list[i];if(r<2)continue;this.addDepth(r-1)}return n},block:function(e){var t=e.mustache,n=e.program,r=e.inverse;n&&(n=this.compileProgram(n)),r&&(r=this.compileProgram(r));var i=this.classifyMustache(t);i==="helper"?this.helperMustache(t,n,r):i==="simple"?(this.simpleMustache(t),this.opcode("pushProgram",n),this.opcode("pushProgram",r),this.opcode("pushLiteral","{}"),this.opcode("blockValue")):(this.ambiguousMustache(t,n,r),this.opcode("pushProgram",n),this.opcode("pushProgram",r),this.opcode("pushLiteral","{}"),this.opcode("ambiguousBlockValue")),this.opcode("append")},hash:function(e){var t=e.pairs,n,r;this.opcode("push","{}");for(var i=0,s=t.length;i<s;i++)n=t[i],r=n[1],this.accept(r),this.opcode("assignToHash",n[0])},partial:function(e){var t=e.id;this.usePartial=!0,e.context?this.ID(e.context):this.opcode("push","depth0"),this.opcode("invokePartial",t.original),this.opcode("append")},content:function(e){this.opcode("appendContent",e.string)},mustache:function(e){var t=this.options,n=this.classifyMustache(e);n==="simple"?this.simpleMustache(e):n==="helper"?this.helperMustache(e):this.ambiguousMustache(e),e.escaped&&!t.noEscape?this.opcode("appendEscaped"):this.opcode("append")},ambiguousMustache:function(e,t,n){var r=e.id,i=r.parts[0];this.opcode("getContext",r.depth),this.opcode("pushProgram",t),this.opcode("pushProgram",n),this.opcode("invokeAmbiguous",i)},simpleMustache:function(e,t,n){var r=e.id;r.type==="DATA"?this.DATA(r):r.parts.length?this.ID(r):(this.addDepth(r.depth),this.opcode("getContext",r.depth),this.opcode("pushContext")),this.opcode("resolvePossibleLambda")},helperMustache:function(e,t,n){var r=this.setupFullMustacheParams(e,t,n),i=e.id.parts[0];if(this.options.knownHelpers[i])this.opcode("invokeKnownHelper",r.length,i);else{if(this.knownHelpersOnly)throw new Error("You specified knownHelpersOnly, but used the unknown helper "+i);this.opcode("invokeHelper",r.length,i)}},ID:function(e){this.addDepth(e.depth),this.opcode("getContext",e.depth);var t=e.parts[0];t?this.opcode("lookupOnContext",e.parts[0]):this.opcode("pushContext");for(var n=1,r=e.parts.length;n<r;n++)this.opcode("lookup",e.parts[n])},DATA:function(e){this.options.data=!0,this.opcode("lookupData",e.id)},STRING:function(e){this.opcode("pushString",e.string)},INTEGER:function(e){this.opcode("pushLiteral",e.integer)},BOOLEAN:function(e){this.opcode("pushLiteral",e.bool)},comment:function(){},opcode:function(e){this.opcodes.push({opcode:e,args:[].slice.call(arguments,1)})},declare:function(e,t){this.opcodes.push({opcode:"DECLARE",name:e,value:t})},addDepth:function(e){if(isNaN(e))throw new Error("EWOT");if(e===0)return;this.depths[e]||(this.depths[e]=!0,this.depths.list.push(e))},classifyMustache:function(e){var t=e.isHelper,n=e.eligibleHelper,r=this.options;if(n&&!t){var i=e.id.parts[0];r.knownHelpers[i]?t=!0:r.knownHelpersOnly&&(n=!1)}return t?"helper":n?"ambiguous":"simple"},pushParams:function(e){var t=e.length,n;while(t--)n=e[t],this.options.stringParams?(n.depth&&this.addDepth(n.depth),this.opcode("getContext",n.depth||0),this.opcode("pushStringParam",n.string)):this[n.type](n)},setupMustacheParams:function(e){var t=e.params;return this.pushParams(t),e.hash?this.hash(e.hash):this.opcode("pushLiteral","{}"),t},setupFullMustacheParams:function(e,t,n){var r=e.params;return this.pushParams(r),this.opcode("pushProgram",t),this.opcode("pushProgram",n),e.hash?this.hash(e.hash):this.opcode("pushLiteral","{}"),r}};var n=function(e){this.value=e};t.prototype={nameLookup:function(e,n,r){return/^[0-9]+$/.test(n)?e+"["+n+"]":t.isValidJavaScriptVariableName(n)?e+"."+n:e+"['"+n+"']"},appendToBuffer:function(e){return this.environment.isSimple?"return "+e+";":"buffer += "+e+";"},initializeBuffer:function(){return this.quotedString("")},namespace:"Handlebars",compile:function(e,t,n,r){this.environment=e,this.options=t||{},Handlebars.log(Handlebars.logger.DEBUG,this.environment.disassemble()+"\n\n"),this.name=this.environment.name,this.isChild=!!n,this.context=n||{programs:[],aliases:{}},this.preamble(),this.stackSlot=0,this.stackVars=[],this.registers={list:[]},this.compileStack=[],this.compileChildren(e,t);var i=e.opcodes,s;this.i=0;for(o=i.length;this.i<o;this.i++)s=i[this.i],s.opcode==="DECLARE"?this[s.name]=s.value:this[s.opcode].apply(this,s.args);return this.createFunctionContext(r)},nextOpcode:function(){var e=this.environment.opcodes,t=e[this.i+1];return e[this.i+1]},eat:function(e){this.i=this.i+1},preamble:function(){var e=[];if(!this.isChild){var t=this.namespace,n="helpers = helpers || "+t+".helpers;";this.environment.usePartial&&(n=n+" partials = partials || "+t+".partials;"),this.options.data&&(n+=" data = data || {};"),e.push(n)}else e.push("");this.environment.isSimple?e.push(""):e.push(", buffer = "+this.initializeBuffer()),this.lastContext=0,this.source=e},createFunctionContext:function(e){var t=this.stackVars.concat(this.registers.list);t.length>0&&(this.source[1]=this.source[1]+", "+t.join(", "));if(!this.isChild){var n=[];for(var r in this.context.aliases)this.source[1]=this.source[1]+", "+r+"="+this.context.aliases[r]}this.source[1]&&(this.source[1]="var "+this.source[1].substring(2)+";"),this.isChild||(this.source[1]+="\n"+this.context.programs.join("\n")+"\n"),this.environment.isSimple||this.source.push("return buffer;");var i=this.isChild?["depth0","data"]:["Handlebars","depth0","helpers","partials","data"];for(var s=0,o=this.environment.depths.list.length;s<o;s++)i.push("depth"+this.environment.depths.list[s]);if(e)return i.push(this.source.join("\n  ")),Function.apply(this,i);var u="function "+(this.name||"")+"("+i.join(",")+") {\n  "+this.source.join("\n  ")+"}";return Handlebars.log(Handlebars.logger.DEBUG,u+"\n\n"),u},blockValue:function(){this.context.aliases.blockHelperMissing="helpers.blockHelperMissing";var e=["depth0"];this.setupParams(0,e),this.replaceStack(function(t){return e.splice(1,0,t),t+" = blockHelperMissing.call("+e.join(", ")+")"})},ambiguousBlockValue:function(){this.context.aliases.blockHelperMissing="helpers.blockHelperMissing";var e=["depth0"];this.setupParams(0,e);var t=this.topStack();e.splice(1,0,t),this.source.push("if (!"+this.lastHelper+") { "+t+" = blockHelperMissing.call("+e.join(", ")+"); }")},appendContent:function(e){this.source.push(this.appendToBuffer(this.quotedString(e)))},append:function(){var e=this.popStack();this.source.push("if("+e+" || "+e+" === 0) { "+this.appendToBuffer(e)+" }"),this.environment.isSimple&&this.source.push("else { "+this.appendToBuffer("''")+" }")},appendEscaped:function(){var e=this.nextOpcode(),t="";this.context.aliases.escapeExpression="this.escapeExpression",e&&e.opcode==="appendContent"&&(t=" + "+this.quotedString(e.args[0]),this.eat(e)),this.source.push(this.appendToBuffer("escapeExpression("+this.popStack()+")"+t))},getContext:function(e){this.lastContext!==e&&(this.lastContext=e)},lookupOnContext:function(e){this.pushStack(this.nameLookup("depth"+this.lastContext,e,"context"))},pushContext:function(){this.pushStackLiteral("depth"+this.lastContext)},resolvePossibleLambda:function(){this.context.aliases.functionType='"function"',this.replaceStack(function(e){return"typeof "+e+" === functionType ? "+e+".apply(depth0) : "+e})},lookup:function(e){this.replaceStack(function(t){return t+" == null || "+t+" === false ? "+t+" : "+this.nameLookup(t,e,"context")})},lookupData:function(e){this.pushStack(this.nameLookup("data",e,"data"))},pushStringParam:function(e){this.pushStackLiteral("depth"+this.lastContext),this.pushString(e)},pushString:function(e){this.pushStackLiteral(this.quotedString(e))},push:function(e){this.pushStack(e)},pushLiteral:function(e){this.pushStackLiteral(e)},pushProgram:function(e){e!=null?this.pushStackLiteral(this.programExpression(e)):this.pushStackLiteral(null)},invokeHelper:function(e,t){this.context.aliases.helperMissing="helpers.helperMissing";var n=this.lastHelper=this.setupHelper(e,t);this.register("foundHelper",n.name),this.pushStack("foundHelper ? foundHelper.call("+n.callParams+") "+": helperMissing.call("+n.helperMissingParams+")")},invokeKnownHelper:function(e,t){var n=this.setupHelper(e,t);this.pushStack(n.name+".call("+n.callParams+")")},invokeAmbiguous:function(e){this.context.aliases.functionType='"function"',this.pushStackLiteral("{}");var t=this.setupHelper(0,e),n=this.lastHelper=this.nameLookup("helpers",e,"helper");this.register("foundHelper",n);var r=this.nameLookup("depth"+this.lastContext,e,"context"),i=this.nextStack();this.source.push("if (foundHelper) { "+i+" = foundHelper.call("+t.callParams+"); }"),this.source.push("else { "+i+" = "+r+"; "+i+" = typeof "+i+" === functionType ? "+i+".apply(depth0) : "+i+"; }")},invokePartial:function(e){var t=[this.nameLookup("partials",e,"partial"),"'"+e+"'",this.popStack(),"helpers","partials"];this.options.data&&t.push("data"),this.context.aliases.self="this",this.pushStack("self.invokePartial("+t.join(", ")+");")},assignToHash:function(e){var t=this.popStack(),n=this.topStack();this.source.push(n+"['"+e+"'] = "+t+";")},compiler:t,compileChildren:function(e,t){var n=e.children,r,i;for(var s=0,o=n.length;s<o;s++){r=n[s],i=new this.compiler,this.context.programs.push("");var u=this.context.programs.length;r.index=u,r.name="program"+u,this.context.programs[u]=i.compile(r,t,this.context)}},programExpression:function(e){this.context.aliases.self="this";if(e==null)return"self.noop";var t=this.environment.children[e],n=t.depths.list,r,i=[t.index,t.name,"data"];for(var s=0,o=n.length;s<o;s++)r=n[s],r===1?i.push("depth0"):i.push("depth"+(r-1));return n.length===0?"self.program("+i.join(", ")+")":(i.shift(),"self.programWithDepth("+i.join(", ")+")")},register:function(e,t){this.useRegister(e),this.source.push(e+" = "+t+";")},useRegister:function(e){this.registers[e]||(this.registers[e]=!0,this.registers.list.push(e))},pushStackLiteral:function(e){return this.compileStack.push(new n(e)),e},pushStack:function(e){return this.source.push(this.incrStack()+" = "+e+";"),this.compileStack.push("stack"+this.stackSlot),"stack"+this.stackSlot},replaceStack:function(e){var t=e.call(this,this.topStack());return this.source.push(this.topStack()+" = "+t+";"),"stack"+this.stackSlot},nextStack:function(e){var t=this.incrStack();return this.compileStack.push("stack"+this.stackSlot),t},incrStack:function(){return this.stackSlot++,this.stackSlot>this.stackVars.length&&this.stackVars.push("stack"+this.stackSlot),"stack"+this.stackSlot},popStack:function(){var e=this.compileStack.pop();return e instanceof n?e.value:(this.stackSlot--,e)},topStack:function(){var e=this.compileStack[this.compileStack.length-1];return e instanceof n?e.value:e},quotedString:function(e){return'"'+e.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n").replace(/\r/g,"\\r")+'"'},setupHelper:function(e,t){var n=[];this.setupParams(e,n);var r=this.nameLookup("helpers",t,"helper");return{params:n,name:r,callParams:["depth0"].concat(n).join(", "),helperMissingParams:["depth0",this.quotedString(t)].concat(n).join(", ")}},setupParams:function(e,t){var n=[],r=[],i,s,o;n.push("hash:"+this.popStack()),s=this.popStack(),o=this.popStack();if(o||s)o||(this.context.aliases.self="this",o="self.noop"),s||(this.context.aliases.self="this",s="self.noop"),n.push("inverse:"+s),n.push("fn:"+o);for(var u=0;u<e;u++)i=this.popStack(),t.push(i),this.options.stringParams&&r.push(this.popStack());return this.options.stringParams&&n.push("contexts:["+r.join(",")+"]"),this.options.data&&n.push("data:data"),t.push("{"+n.join(",")+"}"),t.join(", ")}};var r="break else new var case finally return void catch for switch while continue function this with default if throw delete in try do instanceof typeof abstract enum int short boolean export interface static byte extends long super char final native synchronized class float package throws const goto private transient debugger implements protected volatile double import public let yield".split(" "),i=t.RESERVED_WORDS={};for(var s=0,o=r.length;s<o;s++)i[r[s]]=!0;t.isValidJavaScriptVariableName=function(e){return!t.RESERVED_WORDS[e]&&/^[a-zA-Z_$][0-9a-zA-Z_$]+$/.test(e)?!0:!1}}(Handlebars.Compiler,Handlebars.JavaScriptCompiler),Handlebars.precompile=function(e,t){t=t||{};var n=Handlebars.parse(e),r=(new Handlebars.Compiler).compile(n,t);return(new Handlebars.JavaScriptCompiler).compile(r,t)},Handlebars.compile=function(e,t){function n(){var n=Handlebars.parse(e),r=(new Handlebars.Compiler).compile(n,t),i=(new Handlebars.JavaScriptCompiler).compile(r,t,undefined,!0);return Handlebars.template(i)}t=t||{};var r;return function(e,t){return r||(r=n()),r.call(this,e,t)}},Handlebars.VM={template:function(e){var t={escapeExpression:Handlebars.Utils.escapeExpression,invokePartial:Handlebars.VM.invokePartial,programs:[],program:function(e,t,n){var r=this.programs[e];return n?Handlebars.VM.program(t,n):r?r:(r=this.programs[e]=Handlebars.VM.program(t),r)},programWithDepth:Handlebars.VM.programWithDepth,noop:Handlebars.VM.noop};return function(n,r){return r=r||{},e.call(t,Handlebars,n,r.helpers,r.partials,r.data)}},programWithDepth:function(e,t,n){var r=Array.prototype.slice.call(arguments,2);return function(n,i){return i=i||{},e.apply(this,[n,i.data||t].concat(r))}},program:function(e,t){return function(n,r){return r=r||{},e(n,r.data||t)}},noop:function(){return""},invokePartial:function(e,t,n,r,i,s){var o={helpers:r,partials:i,data:s};if(e===undefined)throw new Handlebars.Exception("The partial "+t+" could not be found");if(e instanceof Function)return e(n,o);if(!Handlebars.compile)throw new Handlebars.Exception("The partial "+t+" could not be compiled when running in runtime-only mode");return i[t]=Handlebars.compile(e,{data:s!==undefined}),i[t](n,o)}},Handlebars.template=Handlebars.VM.template,define("Handlebars",function(e){return function(){var t,n;return t||e.Handlebars}}(this)),window.log=function(){log.history=log.history||[],log.history.push(arguments);if(this.console){var t=arguments,n;t.callee=t.callee.caller,n=[].slice.call(t),typeof console.log=="object"?log.apply.call(console.log,console,n):console.log.apply(console,n)}},function(e){function t(){}for(var n="assert,count,debug,dir,dirxml,error,exception,group,groupCollapsed,groupEnd,info,log,markTimeline,profile,profileEnd,time,timeEnd,trace,warn".split(","),r;!!(r=n.pop());)e[r]=e[r]||t}(function(){try{return console.log(),window.console}catch(e){return window.console={}}}());var Utils=function(e){var t={};return t.preventDefaultEventHandling=function(e){var t=e||window.event;t.preventDefault?t.preventDefault():(t.returnValue=!1,t.cancelBubble=!0)},t.handleValidation=function(t,n,r){e("#"+n+"Message").attr("id")===undefined&&e("#"+n).parent().append('<span class="help-inline hidden" id="'+n+'Message">Please correct the error</span>');var i=e("#"+n).parent(),s="";if(i!==undefined){s=i.attr("class");if(s===undefined)return;while(s.indexOf("control-group")===-1){i=i.parent();if(i===undefined)return;s=i.attr("class");if(s===undefined)return}t===!0?(i.removeClass("error"),e("#"+n+"Message").addClass("hidden"),e("#"+n+"Message").html("")):(e("#"+n+"Message").html(r),i.addClass("error"),e("#"+n+"Message").removeClass("hidden"))}},t}(jQuery);define("utils",["jquery"],function(e){return function(){var t,n;return t||e.Utils}}(this)),!function(e){e(function(){e.support.transition=function(){var e=function(){var e=document.createElement("bootstrap"),t={WebkitTransition:"webkitTransitionEnd",MozTransition:"transitionend",OTransition:"oTransitionEnd otransitionend",transition:"transitionend"},n;for(n in t)if(e.style[n]!==undefined)return t[n]}();return e&&{end:e}}()})}(window.jQuery),!function(e){var t='[data-dismiss="alert"]',n=function(n){e(n).on("click",t,this.close)};n.prototype.close=function(t){function s(){i.trigger("closed").remove()}var n=e(this),r=n.attr("data-target"),i;r||(r=n.attr("href"),r=r&&r.replace(/.*(?=#[^\s]*$)/,"")),i=e(r),t&&t.preventDefault(),i.length||(i=n.hasClass("alert")?n:n.parent()),i.trigger(t=e.Event("close"));if(t.isDefaultPrevented())return;i.removeClass("in"),e.support.transition&&i.hasClass("fade")?i.on(e.support.transition.end,s):s()};var r=e.fn.alert;e.fn.alert=function(t){return this.each(function(){var r=e(this),i=r.data("alert");i||r.data("alert",i=new n(this)),typeof t=="string"&&i[t].call(r)})},e.fn.alert.Constructor=n,e.fn.alert.noConflict=function(){return e.fn.alert=r,this},e(document).on("click.alert.data-api",t,n.prototype.close)}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=e.extend({},e.fn.button.defaults,n)};t.prototype.setState=function(e){var t="disabled",n=this.$element,r=n.data(),i=n.is("input")?"val":"html";e+="Text",r.resetText||n.data("resetText",n[i]()),n[i](r[e]||this.options[e]),setTimeout(function(){e=="loadingText"?n.addClass(t).attr(t,t):n.removeClass(t).removeAttr(t)},0)},t.prototype.toggle=function(){var e=this.$element.closest('[data-toggle="buttons-radio"]');e&&e.find(".active").removeClass("active"),this.$element.toggleClass("active")};var n=e.fn.button;e.fn.button=function(n){return this.each(function(){var r=e(this),i=r.data("button"),s=typeof n=="object"&&n;i||r.data("button",i=new t(this,s)),n=="toggle"?i.toggle():n&&i.setState(n)})},e.fn.button.defaults={loadingText:"loading..."},e.fn.button.Constructor=t,e.fn.button.noConflict=function(){return e.fn.button=n,this},e(document).on("click.button.data-api","[data-toggle^=button]",function(t){var n=e(t.target);n.hasClass("btn")||(n=n.closest(".btn")),n.button("toggle")})}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=n,this.options.pause=="hover"&&this.$element.on("mouseenter",e.proxy(this.pause,this)).on("mouseleave",e.proxy(this.cycle,this))};t.prototype={cycle:function(t){return t||(this.paused=!1),this.options.interval&&!this.paused&&(this.interval=setInterval(e.proxy(this.next,this),this.options.interval)),this},to:function(t){var n=this.$element.find(".item.active"),r=n.parent().children(),i=r.index(n),s=this;if(t>r.length-1||t<0)return;return this.sliding?this.$element.one("slid",function(){s.to(t)}):i==t?this.pause().cycle():this.slide(t>i?"next":"prev",e(r[t]))},pause:function(t){return t||(this.paused=!0),this.$element.find(".next, .prev").length&&e.support.transition.end&&(this.$element.trigger(e.support.transition.end),this.cycle()),clearInterval(this.interval),this.interval=null,this},next:function(){if(this.sliding)return;return this.slide("next")},prev:function(){if(this.sliding)return;return this.slide("prev")},slide:function(t,n){var r=this.$element.find(".item.active"),i=n||r[t](),s=this.interval,o=t=="next"?"left":"right",u=t=="next"?"first":"last",a=this,f;this.sliding=!0,s&&this.pause(),i=i.length?i:this.$element.find(".item")[u](),f=e.Event("slide",{relatedTarget:i[0]});if(i.hasClass("active"))return;if(e.support.transition&&this.$element.hasClass("slide")){this.$element.trigger(f);if(f.isDefaultPrevented())return;i.addClass(t),i[0].offsetWidth,r.addClass(o),i.addClass(o),this.$element.one(e.support.transition.end,function(){i.removeClass([t,o].join(" ")).addClass("active"),r.removeClass(["active",o].join(" ")),a.sliding=!1,setTimeout(function(){a.$element.trigger("slid")},0)})}else{this.$element.trigger(f);if(f.isDefaultPrevented())return;r.removeClass("active"),i.addClass("active"),this.sliding=!1,this.$element.trigger("slid")}return s&&this.cycle(),this}};var n=e.fn.carousel;e.fn.carousel=function(n){return this.each(function(){var r=e(this),i=r.data("carousel"),s=e.extend({},e.fn.carousel.defaults,typeof n=="object"&&n),o=typeof n=="string"?n:s.slide;i||r.data("carousel",i=new t(this,s)),typeof n=="number"?i.to(n):o?i[o]():s.interval&&i.cycle()})},e.fn.carousel.defaults={interval:5e3,pause:"hover"},e.fn.carousel.Constructor=t,e.fn.carousel.noConflict=function(){return e.fn.carousel=n,this},e(document).on("click.carousel.data-api","[data-slide]",function(t){var n=e(this),r,i=e(n.attr("data-target")||(r=n.attr("href"))&&r.replace(/.*(?=#[^\s]+$)/,"")),s=e.extend({},i.data(),n.data());i.carousel(s),t.preventDefault()})}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=e.extend({},e.fn.collapse.defaults,n),this.options.parent&&(this.$parent=e(this.options.parent)),this.options.toggle&&this.toggle()};t.prototype={constructor:t,dimension:function(){var e=this.$element.hasClass("width");return e?"width":"height"},show:function(){var t,n,r,i;if(this.transitioning)return;t=this.dimension(),n=e.camelCase(["scroll",t].join("-")),r=this.$parent&&this.$parent.find("> .accordion-group > .in");if(r&&r.length){i=r.data("collapse");if(i&&i.transitioning)return;r.collapse("hide"),i||r.data("collapse",null)}this.$element[t](0),this.transition("addClass",e.Event("show"),"shown"),e.support.transition&&this.$element[t](this.$element[0][n])},hide:function(){var t;if(this.transitioning)return;t=this.dimension(),this.reset(this.$element[t]()),this.transition("removeClass",e.Event("hide"),"hidden"),this.$element[t](0)},reset:function(e){var t=this.dimension();return this.$element.removeClass("collapse")[t](e||"auto")[0].offsetWidth,this.$element[e!==null?"addClass":"removeClass"]("collapse"),this},transition:function(t,n,r){var i=this,s=function(){n.type=="show"&&i.reset(),i.transitioning=0,i.$element.trigger(r)};this.$element.trigger(n);if(n.isDefaultPrevented())return;this.transitioning=1,this.$element[t]("in"),e.support.transition&&this.$element.hasClass("collapse")?this.$element.one(e.support.transition.end,s):s()},toggle:function(){this[this.$element.hasClass("in")?"hide":"show"]()}};var n=e.fn.collapse;e.fn.collapse=function(n){return this.each(function(){var r=e(this),i=r.data("collapse"),s=typeof n=="object"&&n;i||r.data("collapse",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.collapse.defaults={toggle:!0},e.fn.collapse.Constructor=t,e.fn.collapse.noConflict=function(){return e.fn.collapse=n,this},e(document).on("click.collapse.data-api","[data-toggle=collapse]",function(t){var n=e(this),r,i=n.attr("data-target")||t.preventDefault()||(r=n.attr("href"))&&r.replace(/.*(?=#[^\s]+$)/,""),s=e(i).data("collapse")?"toggle":n.data();n[e(i).hasClass("in")?"addClass":"removeClass"]("collapsed"),e(i).collapse(s)})}(window.jQuery),!function(e){function r(){e(t).each(function(){i(e(this)).removeClass("open")})}function i(t){var n=t.attr("data-target"),r;return n||(n=t.attr("href"),n=n&&/#/.test(n)&&n.replace(/.*(?=#[^\s]*$)/,"")),r=e(n),r.length||(r=t.parent()),r}var t="[data-toggle=dropdown]",n=function(t){var n=e(t).on("click.dropdown.data-api",this.toggle);e("html").on("click.dropdown.data-api",function(){n.parent().removeClass("open")})};n.prototype={constructor:n,toggle:function(t){var n=e(this),s,o;if(n.is(".disabled, :disabled"))return;return s=i(n),o=s.hasClass("open"),r(),o||s.toggleClass("open"),n.focus(),!1},keydown:function(t){var n,r,s,o,u,a;if(!/(38|40|27)/.test(t.keyCode))return;n=e(this),t.preventDefault(),t.stopPropagation();if(n.is(".disabled, :disabled"))return;o=i(n),u=o.hasClass("open");if(!u||u&&t.keyCode==27)return n.click();r=e("[role=menu] li:not(.divider):visible a",o);if(!r.length)return;a=r.index(r.filter(":focus")),t.keyCode==38&&a>0&&a--,t.keyCode==40&&a<r.length-1&&a++,~a||(a=0),r.eq(a).focus()}};var s=e.fn.dropdown;e.fn.dropdown=function(t){return this.each(function(){var r=e(this),i=r.data("dropdown");i||r.data("dropdown",i=new n(this)),typeof t=="string"&&i[t].call(r)})},e.fn.dropdown.Constructor=n,e.fn.dropdown.noConflict=function(){return e.fn.dropdown=s,this},e(document).on("click.dropdown.data-api touchstart.dropdown.data-api",r).on("click.dropdown touchstart.dropdown.data-api",".dropdown form",function(e){e.stopPropagation()}).on("touchstart.dropdown.data-api",".dropdown-menu",function(e){e.stopPropagation()}).on("click.dropdown.data-api touchstart.dropdown.data-api",t,n.prototype.toggle).on("keydown.dropdown.data-api touchstart.dropdown.data-api",t+", [role=menu]",n.prototype.keydown)}(window.jQuery),!function(e){var t=function(t,n){this.options=n,this.$element=e(t).delegate('[data-dismiss="modal"]',"click.dismiss.modal",e.proxy(this.hide,this)),this.options.remote&&this.$element.find(".modal-body").load(this.options.remote)};t.prototype={constructor:t,toggle:function(){return this[this.isShown?"hide":"show"]()},show:function(){var t=this,n=e.Event("show");this.$element.trigger(n);if(this.isShown||n.isDefaultPrevented())return;this.isShown=!0,this.escape(),this.backdrop(function(){var n=e.support.transition&&t.$element.hasClass("fade");t.$element.parent().length||t.$element.appendTo(document.body),t.$element.show(),n&&t.$element[0].offsetWidth,t.$element.addClass("in").attr("aria-hidden",!1),t.enforceFocus(),n?t.$element.one(e.support.transition.end,function(){t.$element.focus().trigger("shown")}):t.$element.focus().trigger("shown")})},hide:function(t){t&&t.preventDefault();var n=this;t=e.Event("hide"),this.$element.trigger(t);if(!this.isShown||t.isDefaultPrevented())return;this.isShown=!1,this.escape(),e(document).off("focusin.modal"),this.$element.removeClass("in").attr("aria-hidden",!0),e.support.transition&&this.$element.hasClass("fade")?this.hideWithTransition():this.hideModal()},enforceFocus:function(){var t=this;e(document).on("focusin.modal",function(e){t.$element[0]!==e.target&&!t.$element.has(e.target).length&&t.$element.focus()})},escape:function(){var e=this;this.isShown&&this.options.keyboard?this.$element.on("keyup.dismiss.modal",function(t){t.which==27&&e.hide()}):this.isShown||this.$element.off("keyup.dismiss.modal")},hideWithTransition:function(){var t=this,n=setTimeout(function(){t.$element.off(e.support.transition.end),t.hideModal()},500);this.$element.one(e.support.transition.end,function(){clearTimeout(n),t.hideModal()})},hideModal:function(e){this.$element.hide().trigger("hidden"),this.backdrop()},removeBackdrop:function(){this.$backdrop.remove(),this.$backdrop=null},backdrop:function(t){var n=this,r=this.$element.hasClass("fade")?"fade":"";if(this.isShown&&this.options.backdrop){var i=e.support.transition&&r;this.$backdrop=e('<div class="modal-backdrop '+r+'" />').appendTo(document.body),this.$backdrop.click(this.options.backdrop=="static"?e.proxy(this.$element[0].focus,this.$element[0]):e.proxy(this.hide,this)),i&&this.$backdrop[0].offsetWidth,this.$backdrop.addClass("in"),i?this.$backdrop.one(e.support.transition.end,t):t()}else!this.isShown&&this.$backdrop?(this.$backdrop.removeClass("in"),e.support.transition&&this.$element.hasClass("fade")?this.$backdrop.one(e.support.transition.end,e.proxy(this.removeBackdrop,this)):this.removeBackdrop()):t&&t()}};var n=e.fn.modal;e.fn.modal=function(n){return this.each(function(){var r=e(this),i=r.data("modal"),s=e.extend({},e.fn.modal.defaults,r.data(),typeof n=="object"&&n);i||r.data("modal",i=new t(this,s)),typeof n=="string"?i[n]():s.show&&i.show()})},e.fn.modal.defaults={backdrop:!0,keyboard:!0,show:!0},e.fn.modal.Constructor=t,e.fn.modal.noConflict=function(){return e.fn.modal=n,this},e(document).on("click.modal.data-api",'[data-toggle="modal"]',function(t){var n=e(this),r=n.attr("href"),i=e(n.attr("data-target")||r&&r.replace(/.*(?=#[^\s]+$)/,"")),s=i.data("modal")?"toggle":e.extend({remote:!/#/.test(r)&&r},i.data(),n.data());t.preventDefault(),i.modal(s).one("hide",function(){n.focus()})})}(window.jQuery),!function(e){var t=function(e,t){this.init("tooltip",e,t)};t.prototype={constructor:t,init:function(t,n,r){var i,s;this.type=t,this.$element=e(n),this.options=this.getOptions(r),this.enabled=!0,this.options.trigger=="click"?this.$element.on("click."+this.type,this.options.selector,e.proxy(this.toggle,this)):this.options.trigger!="manual"&&(i=this.options.trigger=="hover"?"mouseenter":"focus",s=this.options.trigger=="hover"?"mouseleave":"blur",this.$element.on(i+"."+this.type,this.options.selector,e.proxy(this.enter,this)),this.$element.on(s+"."+this.type,this.options.selector,e.proxy(this.leave,this))),this.options.selector?this._options=e.extend({},this.options,{trigger:"manual",selector:""}):this.fixTitle()},getOptions:function(t){return t=e.extend({},e.fn[this.type].defaults,t,this.$element.data()),t.delay&&typeof t.delay=="number"&&(t.delay={show:t.delay,hide:t.delay}),t},enter:function(t){var n=e(t.currentTarget)[this.type](this._options).data(this.type);if(!n.options.delay||!n.options.delay.show)return n.show();clearTimeout(this.timeout),n.hoverState="in",this.timeout=setTimeout(function(){n.hoverState=="in"&&n.show()},n.options.delay.show)},leave:function(t){var n=e(t.currentTarget)[this.type](this._options).data(this.type);this.timeout&&clearTimeout(this.timeout);if(!n.options.delay||!n.options.delay.hide)return n.hide();n.hoverState="out",this.timeout=setTimeout(function(){n.hoverState=="out"&&n.hide()},n.options.delay.hide)},show:function(){var e,t,n,r,i,s,o;if(this.hasContent()&&this.enabled){e=this.tip(),this.setContent(),this.options.animation&&e.addClass("fade"),s=typeof this.options.placement=="function"?this.options.placement.call(this,e[0],this.$element[0]):this.options.placement,t=/in/.test(s),e.detach().css({top:0,left:0,display:"block"}).insertAfter(this.$element),n=this.getPosition(t),r=e[0].offsetWidth,i=e[0].offsetHeight;switch(t?s.split(" ")[1]:s){case"bottom":o={top:n.top+n.height,left:n.left+n.width/2-r/2};break;case"top":o={top:n.top-i,left:n.left+n.width/2-r/2};break;case"left":o={top:n.top+n.height/2-i/2,left:n.left-r};break;case"right":o={top:n.top+n.height/2-i/2,left:n.left+n.width}}e.offset(o).addClass(s).addClass("in")}},setContent:function(){var e=this.tip(),t=this.getTitle();e.find(".tooltip-inner")[this.options.html?"html":"text"](t),e.removeClass("fade in top bottom left right")},hide:function(){function r(){var t=setTimeout(function(){n.off(e.support.transition.end).detach()},500);n.one(e.support.transition.end,function(){clearTimeout(t),n.detach()})}var t=this,n=this.tip();return n.removeClass("in"),e.support.transition&&this.$tip.hasClass("fade")?r():n.detach(),this},fixTitle:function(){var e=this.$element;(e.attr("title")||typeof e.attr("data-original-title")!="string")&&e.attr("data-original-title",e.attr("title")||"").removeAttr("title")},hasContent:function(){return this.getTitle()},getPosition:function(t){return e.extend({},t?{top:0,left:0}:this.$element.offset(),{width:this.$element[0].offsetWidth,height:this.$element[0].offsetHeight})},getTitle:function(){var e,t=this.$element,n=this.options;return e=t.attr("data-original-title")||(typeof n.title=="function"?n.title.call(t[0]):n.title),e},tip:function(){return this.$tip=this.$tip||e(this.options.template)},validate:function(){this.$element[0].parentNode||(this.hide(),this.$element=null,this.options=null)},enable:function(){this.enabled=!0},disable:function(){this.enabled=!1},toggleEnabled:function(){this.enabled=!this.enabled},toggle:function(t){var n=e(t.currentTarget)[this.type](this._options).data(this.type);n[n.tip().hasClass("in")?"hide":"show"]()},destroy:function(){this.hide().$element.off("."+this.type).removeData(this.type)}};var n=e.fn.tooltip;e.fn.tooltip=function(n){return this.each(function(){var r=e(this),i=r.data("tooltip"),s=typeof n=="object"&&n;i||r.data("tooltip",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.tooltip.Constructor=t,e.fn.tooltip.defaults={animation:!0,placement:"top",selector:!1,template:'<div class="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',trigger:"hover",title:"",delay:0,html:!1},e.fn.tooltip.noConflict=function(){return e.fn.tooltip=n,this}}(window.jQuery),!function(e){var t=function(e,t){this.init("popover",e,t)};t.prototype=e.extend({},e.fn.tooltip.Constructor.prototype,{constructor:t,setContent:function(){var e=this.tip(),t=this.getTitle(),n=this.getContent();e.find(".popover-title")[this.options.html?"html":"text"](t),e.find(".popover-content")[this.options.html?"html":"text"](n),e.removeClass("fade top bottom left right in")},hasContent:function(){return this.getTitle()||this.getContent()},getContent:function(){var e,t=this.$element,n=this.options;return e=t.attr("data-content")||(typeof n.content=="function"?n.content.call(t[0]):n.content),e},tip:function(){return this.$tip||(this.$tip=e(this.options.template)),this.$tip},destroy:function(){this.hide().$element.off("."+this.type).removeData(this.type)}});var n=e.fn.popover;e.fn.popover=function(n){return this.each(function(){var r=e(this),i=r.data("popover"),s=typeof n=="object"&&n;i||r.data("popover",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.popover.Constructor=t,e.fn.popover.defaults=e.extend({},e.fn.tooltip.defaults,{placement:"right",trigger:"click",content:"",template:'<div class="popover"><div class="arrow"></div><div class="popover-inner"><h3 class="popover-title"></h3><div class="popover-content"></div></div></div>'}),e.fn.popover.noConflict=function(){return e.fn.popover=n,this}}(window.jQuery),!function(e){function t(t,n){var r=e.proxy(this.process,this),i=e(t).is("body")?e(window):e(t),s;this.options=e.extend({},e.fn.scrollspy.defaults,n),this.$scrollElement=i.on("scroll.scroll-spy.data-api",r),this.selector=(this.options.target||(s=e(t).attr("href"))&&s.replace(/.*(?=#[^\s]+$)/,"")||"")+" .nav li > a",this.$body=e("body"),this.refresh(),this.process()}t.prototype={constructor:t,refresh:function(){var t=this,n;this.offsets=e([]),this.targets=e([]),n=this.$body.find(this.selector).map(function(){var n=e(this),r=n.data("target")||n.attr("href"),i=/^#\w/.test(r)&&e(r);return i&&i.length&&[[i.position().top+t.$scrollElement.scrollTop(),r]]||null}).sort(function(e,t){return e[0]-t[0]}).each(function(){t.offsets.push(this[0]),t.targets.push(this[1])})},process:function(){var e=this.$scrollElement.scrollTop()+this.options.offset,t=this.$scrollElement[0].scrollHeight||this.$body[0].scrollHeight,n=t-this.$scrollElement.height(),r=this.offsets,i=this.targets,s=this.activeTarget,o;if(e>=n)return s!=(o=i.last()[0])&&this.activate(o);for(o=r.length;o--;)s!=i[o]&&e>=r[o]&&(!r[o+1]||e<=r[o+1])&&this.activate(i[o])},activate:function(t){var n,r;this.activeTarget=t,e(this.selector).parent(".active").removeClass("active"),r=this.selector+'[data-target="'+t+'"],'+this.selector+'[href="'+t+'"]',n=e(r).parent("li").addClass("active"),n.parent(".dropdown-menu").length&&(n=n.closest("li.dropdown").addClass("active")),n.trigger("activate")}};var n=e.fn.scrollspy;e.fn.scrollspy=function(n){return this.each(function(){var r=e(this),i=r.data("scrollspy"),s=typeof n=="object"&&n;i||r.data("scrollspy",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.scrollspy.Constructor=t,e.fn.scrollspy.defaults={offset:10},e.fn.scrollspy.noConflict=function(){return e.fn.scrollspy=n,this},e(window).on("load",function(){e('[data-spy="scroll"]').each(function(){var t=e(this);t.scrollspy(t.data())})})}(window.jQuery),!function(e){var t=function(t){this.element=e(t)};t.prototype={constructor:t,show:function(){var t=this.element,n=t.closest("ul:not(.dropdown-menu)"),r=t.attr("data-target"),i,s,o;r||(r=t.attr("href"),r=r&&r.replace(/.*(?=#[^\s]*$)/,""));if(t.parent("li").hasClass("active"))return;i=n.find(".active:last a")[0],o=e.Event("show",{relatedTarget:i}),t.trigger(o);if(o.isDefaultPrevented())return;s=e(r),this.activate(t.parent("li"),n),this.activate(s,s.parent(),function(){t.trigger({type:"shown",relatedTarget:i})})},activate:function(t,n,r){function o(){i.removeClass("active").find("> .dropdown-menu > .active").removeClass("active"),t.addClass("active"),s?(t[0].offsetWidth,t.addClass("in")):t.removeClass("fade"),t.parent(".dropdown-menu")&&t.closest("li.dropdown").addClass("active"),r&&r()}var i=n.find("> .active"),s=r&&e.support.transition&&i.hasClass("fade");s?i.one(e.support.transition.end,o):o(),i.removeClass("in")}};var n=e.fn.tab;e.fn.tab=function(n){return this.each(function(){var r=e(this),i=r.data("tab");i||r.data("tab",i=new t(this)),typeof n=="string"&&i[n]()})},e.fn.tab.Constructor=t,e.fn.tab.noConflict=function(){return e.fn.tab=n,this},e(document).on("click.tab.data-api",'[data-toggle="tab"], [data-toggle="pill"]',function(t){t.preventDefault(),e(this).tab("show")})}(window.jQuery),!function(e){var t=function(t,n){this.$element=e(t),this.options=e.extend({},e.fn.typeahead.defaults,n),this.matcher=this.options.matcher||this.matcher,this.sorter=this.options.sorter||this.sorter,this.highlighter=this.options.highlighter||this.highlighter,this.updater=this.options.updater||this.updater,this.source=this.options.source,this.$menu=e(this.options.menu),this.shown=!1,this.listen()};t.prototype={constructor:t,select:function(){var e=this.$menu.find(".active").attr("data-value");return this.$element.val(this.updater(e)).change(),this.hide()},updater:function(e){return e},show:function(){var t=e.extend({},this.$element.position(),{height:this.$element[0].offsetHeight});return this.$menu.insertAfter(this.$element).css({top:t.top+t.height,left:t.left}).show(),this.shown=!0,this},hide:function(){return this.$menu.hide(),this.shown=!1,this},lookup:function(t){var n;return this.query=this.$element.val(),!this.query||this.query.length<this.options.minLength?this.shown?this.hide():this:(n=e.isFunction(this.source)?this.source(this.query,e.proxy(this.process,this)):this.source,n?this.process(n):this)},process:function(t){var n=this;return t=e.grep(t,function(e){return n.matcher(e)}),t=this.sorter(t),t.length?this.render(t.slice(0,this.options.items)).show():this.shown?this.hide():this},matcher:function(e){return~e.toLowerCase().indexOf(this.query.toLowerCase())},sorter:function(e){var t=[],n=[],r=[],i;while(i=e.shift())i.toLowerCase().indexOf(this.query.toLowerCase())?~i.indexOf(this.query)?n.push(i):r.push(i):t.push(i);return t.concat(n,r)},highlighter:function(e){var t=this.query.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g,"\\$&");return e.replace(new RegExp("("+t+")","ig"),function(e,t){return"<strong>"+t+"</strong>"})},render:function(t){var n=this;return t=e(t).map(function(t,r){return t=e(n.options.item).attr("data-value",r),t.find("a").html(n.highlighter(r)),t[0]}),t.first().addClass("active"),this.$menu.html(t),this},next:function(t){var n=this.$menu.find(".active").removeClass("active"),r=n.next();r.length||(r=e(this.$menu.find("li")[0])),r.addClass("active")},prev:function(e){var t=this.$menu.find(".active").removeClass("active"),n=t.prev();n.length||(n=this.$menu.find("li").last()),n.addClass("active")},listen:function(){this.$element.on("blur",e.proxy(this.blur,this)).on("keypress",e.proxy(this.keypress,this)).on("keyup",e.proxy(this.keyup,this)),this.eventSupported("keydown")&&this.$element.on("keydown",e.proxy(this.keydown,this)),this.$menu.on("click",e.proxy(this.click,this)).on("mouseenter","li",e.proxy(this.mouseenter,this))},eventSupported:function(e){var t=e in this.$element;return t||(this.$element.setAttribute(e,"return;"),t=typeof this.$element[e]=="function"),t},move:function(e){if(!this.shown)return;switch(e.keyCode){case 9:case 13:case 27:e.preventDefault();break;case 38:e.preventDefault(),this.prev();break;case 40:e.preventDefault(),this.next()}e.stopPropagation()},keydown:function(t){this.suppressKeyPressRepeat=~e.inArray(t.keyCode,[40,38,9,13,27]),this.move(t)},keypress:function(e){if(this.suppressKeyPressRepeat)return;this.move(e)},keyup:function(e){switch(e.keyCode){case 40:case 38:case 16:case 17:case 18:break;case 9:case 13:if(!this.shown)return;this.select();break;case 27:if(!this.shown)return;this.hide();break;default:this.lookup()}e.stopPropagation(),e.preventDefault()},blur:function(e){var t=this;setTimeout(function(){t.hide()},150)},click:function(e){e.stopPropagation(),e.preventDefault(),this.select()},mouseenter:function(t){this.$menu.find(".active").removeClass("active"),e(t.currentTarget).addClass("active")}};var n=e.fn.typeahead;e.fn.typeahead=function(n){return this.each(function(){var r=e(this),i=r.data("typeahead"),s=typeof n=="object"&&n;i||r.data("typeahead",i=new t(this,s)),typeof n=="string"&&i[n]()})},e.fn.typeahead.defaults={source:[],items:8,menu:'<ul class="typeahead dropdown-menu"></ul>',item:'<li><a href="#"></a></li>',minLength:1},e.fn.typeahead.Constructor=t,e.fn.typeahead.noConflict=function(){return e.fn.typeahead=n,this},e(document).on("focus.typeahead.data-api",'[data-provide="typeahead"]',function(t){var n=e(this);if(n.data("typeahead"))return;t.preventDefault(),n.typeahead(n.data())})}(window.jQuery),define("plugins/bootstrap",["jquery"],function(){});var HandlebarsTemplates=function(e,t){var n={};return e.getTemplate=function(t){var n="app/templates/"+t+".handlebars";return(e.templates===undefined||e.templates[n]===undefined)&&$.ajax({url:n,success:function(t){e.templates===undefined&&(e.templates={}),e.templates[n]=e.compile(t)},async:!1}),e.templates[n]},n}(Handlebars,this);define("plugins/handlebars.template",["Handlebars"],function(){}),function(e){function t(e,t){var n=decodeURIComponent(e);if(n.length<=t)return e;var r=n.substring(0,t-1).lastIndexOf(" ");return n=encodeURIComponent(n.substring(0,r))+"…"}function n(t){return e('meta[name="'+t+'"]').attr("content")||""}function r(){var t=n("DC.title"),r=n("DC.creator"),t=0<t.length&&0<r.length?t+(" - "+r):e("title").text();return encodeURIComponent(t)}function i(){var t=document.location.href,n=e("link[rel=canonical]").attr("href");return n&&0<n.length&&(0>n.indexOf("http")&&(n=document.location.protocol+"//"+document.location.host+n),t=n),t}e.fn.socialSharePrivacy=function(n){var o=e.extend(!0,{services:{facebook:{status:"on",dummy_img:"socialshareprivacy/images/dummy_facebook.png",txt_info:"2 Klicks f&uuml;r mehr Datenschutz: Erst wenn Sie hier klicken, wird der Button aktiv und Sie k&ouml;nnen Ihre Empfehlung an Facebook senden. Schon beim Aktivieren werden Daten an Dritte &uuml;bertragen &ndash; siehe <em>i</em>.",txt_fb_off:"nicht mit Facebook verbunden",txt_fb_on:"mit Facebook verbunden",perma_option:"on",display_name:"Facebook",referrer_track:"",language:"de_DE",action:"recommend"},twitter:{status:"on",dummy_img:"socialshareprivacy/images/dummy_twitter.png",txt_info:"2 Klicks f&uuml;r mehr Datenschutz: Erst wenn Sie hier klicken, wird der Button aktiv und Sie k&ouml;nnen Ihre Empfehlung an Twitter senden. Schon beim Aktivieren werden Daten an Dritte &uuml;bertragen &ndash; siehe <em>i</em>.",txt_twitter_off:"nicht mit Twitter verbunden",txt_twitter_on:"mit Twitter verbunden",perma_option:"on",display_name:"Twitter",referrer_track:"",tweet_text:r,language:"en"},gplus:{status:"on",dummy_img:"socialshareprivacy/images/dummy_gplus.png",txt_info:"2 Klicks f&uuml;r mehr Datenschutz: Erst wenn Sie hier klicken, wird der Button aktiv und Sie k&ouml;nnen Ihre Empfehlung an Google+ senden. Schon beim Aktivieren werden Daten an Dritte &uuml;bertragen &ndash; siehe <em>i</em>.",txt_gplus_off:"nicht mit Google+ verbunden",txt_gplus_on:"mit Google+ verbunden",perma_option:"on",display_name:"Google+",referrer_track:"",language:"de"}},info_link:"http://www.heise.de/ct/artikel/2-Klicks-fuer-mehr-Datenschutz-1333879.html",txt_help:"Wenn Sie diese Felder durch einen Klick aktivieren, werden Informationen an Facebook, Twitter oder Google in die USA &uuml;bertragen und unter Umst&auml;nden auch dort gespeichert. N&auml;heres erfahren Sie durch einen Klick auf das <em>i</em>.",settings_perma:"Dauerhaft aktivieren und Daten&uuml;ber&shy;tragung zustimmen:",cookie_path:"/",cookie_domain:document.location.host,cookie_expires:"365",css_path:"socialshareprivacy/socialshareprivacy.css",uri:i},n),u="on"===o.services.facebook.status,a="on"===o.services.twitter.status,f="on"===o.services.gplus.status;if(u||a||f)return 0<o.css_path.length&&(document.createStyleSheet?document.createStyleSheet(o.css_path):e("head").append('<link rel="stylesheet" type="text/css" href="'+o.css_path+'" />')),this.each(function(){e(this).prepend('<ul class="social_share_privacy_area"></ul>');var n=e(".social_share_privacy_area",this),r=o.uri;"function"==typeof r&&(r=r(n));if(u){var i=encodeURIComponent(r+o.services.facebook.referrer_track),s='<iframe src="http://www.facebook.com/plugins/like.php?locale='+o.services.facebook.language+"&amp;href="+i+"&amp;send=false&amp;layout=button_count&amp;width=120&amp;show_faces=false&amp;action="+o.services.facebook.action+'&amp;colorscheme=light&amp;font&amp;height=21" scrolling="no" frameborder="0" style="border:none; overflow:hidden; width:145px; height:21px;" allowTransparency="true"></iframe>',l='<img src="'+o.services.facebook.dummy_img+'" alt="Facebook &quot;Like&quot;-Dummy" class="fb_like_privacy_dummy" />';n.append('<li class="facebook help_info"><span class="info">'+o.services.facebook.txt_info+'</span><span class="switch off">'+o.services.facebook.txt_fb_off+'</span><div class="fb_like dummy_btn">'+l+"</div></li>");var c=e("li.facebook",n);e("li.facebook div.fb_like img.fb_like_privacy_dummy,li.facebook span.switch",n).live("click",function(){c.find("span.switch").hasClass("off")?(c.addClass("info_off"),c.find("span.switch").addClass("on").removeClass("off").html(o.services.facebook.txt_fb_on),c.find("img.fb_like_privacy_dummy").replaceWith(s)):(c.removeClass("info_off"),c.find("span.switch").addClass("off").removeClass("on").html(o.services.facebook.txt_fb_off),c.find(".fb_like").html(l))})}if(a){i=o.services.twitter.tweet_text,"function"==typeof i&&(i=i());var i=t(i,"120"),h=encodeURIComponent(r+o.services.twitter.referrer_track),p=encodeURIComponent(r),d='<iframe allowtransparency="true" frameborder="0" scrolling="no" src="http://platform.twitter.com/widgets/tweet_button.html?url='+h+"&amp;counturl="+p+"&amp;text="+i+"&amp;count=horizontal&amp;lang="+o.services.twitter.language+'" style="width:130px; height:25px;"></iframe>',v='<img src="'+o.services.twitter.dummy_img+'" alt="&quot;Tweet this&quot;-Dummy" class="tweet_this_dummy" />';n.append('<li class="twitter help_info"><span class="info">'+o.services.twitter.txt_info+'</span><span class="switch off">'+o.services.twitter.txt_twitter_off+'</span><div class="tweet dummy_btn">'+v+"</div></li>");var m=e("li.twitter",n);e("li.twitter div.tweet img,li.twitter span.switch",n).live("click",function(){m.find("span.switch").hasClass("off")?(m.addClass("info_off"),m.find("span.switch").addClass("on").removeClass("off").html(o.services.twitter.txt_twitter_on),m.find("img.tweet_this_dummy").replaceWith(d)):(m.removeClass("info_off"),m.find("span.switch").addClass("off").removeClass("on").html(o.services.twitter.txt_twitter_off),m.find(".tweet").html(v))})}if(f){var g='<div class="g-plusone" data-size="medium" data-href="'+(r+o.services.gplus.referrer_track)+'"></div><script type="text/javascript">window.___gcfg = {lang: "'+o.services.gplus.language+'"}; (function() { var po = document.createElement("script"); po.type = "text/javascript"; po.async = true; po.src = "https://apis.google.com/js/plusone.js"; var s = document.getElementsByTagName("script")[0]; s.parentNode.insertBefore(po, s); })(); </script>',y='<img src="'+o.services.gplus.dummy_img+'" alt="&quot;Google+1&quot;-Dummy" class="gplus_one_dummy" />';n.append('<li class="gplus help_info"><span class="info">'+o.services.gplus.txt_info+'</span><span class="switch off">'+o.services.gplus.txt_gplus_off+'</span><div class="gplusone dummy_btn">'+y+"</div></li>");var w=e("li.gplus",n);e("li.gplus div.gplusone img,li.gplus span.switch",n).live("click",function(){w.find("span.switch").hasClass("off")?(w.addClass("info_off"),w.find("span.switch").addClass("on").removeClass("off").html(o.services.gplus.txt_gplus_on),w.find("img.gplus_one_dummy").replaceWith(g)):(w.removeClass("info_off"),w.find("span.switch").addClass("off").removeClass("on").html(o.services.gplus.txt_gplus_off),w.find(".gplusone").html(y))})}n.append('<li class="settings_info"><div class="settings_info_menu off perma_option_off"><a href="'+o.info_link+'"><span class="help_info icon"><span class="info">'+o.txt_help+"</span></span></a></div></li>"),e(".help_info:not(.info_off)",n).live("mouseenter",function(){var t=e(this),n=window.setTimeout(function(){e(t).addClass("display")},500);e(this).data("timeout_id",n)}),e(".help_info",n).live("mouseleave",function(){var t=e(this).data("timeout_id");window.clearTimeout(t),e(this).hasClass("display")&&e(this).removeClass("display")}),r="on"===o.services.facebook.perma_option,i="on"===o.services.twitter.perma_option,h="on"===o.services.gplus.perma_option;if((u&&r||a&&i||f&&h)&&(!e.browser.msie||e.browser.msie&&7<e.browser.version)){for(var E=document.cookie.split(";"),p="{",S=0;S<E.length;S+=1){var T=E[S].split("="),p=p+('"'+e.trim(T[0])+'":"'+e.trim(T[1])+'"');S<E.length-1&&(p+=",")}var p=JSON.parse(p+"}"),N=e("li.settings_info",n);N.find(".settings_info_menu").removeClass("perma_option_off"),N.find(".settings_info_menu").append('<span class="settings">Einstellungen</span><form><fieldset><legend>'+o.settings_perma+"</legend></fieldset></form>"),u&&r&&(E="perma_on"===p.socialSharePrivacy_facebook?' checked="checked"':"",N.find("form fieldset").append('<input type="checkbox" name="perma_status_facebook" id="perma_status_facebook"'+E+' /><label for="perma_status_facebook">'+o.services.facebook.display_name+"</label>")),a&&i&&(E="perma_on"===p.socialSharePrivacy_twitter?' checked="checked"':"",N.find("form fieldset").append('<input type="checkbox" name="perma_status_twitter" id="perma_status_twitter"'+E+' /><label for="perma_status_twitter">'+o.services.twitter.display_name+"</label>")),f&&h&&(E="perma_on"===p.socialSharePrivacy_gplus?' checked="checked"':"",N.find("form fieldset").append('<input type="checkbox" name="perma_status_gplus" id="perma_status_gplus"'+E+' /><label for="perma_status_gplus">'+o.services.gplus.display_name+"</label>")),N.find("span.settings").css("cursor","pointer"),e(N.find("span.settings"),n).live("mouseenter",function(){var t=window.setTimeout(function(){N.find(".settings_info_menu").removeClass("off").addClass("on")},500);e(this).data("timeout_id",t)}),e(N,n).live("mouseleave",function(){var t=e(this).data("timeout_id");window.clearTimeout(t),N.find(".settings_info_menu").removeClass("on").addClass("off")}),e(N.find("fieldset input")).live("click",function(t){var r=t.target.id,i="socialSharePrivacy_"+r.substr(r.lastIndexOf("_")+1,r.length);if(e("#"+t.target.id+":checked").length){var t=o.cookie_expires,s=o.cookie_path,u=o.cookie_domain,a=new Date;a.setTime(a.getTime()+t*864e5),document.cookie=i+"=perma_on; expires="+a.toUTCString()+"; path="+s+"; domain="+u,e("form fieldset label[for="+r+"]",n).addClass("checked")}else t=o.cookie_path,s=o.cookie_domain,u=new Date,u.setTime(u.getTime()-100),document.cookie=i+"=perma_on; expires="+u.toUTCString()+"; path="+t+"; domain="+s,e("form fieldset label[for="+r+"]",n).removeClass("checked")}),u&&r&&"perma_on"===p.socialSharePrivacy_facebook&&e("li.facebook span.switch",n).click(),a&&i&&"perma_on"===p.socialSharePrivacy_twitter&&e("li.twitter span.switch",n).click(),f&&h&&"perma_on"===p.socialSharePrivacy_gplus&&e("li.gplus span.switch",n).click()}})}}(jQuery),define("plugins/jquery.socialshareprivacy.min",["jquery"],function(){}),define("app",["jquery","underscore","Handlebars","utils","plugins/bootstrap","plugins/handlebars.template","plugins/jquery.socialshareprivacy.min"],function(e,t,n,r,i){return{module:function(e){return t.extend({ViewModels:{}},e)},app:{}}}),define("modules/hvapp",["app","jquery","utils","Handlebars"],function(e,t,n,r){function s(e){t("#contactSuccess").addClass("hide"),t("#contactError").addClass("hide");var n=window,r=n.i18n,i={name:t("#name").val(),email:t("#email").val(),message:t("#message").val(),captcha_challenge:n.Recaptcha.get_challenge(),captcha_response:n.Recaptcha.get_response()};i.name&&i.name!==""&&i.email&&i.email!==""&&i.message&&i.message!==""&&i.captcha_challenge&&i.captcha_challenge!==""&&i.captcha_response&&i.captcha_response!==""?t.ajax({type:"POST",contentType:"application/json; charset=utf-8",dataType:"json",url:"/contact",data:JSON.stringify(i),async:!0,success:function(e){console.log("got data from the backend! "+e.result),e.result===!0?e.emailSent===!0?(t("#name").val(""),t("#email").val(""),t("#message").val(""),t("#contactSuccess").removeClass("hide")):t("#contactError").removeClass("hide"):alert(r.wrongCaptcha),n.Recaptcha.reload()}}):(n.Recaptcha.reload(),alert(r.requiredFields))}var i=e.module();return i.ViewModels.Model=function(){var e={};return e},i.init=function(){t("#submitContact").on("click",s)},i}),define("modules/social",["app","jquery","utils"],function(e,t,n){var r=e.module();return r.ViewModels.Model=function(){var e={};return e},r.init=function(){t("#socialshareprivacy").length>0&&(t("#socialshareprivacy").socialSharePrivacy({services:{facebook:{status:"on",perma_option:"off",dummy_img:"./assets/images/dummy_facebook_en.png",txt_info:"#{lingua.socialFacebook}",language:"en_US"},twitter:{status:"on",perma_option:"off",dummy_img:"./assets/images/dummy_twitter.png",txt_info:"#{lingua.socialTwitter}",language:"en"},gplus:{status:"on",perma_option:"off",dummy_img:"./assets/images/dummy_gplus.png",txt_info:"#{lingua.socialGplus}",language:"en"}},cookie_domain:"www.haus-voithofer.com",css_path:"./assets/stylesheets/socialshareprivacy.css"}),t(".settings_info").addClass("hide"))},r}),require(["app","jquery","underscore","utils","Handlebars","modules/hvapp","modules/social"],function(e,t,n,r,i,s,o){t(function(){t.ajaxSetup({cache:!1}),s.init(),o.init()})}),define("main",function(){}),require.config({deps:["main"],paths:{libs:"./libs",plugins:"./plugins",jquery:"./libs/jquery.min",underscore:"./libs/underscore-min",Handlebars:"./libs/handlebars-1.0.rc.1.min",utils:"./libs/utils",lazyload:"./libs/lazyload.min"},shim:{Handlebars:{exports:"Handlebars"},underscore:{exports:"_"},utils:{exports:"Utils",deps:["jquery"]},HandlebarsTemplates:{exports:"HandlebarsTemplates",deps:["Handlebars"]},lazyload:{exports:"lazyload"},"plugins/bootstrap":{deps:["jquery"]},"plugins/handlebars.template":{deps:["Handlebars"]},"plugins/jquery.socialshareprivacy.min":{deps:["jquery"]}}}),define("config",function(){});
this["Handlebars"] = this["Handlebars"] || {};
this["Handlebars"]["templates"] = this["Handlebars"]["templates"] || {};

this["Handlebars"]["templates"]["app/templates/init.handlebars"] = Handlebars.template(function (Handlebars,depth0,helpers,partials,data) {
  this.compilerInfo = [2,'>= 1.0.0-rc.3'];
helpers = helpers || Handlebars.helpers; data = data || {};
  var buffer = "", stack1, functionType="function", escapeExpression=this.escapeExpression;


  buffer += "<span>value: ";
  if (stack1 = helpers.name) { stack1 = stack1.call(depth0, {hash:{},data:data}); }
  else { stack1 = depth0.name; stack1 = typeof stack1 === functionType ? stack1.apply(depth0) : stack1; }
  buffer += escapeExpression(stack1)
    + "</span>";
  return buffer;
  });