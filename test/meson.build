project('frida-fs-tests', 'c', 'cpp')

host_os_family = host_machine.system()

gumjs_dep = dependency('frida-gumjs-1.0', default_options: ['gumjs=enabled'])

sources = [
  'basics.c',
  'runner.c',
  'dummy.cpp',
]

extra_link_args = []
extra_link_depends = []
if host_os_family == 'darwin'
  symlist = 'runner.symbols'
  extra_link_args += '-Wl,-exported_symbols_list,' + meson.current_source_dir() / symlist
  extra_link_depends += symlist
elif host_os_family != 'windows'
  symscript = 'runner.version'
  extra_link_args += '-Wl,--version-script,' + meson.current_source_dir() / symscript
  extra_link_depends += symscript
endif

executable('frida-fs-tests', sources,
  link_args: extra_link_args,
  link_depends: extra_link_depends,
  dependencies: [gumjs_dep],
)
