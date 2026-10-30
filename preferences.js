// Zotero loads pane scripts into their own sandbox, so expose the handler to the pane's inline
// onload attribute through the window
window.QuietPopup_Preferences = {
	init() {
		let mode = document.getElementById('quiet-popup-mode');
		let modifier = document.getElementById('quiet-popup-modifier');
		let update = () => {
			modifier.disabled = mode.value != 'modifier';
		};
		mode.addEventListener('command', update);
		mode.addEventListener('syncfrompreference', update);
		update();
	},
};
