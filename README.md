# Koa-File-Cache (middleware)

A simple way to cache expensive requests (e.g. remote, nested DB, etc) to disk in KoaJS.


Cached files will bypass any downstream middleware and be streamed directly to the client. By default, all cache files are compressed with gzip. The library also handles some useful HTTP caching headers, to prevent sending data the client already has cached (304 Not Modified).

## Example

```js
var db = require(...);
var Cache = require('koa-file-cache');

// Determine the letter and set the cache file name
function* getLetter(next) {
    this.letter = this.query.letter || "a";
    this.cacheName = this.letter + '.words';
    yield next;
}

var aDay = 1000*60*60*24;

// *Typically you would probably use this at the router level instead.*
var app = koa();
app.use(getLetter);
app.use(Cache({folder: 'dictionary', cacheTime: aDay}));
app.use(function*(next){
    // This will happen, at most, only once per day
    // *Heavy DB query*
    var words = yield db.query('... WHERE letter = ?',[this.letter]);

    this.body = words;
});
app.listen();
```

What if you want manipulate an existing cache? Use {delegate:true}

```js
// ...
app.use(getLetter);
app.use(Cache({folder: 'dictionary', cacheTime: aDay, delegate: true}));
app.use(function*(next){
    var cache = this.body;
    if (cache) {
        // Add the current server timestamp
        cache.timestamp = Date.now();
    }
    else {
        // This will happen, at most, only once per day
        // Heavy DB query
        var words = yield db.query('... WHERE letter = ?',[this.letter]);

        this.body = words;
    }
});
app.listen();
```

What if you want to disable caching for a particular request?

```js
this.caching = false;
```

Setting this upstream will prevent both reading from and writing to the cache. Downstream will only prevent writing to the cache.



# API
## Cache([options])

```js
var Cache = require('koa-file-cache');
app.use(Cache(options))
```

### options

- `cacheTime` {Number} Time in milliseconds the cache is valid and used. Default `1000*60` (1 min)
- `folder` {String} Folder that will be used to store the cache. Default `.` (current dir)

    > Note: Folder must already exist
- `gzip` {Boolean} Store and send cache gzipped. Default `true`

    > Note: This only applies to the cache and will not gzip the first outgoing response. Use koa-compress if you want this.
- `gzipThreshold` {Number} Size in bytes the amount where should begin to store gzipped. Default `1024`
- `delegate` {Boolean} If true, continues downstream to let middleware execute with the cache available in `this.body`. Default `false`
    
    > Note: This only applies when a cache exists and is not expired. Otherwise, downstream middleware always get executed.
- `type` {String} Response type if cache is being sent directly. Default `json`
    
    > Note: This only applies when delegate is false.
- `fileNameHash` {Array[String}} Fields that will be used to generate the file name. Default `['cacheName']` (Set using `this.cacheName` where context `this` is (in) the middleware)
- `fileNameHashSep` {String} String used to seperate the fileNameHash fields. Default `.`
    
    > Note: This only applies when `fileNameHash` length > 1.

# Installation

```
$ npm install koa-file-cache
```

# Running tests

```
$ make test
```


# License

MIT