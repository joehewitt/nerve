
var _ = require('underscore');
var markdom = require('markdom'),
    Header = markdom.nodeTypes.Header,
    HRule = markdom.nodeTypes.HRule,
    Span = markdom.nodeTypes.Span,
    Block = markdom.nodeTypes.Block,
    Embed = markdom.nodeTypes.Embed,
    Definition = markdom.nodeTypes.Definition,
    NodeSet = markdom.nodeTypes.NodeSet;

// *************************************************************************************************

var reMetadata = /^((.|\n)*?)\s*\((([\.@][A-Za-z0-9\.\/_-]+\s*)+)\)\s*$/;
var reProperty = /^:(.*?)\s+(.*?)$/;
var reFigure = /@[A-Za-z0-9\.\/_-]+/;
var reStyle = /^(\.[A-Za-z0-9_-]+)+/;

// *************************************************************************************************

function NerveTransformer(blog) {
    this.blog = blog;
    this.embeds = [];
    this.figures = [];
    this.definitions = {};
}

NerveTransformer.prototype = _.extend(new markdom.NodeTransformer(), {
    nodeSet: function(nodeSet) {
        var newNodes = [];
        var stack = [];

        function push(newNode) {
            if (stack.length) {
                stack[stack.length-1].content.nodes.push(newNode);
            } else {
                newNodes.push(newNode);
            }
        }

        function findClasses(node) {
            if (node.content && node.content.nodes) {
                var lastChild = node.content.nodes[node.content.nodes.length-1];
                if (lastChild && lastChild.classes) {
                    return lastChild.classes;
                }
            }            
        }

        for (var i = 0; i < nodeSet.nodes.length; ++i) {
            var node = this.visit(nodeSet.nodes[i]);
            if (node instanceof Header && node.content && node.content.nodes.length == 1) {
                var classes = findClasses(node);
                if (classes) {
                    var block = new Block(new NodeSet());
                    block.classes = classes;
                    push(block);
                    stack.push(block);
                } else {
                    push(node);
                }
            } else if (node instanceof HRule) {
                if (stack.length) {
                    stack.pop();
                } else {
                    push(node);
                }
            } else {
                push(node);
            }
        }
        nodeSet.nodes = newNodes;

        return nodeSet;
    },

    definition: function(node) {
        this.definitions[node.name] = node.value;
        return node;
    },

    image: function(node) {
        var m = this.blog.matchTransform(node.url);
        if (m) {
            var embed = new Embed(node.url, node.title, node.alt, m.groups, m.transform, m.query);
            this.embeds.push(embed);
            return embed;
        } else {
            return node;
        }
    },

    text: function(node) {
        return parseStyling(node, this.figures, this.definitions);
    },

    blockCode: function(node) {
        parseStyling(node, this.figures, this.definitions);
        return node;
    },

    link: function(node) {
        var result = parseClasses(node.url);
        if (result.classes) {
            var span = new Span(node.content);
            if (node.title) {
                span.setAttribute('title', node.title);
            }
            span.classes = result.classes;
            span.styles = result.styles;
            return span;
        }
        return node;
    }
});

exports.NerveTransformer = NerveTransformer;

function parseStyling(node, figures, definitions) {
    var m = reProperty.exec(node.text);
    if (m) {
        var name = m[1];
        var value = m[2];
        definitions[name] = value;
        return new Definition(name, value);
    } else {
        var m = reMetadata.exec(node.text);
        if (m) {
            node.text = node.text.slice(0, m.index+m[1].length);

            var result = parseClasses(m[3]);
            node.classes = result.classes;
            node.styles = result.styles;

            if (result.figure && result.figure.length) {
                var projectName, figureName;
                if (result.figure.length == 1) {
                    projectName = figureName = result.figure[0];
                } else {
                    figureName = result.figure.pop();
                    projectName = result.figure.join('/');
                }

                node.figure = result.figure;
                node.addClass('figure');
                node.setAttribute('require', projectName);
                node.setAttribute('figure', figureName);
                figures.push(node);
            }
        }
        return node;
    }
}

function parseClasses(text) {
    var classes = [];
    var figure;
    if (text) {
        var parts = text.split(/\s+/);
        for (var i = 0; i < parts.length; ++i) {
            var m = reFigure.exec(parts[i]);
            if (m) {
                figure = m[0].slice(1).split('/');
            } else {
                m = reStyle.exec(parts[i]);
                if (m) {
                    var partClasses = m[0].split('.').slice(1);
                    classes.push.apply(classes, partClasses);
                }
            } 
        }
    }

    var result = {figure: figure};
    if (classes.length) {
        result.classes = classes;   
        result.styles = parseInlineStyles(classes);
    }
    return result;
}

function parseInlineStyles(classes) {
}
