/*
 * Copyright (C) 2023 Ole André Vadla Ravnås <oleavr@nowsecure.com>
 *
 * Licence: wxWindows Library Licence, Version 3.1
 */

#define SUITE "/Basics"
#include "fixture.c"

TESTLIST_BEGIN (basics)
#ifdef G_OS_WIN32
  TESTENTRY (debug_read_stream)
#endif
  TESTENTRY (stat_should_support_files)
  TESTENTRY (stat_should_support_directories)
#ifdef G_OS_UNIX
  TESTENTRY (stat_should_support_character_devices)
  TESTENTRY (stat_should_support_symbolic_links)
#endif
  TESTENTRY (mkdir_should_create_directory)
  TESTENTRY (mkdir_should_fail_on_existing_directory)
  TESTENTRY (mkdir_should_support_recursive)
  TESTENTRY (append_file_should_append)
  TESTENTRY (exists_should_report_presence)
  TESTENTRY (rename_should_replace_destination)
  TESTENTRY (copy_file_should_replace_destination)
  TESTENTRY (copy_file_should_honor_excl)
  TESTENTRY (truncate_should_resize)
  TESTENTRY (utimes_should_set_times)
#ifndef G_OS_WIN32
  TESTENTRY (read_stream_should_support_range)
  TESTENTRY (read_stream_should_support_start_without_end)
#endif
  TESTENTRY (read_stream_should_support_end_without_start)
  TESTENTRY (read_stream_should_honor_high_water_mark)
  TESTENTRY (read_stream_should_reject_inverted_range)
#ifdef G_OS_UNIX
  TESTENTRY (chmod_should_set_mode)
  TESTENTRY (symlink_should_create_link)
  TESTENTRY (realpath_should_resolve_links)
  TESTENTRY (access_should_check_mode)
#endif
TESTLIST_END ()

static void remove_tree (const gchar * path);

#ifdef G_OS_WIN32

TESTCASE (debug_read_stream)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);
  TestMessageItem * item;

  PUSH_TIMEOUT (10000);
  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, 'Hello world');"
      "const log = ['size ' + fs.statSync(path).size];"
      "const originalInputRead = Win32InputStream.prototype.read;"
      "Win32InputStream.prototype.read = function (size) {"
      "  return originalInputRead.call(this, size).then(b => { log.push('input.read ' + size + ' -> ' + b.byteLength); return b; });"
      "};"
      "function stream(tag, options, next) {"
      "  const s = fs.createReadStream(path, options);"
      "  const originalRead = s._read.bind(s);"
      "  s._read = size => { log.push(tag + ' _read ' + size); originalRead(size); };"
      "  s.on('data', c => log.push(tag + ' data ' + c.length))"
      "   .on('end', () => { log.push(tag + ' end'); next(); })"
      "   .on('error', e => { log.push(tag + ' error ' + e.message); next(); });"
      "}"
      "stream('hwm4', { highWaterMark: 4 }, () =>"
      "  stream('hwm5', { highWaterMark: 5 }, () =>"
      "    stream('default', {}, () =>"
      "      stream('end10', { end: 10 }, probeRaw))));"
      "function probeRaw() {"
      "  const CreateFileW = new NativeFunction("
      "      Process.getModuleByName('kernel32.dll').getExportByName('CreateFileW'),"
      "      'pointer', ['pointer', 'uint', 'uint', 'pointer', 'uint', 'uint', 'pointer'],"
      "      (Process.pointerSize === 4) ? { abi: 'stdcall' } : {});"
      "  async function readAll(flags, size) {"
      "    const handle = CreateFileW(Memory.allocUtf16String(path), 0x80000000, 1, NULL, 3, flags, NULL);"
      "    const input = new Win32InputStream(handle, { autoClose: true });"
      "    const sizes = [];"
      "    for (let i = 0; i !== 6; i++) {"
      "      const chunk = await input.read(size);"
      "      sizes.push(chunk.byteLength);"
      "      if (chunk.byteLength === 0) break;"
      "    }"
      "    await input.close();"
      "    return sizes;"
      "  }"
      "  (async () => {"
      "    log.push('raw overlapped 4: ' + JSON.stringify(await readAll(0x40000000, 4)));"
      "    log.push('raw overlapped 5: ' + JSON.stringify(await readAll(0x40000000, 5)));"
      "    log.push('raw plain 4: ' + JSON.stringify(await readAll(0, 4)));"
      "    log.push('raw plain 5: ' + JSON.stringify(await readAll(0, 5)));"
      "  })()"
      "  .catch(e => log.push('raw error ' + e.stack))"
      "  .then(() => send(log));"
      "}",
      ESCAPE_PATH (dir));

  item = test_fixture_pop_message (fixture);
  g_printerr ("\nDEBUG: %s\n", item->message);
  test_message_item_free (item);
  POP_TIMEOUT ();

  remove_tree (dir);
  g_free (dir);
}

