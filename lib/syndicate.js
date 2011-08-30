
var _ = require('underscore');
var dandy = require('dandy/errors');
var cacheware = require('diskcache/lib/middleware').middleware;
var util = require('util');

var rssMimeType = 'application/rss+xml';

// *************************************************************************************************

exports.route = function(server, blog, middleware) {
    if (blog.app.settings.rss) {
        var args = [blog.app.settings.rss];
        if (middleware) {
            args.push.apply(args, middleware);
        }
        args.push(render(rssPage, rssMimeType));
        server.get.apply(server, args);
    }

    function noop(req, res, next) {
        next(); 
    }

    function render(fn, mimeType) {
        return function(req, res) {
            try {
                return fn(req, res, sbind(function(err, result) {
                    if (err) {
                        sendError(req, res, mimeType, err, err ? err.error : 0);
                    } else {
                        sendPage(req, res, result);
                    }
                }, this));
            } catch (exc) {
                sendError(req, res, mimeType, exc);
            }

            function sbind(fn, self) {
                return function() {
                    try {
                        return fn.apply(self, arguments);
                    } catch (exc) {
                        sendError(req, res, mimeType, exc);                    
                    }
                }
            }
        };
    }

    function rssPage(req, res, cb) {
        blog.getPostsByPage(0, blog.postsPerPage, true, function(err, posts) {
            if (err) {
                cb(err);
                return;
            }

            var rss =
                '<?xml version="1.0" encoding="utf-8" ?>'+
                '<rss version="2.0">'+
                '<channel>'+
                    '<title>' + blog.app.settings.title + '</title>'+
                    '<link>' + blog.link + '</link>'+
                    _.map(posts, function(post) {
                        return ''+
                            '<item>'+
                            '<title>' + post.title + '</title>'+
                            '<description><![CDATA[' + renderRSSBody(post) + ']]></description>'+
                            '<link>' + post.url + '</link>'+
                            '<pubDate>' + post.date + '</pubDate>'+
                            '</item>';
                    }).join('\n')+
                '</channel>'+
                '</rss>';

            // XXXjoe In the event of an error send back non-rss mime type (html)
            cb(0, {mimeType: rssMimeType, body: rss});
        });
    }
}

// *************************************************************************************************

function sendPage(req, res, result) {
    res.header('Content-Type', result.mimeType || htmlMimeType);

    var latestTime = findLatestMtime(result.dependencies || []);
    if (latestTime) {
        res.header('ETag', latestTime);
    }

    // if (result.permanent) {
        res.header('Cache-Control', 'public, max-age=31536000');
    // } else {
    //     res.header('Cache-Control', 'public, max-age=0');
    // }

    res.send(result.body, 200);
}

function sendError(req, res, mimeType, err, code) {
    if (err) {
        dandy.logException(err,
            "Error while loading " + req.url + "\n" + util.inspect(req.headers));
    }

    var message = debugMode ? err+'' : 'Error';
    res.send(message, {'Content-Type': mimeType}, code || 500);
}

function findLatestMtime(dependencies) {
    var maxTime = 0;
    _.each(dependencies, function(dep) {
        if (dep.mtime > maxTime) {
            maxTime = dep.mtime;
        }
    });
    return maxTime;
}

function renderRSSBody(post) {
    var html = post.body;
    if (post.attachments) {
        post.attachments.forEach(function(img) {
            html += '<a href="' + img.largs + '">' + '<img src="' + img.thumb + '">' + '</a>&nbsp;';        
        });
    }
    return html;
}
