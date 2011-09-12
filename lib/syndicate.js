
var _ = require('underscore');
var dandy = require('dandy/errors');
var cacheware = require('express-cache');
var util = require('util');

var rssMimeType = 'application/rss+xml';
var defaultNumberOfPosts = 10;

var debugMode = process.env.NODE_ENV != 'production';

// *************************************************************************************************

exports.route = function(blog, numberOfPosts) {
    // if (blog.app.rss) {
    //     var args = [blog.app.rss];
    //     if (middleware) {
    //         args.push.apply(args, middleware);
    //     }
    //     args.push(render(rssPage, rssMimeType));
    //     server.get.apply(server, args);
    // }

    function rssPage(req, res, cb) {
        blog.getPostsByPage(0, numberOfPosts || defaultNumberOfPosts, true, function(err, posts) {
            if (err) {
                cb(err);
                return;
            }

            var rss =
                '<?xml version="1.0" encoding="utf-8" ?>'+
                '<rss version="2.0">'+
                '<channel>'+
                    '<title>' + blog.title + '</title>'+
                    '<link>http://' + blog.host + '</link>'+
                    _.map(posts, function(post) {
                        return ''+
                            '<item>'+
                            '<title>' + post.title + '</title>'+
                            '<link>http://' + blog.host + '/' + post.url + '</link>'+
                            '<pubDate>' + post.date + '</pubDate>'+
                            '<description><![CDATA[' + renderRSSBody(post) + ']]></description>'+
                            '</item>';
                    }).join('\n')+
                '</channel>'+
                '</rss>';

            // XXXjoe In the event of an error send back non-rss mime type (html)
            cb(0, {mimeType: rssMimeType, body: rss});
        });
    }

    return function(req, res) {
        try {
            return rssPage(req, res, sbind(function(err, result) {
                if (err) {
                    sendError(req, res, rssMimeType, err, err ? err.error : 0);
                } else {
                    sendPage(req, res, result);
                }
            }, this));
        } catch (exc) {
            sendError(req, res, rssMimeType, exc);
        }

        function sbind(fn, self) {
            return function() {
                try {
                    return fn.apply(self, arguments);
                } catch (exc) {
                    sendError(req, res, rssMimeType, exc);                    
                }
            }
        }
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
            html += '<a href="' + img.large + '">' + '<img src="' + img.thumb + '">' + '</a>&nbsp;';        
        });
    }
    return html;
}
