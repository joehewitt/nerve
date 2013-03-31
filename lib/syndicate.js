
var _ = require('underscore');
var dandy = require('dandy/errors');
var cacheware = require('express-store');
var datetime = require('datetime');

// *************************************************************************************************

var rssMimeType = 'application/rss+xml';
var defaultNumberOfPosts = 10;

var debugMode = process.env.NODE_ENV != 'production';

// *************************************************************************************************

exports.route = function(blog, numberOfPosts) {
    return function(req, res) {
        res.sendSafely(function(cb) {
            blog.getPostsByPage(0, numberOfPosts || defaultNumberOfPosts, true, function(err, posts) {
            // blog.getPostsByGroup('drafts', true, function(err, posts) {
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
                                '<pubDate>' + formatDate(post.date) + '</pubDate>'+
                                '<description><![CDATA[' + renderRSSBody(post) + ']]></description>'+
                                '</item>';
                        }).join('\n')+
                    '</channel>'+
                    '</rss>';

                // XXXjoe In the event of an error send back non-rss mime type (html)
                cb(0, {mimeType: rssMimeType, body: rss});
            });
        });
    };
}

// *************************************************************************************************

function renderRSSBody(post) {
    var html = post.rssBody;
    if (post.attachments) {
        post.attachments.forEach(function(img) {
            html += '<a href="' + img.large + '">' + '<img src="' + img.thumb + '">' + '</a>&nbsp;';        
        });
    }
    return html;
}

function formatDate(date) {
    return date ? datetime.format(date, '%a, %d %b %Y %H:%M:%S GMT') : '';
}