/* CFSHeic — optional HEIC/HEIF decode sidecar for browse.html.
   Chrome and Firefox cannot decode HEIC; Safari can, so browse.html only fetches this file after an
   <img> has actually failed. Decoding runs in a Worker (heic.worker.js + libheif-bundle.js, loaded
   from this file's own directory): libheif's wasm needs ~600 ms for a 12 MP frame, which would
   freeze scrolling, swiping and the close button if it ran on the main thread. The result is a JPEG
   Blob the existing <img> displays unchanged. If Workers are unavailable the same pipeline runs
   inline as a fallback.

   Install: put this file, heic.worker.js and libheif-bundle.js side by side under the site root, and
   point $heicJS in browse.html at heic.js. libheif-bundle.js (libheif-js, LGPL) is not vendored:
     curl -sL https://registry.npmjs.org/libheif-js/-/libheif-js-1.19.8.tgz | tar xz -O \
       package/libheif-wasm/libheif-bundle.js > libheif-bundle.js

   Contract: window.CFSHeic.decode(url) -> Promise<Blob>. */
(function () {
	var me = document.currentScript;
	var base = ((me && me.src) || "").replace(/[^/]*$/, ""), nonce = me ? me.nonce : "";
	/* cap the encoded preview at the largest dimension any display can show, doubled for zoom:
	   full-size re-encoding costs 3x the time and 4x the blob for detail no pixel ever receives. */
	var MAX = Math.min(4096, Math.max(2048, Math.round(Math.max(screen.width, screen.height) * (devicePixelRatio || 1) * 2)));
	var Q = .85, wrk = null, seq = 0, jobs = {};

	function worker() {
		if (wrk !== null) return wrk;
		wrk = false;
		try {
			if (self.Worker && self.OffscreenCanvas) {
				var w = new Worker(base + "heic.worker.js");
				w.onmessage = function (e) {
					var j = jobs[e.data.id];
					if (!j) return;
					delete jobs[e.data.id];
					e.data.err ? j[1](new Error(e.data.err)) : j[0](e.data.blob);
				};
				w.onerror = function () {/* CSP or 404: fail the queue once, then fall back inline */
					for (var k in jobs) { jobs[k][1](new Error("worker failed")); delete jobs[k]; }
					try { w.terminate(); } catch (e) { }
					wrk = false;
				};
				wrk = w;
			}
		} catch (e) { wrk = false; }
		return wrk;
	}

	/* ── inline fallback (no Worker / no OffscreenCanvas) ─────────────────── */
	var modP = null;
	function lib() {
		if (modP) return modP;
		modP = new Promise(function (res, rej) {
			var s = document.createElement("script");
			s.src = base + "libheif-bundle.js"; s.nonce = nonce;
			s.onload = function () { res(window.libheif); };
			s.onerror = function () { rej(new Error("libheif-bundle.js not loadable")); };
			document.head.appendChild(s);
		}).then(function (f) {
			if (!f) throw new Error("libheif missing");
			return typeof f === "function" ? f() : f;/* emscripten factory, sync or thenable */
		});
		modP["catch"](function () { modP = null; });/* a failed load must not poison later attempts */
		return modP;
	}
	function draw(mod, buf) {
		var imgs = new mod.HeifDecoder().decode(buf);
		if (!imgs || !imgs.length) throw new Error("no image in file");
		var img = imgs[0], w = img.get_width(), h = img.get_height();
		var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
		var ctx = cv.getContext("2d");
		return new Promise(function (res, rej) {
			img.display(ctx.createImageData(w, h), function (out) { out ? res(out) : rej(new Error("decode failed")); });
		}).then(function (out) {
			ctx.putImageData(out, 0, 0);
			var k = Math.min(1, MAX / Math.max(w, h));
			if (k < 1) {
				var c2 = document.createElement("canvas");
				c2.width = Math.round(w * k); c2.height = Math.round(h * k);
				c2.getContext("2d").drawImage(cv, 0, 0, c2.width, c2.height);
				cv.width = cv.height = 0; cv = c2;
			}
			return new Promise(function (res2, rej2) {
				cv.toBlob(function (b) { b ? res2(b) : rej2(new Error("encode failed")); }, "image/jpeg", Q);
			});
		})["finally"](function () {
			imgs.forEach(function (x) { try { x.free(); } catch (e) { } });
			cv.width = cv.height = 0;/* 12 MP of RGBA is ~48 MB: drop the backing store at once */
		});
	}
	function inline(url) {
		return Promise.all([
			lib(),
			fetch(url, { credentials: "same-origin" }).then(function (r) {
				if (!r.ok) throw new Error("HTTP " + r.status);
				return r.arrayBuffer();
			})
		]).then(function (a) { return draw(a[0], new Uint8Array(a[1])); });
	}

	window.CFSHeic = {
		decode: function (url) {
			url = new URL(url, location.href).href;/* the worker's base is its own directory, not the page */
			var w = worker();
			if (!w) return inline(url);
			return new Promise(function (res, rej) {
				var id = ++seq;
				jobs[id] = [res, rej];
				w.postMessage({ id: id, url: url, max: MAX, q: Q });
			})["catch"](function (e) {
				return worker() ? Promise.reject(e) : inline(url);/* worker died: retry inline once */
			});
		}
	};
})();
