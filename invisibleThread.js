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
			smSetState(new ITStateConnected(this.answerer));
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
			smSetState(new ITStateConnected(initiator));
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

const IT_FILE_AGGRESSION = 0x10000;
const IT_FILE_CHUNK = 1024;

/// This can work with Blob (for sending/reading) or ArrayBuffer (for receiving/writing).
class ITFileChunker {
	constructor(data) {
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

class ITStateConnected extends ITState {
	constructor(conn) {
		super("stateConnected");
		this.log = $("stateConnectedLog");
		this.log.innerText = "";
		this.currentFileSend = null;
		this.currentFileSendPercent = -1;
		this.currentFileRecv = null;
		this.currentFileRecvName = "file";
		this.currentFileRecvPercent = -1;
		this.conn = conn;
		this.connectStatus(conn);
		conn.forwardMessages((msg) => {
			try {
				if (msg instanceof ArrayBuffer) {
					if (this.currentFileRecv != null) {
						this.currentFileRecv.writeChunk(msg);
						let percent = this.currentFileRecv.percent;
						if (this.currentFileRecvPercent != percent) {
							this.log.innerText += "File receive: " + percent + "%\n";
							this.currentFileRecvPercent = percent;
						}
						if (this.currentFileRecv.complete) {
							const blob = new Blob([this.currentFileRecv.data], {type: "application/octet-stream"});
							let paragraph = document.createElement("p");
							let child = document.createElement("a");
							child.download = this.currentFileRecvName;
							child.href = URL.createObjectURL(blob);
							child.innerText = "Save file " + this.currentFileRecvName;
							paragraph.appendChild(child);
							$("stateConnectedFiles").appendChild(paragraph);
							this.currentFileRecv = null;
						}
					}
				} else {
					let msgContent = JSON.parse(msg);
					if (msgContent.type == "msg") {
						this.log.innerText += "Received: " + msgContent.text + "\n";
					} else if (msgContent.type == "file") {
						this.currentFileRecvName = "" + msgContent.name;
						this.log.innerText += "Receiving file: " + msgContent.name + "\n";
						this.currentFileRecv = new ITFileChunker(new ArrayBuffer(msgContent.size));
					}
				}
			} catch (ex) {
				console.log(ex);
			}
		});
		this.interval = setInterval(() => {
			if (this.currentFileSend == null)
				return;
			let percent = this.currentFileSend.percent;
			while (this.currentFileSend != null && this.conn.channel.bufferedAmount < IT_FILE_AGGRESSION) {
				this.conn.channel.send(this.currentFileSend.readChunk());
				percent = this.currentFileSend.percent;
				if (this.currentFileSend.complete)
					this.currentFileSend = null;
			}
			if (this.currentFileSendPercent != percent) {
				this.log.innerText += "File send: " + percent + "%\n";
				this.currentFileSendPercent = percent;
			}
		}, 10);
	}
	stateConnectedSendMsg() {
		try {
			let text = $("stateConnectedMessage").value;
			this.log.innerText += "Sent: " + text + "\n";
			this.conn.channel.send(JSON.stringify({
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
				this.conn.channel.send(JSON.stringify({
					type: "file",
					name: selectedFile.name,
					size: selectedFile.size
				}));
				this.currentFileSend = new ITFileChunker(selectedFile);
			} else {
				alert("You need to select a file!");
			}
		} catch (ex) {
			console.log(ex);
			alert("Something went wrong: " + ex);
		}
	}
}

// -- root handlers --

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

function onBtn(name) {
	if (currentState[name]) {
		currentState[name]();
	}
}

