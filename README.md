### caddy file_server custom `browse.html` template with media extensions

Customized template for caddy [**`file_server`**](https://caddyserver.com/docs/caddyfile/directives/file_server). Compared to caddy's default [browse.html](https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/fileserver/browse.html) this template offers the following extra features:

- play all audios inline (with automatic sequential autoplay)
- dynamic preview mode for images, video, HTML and source code files without page reload
- image gallery mode with easy navigation using :arrow_left: & :arrow_right: keys
- play videos with VTT and SRT subtitles support
- markdown preview using [marked](https://github.com/markedjs/marked)
- code highlighting for common source file formats using [highlight](https://github.com/highlightjs/highlight.js)
- retain list/grid mode on navigation

### NOTE: Experimental HEIC preview branch

If you already use Safari on macOS or iOS, HEIC preview works OOTB in the master branch — you DO NOT NEED TO USE THIS BRANCH.
This branch is ONLY meant for non Safari browsers on non-Apple platforms. It does HEIC decoding in javascipt 
and is therefore SLOWER than native HEIC.

To enable HEIC preview the following files must be copied to caddy's `SERVER_ROOT/.assets`:

```sh
heic.js
heic.worker.js
libheif-bundle.js
libheif.wasm
```
To automate the copy, edit the supplied `Makefile` and set the folder that is configured in caddy as the server root (exposed as `/`) and then run:

```sh
make copy
```
Depending on your specific Caddyfile you might need to modify lines 52..53 in `browse.html` to be resolvable to the actual files:

```
{{- $heicJS := "/.assets/heic.js"}}
{{- $heicFile := "heic.js"}}
```

### Usage

In your `Caddyfile` set the [**`browse`**](https://caddyserver.com/docs/caddyfile/directives/file_server#syntax) subdirective under `file_server` to point to the custom `browse.html` ([view source](https://github.com/glowinthedark/caddy-file-server-browse-extension/blob/master/browse.html)) file:

```Caddyfile
http:// {
    file_server {
        root /path/to/my/server/root
        browse /path/to/folder/caddy/templates/browse.html
    }
}
```
### Screenshots

##### inline audio player 
![](img/caddy_file_server.png)

##### markdown renderer
![](img/caddy_file_server_markdown.png)

##### source file highlighter
![](img/caddy_file_server_highlight.png)
