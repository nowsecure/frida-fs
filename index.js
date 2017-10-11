'use strict';

const stream = require('stream');

const open = new SystemFunction(Module.findExportByName(null, 'open'), 'int', ['pointer', 'int', 'int']);
const strerror = new NativeFunction(Module.findExportByName(null, 'strerror'), 'pointer', ['int']);

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

    this._writeRequest = this._output.write(chunk)
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

function getErrorString(errno) {
  return Memory.readUtf8String(strerror(errno));
}

module.exports = {
  createReadStream(path) {
    return new ReadStream(path);
  },
  createWriteStream(path) {
    return new WriteStream(path);
  }
};
