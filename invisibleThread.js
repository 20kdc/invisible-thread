/*
 * This is free and unencumbered software released into the public domain.
 *
 * Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.
 *
 * In jurisdictions that recognize copyright laws, the author or authors of this software dedicate any and all copyright interest in the software to the public domain. We make this dedication for the benefit of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of relinquishment in perpetuity of all present and future rights to this software under copyright law.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * For more information, please refer to <http://unlicense.org/>
 */

// -- on error --
window.onerror = function(e, url, line) {
	alert("Exception: " + url + ":" + line + ", " + e);
};

// -- state machine --

class ITState {
	constructor(panelName) {
		this.panelName = panelName;
	}
	connectStatus(conn) {
		conn.onStatusChange = () => {
			$(this.panelName + "Status").innerText = conn.status;
		};
		conn.onStatusChange();
	}
}

let currentState = new ITState("");

function smSetState(st) {
	currentState = st;
	for (let v of $("stateMachine").children) {
		if (v.id != st.panelName) {
			v.style.display = "none";
		} else {
			v.style.display = "";
		}
	}
	return st;
}

function onBtn(name) {
	if (currentState[name]) {
		currentState[name]();
	}
}

// -- critical error --

class ITStateCriticalError extends ITState {
	constructor(loc, ex) {
		super("stateCriticalError");
		$("stateCriticalErrorText").value = loc + ": " + ex;
	}
}

// -- initial state --

class ITStateInit extends ITState {
	constructor(initiator) {
		super("stateInit");
		$("stateInitSend").value = "";
		$("stateInitRecv").value = "";
		this.initiator = initiator;
		this.connectStatus(initiator);
		initiator.onTicketUpdate = () => {
			$("stateInitSend").value = initiator.ticket;
		};
		// since we can be re-invoked
		$("stateInitSend").value = initiator.ticket;
		initiator.onCriticalError = (ex) => {
			$("stateInitSend").value = "CRITICAL ERROR: " + ex;
		};
	}
	stateInitSendReady() {
		this.initiator.onStatusChange = null;
		this.initiator.onTicketUpdate = null;
		this.initiator.onCriticalError = null;
		return smSetState(new ITStateInitiator(this.initiator));
	}
	stateInitRecvConfirm() {
		try {
			let ticket = $("stateInitRecv").value;
			if (wrwGetTicketMode(ticket) == "A") {
				// this is an Answerer ticket
				this.stateInitSendReady().acceptTicket(ticket);
			} else {
				this.initiator.close();
				smSetState(new ITStateAnswerer(ticket));
			}
		} catch (ex) {
			smSetState(new ITStateCriticalError("Ticket parsing", ex));
		}
	}
}

function itNewInitState() {
	return new ITStateInit(new WRWInitiator());
}

class ITStateGoner extends ITState {
	constructor() {
		super("stateGoner");
	}
	stateGonerAccept() {
		smSetState(itNewInitState());
	}
}

function boot() {
	smSetState(new ITStateGoner());
}

class ITStateAnswerer extends ITState {
	constructor(ticket) {
		super("stateAnswerer");
		$("stateAnswererTicket").value = "";
		this.answerer = new WRWAnswerer(ticket);
		this.connectStatus(this.answerer);
		this.answerer.onTicketUpdate = () => {
			$("stateAnswererTicket").value = this.answerer.ticket;
		};
		this.answerer.onConnectionEstablished = () => {
			this.answerer.onStatusChange = null;
			this.answerer.onConnectionEstablished = null;
			this.answerer.onCriticalError = null;
			smSetState(new ITStateConnected(new ITSession(this.answerer)));
		};
		this.answerer.onCriticalError = (ex) => {
			smSetState(new ITStateCriticalError("Answerer setup async", ex));
			this.answerer.close();
		};
	}
	stateAnswererShutdown() {
		this.answerer.close();
		smSetState(itNewInitState());
	}
}

