# invisible-thread: generic-brand WebRTC P2P file transfer

features:

* service-agnostic
	* 'literally just static files': can be self-hosted on any HTTPS server, not susceptible to Node bitrot
	* you can use anything for which you can quickly copy/paste ~300 base64 characters as 'signalling'
* [E2EE by virtue of being WebRTC and not using an intermediary server](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels#security)
* relatively decent to navigate codebase by virtue of being small
* vanillajs framework
* no AI logos, code, etc.

caveats:

* 'manual signalling' technique issues
	* clunky
	* somewhat prone to issues on Android
	* only candidates available when the offer/answer are generated are supported; this is required to support the whole arrangement.
	* if you can reliably host the infrastructure to support something better, you wouldn't be here
* if you can't perform NAT traversal (either due to the signalling limitations or just because bad network) then this isn't gonna work
* current implementation of buffer management is possibly scuffed and needs tweaking
* use of more modern JS features affects browser version support envelope

## LICENSE

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this software dedicate any and all copyright interest in the software to the public domain. We make this dedication for the benefit of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of relinquishment in perpetuity of all present and future rights to this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>
```
