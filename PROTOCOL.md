# The Protocol

## Tickets

'Tickets' represent SDP offers and answers.

They consist of base64 strings. These strings decode to a 'mode character' (`"I"` for offer or `"A"` for answer) followed by compressed ticket contents.

The compressed ticket contents are compressed/decompressed using the `wrwCompress`/`wrwDecompress` functions in `webrtcWrapper.js`; this won't be described further.

The offer/answer data has all available candidates concatenated; this means all non-peer-reflexive candidates are automatically available.

## Session Proper

The session proper consists of a single pre-negotiated, reliable, ordered data channel of ID 0.

Due to some oddities in scheduling between string (_control_) and array (_data_) packets, it's assumed these operate on seperate 'internal' channels.

There is no primary/secondary node distinction.

A distinction is also made between:
* **streams**: data-side, segments actual data
* **blobs**: control-side; the actual send/receive session controlling a stream
* **files**: control-side: A specific type of blob transfer (the implementation manages these using specific kinds of widget)

### Data

The data side works as follows:

* `ArrayBuffer` packets are part of an active stream transfer. A given node is _sending_ a stream and _receiving_ a stream at a given time.
	* A fresh node is always sending stream ID -1.
* An empty `ArrayBuffer` is a 'stream marker', sent at the start of each stream. This increments the receiver's view of the sender's stream ID; the first 'marker' indicates the beginning of stream ID 0.
* While the stream marker may be sent whenever, the _data_ of the stream must not be sent until the receiver has signalled (via the control side) that it is ready to receive it.

### Control

The control side maintains its own blob state.

At any given time, each node can be sending one blob and can be receiving one blob.

Blob transfers consist of:

1. A blob start message, along with the corresponding stream marker.
2. A `"blobAck"` message is received to confirm readiness.
3. Data transfer happens.
4. (optional) A `"blobRecvAbort"` message is received to either confirm completion or otherwise end the transfer.
5. A `"blobSendAbort"` message is sent, which formally ends the transfer.

Therefore, for any blob transfer, these rules apply:

* _In the control timeline,_ the sender must not presently be sending any blob when a blob start message is sent.
* Data must not be sent on a stream representing a blob until the corresponding `"blobAck"` message has been received.
	* It is safe to send the data-side stream marker at any time, so long as it precedes the data.
	* This mechanism acts as a 'choke' on data; the blob is formally 'being sent' from the moment the start message is sent.
	* The acknowledgement is solely important because otherwise data could arrive before its metadata.

`String` packets decode to JSON objects, with a property `"type"`.

The types are:

* `"msg"`: The `"text"` field is a string. This is a chat message.
* `"file"`: The sender is about to send a file with the given `"name"`, `"size"` and `"id"`.
	* **This is a blob transfer start message.**
	* The `"id"` must match the data-side stream ID.
* `"blobAck"`: The sender is ready to receive a stream with the given `"id"`.
	* This can be sent in response to any control message that sets up a blob transfer.
* `"blobSendAbort"`: The sender has stopped sending a blob.
	* This is sent in response to any successful `"blobRecvAbort"`.
	* This is sent if the sender explicitly cancels the blob.
* `"blobRecvAbort"`: The sender wishes the receiver to stop sending the blob with the given `"id"`.
	* This is sent when the sender has confirmed that it has completely received the blob.
		* In this role, it acts as confirmation of completed download, which is important to prevent desynchronization between the control and data streams.
	* This is sent if the blob receiver explicitly cancels the transfer.
		* In this role, it cancels the download.
	* If the blob with the given `"id"` is not currently being sent, this does nothing.
		* Note that, per the synchronization requirements, a blob is 'being sent' until `"blobSendAbort"` is sent.
