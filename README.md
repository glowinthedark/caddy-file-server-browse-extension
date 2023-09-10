### caddy file_server custom `browse.html` template with media extensions

Customized template for caddy file_server. Compared to caddy's default [browse.html](https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/fileserver/browse.html) template offers the following extra features:

- play all audios inline (with automatic sequential autoplay)
- dynamic preview mode for images, video, HTML and source code files without page reload
- play videos with VTT and SRT subtitles support
- markdown preview using [marked](https://github.com/markedjs/marked)
- code highlighting for common source file formats using [highlight](https://github.com/highlightjs/highlight.js)
- retains list/grid mode on navigation

### Usage

In your `Caddyfile` set the [**`browse`**](https://caddyserver.com/docs/caddyfile/directives/file_server#syntax) directive under `file_server` to point to the custom `browse.html` ([view source](https://github.com/glowinthedark/caddy-file-server-browse-extension/blob/master/browse.html)) file:

```Caddyfile
file_server {
    root /path/to/my/server/root
    browse /path/to/folder/caddy/templates/browse.html
}
```
