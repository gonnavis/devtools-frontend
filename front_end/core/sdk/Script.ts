// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/* eslint-disable rulesdir/no_underscored_properties */

import * as TextUtils from '../../models/text_utils/text_utils.js';
import * as Common from '../common/common.js';
import * as i18n from '../i18n/i18n.js';
import * as ProtocolClient from '../protocol_client/protocol_client.js';  // eslint-disable-line no-unused-vars

import {DebuggerModel, Location} from './DebuggerModel.js';         // eslint-disable-line no-unused-vars
import {PageResourceLoadInitiator} from './PageResourceLoader.js';  // eslint-disable-line no-unused-vars
import {ResourceTreeModel} from './ResourceTreeModel.js';
import {ExecutionContext} from './RuntimeModel.js';  // eslint-disable-line no-unused-vars
import {Target} from './SDKModel.js';                // eslint-disable-line no-unused-vars

const UIStrings = {
  /**
  *@description Error message for when a script can't be loaded which had been previously
  */
  scriptRemovedOrDeleted: 'Script removed or deleted.',
  /**
  *@description Error message when failing to load a script source text
  */
  unableToFetchScriptSource: 'Unable to fetch script source.',
};
const str_ = i18n.i18n.registerUIStrings('core/sdk/Script.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

/**
 * TODO(chromium:1011811): make `implements {FrameAssociated}` annotation work here.
 */
export class Script implements TextUtils.ContentProvider.ContentProvider {
  debuggerModel: DebuggerModel;
  scriptId: string;
  sourceURL: string;
  lineOffset: number;
  columnOffset: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  _isContentScript: boolean;
  _isLiveEdit: boolean;
  sourceMapURL: string|undefined;
  debugSymbols: Protocol.Debugger.DebugSymbols|null;
  hasSourceURL: boolean;
  contentLength: number;
  _originalContentProvider: TextUtils.ContentProvider.ContentProvider|null;
  originStackTrace: Protocol.Runtime.StackTrace|null;
  _codeOffset: number|null;
  _language: string|null;
  _contentPromise: Promise<TextUtils.ContentProvider.DeferredContent>|null;
  _embedderName: string|null;
  constructor(
      debuggerModel: DebuggerModel, scriptId: string, sourceURL: string, startLine: number, startColumn: number,
      endLine: number, endColumn: number, executionContextId: number, hash: string, isContentScript: boolean,
      isLiveEdit: boolean, sourceMapURL: string|undefined, hasSourceURL: boolean, length: number,
      originStackTrace: Protocol.Runtime.StackTrace|null, codeOffset: number|null, scriptLanguage: string|null,
      debugSymbols: Protocol.Debugger.DebugSymbols|null, embedderName: string|null) {
    this.debuggerModel = debuggerModel;
    this.scriptId = scriptId;
    this.sourceURL = sourceURL;
    this.lineOffset = startLine;
    this.columnOffset = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;

    this.executionContextId = executionContextId;
    this.hash = hash;
    this._isContentScript = isContentScript;
    this._isLiveEdit = isLiveEdit;
    this.sourceMapURL = sourceMapURL;
    this.debugSymbols = debugSymbols;
    this.hasSourceURL = hasSourceURL;
    this.contentLength = length;
    this._originalContentProvider = null;
    this.originStackTrace = originStackTrace;
    this._codeOffset = codeOffset;
    this._language = scriptLanguage;
    this._contentPromise = null;
    this._embedderName = embedderName;
  }

  embedderName(): string|null {
    return this._embedderName;
  }

  target(): Target {
    return this.debuggerModel.target();
  }

  static _trimSourceURLComment(source: string): string {
    let sourceURLIndex = source.lastIndexOf('//# sourceURL=');
    if (sourceURLIndex === -1) {
      sourceURLIndex = source.lastIndexOf('//@ sourceURL=');
      if (sourceURLIndex === -1) {
        return source;
      }
    }
    const sourceURLLineIndex = source.lastIndexOf('\n', sourceURLIndex);
    if (sourceURLLineIndex === -1) {
      return source;
    }
    const sourceURLLine = source.substr(sourceURLLineIndex + 1);
    if (!sourceURLLine.match(sourceURLRegex)) {
      return source;
    }
    return source.substr(0, sourceURLLineIndex);
  }

  isContentScript(): boolean {
    return this._isContentScript;
  }

  codeOffset(): number|null {
    return this._codeOffset;
  }

  isJavaScript(): boolean {
    return this._language === Protocol.Debugger.ScriptLanguage.JavaScript;
  }

  isWasm(): boolean {
    return this._language === Protocol.Debugger.ScriptLanguage.WebAssembly;
  }

  scriptLanguage(): string|null {
    return this._language;
  }

  executionContext(): ExecutionContext|null {
    return this.debuggerModel.runtimeModel().executionContext(this.executionContextId);
  }

  isLiveEdit(): boolean {
    return this._isLiveEdit;
  }

  contentURL(): string {
    return this.sourceURL;
  }

  contentType(): Common.ResourceType.ResourceType {
    return Common.ResourceType.resourceTypes.Script;
  }

  async contentEncoded(): Promise<boolean> {
    return false;
  }

  requestContent(): Promise<TextUtils.ContentProvider.DeferredContent> {
    if (!this._contentPromise) {
      this._contentPromise = this.originalContentProvider().requestContent();
    }
    return this._contentPromise;
  }

  async getWasmBytecode(): Promise<ArrayBuffer> {
    const base64 = await this.debuggerModel.target().debuggerAgent().invoke_getWasmBytecode({scriptId: this.scriptId});
    const response = await fetch(`data:application/wasm;base64,${base64.bytecode}`);
    return response.arrayBuffer();
  }

  originalContentProvider(): TextUtils.ContentProvider.ContentProvider {
    if (!this._originalContentProvider) {
      /* } */
      let lazyContentPromise: Promise<TextUtils.ContentProvider.DeferredContent>|null;
      this._originalContentProvider =
          new TextUtils.StaticContentProvider.StaticContentProvider(this.contentURL(), this.contentType(), () => {
            if (!lazyContentPromise) {
              lazyContentPromise = (async(): Promise<{
                                      content: null,
                                      error: Common.UIString.LocalizedString,
                                      isEncoded: boolean,
                                    }|{
                                      content: string,
                                      isEncoded: boolean,
                                      error?: undefined,
                                    }> => {
                if (!this.scriptId) {
                  return {content: null, error: i18nString(UIStrings.scriptRemovedOrDeleted), isEncoded: false};
                }
                try {
                  const result = await this.debuggerModel.target().debuggerAgent().invoke_getScriptSource(
                      {scriptId: this.scriptId});
                  if (result.getError()) {
                    throw new Error(result.getError());
                  }
                  const {scriptSource, bytecode} = result;
                  if (bytecode) {
                    return {content: bytecode, isEncoded: true};
                  }
                  let content: string = scriptSource || '';
                  if (this.hasSourceURL) {
                    content = Script._trimSourceURLComment(content);
                  }
                  return {content, isEncoded: false};

                } catch (err) {
                  // TODO(bmeurer): Propagate errors as exceptions / rejections.
                  return {content: null, error: i18nString(UIStrings.unableToFetchScriptSource), isEncoded: false};
                }
              })();
            }
            return lazyContentPromise;
          });
    }
    return this._originalContentProvider;
  }

  async searchInContent(query: string, caseSensitive: boolean, isRegex: boolean):
      Promise<TextUtils.ContentProvider.SearchMatch[]> {
    if (!this.scriptId) {
      return [];
    }

    const matches = await this.debuggerModel.target().debuggerAgent().invoke_searchInContent(
        {scriptId: this.scriptId, query, caseSensitive, isRegex});
    return (matches.result || [])
        .map(match => new TextUtils.ContentProvider.SearchMatch(match.lineNumber, match.lineContent));
  }

  _appendSourceURLCommentIfNeeded(source: string): string {
    if (!this.hasSourceURL) {
      return source;
    }
    return source + '\n //# sourceURL=' + this.sourceURL;
  }

  async editSource(
      newSource: string,
      callback:
          (arg0: ProtocolClient.InspectorBackend.ProtocolError|null, arg1?: Protocol.Runtime.ExceptionDetails|undefined,
           arg2?: Array<Protocol.Debugger.CallFrame>|undefined, arg3?: Protocol.Runtime.StackTrace|undefined,
           arg4?: Protocol.Runtime.StackTraceId|undefined, arg5?: boolean|undefined) => void): Promise<void> {
    newSource = Script._trimSourceURLComment(newSource);
    // We append correct sourceURL to script for consistency only. It's not actually needed for things to work correctly.
    newSource = this._appendSourceURLCommentIfNeeded(newSource);

    if (!this.scriptId) {
      callback('Script failed to parse');
      return;
    }

    const {content: oldSource} = await this.requestContent();
    if (oldSource === newSource) {
      callback(null);
      return;
    }
    const response = await this.debuggerModel.target().debuggerAgent().invoke_setScriptSource(
        {scriptId: this.scriptId, scriptSource: newSource});

    if (!response.getError() && !response.exceptionDetails) {
      this._contentPromise = Promise.resolve({content: newSource, isEncoded: false});
    }

    const needsStepIn = Boolean(response.stackChanged);
    callback(
        response.getError() || null, response.exceptionDetails, response.callFrames, response.asyncStackTrace,
        response.asyncStackTraceId, needsStepIn);
  }

  rawLocation(lineNumber: number, columnNumber: number): Location|null {
    if (this.containsLocation(lineNumber, columnNumber)) {
      return new Location(this.debuggerModel, this.scriptId, lineNumber, columnNumber);
    }
    return null;
  }

  toRelativeLocation(location: Location): number[] {
    console.assert(
        location.scriptId === this.scriptId, '`toRelativeLocation` must be used with location of the same script');
    const relativeLineNumber = location.lineNumber - this.lineOffset;
    const relativeColumnNumber = (location.columnNumber || 0) - (relativeLineNumber === 0 ? this.columnOffset : 0);
    return [relativeLineNumber, relativeColumnNumber];
  }

  isInlineScript(): boolean {
    const startsAtZero = !this.lineOffset && !this.columnOffset;
    return !this.isWasm() && Boolean(this.sourceURL) && !startsAtZero;
  }

  isAnonymousScript(): boolean {
    return !this.sourceURL;
  }

  isInlineScriptWithSourceURL(): boolean {
    return Boolean(this.hasSourceURL) && this.isInlineScript();
  }

  async setBlackboxedRanges(positions: Protocol.Debugger.ScriptPosition[]): Promise<boolean> {
    const response = await this.debuggerModel.target().debuggerAgent().invoke_setBlackboxedRanges(
        {scriptId: this.scriptId, positions});
    return !response.getError();
  }

  containsLocation(lineNumber: number, columnNumber: number): boolean {
    const afterStart =
        (lineNumber === this.lineOffset && columnNumber >= this.columnOffset) || lineNumber > this.lineOffset;
    const beforeEnd = lineNumber < this.endLine || (lineNumber === this.endLine && columnNumber <= this.endColumn);
    return afterStart && beforeEnd;
  }

  get frameId(): string {
    // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration
    // @ts-expect-error
    if (typeof this[frameIdSymbol] !== 'string') {
      // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration
      // @ts-expect-error
      this[frameIdSymbol] = frameIdForScript(this);
    }
    // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration
    // @ts-expect-error
    return this[frameIdSymbol] || '';
  }

  createPageResourceLoadInitiator(): PageResourceLoadInitiator {
    return {target: this.target(), frameId: this.frameId, initiatorUrl: this.embedderName()};
  }
}

const frameIdSymbol = Symbol('frameid');

function frameIdForScript(script: Script): string {
  const executionContext = script.executionContext();
  if (executionContext) {
    return executionContext.frameId || '';
  }
  // This is to overcome compilation cache which doesn't get reset.
  const resourceTreeModel = script.debuggerModel.target().model(ResourceTreeModel);
  if (!resourceTreeModel || !resourceTreeModel.mainFrame) {
    return '';
  }
  return resourceTreeModel.mainFrame.id;
}

export const sourceURLRegex = /^[\040\t]*\/\/[@#] sourceURL=\s*(\S*?)\s*$/;