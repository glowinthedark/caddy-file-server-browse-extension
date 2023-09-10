### caddy file_server custom `browse.html` template with media extensions

Customized template for caddy file_server with extra features:

- play all audios inline
- preview mode for images, video, HTML and source code files
- plays video with VTT and SRT subtitles support
- markdown preview using [marked](https://github.com/markedjs/marked)
- code highlighting for common source file formats using [highlight](https://github.com/highlightjs/highlight.js)
- retains list/grid mode on navigation

### Usage

In your `Caddyfile` set the `browse` directive under `file_server` to point to the custom `browse.html` file:

```Caddyfile
file_server {
    root /path/to/my/server/root
    browse /path/to/folder/caddy/templates/browse.html
}
```
