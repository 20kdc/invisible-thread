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

const WRW_SYMBOLS = [
	"\r\n",
	" IN IP4 127.0.0.1\r\n",
	"a=fingerprint:sha-256 ",
	"a=ice-options:trickle\r\n",
	"a=setup:actpass\r\n",
	"a=sctp-port:",
	"a=max-message-size:262144\r\n",
	"a=candidate:",
	" udp ",
	" UDP ",
	" tcp ",
	" TCP ",
	"127.0.0.1",
	"192.168.",
	"0.",
	"10.",
	"0:", "1:", "2:", "3:", "4:", "5:", "6:", "7:", "8:", "9:", "A:", "B:", "C:", "D:", "E:", "F:",
	" network-cost ",
	" ufrag ",
	" rport ",
	"raddr ",
	" typ srflx ",
	" typ host ",
	"generation 0",
	"a=ice-ufrag:",
	"a=ice-pwd:",
	"c=IN IP4 0.0.0.0\r\n",
	"m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
	"a=msid-semantic: WMS\r\n",
	"a=msid-semantic:WMS\r\n", // mozilla
	"a=extmap-allow-mixed\r\n",
	"a=group:BUNDLE 0\r\n",
	"t=0 0\r\n",
	"s=-\r\n",
	"v=0\r\n",
	"a=mid:0\r\n"
];

function wrwCompress(text) {
	let data = "";
	while (text.length > 0) {
		let v = text.charCodeAt(0);
		// fallback encoding:
		// 0-0x7F: direct
		// 0xF0-0xFE: encode 12-bit(ish) number
		// 0xFF: followed by BE full code
		if (v >= 0x80) {
			data += String.fromCharCode(0xFF, v >> 8, v & 0xFF);
			text = text.substring(1);
		} else {
			let maxLen = 1;
			let sym = String.fromCharCode(v);
			let efficiency = maxLen / sym.length;
			for (let i = 3; i < 4; i++) {
				let proposal = text.substring(0, i);
				let parsed = parseInt(proposal, 10);
				if (parsed != NaN && parsed >= 0 && parsed < 0xF00 && (parsed.toString() == proposal)) {
					maxLen = proposal.length;
					sym = String.fromCharCode(0xF0 | (parsed >> 8), parsed & 0xFF);
					efficiency = maxLen / sym.length;
				}
			}
			for (let i = 0; i < WRW_SYMBOLS.length; i++) {
				let symEff = WRW_SYMBOLS[i].length;
				if (efficiency < symEff) {
					if (text.startsWith(WRW_SYMBOLS[i])) {
						maxLen = WRW_SYMBOLS[i].length;
						sym = String.fromCharCode(0x80 + i);
						efficiency = maxLen / sym.length;
					}
				}
			}
			data += sym;
			text = text.substring(maxLen);
		}
	}
	return data;
}

function wrwDecompress(data) {
	let text = "";
	while (data.length > 0) {
		let v = data.charCodeAt(0);
		if (v == 0xFF) {
			let v2 = data.charCodeAt(1);
			let v3 = data.charCodeAt(2);
			text += String.fromCharCode((v2 << 8) | v3);
			data = data.substring(3);
		} else if (v >= 0xF0) {
			// number
			let v2 = data.charCodeAt(1);
			text += (((v & 0xF) << 8) | v2).toString();
			data = data.substring(2);
		} else {
			if (v < 0x80) {
				text += String.fromCharCode(v);
			} else {
				// symbol
				text += WRW_SYMBOLS[v - 0x80];
			}
			data = data.substring(1);
		}
	}
	return text;
}

function wrwDecodeTicket(ticket) {
	ticket = atob(ticket);
	ticket = ticket.substring(1);
	return wrwDecompress(ticket);
}

function wrwGetTicketMode(ticket) {
	return atob(ticket).substring(0, 1);
}

function wrwEncodeTicket(modeChar, ticket) {
	let encoded = btoa(modeChar + wrwCompress(ticket));
	let decoded = wrwDecodeTicket(encoded);
	if (decoded != ticket) {
		console.log("mismatch", [decoded, ticket]);
		throw new Error("wrwEncodeTicket: Round-trip did not match");
	}
	return encoded;
}

