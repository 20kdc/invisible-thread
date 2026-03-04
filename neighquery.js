function $(id) {
	return document.getElementById(id);
}
function copyText(id) {
	try {
		let area = $(id);
		if (document.execCommand) {
			area.select();
			document.execCommand("copy");
		} else if (navigator.clipboard.writeText) {
			navigator.clipboard.writeText(area.innerText);
		} else {
			alert("Your browser doesn't appear to support copying text.");
		}
	} catch (ex) {
		console.log(ex);
		alert("Your browser doesn't appear to support copying text.");
	}
}
