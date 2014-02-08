var fs = require('fs');
var zlib = require('zlib');
var debug = require('debug')('cache');

/**
 * Koa-File-Cache
 * A simple way to cache expensive requests
 * (e.g. remote, nested DB, etc) to disk in KoaJS.
 *
 * @param {Object} [options]
 *      cacheTime: {Number} time in milliseconds cache is allowed
 *      fileNameHash: {Array[String}} Fields that will be used to generate the file name
 *      fileNameHashSep: {String} String used to seperate the fileNameHash fields
 *      folder: {String} Folder that will be used to store the cache
 *      gzip: {Boolean} Store and send cache as gzip
 *      gzipThreshold: {Number} Size in bytes the amount where should begin to store gzipped
 *      delegate: {Boolean} Prevent from piping directly to response, allow cache to be manipulated
 *      type: {String} Only needed to indicate a response type if cache is being piped directly
 * @returns {Middleware*}
*/

function Cache(options) {
    options = options || {};
    options.cacheTime = options.cacheTime || 1000*60; // default 60 seconds

    options.fileNameHash = options.fileNameHash || ['cacheName'];
    options.fileNameHashSep = options.fileNameHashSep || ".";
    options.folder = (options.folder || ".") + "/"; // default current folder

    options.gzip = (options.gzip === undefined)? true : !!options.gzip; // default true
    options.gzipThreshold = options.gzipThreshold || 1024; // default 1024 bytes

    options.delegate = !!options.delegate; // default false
    options.type = options.type || 'json';

    // Middleware
    return function *(next) {
        var fileName = getFileName(this, options); // extension-less (.gz)
        var fileInfo = yield getFileInfo(fileName, options);

        debug(fileInfo.name, " has expired: "+ fileInfo.expired);

        // If no cache exists or is expired (save)
        if (fileInfo.expired) {
            // Let downstream middleware do their stuff
            yield next;

            // Allow middleware to decide if we shouldn't cache
            //  or if the body is empty
            if (this.caching === false || !this.body) {
                debug("Caching disabled for this request");
                return;
            }

            yield saveCache(this, options, fileName);

            // Set some useful caching headers
            var lastModifiedApprox = new Date();
            var expiresApprox = new Date(Date.now() + options.cacheTime);
            this.set('Last-Modified', lastModifiedApprox.toUTCString());
            this.set('Expires', expiresApprox.toUTCString());
        }
        // If a valid cache exists (read)
        else {
            // Let upstream middleware decide if we shouldn't read from cache
            if (this.caching === false) {
                yield next;
                return;
            }

            // Get the header and file cache stats
            this.vary('Accept-Encoding');
            var encoding = this.acceptsEncodings(['gzip', 'identity']);
            var lastModified = fileInfo.stats.mtime;
            var ifModifiedSince = new Date(this.get('If-Modified-Since'));
            var expires = new Date(lastModified.getTime() + options.cacheTime);

            // Drop the milliseconds because ifModifiedSince inherently does
            lastModified.setMilliseconds(0);

            // Check if we need to send the data (or if it's already cached client-side)
            if (ifModifiedSince.getTime() >= lastModified.getTime()) {
                this.status = 304;
                this.set('Last-Modified', lastModified.toUTCString());
                this.set('Expires', expires.toUTCString());
                return;
            }

            // Force the cache to be loaded uncompressed
            var force_parse_file = false;
            // Force delegation to the other middleware
            var force_delegation = false;

            // If we're not delegating we can stream directly to client
            if (!options.delegate) {
                this.set('Last-Modified', lastModified.toUTCString());
                this.set('Expires', expires.toUTCString());

                var cache = fs.createReadStream(fileInfo.name);
                if ((encoding === 'gzip') && fileInfo.gzipped) {
                    this.set('Content-Encoding', encoding);
                    this.body = cache;

                    // Prevent compression by other middleware
                    this.compress = false;
                }
                else if ((encoding === 'identity') && fileInfo.gzipped) {
                    force_parse_file = true;
                }
                else {
                    this.body = cache;
                }

                // Set the type
                this.type = options.type;
            }

            // If we need to load the file into memory uncompressed
            if (options.delegate || force_parse_file) {
                // Read the file
                debug("Reading from "+fileInfo.name);
                var cache = yield readFile(fileInfo.name);

                cache = yield loadCacheUncompressed(options, cache, fileInfo.gzipped);

                // Store the cache directly in the body
                this.body = cache;

                force_delegation = !cache; // if something went wrong
            }

            if (options.delegate || force_delegation) {
                // Let middleware down the line see the cache
                yield next;
            }
        }
    };
}
module.exports = Cache;