class ITStateInitiator extends ITState {
	constructor(initiator) {
		super("stateInitiator");
		$("stateInitiatorTicket").value = "";
		this.initiator = initiator;
		this.connectStatus(initiator);
		initiator.onConnectionEstablished = () => {
			initiator.onStatusChange = null;
			initiator.onConnectionEstablished = null;
			initiator.onCriticalError = null;
			smSetState(new ITStateConnected(new ITSession(initiator)));
		};
		initiator.onCriticalError = (ex) => {
			smSetState(new ITStateCriticalError("Initiator setup async", ex));
			initiator.close();
		};
	}
	acceptTicket(ticket) {
		try {
			this.initiator.receiveTicket(ticket);
			this.panelName = "stateInitiatorWaiting";
			this.connectStatus(this.initiator);
			smSetState(this);
		} catch (ex) {
			smSetState(new ITStateCriticalError("Initiator accept ticket", ex));
			this.initiator.close();
		}
	}
	stateInitiatorAccept() {
		this.acceptTicket($("stateInitiatorTicket").value);
	}
	stateInitiatorWaitingHalt() {
		this.initiator.onStatusChange = null;
		smSetState(new ITStateInit(this.initiator));
	}
}

// -- The Connected State --

let IT_FILE_AGGRESSION = 0x10000;
let IT_FILE_CHUNK = 1024;

/// This can work with Blob (for sending/reading) or ArrayBuffer (for receiving/writing).
/// Also includes an ID for easier tracking.
class ITFileChunker {
	constructor(data) {
		// -1: has not been queued yet
		this.id = -1;
		this.data = data;
		this.pos = 0;
		this.size = (data.size === void 0) ? data.byteLength : data.size;
	}
	get complete() {
		return this.pos >= this.size;
	}
	get percent() {
		return Math.floor((this.pos / this.size) * 100);
	}
	readChunk() {
		let theoryEnd = this.pos + IT_FILE_CHUNK;
		if (theoryEnd > this.size)
			theoryEnd = this.size;
		let slice = this.data.slice(this.pos, theoryEnd);
		this.pos = theoryEnd;
		return slice;
	}
	writeChunk(chunk) {
		let src = new Uint8Array(chunk);
		let dst = new Uint8Array(this.data);
		let j = this.pos;
		for (let i = 0; i < src.byteLength; i++) {
			dst[j++] = src[i];
		}
		this.pos += src.byteLength;
	}
}

class ITSession {
	constructor(conn) {
		this.conn = conn;
		this.widgets = [];
		this.onNewWidget = null;
		// Control-stream files
		this.currentBlobSend = null;
		this.currentBlobRecv = null;
		// Data-stream stream IDs
		this.localStreamId = -1;
		this.localStreamIdAcked = -1;
		this.remoteStreamId = -1;

		conn.forwardMessages((msg) => {
			try {
				if (msg instanceof ArrayBuffer) {
					if (msg.byteLength == 0) {
						// [DESYNC] Marker packet tells us that the remote end is sending a new file.
						this.remoteStreamId++;
					} else if (this.currentBlobRecv != null && this.remoteStreamId == this.currentBlobRecv.id) {
						this.currentBlobRecv.writeChunk(msg);
						// [DESYNC] We don't drop currentBlobRecv until an explicit abort.
						// In addition, the ID counter ensures each file stream is properly managed.
					}
				} else {
					let msgContent = JSON.parse(msg);
					if (msgContent.type == "msg") {
						this.addWidget(new ITMessageWidget(this, "received", "" + msgContent.text));
					} else if (msgContent.type == "file") {
						if (this.currentBlobRecv != null) {
							// [DESYNC] causes this to happen, which is bad.
							alert("WARNING: File interrupted by other file. This isn't supposed to happen, and indicates a bug.");
						}
						this.currentBlobRecv = new ITFileChunker(new ArrayBuffer(msgContent.size));
						this.currentBlobRecv.id = msgContent.id;
						this.conn.channel.send(JSON.stringify({
							type: "blobAck",
							id: msgContent.id
						}));
						this.addWidget(new ITReceiveFileWidget(this, "" + msgContent.name, this.currentBlobRecv));
					} else if (msgContent.type == "blobAck") {
						this.localStreamIdAcked = msgContent.id;
					} else if (msgContent.type == "blobSendAbort") {
						this.currentBlobRecv = null;
					} else if (msgContent.type == "blobRecvAbort") {
						this.opAbortSendBlob(msgContent.id);
					}
				}
			} catch (ex) {
				console.log(ex);
			}
		});
		this.interval = setInterval(() => {
			// [DESYNC]
			// It seems like the JSON messages and the byte-array messages are out of sync somehow.
			// To keep them in sync, we require:
			// * an explicit abort message to indicate completion
			// * acknowledgement of
			while (this.localStreamId == this.localStreamIdAcked && this.currentBlobSend != null && this.conn.channel.bufferedAmount < IT_FILE_AGGRESSION) {
				if (this.currentBlobSend.complete)
					break;
				// it's important the completion check is done; an empty packet would be misread as a marker!
				this.conn.channel.send(this.currentBlobSend.readChunk());
			}
			for (let v of this.widgets) {
				v.doUpdate();
			}
		}, 10);
	}
	addWidget(w) {
		this.widgets.push(w);
		if (this.onNewWidget)
			this.onNewWidget(w);
	}
	opBeginFile(name, fileSend) {
		// take opportunity to begin file transmit
		fileSend.id = ++this.localStreamId;
		this.conn.channel.send(JSON.stringify({
			type: "file",
			name: name,
			id: fileSend.id,
			size: fileSend.size
		}));
		// send empty 'marker' packet
		this.conn.channel.send(new ArrayBuffer(0));
		this.currentBlobSend = fileSend;
	}
	opAbortRecvBlob(id) {
		if (this.currentBlobRecv && this.currentBlobRecv.id == id) {
			this.conn.channel.send(JSON.stringify({
				type: "blobRecvAbort",
				id: id
			}));
			this.currentBlobRecv = null;
		}
	}
	opAbortSendBlob(id) {
		if (this.currentBlobSend && this.currentBlobSend.id == id) {
			this.conn.channel.send(JSON.stringify({
				type: "blobSendAbort"
			}));
			this.currentBlobSend = null;
		}
	}
}

