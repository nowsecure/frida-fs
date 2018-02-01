# frida-fs

Create a stream from a filesystem resource.

## Example

```js
const fs = require('frida-fs');

fs.createReadStream('/etc/hosts').pipe(networkStream);
```
## Example 2

This example demonstrate how to use frida-fs to read a text file on android devices. Below is the payload/agent code:

```JavaScript
'use strict';

const fs = require("frida-fs");

Java.perform(function () {
    var readStream = fs.createReadStream("/path/to/file.txt");
    var text = "";
    readStream
        .on('readable', function () {
            var chunk;
            while (null !== (chunk = readStream.read())) {
                text = text.concat(chunk);
            }
        })
        .on('end', function () {
            send(text);
        });
});
```

Create a node project with above code and make sure that frida-fs and frida-compile are installed.

Compile this script using `frida-compile app.js -o payload.js`.
Then change in your binding code, use payload.js as your JavaScript file. e.g in mine it looks like this:
`script = process.create_script(open("path/to/payload.js").read())`
