# frida-fs

Create a stream from a filesystem resource.

## Example

```js
const fs = require('frida-fs');

fs.createReadStream('/etc/hosts').pipe(networkStream);
```

```js
const fs = require('frida-fs');

fs.list("/proc/self/").forEach(elm => {
    console.log(JSON.stringify(elm))
});

console.log(fs.readFileSync("/etc/hosts"));
```
