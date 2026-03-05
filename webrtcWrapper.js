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

const WRW_COMPRESSION = [
	["\n", "\r\n"],
	["\x80", "IN IP4 "],
	["\x81", "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\n"],
	["\x82", "a=max-message-size:"],
	["\x83", "v=0\n"],
	["\x84", "o=- "],
	["\x85", "a=ice-options:trickle\n"],
	["\x86", "a=fingerprint:sha-256 "],
	["\x87", "a=setup:actpass\n"],
	["\x88", "a=mid:0\n"],
	["\x89", " generation 0 ufrag "],
	["\x8A", " typ srflx"],
	["\x8B", " typ host"],
	["\x8C", " network-cost "],
	["\x8D", "999\n"],
	["\x8E", "a=ice-pwd:"],
	["\x8F", "a=ice-ufrag:"],
	["\x90", "a=msid-semantic: WMS\n"],
	["\x91", "a=sctp-port:"],
	["\x92", "a=candidate:"],
	["\x93", " 1 udp "],
	["\x94", "192.168.0."],
	["\x95", "192.168."],
	["\x96", " raddr "],
	["\x97", " rport "],
	["\x98", "127.0.0.1\n"],
	["\x99", "t=0 0\n"],
	["\x9A", "a=group:BUNDLE 0\n"],
	["\x9B", "a=extmap-allow-mixed\n"],
	["\x9C", "s=-\n"],
	["\x9D", "0.0.0.0\n"],
	["\x9E", "o=mozilla...THIS_IS_SDPARTA-99.0 "],
	["\x9F", "a=sendrecv\n"],
	["\xA0", "a=msid-semantic:WMS *\n"],
	["\xA1", " 1 UDP "],
	["\xA2", " 1 TCP "],
]

function wrwDecodeTicket(ticket) {
	ticket = atob(ticket);
	ticket = ticket.substring(1);
	for (let i = WRW_COMPRESSION.length - 1; i >= 0; i--) {
		ticket = ticket.replaceAll(WRW_COMPRESSION[i][0], WRW_COMPRESSION[i][1]);
	}
	return ticket;
}

function wrwGetTicketMode(ticket) {
	return atob(ticket).substring(0, 1);
}

function wrwEncodeTicket(modeChar, ticket) {
	for (let i = 0; i < WRW_COMPRESSION.length; i++) {
		ticket = ticket.replaceAll(WRW_COMPRESSION[i][1], WRW_COMPRESSION[i][0]);
	}
	let encoded = btoa(modeChar + ticket);
	if (wrwDecodeTicket(encoded) != ticket) {
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
