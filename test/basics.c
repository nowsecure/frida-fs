/*
 * Copyright (C) 2023 Ole André Vadla Ravnås <oleavr@nowsecure.com>
 *
 * Licence: wxWindows Library Licence, Version 3.1
 */

#define SUITE "/Basics"
#include "fixture.c"

TESTLIST_BEGIN (basics)
  TESTENTRY (stat_should_support_files)
  TESTENTRY (stat_should_support_directories)
#ifdef G_OS_UNIX
  TESTENTRY (stat_should_support_character_devices)
  TESTENTRY (stat_should_support_symbolic_links)
#endif
TESTLIST_END ()

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
