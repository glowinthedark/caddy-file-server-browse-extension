/* CFSHeic worker: fetch → libheif (wasm) → JPEG blob, entirely off the main thread.
   Protocol: postMessage({id,url,max,q}) -> {id,blob} | {id,err}. */
var modP = null;
function lib() {
	if (modP) return modP;
	modP = new Promise(function (res) {
		importScripts("libheif-bundle.js");
		var f = self.libheif;
		res(typeof f === "function" ? f() : f);/* emscripten factory, sync or thenable */
	});
	modP["catch"](function () { modP = null; });
	return modP;
}
function draw(mod, buf, max, q) {
	var imgs = new mod.HeifDecoder().decode(buf);
	if (!imgs || !imgs.length) throw new Error("no image in file");
	var img = imgs[0], w = img.get_width(), h = img.get_height();
	var cv = new OffscreenCanvas(w, h), ctx = cv.getContext("2d");
	return new Promise(function (res, rej) {
		img.display(ctx.createImageData(w, h), function (out) { out ? res(out) : rej(new Error("decode failed")); });
	}).then(function (out) {
		ctx.putImageData(out, 0, 0);
		var k = max > 0 ? Math.min(1, max / Math.max(w, h)) : 1;
		if (k < 1) {/* a 12 MP frame encodes 3x faster and costs 4x less memory scaled to the screen */
			var c2 = new OffscreenCanvas(Math.round(w * k), Math.round(h * k));
			c2.getContext("2d").drawImage(cv, 0, 0, c2.width, c2.height);
			cv.width = cv.height = 0; cv = c2;
		}
		return cv.convertToBlob({ type: "image/jpeg", quality: q });
	})["finally"](function () {
		imgs.forEach(function (x) { try { x.free(); } catch (e) { } });
		cv.width = cv.height = 0;/* 12 MP of RGBA is ~48 MB: drop the backing store at once */
	});
}
self.onmessage = function (e) {
	var d = e.data, id = d.id;
	Promise.all([
		lib(),
		fetch(d.url, { credentials: "same-origin" }).then(function (r) {
			if (!r.ok) throw new Error("HTTP " + r.status);
			return r.arrayBuffer();
		})
	]).then(function (a) { return draw(a[0], new Uint8Array(a[1]), d.max, d.q); })
		.then(function (b) { self.postMessage({ id: id, blob: b }); })
		["catch"](function (err) { self.postMessage({ id: id, err: String(err && err.message || err) }); });
};
