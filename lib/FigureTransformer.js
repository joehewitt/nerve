
var _ = require('underscore');
var path = require('path');
var fs = require('fs');
var abind = require('dandy/errors').abind;
var ibind = require('dandy/errors').ibind;

// ************************************************************************************************

function FigureTransformer() {
}
exports.FigureTransformer = FigureTransformer;

FigureTransformer.prototype = {
    pattern: /^figure:(.*?)\/(.*?)$/,

	transform: function(post, projectName, figureName, url, title, alt, query, cb) {
		if (!projectName || !figureName) { cb(new Error("Invalid figure URL")); return; }

		var divClass = "figure-" + projectName + "-" + figureName;

		var timestamp = '';
		if (timestamp) {
			projectName += '@' + timestamp;
		}

		var tag = '<div class="figure" require="' + projectName + '" figure="' + figureName + '">' + alt + '</div>';
		
		cb(0, {content: tag});
	}
};
