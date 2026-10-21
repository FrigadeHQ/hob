/** Python start-up step for the Linux sandbox (Landlock). Written next to each run's script, then runs it. */
export const LANDLOCK_PY = `# Garth's Linux sandbox: limits this Python with Landlock (kernel 5.13+), then runs the code.
# Writes: the chat folder and temp. Reads: system files, the runtime, temp and allowed folders. Runs programs: only the runtime's.
# Network (kernel 6.7+): none, unless GARTH_SB_NET=1. Without Landlock (older kernels) the code runs unlimited.
import ctypes, json, os, platform, sys

def _landlock():
    libc = ctypes.CDLL(None, use_errno=True)
    nr = {'x86_64': (444, 445, 446), 'aarch64': (444, 445, 446)}.get(platform.machine())
    if not nr:
        return
    create, add, restrict = nr
    libc.syscall.restype = ctypes.c_long
    abi = libc.syscall(create, None, ctypes.c_size_t(0), ctypes.c_uint32(1))
    if abi < 1:
        return
    EXEC, WRITE, READ, READ_DIR = 1, 2, 4, 8
    fs_all = (1 << 13) - 1
    if abi >= 2: fs_all |= 1 << 13          # refer
    if abi >= 3: fs_all |= 1 << 14          # truncate
    file_rw = WRITE | READ | (1 << 14 if abi >= 3 else 0)
    read = READ | READ_DIR

    class Attr(ctypes.Structure):
        _fields_ = [('fs', ctypes.c_uint64), ('net', ctypes.c_uint64)]
    class Beneath(ctypes.Structure):
        _pack_ = 1
        _fields_ = [('allowed', ctypes.c_uint64), ('fd', ctypes.c_int32)]

    net = abi >= 4 and os.environ.get('GARTH_SB_NET') != '1'
    attr = Attr(fs_all, 3 if net else 0)   # 3 = bind + connect over TCP
    size = ctypes.sizeof(Attr) if abi >= 4 else 8
    rs = libc.syscall(create, ctypes.byref(attr), ctypes.c_size_t(size), ctypes.c_uint32(0))
    if rs < 0:
        return

    def allow(path, access):
        try:
            fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        except OSError:
            return
        try:
            if not os.path.isdir(path):
                access &= EXEC | WRITE | READ | (1 << 14)
            b = Beneath(access, fd)
            libc.syscall(add, ctypes.c_int(rs), ctypes.c_int(1), ctypes.byref(b), ctypes.c_uint32(0))
        finally:
            os.close(fd)

    for p in ('/usr', '/lib', '/lib64', '/lib32', '/bin', '/sbin', '/etc', '/proc', '/sys', '/dev', '/opt', '/run', '/nix', '/snap'):
        allow(p, read)
    allow('/dev/null', file_rw)
    cfg = json.loads(os.environ.get('GARTH_SB', '{}'))
    for p in cfg.get('exec', []):
        allow(p, read | EXEC)
    for p in cfg.get('read', []):
        allow(p, read)
    for p in cfg.get('write', []):
        allow(p, fs_all)
    if libc.prctl(38, 1, 0, 0, 0) != 0:   # no new privileges: required, and stops setuid escapes
        return
    libc.syscall(restrict, ctypes.c_int(rs), ctypes.c_uint32(0))
    os.close(rs)

_landlock()
del _landlock
for _k in ('GARTH_SB', 'GARTH_SB_NET'):
    os.environ.pop(_k, None)
_script = sys.argv[1]
sys.argv = sys.argv[1:]
import runpy
runpy.run_path(_script, run_name='__main__')
`
