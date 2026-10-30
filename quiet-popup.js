/*
 * Gates the Zotero reader's hover previews: the popups shown for internal links, citations and
 * references in PDFs, and for footnotes in EPUBs.
 *
 * All reader views open those popups through PopupDelayer.open(), called from their pointer
 * handlers. We wrap that method on the PopupDelayer prototype of each reader document so it only
 * proceeds when the configured condition holds. Opening a preview from the keyboard (Tab to a
 * link, then Enter) doesn't go through the delayer and keeps working.
 *
 * Pointer and key events from the reader's frames propagate up to the chrome window that hosts
 * the reader <browser>, so capturing listeners on that window see them before the reader does.
 *
 * This file is loaded into the plugin's bootstrap scope, which is reused when the plugin is
 * disabled and re-enabled, so it must not declare top-level let/const bindings.
 */

QuietPopup = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,

	PREF_BRANCH: 'extensions.zotero-quiet-popup.',
	READER_URL: 'resource://zotero/reader/reader.html',
	POINTER_EVENTS: ['pointerover', 'pointermove', 'pointerdown'],
	MODIFIERS: {
		ctrl: { flag: 'ctrlKey', keys: ['Control'] },
		alt: { flag: 'altKey', keys: ['Alt', 'AltGraph'] },
		shift: { flag: 'shiftKey', keys: ['Shift'] },
		meta: { flag: 'metaKey', keys: ['Meta', 'OS'] },
	},

	_mode: 'modifier',
	_modifier: 'ctrl',
	_modifierHeld: false,
	_lastPointer: null,
	_windows: null,
	_checkedDocs: null,
	_patches: null,
	_prefObserverIDs: null,
	_windowListener: null,

	init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this._windows = new Set();
		this._checkedDocs = new WeakSet();
		this._patches = new Set();
		this._prefObserverIDs = [];

		this._handlePointerEvent = this._handlePointerEvent.bind(this);
		this._handleKeyDown = this._handleKeyDown.bind(this);
		this._handleKeyUp = this._handleKeyUp.bind(this);

		this._readPrefs();
		for (let name of ['mode', 'modifier']) {
			this._prefObserverIDs.push(
				Zotero.Prefs.registerObserver(this.PREF_BRANCH + name, () => this._readPrefs(), true)
			);
		}
		this.initialized = true;
	},

	log(msg) {
		Zotero.debug('Quiet Popup: ' + msg);
	},

	shouldShowPopup() {
		if (!this.initialized) return true;
		switch (this._mode) {
			case 'never':
				return false;
			case 'always':
				return true;
			default:
				return this._modifierHeld;
		}
	},

	addToAllWindows() {
		for (let win of Zotero.getMainWindows()) {
			this.addToWindow(win);
		}
		// Attachments opened in a separate window
		for (let win of Services.wm.getEnumerator('zotero:reader')) {
			this.addToWindow(win);
		}
		this._windowListener = {
			onOpenWindow: (appWindow) => {
				let win = appWindow.docShell.domWindow;
				win.addEventListener('load', () => {
					if (win.document.documentElement.getAttribute('windowtype') == 'zotero:reader') {
						this.addToWindow(win);
					}
				}, { once: true });
			},
			onCloseWindow() {},
		};
		Services.wm.addListener(this._windowListener);
	},

	addToWindow(win) {
		if (this._windows.has(win)) return;
		this._windows.add(win);
		for (let type of this.POINTER_EVENTS) {
			win.addEventListener(type, this._handlePointerEvent, true);
		}
		win.addEventListener('keydown', this._handleKeyDown, true);
		win.addEventListener('keyup', this._handleKeyUp, true);
		win.addEventListener('unload', () => this.removeFromWindow(win), { once: true });
	},

	removeFromWindow(win) {
		if (!this._windows.delete(win)) return;
		for (let type of this.POINTER_EVENTS) {
			win.removeEventListener(type, this._handlePointerEvent, true);
		}
		win.removeEventListener('keydown', this._handleKeyDown, true);
		win.removeEventListener('keyup', this._handleKeyUp, true);
	},

	shutdown() {
		if (this._windowListener) {
			Services.wm.removeListener(this._windowListener);
			this._windowListener = null;
		}
		for (let win of [...this._windows]) {
			this.removeFromWindow(win);
		}
		for (let id of this._prefObserverIDs) {
			Zotero.Prefs.unregisterObserver(id);
		}
		this._prefObserverIDs = [];
		for (let patch of this._patches) {
			this._unpatch(patch);
		}
		this._patches.clear();
		this._lastPointer = null;
		this.initialized = false;
	},

	_readPrefs() {
		let mode = Zotero.Prefs.get(this.PREF_BRANCH + 'mode', true);
		let modifier = Zotero.Prefs.get(this.PREF_BRANCH + 'modifier', true);
		this._mode = ['modifier', 'never', 'always'].includes(mode) ? mode : 'modifier';
		this._modifier = modifier in this.MODIFIERS ? modifier : 'ctrl';
		this._modifierHeld = false;
	},

	_handlePointerEvent(event) {
		this._modifierHeld = !!event[this.MODIFIERS[this._modifier].flag];
		this._lastPointer = {
			target: event.target,
			clientX: event.clientX,
			clientY: event.clientY,
			screenX: event.screenX,
			screenY: event.screenY,
			buttons: event.buttons,
			ctrlKey: event.ctrlKey,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey,
		};
		this._ensurePatched(event.target);
	},

	_handleKeyDown(event) {
		if (!this._isModifierKey(event)) return;
		this._modifierHeld = true;
		// Pressing the key while already resting on a link shows its preview without having to
		// move the pointer
		if (!event.repeat && this._mode == 'modifier') {
			this._replayHover();
		}
	},

	_handleKeyUp(event) {
		if (this._isModifierKey(event)) {
			this._modifierHeld = false;
		}
	},

	_isModifierKey(event) {
		return this.MODIFIERS[this._modifier].keys.includes(event.key);
	},

	// Re-sends the last hover so the reader looks for a link under the pointer again, now with
	// the modifier held. PDF views look for links on pointermove, EPUB views on pointerover.
	_replayHover() {
		let pointer = this._lastPointer;
		if (!pointer || pointer.buttons) return;
		let { target } = pointer;
		try {
			if (Components.utils.isDeadWrapper(target) || !target.isConnected) return;
			let win = target.ownerGlobal;
			if (!win.top.document.documentURI.startsWith(this.READER_URL)) return;
			let init = {
				bubbles: true,
				cancelable: true,
				composed: true,
				view: win,
				clientX: pointer.clientX,
				clientY: pointer.clientY,
				screenX: pointer.screenX,
				screenY: pointer.screenY,
				ctrlKey: pointer.ctrlKey,
				altKey: pointer.altKey,
				shiftKey: pointer.shiftKey,
				metaKey: pointer.metaKey,
				[this.MODIFIERS[this._modifier].flag]: true,
				pointerType: 'mouse',
				isPrimary: true,
			};
			target.dispatchEvent(new win.PointerEvent('pointerover', init));
			target.dispatchEvent(new win.PointerEvent('pointermove', init));
		}
		catch (e) {
			Zotero.logError(e);
		}
	},

	_ensurePatched(target) {
		let doc;
		try {
			doc = target?.ownerGlobal?.top?.document;
		}
		catch (e) {
			return;
		}
		if (!doc || this._checkedDocs.has(doc)) return;
		if (!doc.documentURI.startsWith(this.READER_URL)) {
			// Once loaded, a document never turns into the reader, so it needs no further checks
			if (doc.readyState == 'complete') {
				this._checkedDocs.add(doc);
			}
			return;
		}
		try {
			if (this._patchReader(doc.defaultView)) {
				this._checkedDocs.add(doc);
			}
		}
		catch (e) {
			Zotero.logError(e);
			// Don't retry on every pointer move
			this._checkedDocs.add(doc);
		}
	},

	// Returns true once there's nothing left to do for this reader document
	_patchReader(win) {
		// The internal reader and its views are created after reader.html has loaded
		let internalReader = Components.utils.waiveXrays(win)._reader;
		let delayer = internalReader && this._findPopupDelayer(internalReader);
		if (!delayer) return false;

		let proto = Components.utils.waiveXrays(Object.getPrototypeOf(delayer));
		if (proto.quietPopupPatched) return true;
		let originalOpen = proto.open;
		let originalClose = proto.close;
		if (typeof originalOpen != 'function' || typeof originalClose != 'function') {
			this.log('Unrecognized reader popup code; leaving it unchanged');
			return true;
		}

		let self = this;
		let options = { allowCrossOriginArguments: true };
		proto.open = Components.utils.exportFunction(function (ref, callback) {
			let delayer = Components.utils.waiveXrays(this);
			if (self.shouldShowPopup()) {
				return originalOpen.call(delayer, ref, callback);
			}
			// Hovering a link without the modifier. If a preview is showing, e.g. because the pointer
			// moved straight from one citation onto the next, let it close as if the pointer had left
			// the link, rather than leave the previous link's preview up.
			if (delayer._open && delayer.quietPopupLastClose) {
				originalClose.call(delayer, delayer.quietPopupLastClose);
			}
			return undefined;
		}, win, options);
		proto.close = Components.utils.exportFunction(function (callback) {
			let delayer = Components.utils.waiveXrays(this);
			delayer.quietPopupLastClose = callback;
			return originalClose.call(delayer, callback);
		}, win, options);
		proto.quietPopupPatched = true;

		let patch = { proto, originalOpen, originalClose };
		this._patches.add(patch);
		win.addEventListener('unload', () => this._patches.delete(patch), { once: true });
		this.log('Patched reader popups');
		return true;
	},

	_findPopupDelayer(internalReader) {
		let views = internalReader._views || [internalReader._primaryView, internalReader._secondaryView];
		for (let i = 0; i < views.length; i++) {
			let delayer = views[i]?._overlayPopupDelayer;
			if (delayer) return delayer;
		}
		return null;
	},

	_unpatch({ proto, originalOpen, originalClose }) {
		try {
			if (Components.utils.isDeadWrapper(proto)) return;
			proto.open = originalOpen;
			proto.close = originalClose;
			delete proto.quietPopupPatched;
		}
		catch (e) {
			Zotero.logError(e);
		}
	},
};
