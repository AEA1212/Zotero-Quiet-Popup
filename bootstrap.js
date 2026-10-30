var QuietPopup;

function install() {}

async function startup({ id, version, rootURI }) {
	Services.scriptloader.loadSubScript(rootURI + 'quiet-popup.js');
	QuietPopup.init({ id, version, rootURI });

	Zotero.PreferencePanes.register({
		pluginID: id,
		src: rootURI + 'preferences.xhtml',
		label: 'Quiet Popup',
		image: rootURI + 'icon.svg',
		scripts: [rootURI + 'preferences.js'],
	});

	QuietPopup.addToAllWindows();
}

function onMainWindowLoad({ window }) {
	QuietPopup.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	// On quit, Zotero shuts plugins down before it unloads the main window
	QuietPopup?.removeFromWindow(window);
}

function shutdown() {
	QuietPopup.shutdown();
	QuietPopup = undefined;
}

function uninstall() {}
