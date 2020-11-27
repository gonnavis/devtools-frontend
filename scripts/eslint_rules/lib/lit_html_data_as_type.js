// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

function isLitHtmlTemplateCall(taggedTemplateExpression) {
  if (taggedTemplateExpression.name) {
    // Call to html`` and we assume that html = LitHtml's html function.
    return taggedTemplateExpression.name === 'html';
  }

  // Match calls to LitHtml.html``
  return taggedTemplateExpression.object && taggedTemplateExpression.object.name === 'LitHtml' &&
      taggedTemplateExpression.property.name === 'html';
}

function findIndexOfDataSetterUsageForNode(taggedTemplateExpression) {
  const dataSetterText = '.data=';
  const templateParts = taggedTemplateExpression.quasi.quasis;

  /**
   * This is a bit confusing, and I recommend diving into an example on AST
   * Explorer:
   * https://astexplorer.net/#/gist/62cbc8d019845173b0dfc14214f5a5c4/ce8da61683b587cbccb305fea605b6fad9bc7f89
   * But the summary is that the templateParts are an array of all the static
   * parts of a template. So if we have an input of:
   * <foo .data=${something}></foo>
   * then there are two template parts:
   * 1) represents the string "<foo .data="
   * 2) represets the string "></foo>"
   *
   * All we need to do is find the part that ends with .data= and return its
   * index, because alongside the template parts is another array of expressions
   * representing all the dynamic parts of the template.
   */
  for (const [index, part] of templateParts.entries()) {
    if (part.value.cooked.endsWith(dataSetterText)) {
      return index;
    }
  }
  return -1;
}

function dataSetterUsesTypeCast(taggedTemplateExpression, indexOfDataSetter) {
  const expression = taggedTemplateExpression.quasi.expressions[indexOfDataSetter];
  return (expression.type === 'TSAsExpression');
}

function dataSetterAsUsesInterface(taggedTemplateExpression, indexOfDataSetter) {
  const expression = taggedTemplateExpression.quasi.expressions[indexOfDataSetter];
  return (expression.typeAnnotation.type === 'TSTypeReference');
}

module.exports = {
  meta: {
    type: 'problem',

    docs: {
      description: 'check for .data typecasts',
      category: 'Possible Errors',
    },
    fixable: 'code',
    schema: []  // no options
  },
  create: function(context) {
    return {
      TaggedTemplateExpression(node) {
        const isLitHtmlCall = isLitHtmlTemplateCall(node.tag);
        if (!isLitHtmlCall) {
          return;
        }
        const indexOfDataSetterCall = findIndexOfDataSetterUsageForNode(node);
        if (indexOfDataSetterCall === -1) {
          // Didn't find a .data=${} call, so bail.
          return -1;
        }
        const dataUsageHasTypeCast = dataSetterUsesTypeCast(node, indexOfDataSetterCall);
        if (!dataUsageHasTypeCast) {
          context.report({node: node, message: 'LitHtml .data=${} calls must be typecast (.data=${{...} as X}).'});
          return;
        }

        if (!dataSetterAsUsesInterface(node, indexOfDataSetterCall)) {
          context.report({
            node: node,
            message:
                'LitHtml .data=${} calls must be typecast to a type reference (e.g. `as FooInterface`), not a literal.'
          });
          return;
        }
      },
    };
  }
};