#endif

TESTCASE (stat_should_support_files)
{
  GFile * file;
  GFileIOStream * stream;
  gchar * path;
  const gchar * message = "Hello";

  file = g_file_new_tmp (NULL, &stream, NULL);
  path = g_file_get_path (file);
  g_output_stream_write_all (
      g_io_stream_get_output_stream (G_IO_STREAM (stream)),
      message, strlen (message), NULL, NULL, NULL);
  g_io_stream_close (G_IO_STREAM (stream), NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const st = fs.statSync('%s');"
      "send(st.isFile());"
      "send(st.size);",
      ESCAPE_PATH (path));
  EXPECT_SEND_MESSAGE_WITH ("true");
  EXPECT_SEND_MESSAGE_WITH ("5");

  g_file_delete (file, NULL, NULL);
  g_free (path);
  g_object_unref (stream);
  g_object_unref (file);
}

TESTCASE (stat_should_support_directories)
{
  gchar * path = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "send(fs.statSync('%s').isDirectory());",
      ESCAPE_PATH (path));
  EXPECT_SEND_MESSAGE_WITH ("true");

  g_rmdir (path);
  g_free (path);
}

#ifdef G_OS_UNIX

TESTCASE (stat_should_support_character_devices)
{
  COMPILE_AND_LOAD_SCRIPT ("send(fs.statSync('/dev/null')"
      ".isCharacterDevice());");
  EXPECT_SEND_MESSAGE_WITH ("true");
}

TESTCASE (stat_should_support_symbolic_links)
{
  COMPILE_AND_LOAD_SCRIPT ("send(fs.lstatSync('/dev/stdout')"
      ".isSymbolicLink());");
  EXPECT_SEND_MESSAGE_WITH ("true");
}

#endif

TESTCASE (mkdir_should_create_directory)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/child';"
      "fs.mkdirSync(path);"
      "send(fs.statSync(path).isDirectory());",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("true");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (mkdir_should_fail_on_existing_directory)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "try {"
      "  fs.mkdirSync('%s');"
      "  send('created');"
      "} catch (e) {"
      "  send('failed');"
      "}",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"failed\"");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (mkdir_should_support_recursive)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/a/b/c';"
      "fs.mkdirSync(path, { recursive: true });"
      "fs.mkdirSync(path, { recursive: true });"
      "send(fs.statSync(path).isDirectory());",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("true");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (append_file_should_append)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, 'Hello');"
      "fs.appendFileSync(path, ' world');"
      "send(fs.readFileSync(path, 'utf8'));",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"Hello world\"");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (exists_should_report_presence)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const dir = '%s';"
      "send([fs.existsSync(dir), fs.existsSync(dir + '/missing')]);",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("[true,false]");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (rename_should_replace_destination)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const dir = '%s';"
      "fs.writeFileSync(dir + '/a', 'new');"
      "fs.writeFileSync(dir + '/b', 'old');"
      "fs.renameSync(dir + '/a', dir + '/b');"
      "send([fs.existsSync(dir + '/a'), fs.readFileSync(dir + '/b', 'utf8')]);",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("[false,\"new\"]");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (copy_file_should_replace_destination)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const dir = '%s';"
      "fs.writeFileSync(dir + '/a', 'new');"
      "fs.writeFileSync(dir + '/b', 'much older');"
      "fs.copyFileSync(dir + '/a', dir + '/b');"
      "send([fs.readFileSync(dir + '/a', 'utf8'), fs.readFileSync(dir + '/b', 'utf8')]);",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("[\"new\",\"new\"]");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (copy_file_should_honor_excl)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const dir = '%s';"
      "fs.writeFileSync(dir + '/a', 'new');"
      "fs.writeFileSync(dir + '/b', 'old');"
      "try {"
      "  fs.copyFileSync(dir + '/a', dir + '/b', fs.constants.COPYFILE_EXCL);"
      "  send('copied');"
      "} catch (e) {"
      "  send(fs.readFileSync(dir + '/b', 'utf8'));"
      "}",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"old\"");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (truncate_should_resize)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, 'Hello world');"
      "fs.truncateSync(path, 5);"
      "const shrunk = fs.readFileSync(path, 'utf8');"
      "fs.truncateSync(path, 8);"
      "const grown = fs.statSync(path).size;"
      "fs.truncateSync(path);"
      "send([shrunk, grown, fs.statSync(path).size]);",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("[\"Hello\",8,0]");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (utimes_should_set_times)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, '');"
      "fs.utimesSync(path, new Date(1500000000000), new Date(1600000000000));"
      "send(fs.statSync(path).mtimeMs);",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("1600000000000");

  remove_tree (dir);
  g_free (dir);
}

