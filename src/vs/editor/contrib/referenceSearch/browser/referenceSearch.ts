/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import {KeyCode, KeyMod} from 'vs/base/common/keyCodes';
import URI from 'vs/base/common/uri';
import {TPromise} from 'vs/base/common/winjs.base';
import {IEditorService} from 'vs/platform/editor/common/editor';
import {optional} from 'vs/platform/instantiation/common/instantiation';
import {CommandsRegistry, ICommandHandler} from 'vs/platform/commands/common/commands';
import {IKeybindingService, KbExpr} from 'vs/platform/keybinding/common/keybinding';
import {KeybindingsRegistry} from 'vs/platform/keybinding/common/keybindingsRegistry';
import {Position} from 'vs/editor/common/core/position';
import {Range} from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import {ServicesAccessor, EditorAction, CommonEditorRegistry} from 'vs/editor/common/editorCommonExtensions';
import {Location} from 'vs/editor/common/modes';
import {IPeekViewService, PeekContext, getOuterEditor} from 'vs/editor/contrib/zoneWidget/browser/peekViewWidget';
import {provideReferences} from '../common/referenceSearch';
import {ReferencesController, RequestOptions, ctxReferenceSearchVisible} from './referencesController';
import {ReferencesModel} from './referencesModel';

import ModeContextKeys = editorCommon.ModeContextKeys;
import EditorContextKeys = editorCommon.EditorContextKeys;

const defaultReferenceSearchOptions: RequestOptions = {
	getMetaTitle(model) {
		return model.references.length > 1 && nls.localize('meta.titleReference', " – {0} references", model.references.length);
	}
};

export class ReferenceController implements editorCommon.IEditorContribution {

	private static ID = 'editor.contrib.referenceController';

	constructor(
		editor:editorCommon.ICommonCodeEditor,
		@IKeybindingService keybindingService: IKeybindingService,
		@optional(IPeekViewService) peekViewService: IPeekViewService
	) {
		if (peekViewService) {
			PeekContext.inPeekEditor.bindTo(keybindingService);
		}
	}

	public dispose(): void {
	}

	public getId(): string {
		return ReferenceController.ID;
	}
}

export class ReferenceAction extends EditorAction {

	constructor() {
		super(
			'editor.action.referenceSearch.trigger',
			nls.localize('references.action.label', "Find All References"),
			'Find All References',
			false
		);

		this._precondition = KbExpr.and(EditorContextKeys.TextFocus, ModeContextKeys.hasReferenceProvider, PeekContext.notInPeekEditor);

		this.kbOpts = {
			kbExpr: EditorContextKeys.TextFocus,
			primary: KeyMod.Shift | KeyCode.F12
		};

		this.menuOpts = {
			kbExpr: ModeContextKeys.hasReferenceProvider,
			group: 'navigation',
			order: 1.3
		};
	}

	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let range = editor.getSelection();
		let model = editor.getModel();
		let references = provideReferences(model, range.getStartPosition()).then(references => new ReferencesModel(references));
		let controller = ReferencesController.getController(editor);
		controller.toggleWidget(range, references, defaultReferenceSearchOptions);
	}
}

let findReferencesCommand: ICommandHandler = (accessor:ServicesAccessor, resource:URI, position:editorCommon.IPosition) => {

	if (!(resource instanceof URI)) {
		throw new Error('illegal argument, uri');
	}
	if (!position) {
		throw new Error('illega argument, position');
	}

	return accessor.get(IEditorService).openEditor({ resource }).then(editor => {

		let control = <editorCommon.ICommonCodeEditor>editor.getControl();
		if (!control || typeof control.getEditorType !== 'function') {
			return;
		}

		let references = provideReferences(control.getModel(), Position.lift(position)).then(references => new ReferencesModel(references));
		let controller = ReferencesController.getController(control);
		let range = new Range(position.lineNumber, position.column, position.lineNumber, position.column);
		return TPromise.as(controller.toggleWidget(range, references, defaultReferenceSearchOptions));
	});
};

let showReferencesCommand: ICommandHandler = (accessor:ServicesAccessor, resource:URI, position:editorCommon.IPosition, references:Location[]) => {
	if (!(resource instanceof URI)) {
		throw new Error('illegal argument, uri expected');
	}

	return accessor.get(IEditorService).openEditor({ resource: resource }).then(editor => {

		let control = <editorCommon.ICommonCodeEditor>editor.getControl();
		if (!control || typeof control.getEditorType !== 'function') {
			return;
		}

		let controller = ReferencesController.getController(control);

		return TPromise.as(controller.toggleWidget(
			new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			TPromise.as(new ReferencesModel(references)),
			defaultReferenceSearchOptions)).then(() => true);
	});
};



// register action

CommonEditorRegistry.registerEditorContribution(ReferenceController);
CommonEditorRegistry.registerEditorAction(new ReferenceAction());

CommandsRegistry.registerCommand('editor.action.findReferences', findReferencesCommand);

CommandsRegistry.registerCommand('editor.action.showReferences', {
	handler: showReferencesCommand,
	description: {
		description: 'Show references at a position in a file',
		args: [
			{ name: 'uri', description: 'The text document in which to show references', constraint: URI },
			{ name: 'position', description: 'The position at which to show', constraint: Position.isIPosition },
			{ name: 'locations', description: 'An array of locations.', constraint: Array },
		]
	}
});

function closeActiveReferenceSearch(accessor, args) {
	var outerEditor = getOuterEditor(accessor, args);
	if (outerEditor) {
		var controller = ReferencesController.getController(outerEditor);
		controller.closeWidget();
	}
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'closeReferenceSearch',
	weight: CommonEditorRegistry.commandWeight(50),
	primary: KeyCode.Escape,
	secondary: [KeyMod.Shift | KeyCode.Escape],
	when: KbExpr.and(ctxReferenceSearchVisible, KbExpr.not('config.editor.stablePeek')),
	handler: closeActiveReferenceSearch
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'closeReferenceSearchEditor',
	weight: CommonEditorRegistry.commandWeight(-101),
	primary: KeyCode.Escape,
	secondary: [KeyMod.Shift | KeyCode.Escape],
	when: KbExpr.and(PeekContext.inPeekEditor, KbExpr.not('config.editor.stablePeek')),
	handler: closeActiveReferenceSearch
});