function* loadCacheUncompressed(options, cache, isGzipped) {
    // Ensure cache is okay
    if (cache !== undefined) {
        // Uncompress if compressed
        if (options.gzip && isGzipped) {
            cache = yield gunzip(cache);
        }
    }

    // Ensure cache is okay
    if (cache !== undefined) {
        // Parse JSON if we need to
        if (options.type === 'json') {
            cache = parseJSON(cache);
        }
    }

    return cache;
}

// Save the cache
function saveCache(ctx, options, fileName) {
    return function(cb) {
        // Stringify any JSON
        if (options.type === 'json') {
            ctx.body = JSON.stringify(ctx.body, null, ctx.app.jsonSpaces);
        }

        // The write stream
        var out;

        // If we should gzip and save
        if (options.gzip && (ctx.response.length > options.gzipThreshold)) {
            out = fs.createWriteStream(fileName+'.gz');
            var compression = zlib.createGzip();
            compression.pipe(out);
            compression.end(ctx.body);
            debug("Attempting to save "+fileName+'.gz');
        }
        // Or just save
        else {
            debug('gzip disabled or below threshold');
            out = fs.createWriteStream(fileName);
            out.end(ctx.body);
            debug("Attempting to save "+fileName);
        }

        out.on('error', cb);
        out.on('finish', cb);
    };
}

function parseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return undefined;
    }
}

// Determine if cache has expired (or doesn't exist)
function* getFileInfo(fileName, options) {
    var info = {name:fileName, stats:null, expired: false, gzipped:false};
    var cacheExists = false;

    // If gzip is enabled, check filename.gz names first
    if (options.gzip) cacheExists = yield fileExists(fileName+'.gz');

    // If it does save some info, or else attempt without .gz
    if (cacheExists) {
        info.name = fileName+'.gz';
        info.gzipped = true;
    }
    else {
        cacheExists = yield fileExists(fileName);
    }

    // If either exists, retrieve stats and if it has expired
    if (cacheExists) {
        info.stats =  yield fileStat(info.name);
        info.expired = (Date.now() > info.stats.mtime.getTime() + options.cacheTime);
    }
    // If neither exist
    else {
        //info.name = fileName+'.gz'; // default to this
        info.expired = true;
    }
    return info;
}

function getFileName(ctx, options) {
    var name = '';
    var fileNameHash = options.fileNameHash;

    for (var i=0; i<fileNameHash.length; i++) {
        name += ctx[fileNameHash[i]];
        if (i !== fileNameHash.length-1) name += options.fileNameHashSep;
    }

    if (name.length === 0)
        throw new Error("No cacheName given or way to generate a name to store the cache file");

    return options.folder + name;
}

// Thunkify a few fs functions
function readFile(path) {
    return function(cb) {
        fs.readFile(path, cb);
    };
}
function fileExists(path) {
    return function(cb) {
        fs.exists(path, function(exists) {
            cb(void 0, exists);
        });
    };
}
function fileStat(path) {
    return function(cb) {
        fs.stat(path, cb);
    };
}

//Thunkify gzip/gunzip
function gzip(buf) {
    return function(cb) {
        zlib.gzip(buf, cb);
    };
}

function gunzip(buf) {
    return function(cb) {
        zlib.gunzip(buf, cb);
    };
}





