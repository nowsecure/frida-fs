import {Buffer} from 'buffer';
import process from 'process';
import stream from 'stream';

const {platform, pointerSize} = Process;
const isWindows = platform === 'windows';

const S_IFMT = 0xf000;
const S_IFREG = 0x8000;
const S_IFDIR = 0x4000;
const S_IFCHR = 0x2000;
const S_IFBLK = 0x6000;
const S_IFIFO = 0x1000;
const S_IFLNK = 0xa000;
const S_IFSOCK = 0xc000;

const universalConstants = {
  S_IFMT,
  S_IFREG,
  S_IFDIR,
  S_IFCHR,
  S_IFBLK,
  S_IFIFO,
  S_IFLNK,
  S_IFSOCK,

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

  DT_UNKNOWN: 0,
  DT_FIFO: 1,
  DT_CHR: 2,
  DT_DIR: 4,
  DT_BLK: 6,
  DT_REG: 8,
  DT_LNK: 10,
  DT_SOCK: 12,
  DT_WHT: 14,
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
const constants = Object.assign({}, universalConstants, platformConstants[platform] || {});

const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;

const EINTR = 4;

class ReadStream extends stream.Readable {
  constructor(path) {
    super({
      highWaterMark: 4 * 1024 * 1024
    });

    this._input = null;
    this._readRequest = null;

    const pathStr = Memory.allocUtf8String(path);
    const fd = getApi().open(pathStr, constants.O_RDONLY, 0);
    if (fd.value === -1) {
      process.nextTick(() => {
        this.destroy(new Error(getLibcErrorString(fd.errno)));
      });
      return;
    }

    this._input = new UnixInputStream(fd.value, { autoClose: true });
  }

  _destroy(err, callback) {
    if (this._input !== null) {
      this._input.close();
      this._input = null;
    }

    callback(err);
  }

  _read(size) {
    if (this._readRequest !== null)
      return;

    this._readRequest = this._input.read(size)
    .then(buffer => {
      this._readRequest = null;

      if (buffer.byteLength === 0) {
        this.push(null);
        return;
      }

      if (this.push(Buffer.from(buffer)))
        this._read(size);
    })
    .catch(error => {
      this._readRequest = null;
      this.destroy(error);
    });
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
    const flags = constants.O_WRONLY | constants.O_CREAT;
    const mode = constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IROTH;
    const fd = getApi().open(pathStr, flags, mode);
    if (fd.value === -1) {
      process.nextTick(() => {
        this.destroy(new Error(getLibcErrorString(fd.errno)));
      });
      return;
    }

    this._output = new UnixOutputStream(fd.value, { autoClose: true });
  }

  _destroy(err, callback) {
    if (this._output !== null) {
      this._output.close();
      this._output = null;
    }

    callback(err);
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
}

const direntSpecs = {
  'windows': {
    'd_name': [44, 'Utf16String'],
  },
  'linux-32': {
    'd_name': [11, 'Utf8String'],
    'd_type': [10, 'U8']
  },
  'linux-64': {
    'd_name': [19, 'Utf8String'],
    'd_type': [18, 'U8']
  },
  'darwin-32': {
    'd_name': [21, 'Utf8String'],
    'd_type': [20, 'U8']
  },
  'darwin-64': {
    'd_name': [21, 'Utf8String'],
    'd_type': [20, 'U8']
  }
};

const enumerateDirectoryEntries = isWindows ? enumerateDirectoryEntriesWindows : enumerateDirectoryEntriesUnix;
const direntSpec = isWindows ? direntSpecs.windows : direntSpecs[`${platform}-${pointerSize * 8}`];

function readdirSync(path) {
  const entries = [];
  enumerateDirectoryEntries(path, entry => {
    const name = readDirentField(entry, 'd_name');
    entries.push(name);
  });
  return entries;
}

function list(path) {
  const entries = [];
  enumerateDirectoryEntries(path, entry => {
    entries.push({
      name: readDirentField(entry, 'd_name'),
      type: readDirentField(entry, 'd_type')
    });
  });
  return entries;
}

function enumerateDirectoryEntriesWindows(path, callback) {
  const {FindFirstFileW, FindNextFileW, FindClose} = getApi();
  const INVALID_HANDLE_VALUE = ptr(-1);

  const data = Memory.alloc(128 * 1024); // FIXME

  const result = FindFirstFileW(Memory.allocUtf16String(path + '\\*'), data);
  const handle = result.value;
  if (handle.equals(INVALID_HANDLE_VALUE))
    throwWindowsError(result.lastError);

  try {
    do {
      callback(data);
    } while (FindNextFileW(handle, data) !== 0);
  } finally {
    FindClose(handle);
  }
}

function enumerateDirectoryEntriesUnix(path, callback) {
  const {opendir, opendir$INODE64, closedir, readdir, readdir$INODE64} = getApi();

  const opendirImpl = opendir$INODE64 || opendir;
  const readdirImpl = readdir$INODE64 || readdir;

  const dir = opendirImpl(Memory.allocUtf8String(path));
  const dirHandle = dir.value;
  if (dirHandle.isNull())
    throwUnixError(dir.errno);

  try {
    let entry;
    while (!((entry = readdirImpl(dirHandle)).isNull())) {
      callback(entry);
    }
  } finally {
    closedir(dirHandle);
  }
}

function readDirentField(entry, name) {
  const [offset, type] = direntSpec[name];

  const read = (typeof type === 'string') ? NativePointer.prototype['read' + type] : type;

  const value = read.call(entry.add(offset));
  if (value instanceof Int64 || value instanceof UInt64)
    return value.valueOf();

  return value;
}

function readFileSync(path, options = {}) {
  if (typeof options === 'string')
    options = { encoding: options };
  const {encoding = null} = options;

  const {open, close, lseek, read} = getApi();

  const pathStr = Memory.allocUtf8String(path);
  const openResult = open(pathStr, constants.O_RDONLY, 0);
  const fd = openResult.value;
  if (fd === -1)
    throwUnixError(openResult.errno);

  try {
    const fileSize = lseek(fd, 0, SEEK_END).valueOf();

    lseek(fd, 0, SEEK_SET);

    const buf = Memory.alloc(fileSize);
    let readResult, n, readFailed;
    do {
      readResult = read(fd, buf, fileSize);
      n = readResult.value.valueOf();
      readFailed = n === -1;
    } while (readFailed && readResult.errno === EINTR);

    if (readFailed)
      throwUnixError(readResult.errno);

    if (n !== fileSize.valueOf())
      throw new Error('Short read');

    if (encoding === 'utf8') {
      return buf.readUtf8String(fileSize);
    }

    const value = Buffer.from(buf.readByteArray(fileSize));
    if (encoding !== null) {
      return value.toString(encoding);
    }

    return value;
  } finally {
    close(fd);
  }
}

function readlinkSync(path) {
  const api = getApi();

  const pathStr = Memory.allocUtf8String(path);

  const linkSize = lstatSync(path).size.valueOf();
  const buf = Memory.alloc(linkSize);

  const result = api.readlink(pathStr, buf, linkSize);
  const n = result.value.valueOf();
  if (n === -1)
    throwUnixError(result.errno);

  return buf.readUtf8String(n);
}

function rmdirSync(path) {
  const pathStr = Memory.allocUtf8String(path);

  const result = getApi().rmdir(pathStr);
  if (result.value === -1)
    throwUnixError(result.errno);
}

function unlinkSync(path) {
  const pathStr = Memory.allocUtf8String(path);

  const result = getApi().unlink(pathStr);
  if (result.value === -1)
    throwUnixError(result.errno);
}

const statFields = new Set([
  'dev',
  'mode',
  'nlink',
  'uid',
  'gid',
  'rdev',
  'blksize',
  'ino',
  'size',
  'blocks',
  'atimeMs',
  'mtimeMs',
  'ctimeMs',
  'birthtimeMs',
  'atime',
  'mtime',
  'ctime',
  'birthtime',
]);
const statSpecs = {
  'windows': {
    size: 36,
    fields: {
      'dev': [ 0, returnZero ],
      'mode': [ 0, readWindowsFileAttributes ],
      'nlink': [ 0, returnOne ],
      'ino': [ 0, returnZero ],
      'uid': [ 0, returnZero ],
      'gid': [ 0, returnZero ],
      'rdev': [ 0, returnZero ],
      'atime': [ 12, readWindowsFileTime ],
      'mtime': [ 20, readWindowsFileTime ],
      'ctime': [ 4, readWindowsFileTime ],
      'size': [ 28, readWindowsFileSize ],
      'blocks': [ 28, readWindowsFileSize ],
      'blksize': [ 0, returnOne ],
    },
  },
  'darwin-32': {
    size: 108,
    fields: {
      'dev': [ 0, 'S32' ],
      'mode': [ 4, 'U16' ],
      'nlink': [ 6, 'U16' ],
      'ino': [ 8, 'U64' ],
      'uid': [ 16, 'U32' ],
      'gid': [ 20, 'U32' ],
      'rdev': [ 24, 'S32' ],
      'atime': [ 28, readTimespec32 ],
      'mtime': [ 36, readTimespec32 ],
      'ctime': [ 44, readTimespec32 ],
      'birthtime': [ 52, readTimespec32 ],
      'size': [ 60, 'S64' ],
      'blocks': [ 68, 'S64' ],
      'blksize': [ 76, 'S32' ],
    }
  },
  'darwin-64': {
    size: 144,
    fields: {
      'dev': [ 0, 'S32' ],
      'mode': [ 4, 'U16' ],
      'nlink': [ 6, 'U16' ],
      'ino': [ 8, 'U64' ],
      'uid': [ 16, 'U32' ],
      'gid': [ 20, 'U32' ],
      'rdev': [ 24, 'S32' ],
      'atime': [ 32, readTimespec64 ],
      'mtime': [ 48, readTimespec64 ],
      'ctime': [ 64, readTimespec64 ],
      'birthtime': [ 80, readTimespec64 ],
      'size': [ 96, 'S64' ],
      'blocks': [ 104, 'S64' ],
      'blksize': [ 112, 'S32' ],
    }
  },
  'linux-32': {
    size: 88,
    fields: {
      'dev': [ 0, 'U64' ],
      'mode': [ 16, 'U32' ],
      'nlink': [ 20, 'U32' ],
      'ino': [ 12, 'U32' ],
      'uid': [ 24, 'U32' ],
      'gid': [ 28, 'U32' ],
      'rdev': [ 32, 'U64' ],
      'atime': [ 56, readTimespec32 ],
      'mtime': [ 64, readTimespec32 ],
      'ctime': [ 72, readTimespec32 ],
      'size': [ 44, 'S32' ],
      'blocks': [ 52, 'S32' ],
      'blksize': [ 48, 'S32' ],
    }
  },
  'linux-32-stat64': {
    size: 104,
    fields: {
      'dev': [ 0, 'U64' ],
      'mode': [ 16, 'U32' ],
      'nlink': [ 20, 'U32' ],
      'ino': [ 96, 'U64' ],
      'uid': [ 24, 'U32' ],
      'gid': [ 28, 'U32' ],
      'rdev': [ 32, 'U64' ],
      'atime': [ 72, readTimespec32 ],
      'mtime': [ 80, readTimespec32 ],
      'ctime': [ 88, readTimespec32 ],
      'size': [ 48, 'S64' ],
      'blocks': [ 64, 'S64' ],
      'blksize': [ 56, 'S32' ],
    }
  },
  'linux-64': {
    size: 144,
    fields: {
      'dev': [ 0, 'U64' ],
      'mode': [ 24, 'U32' ],
      'nlink': [ 16, 'U64' ],
      'ino': [ 8, 'U64' ],
      'uid': [ 28, 'U32' ],
      'gid': [ 32, 'U32' ],
      'rdev': [ 40, 'U64' ],
      'atime': [ 72, readTimespec64 ],
      'mtime': [ 88, readTimespec64 ],
      'ctime': [ 104, readTimespec64 ],
      'size': [ 48, 'S64' ],
      'blocks': [ 64, 'S64' ],
      'blksize': [ 56, 'S64' ],
    },
  },
};
let cachedStatSpec = null;
const statBufSize = 256;

function getStatSpec() {
  if (cachedStatSpec !== null)
    return cachedStatSpec;

  let statSpec;
  if (isWindows) {
    statSpec = statSpecs.windows;
  } else {
    const api = getApi();
    const stat64Impl = api.stat64 ?? api.__xstat64;

    let platformId = `${platform}-${pointerSize * 8}`;
    if (platformId === 'linux-32') {
      if (stat64Impl !== undefined)
        platformId += '-stat64';
    }

    const statSpec = statSpecs[platformId];
    if (statSpec === undefined)
      throw new Error('Current OS is not yet supported; please open a PR');

    statSpec._stat = stat64Impl ?? api.stat;
    statSpec._lstat = api.lstat64 ?? api.__lxstat64 ?? api.lstat;
  }

  cachedStatSpec = statSpec;

  return statSpec;
}

class Stats {
  isFile() {
    return (this.mode & S_IFMT) === S_IFREG;
  }

  isDirectory() {
    return (this.mode & S_IFMT) === S_IFDIR;
  }

  isCharacterDevice() {
    return (this.mode & S_IFMT) === S_IFCHR;
  }

  isBlockDevice() {
    return (this.mode & S_IFMT) === S_IFBLK;
  }

  isFIFO() {
    return (this.mode & S_IFMT) === S_IFIFO;
  }

  isSymbolicLink() {
    return (this.mode & S_IFMT) === S_IFLNK;
  }

  isSocket() {
    return (this.mode & S_IFMT) === S_IFSOCK;
  }
}

function statSync(path) {
  if (isWindows)
    return performStatWindows(path);
  return performStatUnix(getStatSpec()._stat, path);
}

function lstatSync(path) {
  if (isWindows)
    return statSync(path);
  return performStatUnix(getStatSpec()._lstat, path);
}

function performStatWindows(path) {
  const getFileExInfoStandard = 0;
  const buf = Memory.alloc(36);
  const result = getApi().GetFileAttributesExW(Memory.allocUtf16String(path), getFileExInfoStandard, buf);
  console.log(`stat() path=\"${path}\" result=${JSON.stringify(result)}`);
  if (result.value === 0)
    throwWindowsError(result.lastError);
  return makeStatsProxy(buf);
}

function performStatUnix(impl, path) {
  const buf = Memory.alloc(statBufSize);
  const result = impl(Memory.allocUtf8String(path), buf);
  if (result.value !== 0)
    throwUnixError(result.errno);
  return makeStatsProxy(buf);
}

function makeStatsProxy(buf) {
  return new Proxy(new Stats(), {
    has(target, property) {
      return statsHasField(property);
    },
    get(target, property, receiver) {
      switch (property) {
        case 'prototype':
        case 'constructor':
        case 'toString':
          return target[property];
        case 'hasOwnProperty':
          return statsHasField;
        case 'valueOf':
          return receiver;
        case 'buffer':
          return buf;
        default:
          if (property in target)
            return target[property];
          const value = statsReadField.call(receiver, property);
          return (value !== null) ? value : undefined;
      }
    },
    set(target, property, value, receiver) {
      return false;
    },
    ownKeys(target) {
      return Array.from(statFields);
    },
    getOwnPropertyDescriptor(target, property) {
      return {
        writable: false,
        configurable: true,
        enumerable: true
      };
    },
  });
}

function statsHasField(name) {
  return statFields.has(name);
}

function statsReadField(name) {
  let field = getStatSpec().fields[name];
  if (field === undefined) {
    if (name === 'birthtime') {
      return statsReadField.call(this, 'ctime');
    }

    const msPos = name.lastIndexOf('Ms');
    if (msPos === name.length - 2) {
      return statsReadField.call(this, name.substr(0, msPos)).getTime();
    }

    return undefined;
  }

  const [offset, type] = field;

  const read = (typeof type === 'string') ? NativePointer.prototype['read' + type] : type;

  const value = read.call(this.buffer.add(offset));
  if (value instanceof Int64 || value instanceof UInt64)
    return value.valueOf();

  return value;
}

function readWindowsFileAttributes() {
  const FILE_ATTRIBUTE_DIRECTORY = 0x10;

  let mode;
  if ((this.readU32() & FILE_ATTRIBUTE_DIRECTORY) !== 0)
    mode = S_IFDIR | 0x1ed;
  else
    mode |= S_IFREG | 0x1a4;

  return mode;
}

function readWindowsFileTime() {
  const fileTime = BigInt(this.readU64().toString()).valueOf();
  const hundredNsecInMsec = 10000n;
  const msecToUnixEpoch = 11644473600000n;
  const unixTime = (fileTime / hundredNsecInMsec) + msecToUnixEpoch;
  return new Date(parseInt(unixTime));
}

function readWindowsFileSize() {
  const high = this.readU32();
  const low = this.add(4).readU32();
  return uint64(high).shl(32).or(low);
}

function readTimespec32() {
  const sec = this.readU32();
  const nsec = this.add(4).readU32();
  const msec = nsec / 1000000;
  return new Date((sec * 1000) + msec);
}

function readTimespec64() {
  // FIXME: Improve UInt64 to support division
  const sec = this.readU64().valueOf();
  const nsec = this.add(8).readU64().valueOf();
  const msec = nsec / 1000000;
  return new Date((sec * 1000) + msec);
}

function returnZero() {
  return 0;
}

function returnOne() {
  return 1;
}

function throwWindowsError(lastError) {
  throw makeWindowsError(lastError);
}

function throwUnixError(errno) {
  throw makeUnixError(errno);
}

function makeWindowsError(lastError) {
  return new Error('Something went wrong: LastError=' + lastError);
}

function makeUnixError(errno) {
  return new Error(getLibcErrorString(errno));
}

function getLibcErrorString(errno) {
  return getApi().strerror(errno).readUtf8String();
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

const nativeOpts = (isWindows && pointerSize === 4) ? { abi: 'stdcall' } : {};

const ssizeType = (pointerSize === 8) ? 'int64' : 'int32';
const sizeType = 'u' + ssizeType;
const offsetType = (platform === 'darwin' || pointerSize === 8) ? 'int64' : 'int32';

let apiSpec;
if (isWindows) {
  apiSpec = [
    ['FindFirstFileW', SF, 'pointer', ['pointer', 'pointer']],
    ['FindNextFileW', NF, 'uint', ['pointer', 'pointer']],
    ['FindClose', NF, 'uint', ['pointer']],
    ['GetFileAttributesExW', SF, 'uint', ['pointer', 'uint', 'pointer']],
  ];
} else {
  apiSpec = [
    ['open', SF, 'int', ['pointer', 'int', '...', 'int']],
    ['close', NF, 'int', ['int']],
    ['lseek', NF, offsetType, ['int', offsetType, 'int']],
    ['read', SF, ssizeType, ['int', 'pointer', sizeType]],
    ['opendir', SF, 'pointer', ['pointer']],
    ['opendir$INODE64', SF, 'pointer', ['pointer']],
    ['closedir', NF, 'int', ['pointer']],
    ['readdir', NF, 'pointer', ['pointer']],
    ['readdir$INODE64', NF, 'pointer', ['pointer']],
    ['readlink', SF, ssizeType, ['pointer', 'pointer', sizeType]],
    ['rmdir', SF, 'int', ['pointer']],
    ['unlink', SF, 'int', ['pointer']],
    ['stat', SF, 'int', ['pointer', 'pointer']],
    ['stat64', SF, 'int', ['pointer', 'pointer']],
    ['__xstat64', SF, 'int', ['int', 'pointer', 'pointer'], invokeXstat],
    ['lstat', SF, 'int', ['pointer', 'pointer']],
    ['lstat64', SF, 'int', ['pointer', 'pointer']],
    ['__lxstat64', SF, 'int', ['int', 'pointer', 'pointer'], invokeXstat],
    ['strerror', NF, 'pointer', ['int']],
  ];
}

function invokeXstat(impl, path, buf) {
  const STAT_VER_LINUX = 3;
  return impl(STAT_VER_LINUX, path, buf);
}

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
      const [, Ctor, retType, argTypes, wrapper] = entry;

      let impl = null;
      const address = isWindows
          ? Module.findExportByName('kernel32.dll', name)
          : Module.findExportByName(null, name);
      if (address !== null)
        impl = new Ctor(address, retType, argTypes, nativeOpts);

      if (wrapper !== undefined)
        impl = wrapper.bind(null, impl);

      Object.defineProperty(api, name, { value: impl });

      return impl;
    }
  });
}

export function createReadStream(path) {
  return new ReadStream(path);
}

export function createWriteStream(path) {
  return new WriteStream(path);
}

export const readdir = callbackify(readdirSync);
export const readFile = callbackify(readFileSync);
export const readlink = callbackify(readlinkSync);
export const rmdir = callbackify(rmdirSync);
export const unlink = callbackify(unlinkSync);
export const stat = callbackify(statSync);
export const lstat = callbackify(lstatSync);

export {
  constants,
  readdirSync,
  list,
  readFileSync,
  readlinkSync,
  rmdirSync,
  unlinkSync,
  statSync,
  lstatSync,
  Stats,
};

export default {
  constants,
  createReadStream,
  createWriteStream,
  readdir,
  readdirSync,
  list,
  readFile,
  readFileSync,
  readlink,
  readlinkSync,
  rmdir,
  rmdirSync,
  unlink,
  unlinkSync,
  stat,
  statSync,
  lstat,
  lstatSync,
  Stats,
};