class ITWidget {
	constructor(sess, title) {
		this.sess = sess;
		this.title = title;
		this.realized = null;
	}
	realize() {
		let parent = document.createElement("div");
		parent.className = "widget";
		this.realized = parent;
		this.realizeContents(parent);
		return parent;
	}
	realizeContents(parent) {
		let titleBar = document.createElement("div");
		titleBar.className = "widgetTitleBar";
		let titleText = document.createElement("div");
		titleText.className = "widgetTitleText";
		titleText.appendChild(document.createTextNode(this.title + " "));
		let closeButton = document.createElement("button");
		closeButton.class = "closeButton";
		closeButton.innerText = "x";
		closeButton.onclick = () => this.doClose();
		titleBar.appendChild(titleText);
		titleBar.appendChild(closeButton);
		parent.appendChild(titleBar);
	}
	// called by widget
	updateContents() {
		if (this.realized != null) {
			$.removeAllChildren(this.realized);
			this.realizeContents(this.realized);
		}
	}
	doClose() {
		if (this.realized != null) {
			this.realized.parentNode.removeChild(this.realized);
			this.realized = null;
		}
		this.sess.widgets = this.sess.widgets.filter((v) => v !== this);
	}
	doUpdate() {

	}
}

class ITReceiveFileWidget extends ITWidget {
	constructor(sess, fileRecvName, fileRecv) {
		super(sess, "receiving: " + fileRecvName + " (" + $.friendlyBytes(fileRecv.size) + ")");
		this.filename = fileRecvName;
		this.fileRecv = fileRecv;
		this.blob = null;
		this.ackState = "";
	}
	figureOutState() {
		if (this.sess.currentBlobRecv == this.fileRecv) {
			return "receiving" + this.fileRecv.percent;
		} else if (this.fileRecv.complete || (this.blob != null)) {
			return "complete";
		} else {
			return "aborted";
		}
	}
	realizeContents(parent) {
		super.realizeContents(parent);
		let state = this.figureOutState();
		this.ackState = state;
		if (this.blob != null) {
			let paragraph = document.createElement("p");
			let child = document.createElement("a");
			child.download = this.filename;
			child.href = this.blobObjectURL;
			child.innerText = "Save file";
			paragraph.appendChild(child);
			parent.appendChild(paragraph);
		} else if (state == "aborted") {
			parent.appendChild(document.createTextNode("Upload aborted"));
		} else {
			parent.appendChild(document.createTextNode("Downloading: " + this.fileRecv.percent + "%"));
		}
	}
	doUpdate() {
		if (this.blob == null && this.fileRecv.complete) {
			this.sess.opAbortRecvBlob(this.fileRecv.id);
			this.blob = new Blob([this.fileRecv.data], {type: "application/octet-stream"});
			this.blobObjectURL = URL.createObjectURL(this.blob);
		}
		if (this.ackState != this.figureOutState()) {
			this.updateContents();
		}
	}
	doClose() {
		super.doClose();
		this.sess.opAbortRecvBlob(this.fileRecv.id);
		if (this.blob != null) {
			URL.revokeObjectURL(this.blobObjectURL);
		}
	}
}