#ifndef G_OS_WIN32

TESTCASE (read_stream_should_support_range)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, 'Hello world');"
      "const chunks = [];"
      "fs.createReadStream(path, { start: 6, end: 9 })"
      "    .on('data', chunk => chunks.push(chunk.toString()))"
      "    .on('end', () => send(chunks.join('')));",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"worl\"");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (read_stream_should_support_start_without_end)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, 'Hello world');"
      "const chunks = [];"
      "fs.createReadStream(path, { start: 6 })"
      "    .on('data', chunk => chunks.push(chunk.toString()))"
      "    .on('end', () => send(chunks.join('')));",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"world\"");

  remove_tree (dir);
  g_free (dir);
}

#endif

TESTCASE (read_stream_should_support_end_without_start)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, 'Hello world');"
      "const chunks = [];"
      "fs.createReadStream(path, { end: 4 })"
      "    .on('data', chunk => chunks.push(chunk.toString()))"
      "    .on('end', () => send(chunks.join('')));",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"Hello\"");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (read_stream_should_honor_high_water_mark)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, 'Hello world');"
      "const sizes = [];"
      "fs.createReadStream(path, { highWaterMark: 4 })"
      "    .on('data', chunk => sizes.push(chunk.length))"
      "    .on('end', () => send(sizes));",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("[4,4,3]");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (read_stream_should_reject_inverted_range)
{
  COMPILE_AND_LOAD_SCRIPT (
      "try {"
      "  fs.createReadStream('/nonexistent', { start: 5, end: 4 });"
      "  send('created');"
      "} catch (e) {"
      "  send(e.name);"
      "}");
  EXPECT_SEND_MESSAGE_WITH ("\"RangeError\"");
}

#ifdef G_OS_UNIX

TESTCASE (chmod_should_set_mode)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, '');"
      "fs.chmodSync(path, 0o640);"
      "send((fs.statSync(path).mode & 0o777).toString(8));",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"640\"");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (symlink_should_create_link)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const dir = '%s';"
      "fs.symlinkSync('target', dir + '/link');"
      "send([fs.lstatSync(dir + '/link').isSymbolicLink(), fs.readlinkSync(dir + '/link')]);",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("[true,\"target\"]");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (realpath_should_resolve_links)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const dir = fs.realpathSync('%s');"
      "fs.writeFileSync(dir + '/target', '');"
      "fs.symlinkSync('target', dir + '/link');"
      "send(fs.realpathSync(dir + '/link') === dir + '/target');",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("true");

  remove_tree (dir);
  g_free (dir);
}

TESTCASE (access_should_check_mode)
{
  gchar * dir = g_dir_make_tmp (NULL, NULL);

  COMPILE_AND_LOAD_SCRIPT (
      "const path = '%s/file';"
      "fs.writeFileSync(path, '');"
      "fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK);"
      "try {"
      "  fs.accessSync(path, fs.constants.X_OK);"
      "  send('executable');"
      "} catch (e) {"
      "  send('denied');"
      "}",
      ESCAPE_PATH (dir));
  EXPECT_SEND_MESSAGE_WITH ("\"denied\"");

  remove_tree (dir);
  g_free (dir);
}

#endif

static void
remove_tree (const gchar * path)
{
  GDir * dir;
  const gchar * name;

  dir = g_dir_open (path, 0, NULL);
  if (dir != NULL)
  {
    while ((name = g_dir_read_name (dir)) != NULL)
    {
      gchar * child = g_build_filename (path, name, NULL);
      remove_tree (child);
      g_free (child);
    }
    g_dir_close (dir);
  }

  g_remove (path);
}
