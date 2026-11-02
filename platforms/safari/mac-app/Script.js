// Called by ViewController.swift with the extension's state (true/false, or undefined if unknown).
function show(enabled) {
    document.body.classList.toggle('on', enabled === true);
}

document.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', () => {
    webkit.messageHandlers.controller.postMessage(b.dataset.msg);
}));
