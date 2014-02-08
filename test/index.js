var request = require('supertest');
var compress = require('koa-compress');
var fs = require('fs');
var koa = require('koa');
var Cache = require('..');

// Output folder
var folder = 'test/output';

// Helper to create a large json file
function* largeBody(next) {
    var obj = { arr: []};
    for (var i=0; i<10e4; i++) {
        obj.arr[i] = "test";
    }

    this.body = obj;

    yield next;
}
function isLargeBody(obj) {
    return obj && obj.arr && obj.arr.length == 10e4;
}
// Helper to create a small json file
function* smallBody(next) {
    this.body = {"test":"test"};
}
function isSmallBody(obj) {
    return obj && obj.test === "test";
}
// Helper to create a random file name/number
function createRandomID() {
    return Math.random() * 1e17;
}

function setCacheName(cacheName) {
    return function*(next) {
        this.cacheName = cacheName;
        yield next;
    };
}

function isGzipped(buf) {
    if (Buffer.isBuffer(buf)) {
        // gzip magic numbers
        return (buf[0] === 0x1f && buf[1] === 0x8b);
    }
    return false;
}

describe('Koa-Cache', function() {

    var sharedFileID = createRandomID(); // used for the filename

    it('should cache to disk gzipped', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder}));
        app.use(largeBody);

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var file = folder + '/' + sharedFileID + '.gz';
                fs.exists(file, function(exists) {
                    if (!exists)
                        return done(new Error('Cache file was not created'));

                    fs.readFile(file, function(err, buf) {
                        if (err) return done(err);

                        if (!isGzipped(buf)) done(new Error('Cache file is not gzipped'));
                        else done();

                        console
                    });
                });

            })
        ;
    });


    it('should send directly from cache gzipped', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder}));
        app.use(largeBody); // should not be reached
        app.use(function*(next) {
            // Should also be unreachable
            this.should.not.be.ok;
        });

        request(app.listen())
            //_request
            .get('/')
            .set('Accept-Encoding', 'gzip')
            .expect(200)
            .end(function(err, res) {

                if (err) return done(err);

                res.should.have.header('Content-Encoding','gzip');
                var data = JSON.parse(res.text);
                if (!isLargeBody(data)) {
                    done(new Error("Data returned is not correct"));
                }
                else {
                    done();
                }
            })
        ;
    });

    it('should work alongside with compression middleware if already compressed', function(done) {
        var app = koa();
        app.use(compress())
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder}));
        app.use(largeBody);

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var data = JSON.parse(res.text);
                if (!isLargeBody(data)) {
                    done(new Error("Data returned is not correct"));
                }
                else {
                    done();
                }

            })
        ;
    });

    it('should send uncompressed from a gzipped file', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder}));
        app.use(largeBody); // should not be reached
        app.use(function*(next) {
            // Should also be unreachable
            this.should.not.be.ok;
        });

        request(app.listen())
            .get('/')
            .set('Accept-Encoding', 'identity')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var data = JSON.parse(res.text);
                if (!isLargeBody(data)) {
                    done(new Error("Data returned is not correct"));
                }
                else {
                    done();
                }
            })
        ;
    });

    it('should cache to disk uncompressed (gzip=false)', function(done) {
        var id = createRandomID();

        var app = koa();
        app.use(setCacheName(id));
        app.use(Cache({folder: folder, gzip: false}));
        app.use(largeBody);

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {

                if (err) return done(err);

                var file = folder + '/' + id;
                fs.exists(file, function(exists) {
                    if (!exists)
                        return done(new Error('Cache file was not created'));

                    fs.readFile(file, function(err, buf) {
                        if (err) return done(err);

                        if (isGzipped(buf)) done(new Error('Cache file is gzipped'));
                        else if (!isLargeBody(JSON.parse(buf)))
                            done(new Error('Data returned is not correct'));
                        else done();
                    });
                });
            })
        ;
    });

    it('should cache to disk uncompressed (< threshold)', function(done) {
        var id = createRandomID();

        var app = koa();
        app.use(setCacheName(id));
        app.use(Cache({folder: folder, gzip: true}));
        app.use(smallBody);

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var file = folder + '/' + id;
                fs.exists(file, function(exists) {
                    if (!exists)
                        return done(new Error('Cache file was not created'));

                    fs.readFile(file, function(err, buf) {
                        if (err) return done(err);

                        if (isGzipped(buf)) done(new Error('Cache file is gzipped'));
                        else if (!isSmallBody(JSON.parse(buf)))
                            done(new Error('Data returned is not correct'));
                        else done();
                    });
                });
            })
        ;
    });

    it('should not be reading from cache (caching=false upstream)', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(function*(next) {
           this.caching = false;
            yield next;
        });
        app.use(Cache({folder: folder}));
        app.use(smallBody);

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var data = JSON.parse(res.text);
                if (isLargeBody(data) && isSmallBody(data)) {
                    done(new Error("Data returned is not correct"));
                }
                else {
                    done();
                }
            })
        ;
    });

    it('should not be caching (caching=false downstream)', function(done) {
        var id = createRandomID();

        var app = koa();
        app.use(setCacheName(id));
        app.use(Cache({folder: folder}));
        app.use(largeBody);
        app.use(function*(next) {
            this.caching = false;
        });

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var file = folder + '/' + id+'.gz';
                fs.exists(file, function(exists) {
                    if (exists)
                        return done(new Error('Cache file was created'));
                    else
                        done();

                });

            })
        ;
    });

    it('should ignore any expired cache', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder, cacheTime:-1}));
        app.use(largeBody);
        app.use(function*(next) {
            this.caching = false; // don't save over largeBody
            this.body = {test:"test"}; // smallBody
        });

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var data = JSON.parse(res.text);
                if (!isSmallBody(data)) {
                    done(new Error("Data returned is not correct"));
                }
                else {
                    done();
                }
            })
        ;
    });

    it('should allow middleware to access the cache', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder, delegate:true}));
        app.use(function*(next) {
            this.caching = false; // don't save over largeBody

            var cache = this.body;

            this.body = {test:"test", largeBody:cache};
        });

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var data = JSON.parse(res.text);
                if (!isSmallBody(data) && !isLargeBody(data.largeBody)) {
                    done(new Error("Data returned is not correct"));
                }
                else {
                    done();
                }
            })
        ;
    });

    it('should send correct type when sending directly from file', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder, type:'text'}));
        app.use(largeBody);

        request(app.listen())
            .get('/')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var hasType = res.headers['content-type'].indexOf('text/plain') !== -1;
                if (!hasType) {
                    done(new Error("Type was not included"));
                } else {
                    done();
                }
            })
        ;
    });

    it('should not cache (or cause errors on) empty returns', function(done) {
        var id = createRandomID();

        var app = koa();
        app.use(setCacheName(id));
        app.use(Cache({folder: folder}));

        request(app.listen())
            .get('/')
            //.expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                var file = folder + '/' + id;

                fs.exists(file, function(exists) {
                    if (exists) {
                        return done(new Error('Cache file was created'));
                    }
                    else {
                        done();
                    }
                });

            })
        ;
    });

    it('should follow If-Modified-Since (false / 304)', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder}));
        app.use(function*(next) {
            // this should never happen
        });

        request(app.listen())
            .get('/')
            .set('If-Modified-Since', new Date())
            .expect(304)
            .end(function(err, res) {
                if (err) return done(err);

                if (res.text) {
                    done(new Error("Sending data with 304 not modified"));
                }
                done();
            })
        ;
    });

    it('should follow If-Modified-Since (true / 200)', function(done) {
        var app = koa();
        app.use(setCacheName(sharedFileID));
        app.use(Cache({folder: folder}));
        app.use(function*(next) {
            // this should never happen
        });

        request(app.listen())
            .get('/')
            .set('If-Modified-Since', new Date(Date.now()-1000*61))
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);

                if (!res.text) {
                    done(new Error("Not sending data"));
                }
                done();
            })
        ;
    });

    //it('should fallback (w/ delegate=false) to middleware if something goes wrong with cache (direct) ');
    //it('should fallback (w/ delegate=false) to middleware if something goes wrong with cache (indirect, no encoding and must uncompress)');

});