/// WebRTC 'base opening handler'.
/// Note that onTicketUpdate should be called eventually; the other one won't.'
class WRWBaseConnection {
	constructor(ticketModeChar) {
		this.ticketModeChar = ticketModeChar;
		this.webrtc = new RTCPeerConnection({
			iceServers: [
				{
					urls: [
						"stun:stun.l.google.com:19302",
						"stun:stun1.l.google.com:19302",
						"stun:stun2.l.google.com:19302",
						"stun:stun3.l.google.com:19302",
						"stun:stun4.l.google.com:19302",
					]
				}
			]
		});
		this.channel = this.webrtc.createDataChannel("data", {negotiated: true, id: 0});
		// updated by caller
		this.onTicketUpdate = null;
		this.onConnectionEstablished = null;
		this.onStatusChange = null;
		this.onCriticalError = null;
		// updated by subclass
		this.ticketValid = false;
		this.ticketPrefix = "";
		// updated here
		this.candidateCount = 0;
		this.ticketSuffix = "";
		// These are buffered messages, retrievable on conversion of this structure.
		this.messages = [];
		// All event handlers here need to be detached in detach()
		this.channel.onmessage = (message) => {
			this.messages.push(message.data);
		};
		this.webrtc.onicecandidate = (candidate) => {
			if (candidate.candidate !== null) {
				let str = candidate.candidate.candidate;
				if (str.startsWith("candidate:")) {
					this.candidateCount += 1;
					this.ticketSuffix += "a=" + str + "\r\n";
					this.fireOnTicketUpdate();
					this.fireOnStatusChange();
				}
			}
		};
		this.webrtc.onconnectionstatechange = () => {
			if (this.webrtc.connectionState == "connected") {
				if (this.onConnectionEstablished !== null) {
					this.onConnectionEstablished();
				}
			}
			this.fireOnStatusChange();
		};
	}

	fireOnTicketUpdate() {
		if (this.ticketValid)
			if (this.onTicketUpdate !== null)
				this.onTicketUpdate();
	}

	fireOnStatusChange() {
		if (this.onStatusChange !== null)
			this.onStatusChange();
	}

	fireOnCriticalError(ex) {
		console.log(ex);
		if (this.onCriticalError !== null)
			this.onCriticalError(ex);
	}

	/// Gets the ticket. This is either an offer or answer depending on context.
	get ticket() {
		return wrwEncodeTicket(this.ticketModeChar, this.ticketPrefix + this.ticketSuffix);
	}

	get status() {
		return "connectionState=" + this.webrtc.connectionState + ", candidateCount=" + this.candidateCount;
	}

	/// Redirects all messages to the new callback, and calls it with all existing messages.
	forwardMessages(cb) {
		for (let v of this.messages) {
			cb(v);
		}
		this.channel.onmessage = (event) => {
			cb(event.data);
		};
		this.messages = null;
	}

	close() {
		this.webrtc.close();
	}

	detach() {
		this.channel.onmessage = null;
		this.webrtc.onicecandidate = null;
		this.webrtc.onconnectionstatechange = null;
	}
}

/// WebRTC initiator wrapper.
class WRWInitiator extends WRWBaseConnection {
	constructor() {
		super("I");
		this.webrtc.createOffer().then((offer) => {
			this.webrtc.setLocalDescription(offer).then(() => {
				this.ticketPrefix = offer.sdp;
				this.ticketValid = true;
				this.fireOnTicketUpdate();
			})
		})
	}

	/// Receive answer ticket.
	receiveTicket(answerTicket) {
		answerTicket = wrwDecodeTicket(answerTicket);
		this.webrtc.setRemoteDescription({
			type: "answer",
			sdp: answerTicket
		}).then(() => {
			// now we have to ride out connection state until we're done'
		}, this.fireOnCriticalError);
	}
}

/// WebRTC answerer wrapper.
class WRWAnswerer extends WRWBaseConnection {
	constructor(offerTicket) {
		super("A");
		offerTicket = wrwDecodeTicket(offerTicket);
		this.webrtc.setRemoteDescription({
			type: "offer",
			sdp: offerTicket
		}).then(() => {
			this.webrtc.createAnswer().then((answer) => {
				this.webrtc.setLocalDescription(answer).then(() => {
					this.ticketPrefix = answer.sdp;
					this.ticketValid = true;
					this.fireOnTicketUpdate();
				}, this.fireOnCriticalError)
			}, this.fireOnCriticalError);
		}, this.fireOnCriticalError)
	}
}