class ITSendFileWidget extends ITWidget {
	constructor(sess, fileSendName, fileSend) {
		super(sess, "sending: " + fileSendName + " (" + $.friendlyBytes(fileSend.size) + ")");
		this.fileSendName = fileSendName;
		this.fileSend = fileSend;
		this.queueWaiting = true;
		this.ackState = "";
	}
	figureOutState() {
		if (this.queueWaiting) {
			return "queued";
		} else if (this.sess.currentBlobSend == this.fileSend) {
			return "transmitting" + this.fileSend.percent;
		} else if (this.fileSend.complete) {
			return "complete";
		} else {
			return "aborted";
		}
	}
	realizeContents(parent) {
		super.realizeContents(parent);
		let state = this.figureOutState();
		if (state == "complete") {
			parent.appendChild(document.createTextNode("Complete"));
		} else if (state == "queued") {
			parent.appendChild(document.createTextNode("Queued..."));
		} else if (state == "aborted") {
			parent.appendChild(document.createTextNode("Download aborted"));
		} else {
			parent.appendChild(document.createTextNode("Sending: " + this.fileSend.percent + "%"));
		}
		this.ackState = state;
	}
	doUpdate() {
		if (this.queueWaiting) {
			// queued
			if (this.sess.currentBlobSend == null) {
				this.queueWaiting = false;
				console.log("file transmit start opportunity");
				this.sess.opBeginFile(this.fileSendName, this.fileSend);
				this.updateContents();
			}
		}
		if (this.figureOutState() != this.ackState) {
			this.updateContents();
		}
	}
	doClose() {
		super.doClose();
		this.sess.opAbortSendBlob(this.fileSend.id);
	}
}

class ITMessageWidget extends ITWidget {
	constructor(sess, title, text) {
		super(sess, title);
		this.text = text;
	}
	realizeContents(parent) {
		super.realizeContents(parent);
		let paragraph = document.createElement("pre");
		paragraph.appendChild(document.createTextNode(this.text));
		parent.appendChild(paragraph);
	}
}

class ITStateConnected extends ITState {
	constructor(sess) {
		super("stateConnected");
		this.log = $("stateConnectedLog");
		$.removeAllChildren(this.log);
		this.sess = sess;
		this.sess.onNewWidget = (widget) => {
			$.prependChild(this.log, widget.realize());
		};
		for (let v of sess.widgets) {
			$.prependChild(this.log, v.realize());
		}
		this.connectStatus(sess.conn);
	}
	stateConnectedSendMsg() {
		try {
			let text = $("stateConnectedMessage").value;
			$("stateConnectedMessage").value = "";
			this.sess.addWidget(new ITMessageWidget(this.sess, "sent", text));
			this.sess.conn.channel.send(JSON.stringify({
				type: "msg",
				text: text
			}));
		} catch (ex) {
			console.log(ex);
			alert("Something went wrong: " + ex);
		}
	}
	stateConnectedSendFile() {
		try {
			let selectedFile = $("stateConnectedFile").files[0];
			if (selectedFile !== void 0) {
				this.sess.addWidget(new ITSendFileWidget(this.sess, selectedFile.name, new ITFileChunker(selectedFile)));
			} else {
				alert("You need to select a file!");
			}
		} catch (ex) {
			console.log(ex);
			alert("Something went wrong: " + ex);
		}
	}
}
