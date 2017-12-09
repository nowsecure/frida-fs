'use strict';

const stream = require('stream');

const universalConstants = {
  S_IFMT: 0xf000,
  S_IFREG: 0x8000,
  S_IFDIR: 0x4000,
  S_IFCHR: 0x2000,
  S_IFBLK: 0x6000,
  S_IFIFO: 0x1000,
  S_IFLNK: 0xa000,
  S_IFSOCK: 0xc000,

  S_IRWXU: 448,
  S_IRUSR: 256,
  S_IWUSR: 128,
  S_IXUSR: 64,
  S_IRWXG: 56,
  S_IRGRP: 32,
  S_IWGRP: 16,
  S_IXGRP: 8,
  S_IRWXO: 7,
  S_IROTH: 4,
  S_IWOTH: 2,
  S_IXOTH: 1,
};
const platformConstants = {
  darwin: {
    O_RDONLY: 0x0,
    O_WRONLY: 0x1,
    O_RDWR: 0x2,
    O_CREAT: 0x200,
    O_EXCL: 0x800,
    O_NOCTTY: 0x20000,
    O_TRUNC: 0x400,
    O_APPEND: 0x8,
    O_DIRECTORY: 0x100000,
    O_NOFOLLOW: 0x100,
    O_SYNC: 0x80,
    O_DSYNC: 0x400000,
    O_SYMLINK: 0x200000,
    O_NONBLOCK: 0x4,
  },
  linux: {
    O_RDONLY: 0x0,
    O_WRONLY: 0x1,
    O_RDWR: 0x2,
    O_CREAT: 0x40,
    O_EXCL: 0x80,
    O_NOCTTY: 0x100,
    O_TRUNC: 0x200,
    O_APPEND: 0x400,
    O_DIRECTORY: 0x10000,
    O_NOATIME: 0x40000,
    O_NOFOLLOW: 0x20000,
    O_SYNC: 0x101000,
    O_DSYNC: 0x1000,
    O_DIRECT: 0x4000,
    O_NONBLOCK: 0x800,
  },
};
const constants = Object.assign({}, universalConstants, platformConstants[Process.platform] || {});

class ReadStream extends stream.Readable {
  constructor(path) {
    super({
      highWaterMark: 4 * 1024 * 1024
    });

    this._input = null;
    this._readRequest = null;

    const pathStr = Memory.allocUtf8String(path);
    const fd = open(pathStr, 0, 0);
    if (fd.value === -1) {
      this.emit('error', new Error(`Unable to open file (${getErrorString(fd.errno)})`));
      this.push(null);
      return;
    }

    this._input = new UnixInputStream(fd.value, { autoClose: true });
  }

  _read(size) {
    if (this._readRequest !== null)
      return;

    this._readRequest = this._input.read(size)
    .then(buffer => {
      this._readRequest = null;

      if (buffer.byteLength === 0) {
        this._closeInput();
        this.push(null);
        return;
      }

      if (this.push(Buffer.from(buffer)))
        this._read(size);
    })
    .catch(error => {
      this._readRequest = null;
      this._closeInput();
      this.push(null);
    });
  }

  _closeInput() {
    if (this._input !== null) {
      this._input.close();
      this._input = null;
    }
  }
}

class WriteStream extends stream.Writable {
  constructor(path) {
    super({
      highWaterMark: 4 * 1024 * 1024
    });

    this._output = null;
    this._writeRequest = null;

    const pathStr = Memory.allocUtf8String(path);
    /*
     * flags = O_WRONLY | O_CREAT (= 0x201)
     * mode  = 0644               (= 0x1a4)
     */
    const fd = open(pathStr, 0x201, 0x1a4);
    if (fd.value === -1) {
      this.emit('error', new Error(`Unable to open file (${getErrorString(fd.errno)})`));
      this.push(null);
      return;
    }

    this._output = new UnixOutputStream(fd.value, { autoClose: true });
    this.on('finish', () => this._closeOutput());
    this.on('error', () => this._closeOutput());
  }

  _write(chunk, encoding, callback) {
    if (this._writeRequest !== null)
      return;

    this._writeRequest = this._output.writeAll(chunk)
    .then(size => {
      this._writeRequest = null;

      callback();
    })
    .catch(error => {
      this._writeRequest = null;

      callback(error);
    });
  }

  _closeOutput() {
    if (this._output !== null) {
      this._output.close();
      this._output = null;
    }
  }
}

function readdirSync(path) {
  const {opendir, closedir, readdir} = getApi();

  const dir = opendir(Memory.allocUtf8String(path));
  const dirHandle = dir.value;
  if (dirHandle.isNull())
    throw new Error(`Unable to open directory (${getErrorString(dir.errno)})`);

  try {
    const entries = [];

    let entry;
    while (!((entry = readdir(dirHandle)).isNull())) {
      const name = Memory.readUtf8String(entry.add(8));
      entries.push(name);
    }

    return entries;
  } finally {
    closedir(dirHandle);
  }
}

function statSync(path) {
}

function getErrorString(errno) {
  return Memory.readUtf8String(strerror(errno));
}

function callbackify(original) {
  return function (...args) {
    const numArgsMinusOne = args.length - 1;

    const implArgs = args.slice(0, numArgsMinusOne);
    const callback = args[numArgsMinusOne];

    process.nextTick(function () {
      try {
        const result = original(...implArgs);
        callback(null, result);
      } catch (e) {
        callback(e);
      }
    });
  };
}

const SF = SystemFunction;
const NF = NativeFunction;

const apiSpec = [
  ['open', SF, 'int', ['pointer', 'int', '...', 'int']],
  ['opendir', SF, 'pointer', ['pointer']],
  ['closedir', NF, 'int', ['pointer']],
  ['readdir', NF, 'pointer', ['pointer']],
  ['strerror', NF, 'pointer', ['int']],
];

let cachedApi = null;
function getApi() {
  if (cachedApi === null) {
    cachedApi = apiSpec.reduce((api, entry) => {
      addApiPlaceholder(api, entry);
      return api;
    }, {});
  }
  return cachedApi;
}

function addApiPlaceholder(api, entry) {
  const [name] = entry;

  Object.defineProperty(api, name, {
    configurable: true,
    get() {
      const [, Ctor, retType, argTypes] = entry;

      const impl = new Ctor(Module.findExportByName(null, name), retType, argTypes);
      Object.defineProperty(api, name, { value: impl });

      return impl;
    }
  });
}

module.exports = {
  constants,
  createReadStream(path) {
    return new ReadStream(path);
  },
  createWriteStream(path) {
    return new WriteStream(path);
  },
  readdir: callbackify(readdirSync),
  readdirSync,
  stat: callbackify(readdirSync),
  statSync,
};
